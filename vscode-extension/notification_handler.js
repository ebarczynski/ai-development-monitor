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
        const title = accept ? 'Code suggestion accepted' : 'Code suggestion rejected';
        const tddScore = evaluation.tdd_score !== undefined ? 
            ` | TDD Score: ${Math.round(evaluation.tdd_score * 100)}%` : '';
            
        const message = `${title} - ${evaluation.reason.substring(0, 100)}${evaluation.reason.length > 100 ? '...' : ''}`;
        
        const actions = ['Show Details', 'Dismiss'];
        
        const selection = accept ? 
            await this.showInfo(message, actions) :
            await this.showWarning(message, actions);
            
        if (selection === 'Show Details') {
            // Show details in the monitor panel
            const panel = AIMonitorPanel.createOrShow(this._extensionContext);
            panel.setEvaluationResults(evaluation);
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
