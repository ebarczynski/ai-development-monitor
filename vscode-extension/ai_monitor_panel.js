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
     * @param {vscode.WebviewPanel} panel
     * @param {vscode.ExtensionContext} context
     */
    constructor(panel, context) {
        this._panel = panel;
        this._extensionContext = context;
        
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
        
        this._update();
    }
    
    /**
     * Show details of a specific TDD iteration
     * @param {number} index The iteration index
     */
    showTddDetails(index) {
        if (index >= 0 && index < this._tddResults.length) {
            const result = this._tddResults[index];
            
            // Create a untitled file with the test code
            vscode.workspace.openTextDocument({
                content: result.test_code,
                language: result.language || 'python'
            })
            .then(doc => {
                vscode.window.showTextDocument(doc);
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
                            <div class="risk-value">${Math.round(eval.hallucination_risk * 100)}%</div>
                        </div>
                        
                        <div class="risk-item">
                            <div class="risk-label">Recursive Risk:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${eval.recursive_risk * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(eval.recursive_risk * 100)}%</div>
                        </div>
                        
                        <div class="risk-item">
                            <div class="risk-label">Alignment Score:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${eval.alignment_score * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(eval.alignment_score * 100)}%</div>
                        </div>
                        
                        ${eval.tdd_score !== undefined ? `
                        <div class="risk-item">
                            <div class="risk-label">TDD Score:</div>
                            <div class="risk-meter">
                                <div class="risk-fill" style="width: ${eval.tdd_score * 100}%"></div>
                            </div>
                            <div class="risk-value">${Math.round(eval.tdd_score * 100)}%</div>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${eval.issues_detected && eval.issues_detected.length > 0 ? `
                    <div class="issues">
                        <h4>Issues Detected:</h4>
                        <ul>
                            ${eval.issues_detected.map(issue => `<li>${issue}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                    
                    ${eval.recommendations && eval.recommendations.length > 0 ? `
                    <div class="recommendations">
                        <h4>Recommendations:</h4>
                        <ul>
                            ${eval.recommendations.map(rec => `<li>${rec}</li>`).join('')}
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
            </style>
        </head>
        <body>
            <div class="container">
                <h2>AI Development Monitor</h2>
                
                <div class="toolbar">
                    <div>
                        <button id="runTestBtn">Run Diagnostic Test</button>
                    </div>
                    <div>
                        <button id="clearLogsBtn">Clear Logs</button>
                    </div>
                </div>
                
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
                
                <div class="panel logs-panel">
                    <h3>Activity Log</h3>
                    <div class="logs-container">
                        ${logsHtml || '<div class="log-entry info"><span class="log-message">No activity recorded yet.</span></div>'}
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
                    
                    // Add event listeners for all TDD view buttons
                    document.querySelectorAll('.tdd-view-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const index = parseInt(btn.getAttribute('data-index'));
                            vscode.postMessage({ command: 'showTddDetails', iterationIndex: index });
                        });
                    });
                    
                    // Scroll logs panel to bottom
                    const logsPanel = document.querySelector('.logs-panel');
                    if (logsPanel) {
                        logsPanel.scrollTop = logsPanel.scrollHeight;
                    }
                })();
            </script>
        </body>
        </html>`;
    }
}

module.exports = AIMonitorPanel;
