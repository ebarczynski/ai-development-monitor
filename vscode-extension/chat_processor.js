/**
 * Chat Context Processor for AI Development Monitor
 * 
 * Processes context extracted from Copilot Chat and triggers evaluations
 */
const vscode = require('vscode');
const Logger = require('./logger');

// These will be set when the module is initialized
let mcpClient = null;
let monitorEnabled = true;
let notificationHandler = null;
let AIMonitorPanel = null;
let evaluateChatSuggestion = null;

/**
 * Initialize the chat context processor
 * @param {Object} dependencies The required dependencies
 */
function initialize(dependencies) {
    mcpClient = dependencies.mcpClient;
    monitorEnabled = dependencies.monitorEnabled;
    notificationHandler = dependencies.notificationHandler;
    AIMonitorPanel = dependencies.AIMonitorPanel;
    evaluateChatSuggestion = dependencies.evaluateChatSuggestion;
    
    Logger.info('Chat context processor initialized', 'chat-processor');
}

/**
 * Process extracted context from Copilot Chat
 * @param {Object} chatContext The extracted chat context
 */
function processChatContext(chatContext) {
    if (!chatContext || !chatContext.taskDescription) {
        return;
    }
    
    Logger.info('Processing extracted chat context', 'copilot-chat');
    
    // Log to panel if available
    if (AIMonitorPanel && AIMonitorPanel.currentPanel) {
        AIMonitorPanel.currentPanel.addLogEntry(
            `Extracted context from Copilot Chat: ${chatContext.taskDescription.substring(0, 50)}...`, 
            'info'
        );
    }
    
    // Store the context for use in evaluations
    if (mcpClient) {
        mcpClient.setEnhancedContext({
            taskDescription: chatContext.taskDescription,
            originalCode: chatContext.originalCode || '',
            language: chatContext.language || ''
        });
        
        Logger.debug('Enhanced context set in MCP client', 'copilot-chat');
    }
    
    // If we have proposed code, potentially trigger an evaluation
    if (chatContext.proposedCode && monitorEnabled) {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        
        // Auto-evaluate proposed code if enabled
        if (config.get('autoEvaluateChatSuggestions', true)) {
            evaluateChatSuggestion(chatContext);
        } else {
            // Show notification with option to evaluate
            notificationHandler.showInfo(
                'Code suggestion detected in Copilot Chat. Evaluate it?',
                ['Evaluate', 'Ignore']
            ).then(selection => {
                if (selection === 'Evaluate') {
                    evaluateChatSuggestion(chatContext);
                }
            });
        }
    }
}

module.exports = {
    initialize,
    processChatContext
};
