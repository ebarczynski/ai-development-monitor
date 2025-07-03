// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

/**
 * AI Development Monitor Panel
 * 
 * Provides a dedicated panel for displaying evaluation results and TDD progress.
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');

class AIMonitorPanel {
    /**
     * Track the currently active panel
     * @type {AIMonitorPanel | undefined}
     */
    static currentPanel = undefined;
    
    /**
     * @type {vscode.WebviewPanel}
     */
    _panel;
    
    /**
     * @type {vscode.ExtensionContext}
     */
    _extensionContext;
    
    /**
     * @type {string[]}
     */
    _logEntries = [];
    
    /**
     * @type {Object}
     */
    _lastEvaluation = null;
    
    /**
     * @type {Object[]}
     */
    _tddResults = [];
    
    /**
     * @type {vscode.TextEditorDecorationType}
     */
    _coveredLineDecorationType = null;
    
    /**
     * @type {vscode.TextEditorDecorationType}
     */
    _uncoveredLineDecorationType = null;
    
    /**
     * @type {Object}
     * Stores comprehensive TDD metrics and dashboard data
     */
    _tddMetrics = {
        coverageData: {},
        testProgressHistory: [],
        activeConfiguration: {},
        lastRunDate: null
    };
    
    /**
     * @param {vscode.WebviewPanel} panel
     * @param {vscode.ExtensionContext} context
     */
    constructor(panel, context) {
        this._panel = panel;
        this._extensionContext = context;
        
        // Initialize TDD configuration with defaults
        this._tddMetrics.activeConfiguration = {
            autoRunTests: true,
            showInlineCoverage: true,
            defaultIterations: 5,
            testFramework: 'auto'
        };
        
        // Load existing configuration from settings if available
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.tdd');
        if (config) {
            this._tddMetrics.activeConfiguration.autoRunTests = config.get('autoRunTests', true);
            this._tddMetrics.activeConfiguration.showInlineCoverage = config.get('showInlineCoverage', true);
            this._tddMetrics.activeConfiguration.defaultIterations = config.get('defaultIterations', 5);
            this._tddMetrics.activeConfiguration.testFramework = config.get('testFramework', 'auto');
        }
        
        // Set the webview's initial html content
        this._update();
        
        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, context.subscriptions);
        
        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            context.subscriptions
        );
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'clearLogs':
                        this.clearLogs();
                        break;
                    case 'runTest':
                        vscode.commands.executeCommand('ai-development-monitor.runDiagnosticTest');
                        break;
                    case 'showTddDetails':
                        this.showTddDetails(message.iterationIndex);
                        break;
                    case 'updateTDDConfig':
                        this.updateTDDConfiguration(message.setting, message.value);
                        break;
                    case 'updateSetting':
                        this.updateGlobalSetting(message.setting, message.value);
                        break;
                    case 'openFile':
                        this.openFileWithCoverage(message.filePath);
                        break;
                }
            },
            null,
            context.subscriptions
        );
    }
    
    /**
     * Creates a new panel or reveals an existing one
     * @param {vscode.ExtensionContext} context
     * @returns {AIMonitorPanel}
     */
    static createOrShow(context) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
            
        // If we already have a panel, show it
        if (AIMonitorPanel.currentPanel) {
            AIMonitorPanel.currentPanel._panel.reveal(column);
            return AIMonitorPanel.currentPanel;
        }
        
        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'aiMonitorPanel',
            'AI Development Monitor',
            column || vscode.ViewColumn.One,
            {
                // Enable JavaScript in the webview
                enableScripts: true,
                
                // Restrict the webview to only load resources from the extension directory
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
            }
        );
        
        AIMonitorPanel.currentPanel = new AIMonitorPanel(panel, context);
        return AIMonitorPanel.currentPanel;
    }
    
    /**
     * Add a log entry to the panel
     * @param {string} message The log message
     * @param {string} type The type of log (info, warning, error, success)
     */
    addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = {
            message,
            type,
            timestamp
        };
        
        this._logEntries.push(entry);
        
        // Limit the number of log entries to keep performance good
        if (this._logEntries.length > 100) {
            this._logEntries.shift();
        }
        
        this._update();
    }
    
    /**
     * Set evaluation results to display
     * @param {Object} evaluation The evaluation data
     */
    setEvaluationResults(evaluation) {
        this._lastEvaluation = evaluation;
        
        // Add a log entry for the evaluation
        const accept = evaluation.accept;
        const message = `Evaluation result: ${accept ? 'ACCEPTED' : 'REJECTED'} - ${evaluation.reason}`;
        const type = accept ? 'success' : 'warning';
        
        this.addLogEntry(message, type);
        
        // Store TDD results separately if present
        if (evaluation.tdd_test_results && Array.isArray(evaluation.tdd_test_results)) {
            this._tddResults = evaluation.tdd_test_results;
            
            // Add log entries for TDD iterations
            for (let i = 0; i < this._tddResults.length; i++) {
                const result = this._tddResults[i];
                this.addLogEntry(`TDD Iteration ${result.iteration}: Generated ${result.test_code.length} bytes of test code`, 'info');
            }
        }

        // Highlight GitHub Copilot test execution results if available
        if (evaluation.github_copilot_execution) {
            this.processGitHubCopilotTestResults(evaluation.github_copilot_execution);
        }
        
        this._update();
    }
    
    /**
     * Update the panel with evaluation results from command-triggered evaluations
     * @param {Object} evaluationResult The evaluation result from an AI Dev action
     */
    updateEvaluationResult(evaluationResult) {
        if (!evaluationResult) return;
        
        this._lastEvaluation = evaluationResult;
        
        // Add a log entry for the manually triggered evaluation
        const accept = evaluationResult.accept;
        const reason = evaluationResult.evaluation?.reason || 'No reason provided';
        const message = `Command-triggered evaluation: ${accept ? 'ACCEPTED' : 'REJECTED'} - ${reason}`;
        const type = accept ? 'success' : 'warning';
        
        this.addLogEntry(message, type);
        
        // Make sure the panel becomes visible for command-triggered evaluations
        this._panel.reveal(vscode.ViewColumn.Two);
        
        this._update();
    }
    
    /**
     * Show details of a specific TDD iteration
     * @param {number} index The iteration index
     */
    showTddDetails(index) {
        if (index >= 0 && index < this._tddResults.length) {
            const result = this._tddResults[index];
            const isGithubCopilot = result.source === 'github-copilot-chat' || result.iteration === 0;
            
            // Create an untitled file with the code
            let content = result.test_code;
            let title = 'Test Code';
            
            // For GitHub Copilot results, display both test code and implementation if available
            if (isGithubCopilot && result.implementation_code) {
                content = `// Implementation Code (GitHub Copilot Suggestion)
${result.implementation_code || ''}

// Test Code
${result.test_code || ''}`;
                title = 'GitHub Copilot Test Results';
            }
            
            vscode.workspace.openTextDocument({
                content: content,
                language: result.language || 'python'
            })
            .then(doc => {
                vscode.window.showTextDocument(doc, { preview: true });
                
                // If GitHub Copilot result, show a notification with the test results
                if (isGithubCopilot) {
                    const passRate = result.tests?.total > 0 ? result.tests.passed / result.tests.total : 0;
                    const message = `GitHub Copilot test results: ${result.tests?.passed || 0}/${result.tests?.total || 0} tests passed`;
                    if (passRate === 1) {
                        vscode.window.showInformationMessage(message);
                    } else if (passRate > 0.5) {
                        vscode.window.showWarningMessage(message);
                    } else {
                        vscode.window.showErrorMessage(message);
                    }
                }
            });
        }
    }
    
    /**
     * Clear all logs
     */
    clearLogs() {
        this._logEntries = [];
        this._update();
    }
    
    /**
     * Update TDD metrics with new data
     * @param {Object} metrics TDD metrics data
     * @param {Object} options Additional options
     */
    updateTDDMetrics(metrics, options = {}) {
        // Update coverage data if provided
        if (metrics.coverage) {
            this._tddMetrics.coverageData = {
                ...this._tddMetrics.coverageData,
                ...metrics.coverage
            };
        }
        
        // Update test progress history
        if (metrics.progress) {
            // Add timestamp to progress data
            const progressEntry = {
                ...metrics.progress,
                timestamp: new Date().getTime()
            };
            this._tddMetrics.testProgressHistory.push(progressEntry);
            
            // Limit history to last 100 entries
            if (this._tddMetrics.testProgressHistory.length > 100) {
                this._tddMetrics.testProgressHistory.shift();
            }
        }
        
        // Update active configuration
        if (metrics.configuration) {
            this._tddMetrics.activeConfiguration = {
                ...this._tddMetrics.activeConfiguration,
                ...metrics.configuration
            };
        }
        
        // Update last run date
        this._tddMetrics.lastRunDate = new Date().getTime();
        
        // Add a log entry if results are included
        if (metrics.results) {
            const passRate = metrics.results.passRate || 0;
            const message = `TDD Results: ${metrics.results.passed || 0}/${metrics.results.total || 0} tests passed (${Math.round(passRate * 100)}%)`;
            const type = passRate >= 0.8 ? 'success' : passRate >= 0.5 ? 'warning' : 'error';
            this.addLogEntry(message, type);
        }
        
        // Update the panel
        this._update();
    }
    
    /**
     * Update TDD configuration setting
     * @param {string} setting The setting name
     * @param {any} value The new value
     */
    updateTDDConfiguration(setting, value) {
        // Update the configuration in the metrics object
        if (this._tddMetrics.activeConfiguration === undefined) {
            this._tddMetrics.activeConfiguration = {};
        }
        
        this._tddMetrics.activeConfiguration[setting] = value;
        
        // Save to user settings
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.tdd');
        config.update(setting, value, vscode.ConfigurationTarget.Global);
        
        // Log the change
        this.addLogEntry(`Updated TDD configuration: ${setting} = ${value}`, 'info');
        
        // Update the panel
        this._update();
    }
    
    /**
     * Update a global extension setting
     * @param {string} setting The setting name (full path)
     * @param {any} value The new value
     */
    updateGlobalSetting(setting, value) {
        try {
            // Parse the setting path (e.g., "aiDevelopmentMonitor.autoCaptureChatHistory")
            const parts = setting.split('.');
            if (parts.length < 2) {
                Logger.warn(`Invalid setting path: ${setting}`, 'settings');
                return;
            }
            
            // Get the configuration section
            const section = parts[0];
            const key = parts.slice(1).join('.');
            
            // Update the setting
            const config = vscode.workspace.getConfiguration(section);
            config.update(key, value, vscode.ConfigurationTarget.Global);
            
            // Log the change
            this.addLogEntry(`Updated setting: ${setting} = ${value}`, 'info');
            
            // Show notification for important settings
            const importantSettings = ['autoCaptureChatHistory', 'autoEvaluate', 'notificationLevel'];
            const shortKey = key.split('.').pop();
            
            if (importantSettings.includes(shortKey)) {
                vscode.window.showInformationMessage(`AI Development Monitor: ${shortKey} set to ${value}`);
            }
        } catch (error) {
            Logger.error(`Error updating setting ${setting}: ${error.message}`, 'settings');
            vscode.window.showErrorMessage(`Failed to update setting: ${error.message}`);
        }
    }
    
    /**
     * Open file with coverage highlighting
     * @param {string} filePath Path to the file
     */
    openFileWithCoverage(filePath) {
        try {
            vscode.workspace.openTextDocument(filePath).then(doc => {
                vscode.window.showTextDocument(doc).then(editor => {
                    try {
                        // If inline coverage is enabled, add coverage highlighting
                        const showInlineCoverage = this._tddMetrics.activeConfiguration.showInlineCoverage;
                        
                        if (showInlineCoverage && this._tddMetrics.coverageData[filePath]) {
                            const coverageData = this._tddMetrics.coverageData[filePath];
                            
                            // Apply decorations for covered and uncovered lines
                            if (coverageData.lines) {
                                this.applyCoverageHighlighting(editor, coverageData.lines);
                            }
                        }
                    } catch (error) {
                        Logger.error(`Error in coverage highlighting: ${error.message}`, 'tdd');
                    }
                }).catch(error => {
                    Logger.error(`Error showing text document: ${error.message}`, 'tdd');
                    vscode.window.showErrorMessage(`Failed to open document: ${error.message}`);
                });
            }).catch(error => {
                Logger.error(`Error opening file for coverage: ${error.message}`, 'tdd');
                vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
            });
        } catch (error) {
            Logger.error(`Error in openFileWithCoverage: ${error.message}`, 'tdd');
            vscode.window.showErrorMessage(`Error accessing file: ${error.message}`);
        }
    }
    
    /**
     * Apply coverage highlighting to editor
     * @param {vscode.TextEditor} editor The editor to apply decorations to
     * @param {Object} coverageLines Coverage line data
     */
    applyCoverageHighlighting(editor, coverageLines) {
        try {
            // Create decoration types if they don't exist
            if (!this._coveredLineDecorationType) {
                this._coveredLineDecorationType = vscode.window.createTextEditorDecorationType({
                    backgroundColor: 'rgba(80, 200, 120, 0.05)',
                    isWholeLine: true,
                    overviewRulerColor: 'rgba(80, 200, 120, 0.5)',
                    overviewRulerLane: vscode.OverviewRulerLane.Right
                });
            }
            
            if (!this._uncoveredLineDecorationType) {
                this._uncoveredLineDecorationType = vscode.window.createTextEditorDecorationType({
                    backgroundColor: 'rgba(200, 100, 100, 0.05)',
                    isWholeLine: true,
                    overviewRulerColor: 'rgba(200, 100, 100, 0.5)',
                    overviewRulerLane: vscode.OverviewRulerLane.Right
                });
            }
            
            // Create arrays for decorations
            const coveredLines = [];
            const uncoveredLines = [];
            
            // Sort lines into covered and uncovered
            Object.keys(coverageLines).forEach(lineStr => {
                const line = parseInt(lineStr);
                const covered = coverageLines[lineStr];
                
                const range = new vscode.Range(
                    new vscode.Position(line, 0),
                    new vscode.Position(line, Number.MAX_VALUE)
                );
                
                if (covered) {
                    coveredLines.push(range);
                } else {
                    uncoveredLines.push(range);
                }
            });
            
            // Apply decorations
            editor.setDecorations(this._coveredLineDecorationType, coveredLines);
            editor.setDecorations(this._uncoveredLineDecorationType, uncoveredLines);
        } catch (error) {
            Logger.error(`Error applying coverage highlighting: ${error.message}`, 'tdd');
            vscode.window.showErrorMessage(`Failed to apply coverage highlighting: ${error.message}`);
        }
    }
    
    /**
     * Process GitHub Copilot test execution results for display
     * 
     * @param {Object} executionResult The test execution result from GitHub Copilot
     */
    processGitHubCopilotTestResults(executionResult) {
        if (!executionResult || typeof executionResult !== 'object') {
            return;
        }
        
        try {
            const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.tdd');
            if (!config.get('includeGithubCopilotResults', true)) {
                return;
            }
            
            // Create a new TDD result object for the GitHub Copilot test execution
            const copilotResult = {
                iteration: 0, // Use 0 to indicate GitHub Copilot results
                test_code: executionResult.test_code || '',
                implementation_code: executionResult.implementation_code || '',
                language: executionResult.language || 'javascript',
                source: 'github-copilot-chat',
                timestamp: new Date().toISOString(),
                tests: {
                    total: executionResult.total_tests || 0,
                    passed: executionResult.passed_tests || 0,
                    failed: executionResult.failed_tests || 0,
                    success: executionResult.success || false
                },
                execution: {
                    success: executionResult.success || false,
                    execution_time: executionResult.execution_time || 0,
                    errors: executionResult.errors || []
                }
            };
            
            // Add to TDD results
            this._tddResults.push(copilotResult);
            
            // Update the dashboard
            this._update();
            
            Logger.info(`Added GitHub Copilot test execution results: ${copilotResult.tests.passed}/${copilotResult.tests.total} tests passed`, 'tdd');
            
        } catch (error) {
            Logger.error(`Error processing GitHub Copilot test results: ${error.message}`, 'tdd');
        }
    }

    /**
     * Create HTML for the TDD Dashboard
     * @returns {string} HTML content for the TDD Dashboard
     */
    _createTDDDashboardHtml() {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.tdd');
        const autoRunTests = config.get('autoRunTests', true);
        const showInlineCoverage = config.get('showInlineCoverage', true);
        const defaultIterations = config.get('defaultIterations', 5);
        const testFramework = config.get('testFramework', 'auto');
        const showExecutionResults = config.get('showExecutionResults', true);
        const includeGithubCopilotResults = config.get('includeGithubCopilotResults', true);

        // Gather TDD metrics from the stored results
        const testMetrics = {
            totalTests: 0,
            passed: 0,
            failed: 0,
            iterations: this._tddResults.length,
            coverage: 0,
            executionTime: 0,
            testsByIteration: []
        };

        // Calculate metrics
        if (this._tddResults.length > 0) {
            this._tddResults.forEach(result => {
                if (result.tests) {
                    testMetrics.totalTests += result.tests.total || 0;
                    testMetrics.passed += result.tests.passed || 0;
                    testMetrics.failed += result.tests.failed || 0;
                    
                    testMetrics.testsByIteration.push({
                        iteration: result.iteration,
                        total: result.tests.total || 0,
                        passed: result.tests.passed || 0,
                        failed: result.tests.failed || 0,
                        coverage: result.coverage?.overall || 0,
                        executionTime: result.execution?.execution_time || 0
                    });
                }
                
                if (result.execution && result.execution.execution_time) {
                    testMetrics.executionTime += result.execution.execution_time;
                }
                
                if (result.coverage && result.coverage.overall) {
                    testMetrics.coverage += result.coverage.overall;
                }
            });
            
            // Calculate average coverage
            if (testMetrics.iterations > 0) {
                testMetrics.coverage = Math.round((testMetrics.coverage / testMetrics.iterations) * 100) / 100;
            }
        }

        // Create file coverage data for display
        const coverageData = [];
        this._tddResults.forEach(result => {
            if (result.coverage && result.coverage.files) {
                result.coverage.files.forEach(file => {
                    if (!coverageData.find(f => f.path === file.path)) {
                        coverageData.push(file);
                    }
                });
            }
        });

        return `
        <div class="panel tdd-dashboard-panel">
            <h3>TDD Dashboard</h3>
            
            <div class="tdd-dashboard-content">
                <div class="tdd-dashboard-summary">
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.iterations}</div>
                        <div class="tdd-stat-label">Iterations</div>
                    </div>
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.totalTests}</div>
                        <div class="tdd-stat-label">Total Tests</div>
                    </div>
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.passed}</div>
                        <div class="tdd-stat-label">Passed</div>
                    </div>
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.failed}</div>
                        <div class="tdd-stat-label">Failed</div>
                    </div>
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.coverage}%</div>
                        <div class="tdd-stat-label">Avg Coverage</div>
                    </div>
                    <div class="tdd-stat-box">
                        <div class="tdd-stat-value">${testMetrics.executionTime > 0 ? testMetrics.executionTime.toFixed(2) + 's' : 'N/A'}</div>
                        <div class="tdd-stat-label">Execution Time</div>
                    </div>
                </div>
                
                <div class="tdd-config-section">
                    <h4>TDD Configuration</h4>
                    <div class="tdd-config-grid">
                        <div class="tdd-config-item">
                            <label>
                                <input type="checkbox" class="tdd-config-toggle" data-setting="autoRunTests" ${autoRunTests ? 'checked' : ''}>
                                Auto-run tests
                            </label>
                        </div>
                        <div class="tdd-config-item">
                            <label>
                                <input type="checkbox" class="tdd-config-toggle" data-setting="showInlineCoverage" ${showInlineCoverage ? 'checked' : ''}>
                                Show inline coverage
                            </label>
                        </div>
                        <div class="tdd-config-item">
                            <label>
                                <input type="checkbox" class="tdd-config-toggle" data-setting="showExecutionResults" ${showExecutionResults ? 'checked' : ''}>
                                Show execution results
                            </label>
                        </div>
                        <div class="tdd-config-item">
                            <label>
                                <input type="checkbox" class="tdd-config-toggle" data-setting="includeGithubCopilotResults" ${includeGithubCopilotResults ? 'checked' : ''}>
                                Include Copilot Chat results
                            </label>
                        </div>
                        <div class="tdd-config-item">
                            <label>Default iterations:</label>
                            <select class="tdd-config-select" data-setting="defaultIterations">
                                <option value="3" ${defaultIterations === 3 ? 'selected' : ''}>3 iterations</option>
                                <option value="5" ${defaultIterations === 5 ? 'selected' : ''}>5 iterations</option>
                                <option value="10" ${defaultIterations === 10 ? 'selected' : ''}>10 iterations</option>
                            </select>
                        </div>
                        <div class="tdd-config-item">
                            <label>Test framework:</label>
                            <select class="tdd-config-select" data-setting="testFramework">
                                <option value="auto" ${testFramework === 'auto' ? 'selected' : ''}>Auto-detect</option>
                                <option value="unittest" ${testFramework === 'unittest' ? 'selected' : ''}>Python unittest</option>
                                <option value="pytest" ${testFramework === 'pytest' ? 'selected' : ''}>pytest</option>
                                <option value="jest" ${testFramework === 'jest' ? 'selected' : ''}>Jest</option>
                                <option value="mocha" ${testFramework === 'mocha' ? 'selected' : ''}>Mocha</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                ${testMetrics.testsByIteration.length > 0 ? `
                <div class="tdd-progress-section">
                    <h4>Test Progress Over Time</h4>
                    <div class="tdd-chart-container" id="tdd-progress-chart">
                        <canvas id="progressChart"></canvas>
                        <div id="chart-placeholder" class="chart-placeholder">
                            <p>TDD Progress Chart</p>
                            <p><small>Showing test results over ${testMetrics.iterations} iterations</small></p>
                            <ul>
                                <li>Total Tests: ${testMetrics.totalTests}</li>
                                <li>Passed: ${testMetrics.passed}</li>
                                <li>Failed: ${testMetrics.failed}</li>
                                <li>Average Coverage: ${testMetrics.coverage}%</li>
                                <li>Total Execution Time: ${testMetrics.executionTime}s</li>
                            </ul>
                            <p><small>Interactive chart visualization requires Chart.js</small></p>
                        </div>
                        <div id="tdd-chart-data" style="display:none;" data-metrics='${JSON.stringify(testMetrics.testsByIteration).replace(/'/g, "&#39;")}'></div>
                    </div>
                    <div class="chart-legend">
                        <div class="chart-legend-item">
                            <div class="chart-legend-color" style="background-color: #4CAF50;"></div>
                            <span>Passed Tests</span>
                        </div>
                        <div class="chart-legend-item">
                            <div class="chart-legend-color" style="background-color: #F44336;"></div>
                            <span>Failed Tests</span>
                        </div>
                        <div class="chart-legend-item">
                            <div class="chart-legend-color" style="background-color: #2196F3;"></div>
                            <span>Coverage %</span>
                        </div>
                        <div class="chart-legend-item">
                            <div class="chart-legend-color" style="background-color: #FF9800;"></div>
                            <span>Execution Time</span>
                        </div>
                    </div>
                </div>
                ` : ''}
                
                ${coverageData.length > 0 ? `
                <div class="tdd-coverage-section">
                    <h4>Code Coverage</h4>
                    <table class="tdd-coverage-table">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Coverage</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${coverageData.map(file => `
                            <tr>
                                <td>
                                    <span class="tdd-coverage-filename" data-path="${file.path}">${file.name || file.path.split('/').pop()}</span>
                                </td>
                                <td class="tdd-coverage-percent">${Math.round(file.coverage * 100)}%</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ` : ''}
                
                ${this._tddResults.length > 0 ? `
                <div class="tdd-test-log">
                    <h4>Test Results by Iteration</h4>
                    <table class="tdd-results-table">
                        <thead>
                            <tr>
                                <th>Iter</th>
                                <th>Test File</th>
                                <th>Results</th>
                                <th>Execution Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this._tddResults.map((result, index) => {
                                // Check if this is a GitHub Copilot result (source field and/or iteration 0)
                                const isGithubCopilot = result.source === 'github-copilot-chat' || result.iteration === 0;
                                const rowClass = isGithubCopilot ? 'github-copilot-result' : '';
                                
                                return `
                            <tr${rowClass ? ` class="${rowClass}"` : ''} data-source="${result.source || 'tdd'}">
                                <td>${isGithubCopilot ? 'GH' : result.iteration}</td>
                                <td>
                                    ${result.testFilePath ? 
                                      `<span class="tdd-file-link" data-path="${result.testFilePath}" data-index="${index}">${result.testFilePath.split('/').pop()}</span>` : 
                                      (isGithubCopilot ? 'GitHub Copilot' : 'No file created')}
                                </td>
                                <td>
                                    ${result.tests && result.tests.total ? 
                                      `<span class="${result.tests.passed === result.tests.total ? 'success' : 'warning'}">
                                        ${result.tests.passed}/${result.tests.total} passed
                                      </span>` : 
                                      'Not executed'}
                                </td>
                                <td>
                                    ${result.execution ? 
                                      `<span class="${result.execution.success ? 'success' : 'error'}">
                                        ${result.execution.success ? 'Success' : 'Failed'}
                                        ${result.execution.execution_time ? ` (${result.execution.execution_time.toFixed(2)}s)` : ''}
                                        ${result.execution.errors && result.execution.errors.length > 0 ? 
                                          `<span class="tooltip">
                                            ⚠️
                                            <span class="tooltiptext error-tooltip">
                                              ${result.execution.errors.slice(0, 3).join('<br>')}
                                              ${result.execution.errors.length > 3 ? '<br>...' : ''}
                                            </span>
                                          </span>` : 
                                          ''}
                                      </span>` : 
                                      'Simulated'}
                                </td>
                                <td>
                                    <button class="tdd-action-button" data-action="view-test" data-index="${index}">View ${isGithubCopilot ? 'Code' : 'Test'}</button>
                                </td>
                            </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                ` : ''}
                
                <div class="tdd-actions">
                    <button id="runTDDTestBtn" class="vscode-button">Run TDD Test</button>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Update the webview content
     */
    _update() {
        const webview = this._panel.webview;
        this._panel.title = "AI Development Monitor";
        webview.html = this._getHtmlForWebview(webview);
    }
    
    /**
     * Dispose of the panel
     */
    dispose() {
        AIMonitorPanel.currentPanel = undefined;
        
        // Clean up resources
        this._panel.dispose();
    }
    
    /**
     * Get the HTML for the webview
     * @param {vscode.Webview} webview
     * @returns {string}
     */
    _getHtmlForWebview(webview) {
        // Convert evaluation data to HTML
        let evaluationHtml = '';
        if (this._lastEvaluation) {
            const evaluation = this._lastEvaluation;
            const acceptClass = evaluation.accept ? 'success' : 'warning';
            
            evaluationHtml = `
                <div class="evaluation-result ${acceptClass}">
                    <h3>Evaluation Result: ${evaluation.accept ? 'ACCEPTED' : 'REJECTED'}</h3>
                    <div class="reason">${evaluation.reason || 'No reason provided'}</div>
                    
                    <div class="risk-scores">
                        <div class="risk-item">
                            <div class="risk-label">Hallucination Risk:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${evaluation.hallucination_risk * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(evaluation.hallucination_risk * 100)}%</div>
                        </div>
                        
                        <div class="risk-item">
                            <div class="risk-label">Recursive Risk:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${evaluation.recursive_risk * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(evaluation.recursive_risk * 100)}%</div>
                        </div>
                        
                        <div class="risk-item">
                            <div class="risk-label">Alignment Score:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${evaluation.alignment_score * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(evaluation.alignment_score * 100)}%</div>
                        </div>
                        
                        ${evaluation.tdd_score !== undefined ? `
                        <div class="risk-item">
                            <div class="risk-label">TDD Score:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${evaluation.tdd_score * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(evaluation.tdd_score * 100)}%</div>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${evaluation.issues_detected && evaluation.issues_detected.length > 0 ? `
                    <div class="issues">
                        <h4>Issues Detected:</h4>
                        <ul>
                            ${evaluation.issues_detected.map(issue => `<li>${issue}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                    
                    ${evaluation.recommendations && evaluation.recommendations.length > 0 ? `
                    <div class="recommendations">
                        <h4>Recommendations:</h4>
                        <ul>
                            ${evaluation.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                </div>
            `;
        }
        
        // Convert TDD results to HTML
        let tddHtml = '';
        if (this._tddResults && this._tddResults.length > 0) {
            tddHtml = `
                <div class="tdd-results">
                    <h3>TDD Test Results</h3>
                    <div class="tdd-iterations">
                        ${this._tddResults.map((result, index) => `
                        <div class="tdd-iteration">
                            <div class="tdd-header">
                                <strong>Iteration ${result.iteration}</strong>
                                <button class="tdd-view-btn" data-index="${index}">View Tests</button>
                            </div>
                            <div class="tdd-summary">
                                <div>Language: ${result.language || 'python'}</div>
                                <div>Test Size: ${result.test_code.length} bytes</div>
                                ${result.execution ? `
                                <div class="tdd-execution">
                                    <div class="tdd-exec-header">Execution Results:</div>
                                    <div class="tdd-execution-bar">
                                        <div class="tdd-exec-metrics">
                                            <span class="tdd-exec-passed">${result.execution.passed || 0}</span>/<span class="tdd-exec-total">${result.execution.total || 0}</span> tests passed
                                            ${result.execution.execution_time ? `(${result.execution.execution_time.toFixed(2)}s)` : ''}
                                        </div>
                                        <div class="tdd-exec-bar">
                                            <div class="tdd-exec-success" style="width: ${result.execution.total > 0 ? (result.execution.passed / result.execution.total) * 100 : 0}%"></div>
                                        </div>
                                    </div>
                                    ${result.execution.errors && result.execution.errors.length > 0 ? `
                                    <div class="tdd-exec-errors">
                                        <details>
                                            <summary>${result.execution.errors.length} error(s)</summary>
                                            <ul class="tdd-error-list">
                                                ${result.execution.errors.map(err => `<li>${err}</li>`).join('')}
                                            </ul>
                                        </details>
                                    </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        // Convert logs to HTML
        const logsHtml = this._logEntries.map(entry => `
            <div class="log-entry ${entry.type}">
                <span class="log-time">${entry.timestamp}</span>
                <span class="log-message">${entry.message}</span>
            </div>
        `).join('');
        
        // Generate TDD Dashboard HTML
        const tddDashboardHtml = this._createTDDDashboardHtml();
        
        // Complete HTML with CSS and JavaScript
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AI Development Monitor</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    padding: 0;
                    margin: 0;
                }
                
                .container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    padding: 16px;
                    box-sizing: border-box;
                }
                
                h2 {
                    margin-top: 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 8px;
                }
                
                h3 {
                    margin-top: 0;
                }
                
                .toolbar {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 16px;
                }
                
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    cursor: pointer;
                    border-radius: 2px;
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .tdd-view-btn {
                    padding: 2px 8px;
                    font-size: 0.85em;
                }
                
                .panel {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 3px;
                    padding: 16px;
                    margin-bottom: 16px;
                    overflow: auto;
                }
                
                .logs-panel {
                    flex: 1;
                    min-height: 200px;
                    max-height: 300px;
                    overflow-y: auto;
                }
                
                .log-entry {
                    padding: 4px 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                }
                
                .log-time {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    margin-right: 8px;
                    flex-shrink: 0;
                }
                
                .log-message {
                    font-family: var(--vscode-editor-font-family);
                    white-space: pre-wrap;
                    flex: 1;
                }
                
                .log-entry.info {
                    border-left: 3px solid var(--vscode-terminal-ansiBlue);
                }
                
                .log-entry.warning {
                    border-left: 3px solid var(--vscode-terminal-ansiYellow);
                }
                
                .log-entry.error {
                    border-left: 3px solid var(--vscode-terminal-ansiRed);
                }
                
                .log-entry.success {
                    border-left: 3px solid var(--vscode-terminal-ansiGreen);
                }
                
                .evaluation-result {
                    border-left: 4px solid var(--vscode-terminal-ansiYellow);
                    padding-left: 12px;
                }
                
                .evaluation-result.success {
                    border-left-color: var(--vscode-terminal-ansiGreen);
                }
                
                .risk-scores {
                    margin-top: 16px;
                }
                
                .risk-item {
                    display: flex;
                    align-items: center;
                    margin-bottom: 8px;
                }
                
                .risk-label {
                    width: 150px;
                    flex-shrink: 0;
                }
                
                .risk-meter {
                    flex: 1;
                    height: 8px;
                    background-color: var(--vscode-input-background);
                    border-radius: 4px;
                    overflow: hidden;
                    margin: 0 12px;
                }
                
                .risk-fill {
                    height: 100%;
                    background-color: var(--vscode-terminal-ansiBlue);
                }
                
                .success .risk-fill {
                    background-color: var(--vscode-terminal-ansiGreen);
                }
                
                .warning .risk-fill {
                    background-color: var(--vscode-terminal-ansiYellow);
                }
                
                .risk-value {
                    width: 40px;
                    text-align: right;
                    flex-shrink: 0;
                }
                
                .reason {
                    font-style: italic;
                    margin-bottom: 8px;
                }
                
                .issues, .recommendations {
                    margin-top: 16px;
                }
                
                .issues h4, .recommendations h4 {
                    margin-bottom: 4px;
                }
                
                .issues ul, .recommendations ul {
                    margin-top: 4px;
                }
                
                .tdd-results {
                    margin-top: 16px;
                }
                
                .tdd-iterations {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                }
                
                .tdd-iteration {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 3px;
                    padding: 8px;
                    min-width: 200px;
                }
                
                .tdd-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                
                .tdd-summary {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                
                .tdd-execution {
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid var(--vscode-panel-border);
                }
                
                .tdd-exec-header {
                    font-weight: bold;
                    margin-bottom: 4px;
                }
                
                .tdd-execution-bar {
                    margin: 4px 0;
                }
                
                .tdd-exec-metrics {
                    font-size: 0.9em;
                    margin-bottom: 2px;
                }
                
                .tdd-exec-passed {
                    color: var(--vscode-terminal-ansiGreen);
                    font-weight: bold;
                }
                
                .tdd-exec-total {
                    font-weight: bold;
                }
                
                .tdd-exec-bar {
                    height: 4px;
                    background-color: var(--vscode-input-background);
                    border-radius: 2px;
                    overflow: hidden;
                }
                
                .tdd-exec-success {
                    height: 100%;
                    background-color: var(--vscode-terminal-ansiGreen);
                }
                
                .tdd-exec-errors {
                    margin-top: 4px;
                    font-size: 0.85em;
                }
                
                .tdd-error-list {
                    margin: 4px 0 0 0;
                    padding-left: 20px;
                    color: var(--vscode-terminal-ansiRed);
                }
                
                /* Tab styles */
                .tab-container {
                    margin-bottom: 16px;
                }
                
                .tab-buttons {
                    display: flex;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .tab-button {
                    background-color: transparent;
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                    margin-right: 4px;
                    color: var(--vscode-foreground);
                }
                
                .tab-button:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .tab-button.active {
                    border-bottom: 2px solid var(--vscode-button-background);
                    font-weight: bold;
                }
                
                .tab-content {
                    display: none;
                    padding: 16px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-top: none;
                }
                
                .tab-content.active {
                    display: block;
                }
                
                /* TDD Dashboard specific styles */
                .tdd-dashboard-panel {
                    padding: 16px;
                }
                
                .tdd-dashboard-content {
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                }
                
                .tdd-dashboard-summary {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 16px;
                    justify-content: space-between;
                    margin-bottom: 8px;
                }
                
                .tdd-stat-box {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 12px;
                    min-width: 100px;
                    text-align: center;
                    flex: 1;
                }
                
                .tdd-stat-value {
                    font-size: 1.8em;
                    font-weight: bold;
                    margin-bottom: 4px;
                }
                
                .tdd-stat-label {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                
                .tdd-config-section, .tdd-progress-section, .tdd-coverage-section, .settings-section {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 16px;
                }
                
                .tdd-config-section h4, .tdd-progress-section h4, .tdd-coverage-section h4, .settings-section h4 {
                    margin-top: 0;
                    margin-bottom: 12px;
                }
                
                .settings-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 16px;
                }
                
                .settings-item {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                
                .settings-description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                    margin-left: 20px;
                }
                
                .settings-toggle {
                    margin-right: 8px;
                }
                
                .settings-select {
                    height: 28px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    padding: 0 8px;
                    margin-top: 4px;
                }
                
                .tdd-config-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                }
                
                .tdd-config-item {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                
                .tdd-config-toggle {
                    margin-right: 8px;
                }
                
                .tdd-config-select {
                    height: 28px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    padding: 0 8px;
                }
                
                .tdd-chart-container {
                    height: 200px;
                    margin-bottom: 16px;
                }
                
                .chart-placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    border: 1px dashed var(--vscode-panel-border);
                    border-radius: 4px;
                    text-align: center;
                }
                
                .chart-placeholder p {
                    margin: 4px 0;
                }
                
                .tdd-coverage-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                
                .tdd-coverage-table th, .tdd-coverage-table td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .tdd-coverage-table th {
                    font-weight: bold;
                }
                
                .tdd-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }
                
                .logs-container {
                    max-height: 300px;
                    overflow-y: auto;
                    font-family: monospace;
                }
            </style>
            <script>
                // Add Chart.js library for TDD Dashboard charts
                const chartJsScript = document.createElement('script');
                chartJsScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
                chartJsScript.integrity = 'sha256-+8RZJLOzbQINNk2WMZVLgwucY+65abyEXlv1ffenl5g=';
                chartJsScript.crossOrigin = 'anonymous';
                document.head.appendChild(chartJsScript);
            </script>
        </head>
        <body>
            <div class="container">
                <h2>AI Development Monitor</h2>
                
                <div class="toolbar">
                    <div>
                        <button id="runTestBtn">Run Diagnostic Test</button>
                        <button id="openTddDashboardBtn">TDD Dashboard</button>
                    </div>
                    <div>
                        <button id="clearLogsBtn">Clear Logs</button>
                    </div>
                </div>
                
                <div class="tab-container">
                    <div class="tab-buttons">
                        <button class="tab-button active" data-tab="overview">Overview</button>
                        <button class="tab-button" data-tab="tdd-dashboard">TDD Dashboard</button>
                        <button class="tab-button" data-tab="logs">Logs</button>
                        <button class="tab-button" data-tab="settings">Settings</button>
                    </div>
                    
                    <div class="tab-content active" id="overview">
                        ${this._lastEvaluation ? `
                        <div class="panel evaluation-panel">
                            <h3>Evaluation Results</h3>
                            ${evaluationHtml}
                        </div>
                        ` : ''}
                        
                        ${this._tddResults.length > 0 ? `
                        <div class="panel tdd-panel">
                            ${tddHtml}
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="tab-content" id="tdd-dashboard">
                        ${tddDashboardHtml}
                    </div>
                    
                    <div class="tab-content" id="logs">
                        <div class="panel logs-panel">
                            <h3>Activity Log</h3>
                            <div class="logs-container">
                                ${logsHtml || '<div class="log-entry info"><span class="log-message">No activity recorded yet.</span></div>'}
                            </div>
                        </div>
                    </div>
                    
                    <div class="tab-content" id="settings">
                        <div class="panel settings-panel">
                            <h3>AI Monitor Settings</h3>
                            <div class="settings-container">
                                <div class="settings-section">
                                    <h4>Copilot Integration</h4>
                                    <div class="settings-grid">
                                        <div class="settings-item">
                                            <label>
                                                <input type="checkbox" class="settings-toggle" data-setting="autoCaptureChatHistory" 
                                                ${vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoCaptureChatHistory', true) ? 'checked' : ''}>
                                                Auto-capture Copilot Chat history
                                            </label>
                                            <div class="settings-description">
                                                Automatically capture and process GitHub Copilot Chat conversations
                                            </div>
                                        </div>
                                        <div class="settings-item">
                                            <label>
                                                <input type="checkbox" class="settings-toggle" data-setting="autoEvaluate"
                                                ${vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoEvaluate', true) ? 'checked' : ''}>
                                                Auto-evaluate Copilot suggestions
                                            </label>
                                            <div class="settings-description">
                                                Automatically evaluate code suggestions from GitHub Copilot
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="settings-section">
                                    <h4>Notification Settings</h4>
                                    <div class="settings-grid">
                                        <div class="settings-item">
                                            <label>Notification level:</label>
                                            <select class="settings-select" data-setting="notificationLevel">
                                                <option value="minimal" ${vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('notificationLevel', 'normal') === 'minimal' ? 'selected' : ''}>Minimal</option>
                                                <option value="normal" ${vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('notificationLevel', 'normal') === 'normal' ? 'selected' : ''}>Normal</option>
                                                <option value="detailed" ${vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('notificationLevel', 'normal') === 'detailed' ? 'selected' : ''}>Detailed</option>
                                            </select>
                                            <div class="settings-description">
                                                Control how verbose notifications are displayed
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    
                    document.getElementById('clearLogsBtn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'clearLogs' });
                    });
                    
                    document.getElementById('runTestBtn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'runTest' });
                    });
                    
                    document.getElementById('openTddDashboardBtn').addEventListener('click', () => {
                        // Switch to TDD dashboard tab
                        setActiveTab('tdd-dashboard');
                    });
                    
                    // Add event listeners for all TDD view buttons
                    document.querySelectorAll('.tdd-view-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const index = parseInt(btn.getAttribute('data-index'));
                            vscode.postMessage({ command: 'showTddDetails', iterationIndex: index });
                        });
                    });
                    
                    // Tab switching functionality
                    document.querySelectorAll('.tab-button').forEach(button => {
                        button.addEventListener('click', () => {
                            const tabId = button.getAttribute('data-tab');
                            setActiveTab(tabId);
                        });
                    });
                    
                    function setActiveTab(tabId) {
                        // Deactivate all tabs and buttons
                        document.querySelectorAll('.tab-button').forEach(btn => {
                            btn.classList.remove('active');
                        });
                        document.querySelectorAll('.tab-content').forEach(content => {
                            content.classList.remove('active');
                        });
                        
                        // Activate selected tab and button
                        document.querySelector('.tab-button[data-tab="' + tabId + '"]').classList.add('active');
                        document.getElementById(tabId).classList.add('active');
                    }
                    
                    // TDD Dashboard functionality
                    function setupTDDDashboard() {
                        // Setup configuration buttons
                        var toggles = document.querySelectorAll('.tdd-config-toggle');
                        if (toggles) {
                            toggles.forEach(function(toggle) {
                                toggle.addEventListener('click', function() {
                                    var setting = toggle.getAttribute('data-setting');
                                    var value = toggle.checked;
                                    vscode.postMessage({ 
                                        command: 'updateTDDConfig', 
                                        setting: setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup general settings buttons
                        var settingsToggles = document.querySelectorAll('.settings-toggle');
                        if (settingsToggles) {
                            settingsToggles.forEach(function(toggle) {
                                toggle.addEventListener('click', function() {
                                    var setting = toggle.getAttribute('data-setting');
                                    var value = toggle.checked;
                                    vscode.postMessage({ 
                                        command: 'updateSetting', 
                                        setting: 'aiDevelopmentMonitor.' + setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup settings dropdowns
                        var settingsSelects = document.querySelectorAll('.settings-select');
                        if (settingsSelects) {
                            settingsSelects.forEach(function(select) {
                                select.addEventListener('change', function() {
                                    var setting = select.getAttribute('data-setting');
                                    var value = select.value;
                                    vscode.postMessage({ 
                                        command: 'updateSetting', 
                                        setting: 'aiDevelopmentMonitor.' + setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup general settings buttons
                        var settingsToggles = document.querySelectorAll('.settings-toggle');
                        if (settingsToggles) {
                            settingsToggles.forEach(function(toggle) {
                                toggle.addEventListener('click', function() {
                                    var setting = toggle.getAttribute('data-setting');
                                    var value = toggle.checked;
                                    vscode.postMessage({ 
                                        command: 'updateSetting', 
                                        setting: 'aiDevelopmentMonitor.' + setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup settings dropdowns
                        var settingsSelects = document.querySelectorAll('.settings-select');
                        if (settingsSelects) {
                            settingsSelects.forEach(function(select) {
                                select.addEventListener('change', function() {
                                    var setting = select.getAttribute('data-setting');
                                    var value = select.value;
                                    vscode.postMessage({ 
                                        command: 'updateSetting', 
                                        setting: 'aiDevelopmentMonitor.' + setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup configuration dropdowns
                        var selects = document.querySelectorAll('.tdd-config-select');
                        if (selects) {
                            selects.forEach(function(select) {
                                select.addEventListener('change', function() {
                                    var setting = select.getAttribute('data-setting');
                                    var value = select.value;
                                    vscode.postMessage({ 
                                        command: 'updateTDDConfig', 
                                        setting: setting,
                                        value: value 
                                    });
                                });
                            });
                        }
                        
                        // Setup coverage file links
                        var links = document.querySelectorAll('.tdd-coverage-filename');
                        if (links) {
                            links.forEach(function(link) {
                                link.addEventListener('click', function(e) {
                                    e.preventDefault();
                                    var filePath = link.getAttribute('data-path');
                                    vscode.postMessage({ 
                                        command: 'openFile', 
                                        filePath: filePath
                                    });
                                });
                            });
                        }

                        // Setup TDD test button
                        var runTddTestBtn = document.getElementById('runTDDTestBtn');
                        if (runTddTestBtn) {
                            runTddTestBtn.addEventListener('click', function() {
                                vscode.postMessage({ command: 'runTest' });
                            });
                        }
                        
                        // Setup test view buttons in the TDD table
                        document.querySelectorAll('.tdd-action-button').forEach(function(btn) {
                            btn.addEventListener('click', function() {
                                const index = parseInt(btn.getAttribute('data-index'));
                                vscode.postMessage({ command: 'showTddDetails', iterationIndex: index });
                            });
                        });
                    }
                    
                    // Call setup function after DOM is fully loaded
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', setupTDDDashboard);
                    } else {
                        setupTDDDashboard();
                    }
                    
                    // Scroll logs panel to bottom
                    const logsPanel = document.querySelector('.logs-panel');
                    if (logsPanel) {
                        logsPanel.scrollTop = logsPanel.scrollHeight;
                    }

                    // Initialize TDD progress chart if element exists
                    function initProgressChart() {
                        // Simple placeholder function - we'll use static chart for now
                        // to avoid potential JS errors with Chart.js integration
                        const placeholder = document.getElementById('chart-placeholder');
                        if (placeholder) {
                            placeholder.style.display = 'flex';
                        }
                        
                        const canvas = document.getElementById('progressChart');
                        if (canvas) {
                            canvas.style.display = 'none';
                        }
                    }
                    
                    // Initialize chart if we're on the TDD dashboard tab
                    if (document.getElementById('progressChart')) {
                        initProgressChart();
                    }
                    
                    // Add event listener for tab button to initialize chart when TDD tab is shown
                    document.querySelectorAll('.tab-button').forEach(function(btn) {
                        btn.addEventListener('click', function() {
                            if (btn.getAttribute('data-tab') === 'tdd-dashboard') {
                                setTimeout(initProgressChart, 100);
                            }
                        });
                    });
                    
                    // Add event listener for run TDD test button
                    const runTddBtn = document.getElementById('runTDDTestBtn');
                    if (runTddBtn) {
                        runTddBtn.addEventListener('click', () => {
                            vscode.postMessage({ command: 'runTest' });
                        });
                    }

                    // Handle messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        
                        switch (message.command) {
                            case 'switchTab':
                                setActiveTab(message.tab);
                                break;
                        }
                    });
                })();
            </script>
        </body>
        </html>`;
    }

    /**
     * Show the TDD Dashboard tab
     */
    showTddDashboard() {
        // If the panel isn't created yet, create it
        if (!this._panel) {
            return;
        }

        try {
            // Update the panel content to ensure it's current
            this._update();
            
            // Send a message to the webview to switch to the TDD Dashboard tab
            this._panel.webview.postMessage({
                command: 'switchTab',
                tab: 'tdd-dashboard'
            });
            
            // Update the panel title
            this._panel.title = "TDD Dashboard";
        } catch (error) {
            Logger.error(`Error showing TDD dashboard: ${error.message}`, 'tdd');
            vscode.window.showErrorMessage(`Failed to show TDD dashboard: ${error.message}`);
        }
    }
}

module.exports = AIMonitorPanel;
