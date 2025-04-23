/**
 * Notification Handler for AI Development Monitor
 * 
 * Manages notifications and provides consistent notification patterns
 */
const vscode = require('vscode');
const Logger = require('./logger');
const AIMonitorPanel = require('./ai_monitor_panel');

class NotificationHandler {
    constructor() {
        this.activeNotifications = new Map();
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    }

    /**
     * Show an information notification
     * @param {string} message The notification message
     * @param {string[]} actions Optional action items
     * @returns {Promise<string|undefined>} The selected action or undefined
     */
    async showInfo(message, actions = []) {
        Logger.debug(`INFO: ${message}`, 'notification');
        return vscode.window.showInformationMessage(message, ...actions);
    }

    /**
     * Show a warning notification
     * @param {string} message The notification message
     * @param {string[]} actions Optional action items
     * @returns {Promise<string|undefined>} The selected action or undefined
     */
    async showWarning(message, actions = []) {
        Logger.debug(`WARNING: ${message}`, 'notification');
        return vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show an error notification
     * @param {string} message The notification message
     * @param {string[]} actions Optional action items
     * @returns {Promise<string|undefined>} The selected action or undefined
     */
    async showError(message, actions = []) {
        Logger.debug(`ERROR: ${message}`, 'notification');
        return vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * Show a notification for evaluation results
     * @param {Object} evaluation The evaluation data
     * @param {Object} suggestionData The suggestion data that was evaluated
     */
    async showEvaluationResult(evaluation, suggestionData) {
        // Get notification preference
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        const notifyLevel = this.config.get('notificationLevel', 'normal');
        
        if (notifyLevel === 'minimal' && evaluation.accept) {
            // For minimal notifications, only show rejected evaluations
            return;
        }
        
        const accept = evaluation.accept;
        
        // Extract test information if available
        const testsPassing = evaluation.tests_passing || 0;
        const testsTotal = evaluation.tests_total || 0;
        const testInfo = (testsTotal > 0) ? 
            ` | Tests: ${testsPassing}/${testsTotal} passing` : '';
            
        const tddScore = evaluation.tdd_score !== undefined ? 
            ` | TDD Score: ${Math.round(evaluation.tdd_score * 100)}%` : '';
            
        const title = accept ? 'Code suggestion accepted' : 'Code suggestion rejected';
            
        const message = `${title} - ${evaluation.reason.substring(0, 80)}${evaluation.reason.length > 80 ? '...' : ''}${testInfo}${tddScore}`;
        
        // Include Accept/Reject buttons in addition to Show Details
        const actions = [
            ...(suggestionData ? ['Accept', 'Reject'] : []), 
            'Show Details', 
            ...(evaluation.test_scenarios ? ['View Tests'] : []),
            'Dismiss'
        ];
        
        const selection = accept ? 
            await this.showInfo(message, actions) :
            await this.showWarning(message, actions);
            
        if (selection === 'Show Details') {
            // Show details in the monitor panel
            const panel = AIMonitorPanel.createOrShow(this._extensionContext);
            panel.setEvaluationResults(evaluation);
        } else if (selection === 'Accept' && suggestionData) {
            // Trigger the accept action for the suggestion
            if (suggestionData.acceptCallback) {
                Logger.info('User accepted suggestion via notification', 'notification');
                await suggestionData.acceptCallback();
            }
        } else if (selection === 'Reject' && suggestionData) {
            // Trigger the reject action for the suggestion
            if (suggestionData.rejectCallback) {
                Logger.info('User rejected suggestion via notification', 'notification');
                await suggestionData.rejectCallback();
            }
        } else if (selection === 'View Tests' && evaluation.test_scenarios) {
            // Show test scenarios in a new document
            this.showTestScenarios(evaluation.test_scenarios);
        }
    }
    
    /**
     * Display test scenarios in a new editor window
     * @param {Array|Object} testScenarios The test scenarios to display
     */
    async showTestScenarios(testScenarios) {
        try {
            // Convert test scenarios to displayable format
            let content = '# Test Scenarios\n\n';
            
            if (Array.isArray(testScenarios)) {
                testScenarios.forEach((scenario, index) => {
                    content += `## Scenario ${index + 1}: ${scenario.title || 'Untitled'}\n\n`;
                    if (scenario.description) content += `${scenario.description}\n\n`;
                    if (scenario.code) content += `\`\`\`\n${scenario.code}\n\`\`\`\n\n`;
                    
                    // Add pass/fail status if available
                    if (scenario.status) {
                        const statusIcon = scenario.status === 'pass' ? '✅' : '❌';
                        content += `**Status**: ${statusIcon} ${scenario.status.toUpperCase()}\n\n`;
                    }
                });
            } else if (typeof testScenarios === 'object') {
                // Handle case where test scenarios is an object with named scenarios
                Object.keys(testScenarios).forEach(key => {
                    const scenario = testScenarios[key];
                    content += `## ${key}\n\n`;
                    if (scenario.description) content += `${scenario.description}\n\n`;
                    if (scenario.code) content += `\`\`\`\n${scenario.code}\n\`\`\`\n\n`;
                    
                    // Add pass/fail status if available
                    if (scenario.status) {
                        const statusIcon = scenario.status === 'pass' ? '✅' : '❌';
                        content += `**Status**: ${statusIcon} ${scenario.status.toUpperCase()}\n\n`;
                    }
                });
            } else {
                content += 'No test scenarios available.';
            }
            
            // Create a new untitled document with the content
            const document = await vscode.workspace.openTextDocument({
                content,
                language: 'markdown'
            });
            
            await vscode.window.showTextDocument(document);
            Logger.info('Displayed test scenarios in new document', 'notification');
            
        } catch (error) {
            Logger.error(`Error showing test scenarios: ${error.message}`, error, 'notification');
            await this.showError(`Failed to display test scenarios: ${error.message}`);
        }
    }

    /**
     * Show a progress notification for long-running operations
     * @param {string} title The progress title
     * @param {Function} task The task function to execute while showing progress
     * @returns {Promise<any>} The result of the task function
     */
    async withProgress(title, task) {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            
            try {
                const result = await task(progress);
                return result;
            } catch (error) {
                Logger.error(`Error in progress task: ${error.message}`, error, 'notification');
                throw error;
            }
        });
    }

    /**
     * Set the extension context
     * @param {vscode.ExtensionContext} context The extension context
     */
    setContext(context) {
        this._extensionContext = context;
    }
}

module.exports = NotificationHandler;
