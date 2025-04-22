/**
 * Suggestion Evaluator for AI Development Monitor
 * 
 * Handles evaluation of suggestions from Copilot Chat
 */
const vscode = require('vscode');
const Logger = require('./logger');

// These will be set when the module is initialized
let mcpClient = null;
let connectionStatus = false;
let notificationHandler = null;
let AIMonitorPanel = null;
let checkApiConnection = null;
let httpRequest = null;
let showEvaluationResult = null;

/**
 * Initialize the suggestion evaluator
 * @param {Object} dependencies The required dependencies
 */
function initialize(dependencies) {
    mcpClient = dependencies.mcpClient;
    connectionStatus = dependencies.connectionStatus;
    notificationHandler = dependencies.notificationHandler;
    AIMonitorPanel = dependencies.AIMonitorPanel;
    checkApiConnection = dependencies.checkApiConnection;
    httpRequest = dependencies.httpRequest;
    showEvaluationResult = dependencies.showEvaluationResult || 
                           require('./evaluation_display').showEvaluationResult;
    
    Logger.info('Suggestion evaluator initialized', 'evaluator');
}

/**
 * Evaluate a code suggestion from Copilot Chat
 * @param {Object} chatContext The chat context with code suggestion
 */
async function evaluateChatSuggestion(chatContext) {
    try {
        Logger.info('Evaluating code suggestion from Copilot Chat', 'copilot-chat');
        
        // Show activity in panel if available
        if (AIMonitorPanel && AIMonitorPanel.currentPanel) {
            AIMonitorPanel.currentPanel.addLogEntry('Evaluating code suggestion from Copilot Chat...', 'info');
        }
        
        if (!connectionStatus) {
            const connected = await checkApiConnection();
            if (!connected) {
                notificationHandler.showError('Cannot evaluate suggestion: not connected to AI Development Monitor');
                return;
            }
        }
        
        // Prepare the suggestion data
        const suggestionData = {
            original_code: chatContext.originalCode || '',
            proposed_changes: chatContext.proposedCode || '',
            task_description: chatContext.taskDescription || '',
            language: chatContext.language || '',
            source: 'copilot-chat'
        };
        
        // Use notification handler to show progress
        const result = await notificationHandler.withProgress('Evaluating Copilot Chat suggestion', async (progress) => {
            // Send to MCP server
            let result;
            if (mcpClient) {
                progress.report({ increment: 30, message: "Sending to MCP server..." });
                result = await mcpClient.sendSuggestion(suggestionData);
            } else {
                // Fall back to REST API if MCP client not available
                progress.report({ increment: 30, message: "Sending to REST API..." });
                const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
                const apiUrl = config.get('apiUrl', 'http://localhost:5000');
                result = await httpRequest(`${apiUrl}/evaluate`, 'POST', suggestionData);
                result = result.data;
            }
            
            progress.report({ increment: 70, message: "Processing response..." });
            return result;
        });
        
        // Process result
        if (result && result.content) {
            showEvaluationResult(result.content, suggestionData);
        } else {
            Logger.error('Invalid evaluation result', 'copilot-chat');
            
            if (AIMonitorPanel && AIMonitorPanel.currentPanel) {
                AIMonitorPanel.currentPanel.addLogEntry('Error: Invalid evaluation result', 'error');
            }
            
            notificationHandler.showError('Error evaluating code suggestion');
        }
    } catch (error) {
        Logger.error(`Error evaluating code suggestion: ${error.message}`, 'copilot-chat');
        
        if (AIMonitorPanel && AIMonitorPanel.currentPanel) {
            AIMonitorPanel.currentPanel.addLogEntry(`Error: ${error.message}`, 'error');
        }
        
        notificationHandler.showError(`Error evaluating code suggestion: ${error.message}`);
    }
}

module.exports = {
    initialize,
    evaluateChatSuggestion
};
