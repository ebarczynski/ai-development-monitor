// Required imports
const vscode = require('vscode');
const crypto = require('crypto');
const Logger = require('./logger');
// const httpRequest = require('./http_utils').httpRequest;
// CopilotIntegration class import
const CopilotIntegration = require('./copilot_integration');

// Module-level variables
let lastEvaluation = null;
let retryTimeout = null;
let mcpClient = null;
let monitorEnabled = true;

// Set MCP client reference
function setMcpClient(client) {
    mcpClient = client;
}

/**
 * Set up listeners for GitHub Copilot suggestions
 * @param {vscode.ExtensionContext} context Extension context
 */
async function setupCopilotListeners(context) {
    Logger.info('Setting up GitHub Copilot integration', 'copilot');
    
    // Initialize Copilot integration
    const copilotIntegration = new CopilotIntegration();
    const isAvailable = await copilotIntegration.initialize();
    
    if (!isAvailable) {
        Logger.warn('GitHub Copilot integration not available, suggestion monitoring disabled', 'copilot');
        vscode.window.showWarningMessage('GitHub Copilot not detected. AI Development Monitor will have limited functionality.');
        return;
    }
    
    // Register callback for when suggestions are detected
    // Check which method is actually available on the copilotIntegration object
    if (typeof copilotIntegration.onSuggestionChange === 'function') {
        copilotIntegration.onSuggestionChange(async (suggestion) => {
            handleSuggestion(suggestion);
        });
    } else if (typeof copilotIntegration.registerSuggestionCallback === 'function') {
        // Try alternative method name
        copilotIntegration.registerSuggestionCallback(async (suggestion) => {
            handleSuggestion(suggestion);
        });
    } else {
        // Fallback if no appropriate method exists
        Logger.error('No suggestion callback method found on CopilotIntegration', null, 'copilot');
        vscode.window.showErrorMessage('Error setting up Copilot integration: suggestion monitoring unavailable');
        return;
    }
    
    // Store in context for cleanup
    context.subscriptions.push({
        dispose: () => {
            copilotIntegration.dispose();
        }
    });
    
    Logger.info('GitHub Copilot integration setup complete', 'copilot');
}

/**
 * Handle a suggestion from Copilot
 */
function handleSuggestion(suggestion) {
    Logger.info('Detected GitHub Copilot suggestion', 'copilot');
    Logger.logObject('DEBUG', 'Suggestion details', suggestion, 'copilot');
    
    if (suggestion && monitorEnabled) {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        
        // Automatically evaluate suggestion if enabled
        if (config.get('autoEvaluate', true)) {
            Logger.info('Auto-evaluating Copilot suggestion', 'copilot');
            evaluateSuggestion(suggestion);
        } else {
            Logger.info('Auto-evaluation disabled, suggestion stored for manual evaluation', 'copilot');
            lastEvaluation = suggestion;
            
            // Show notification
            vscode.window.showInformationMessage(
                'GitHub Copilot suggestion detected. Evaluate it?',
                'Evaluate', 'Ignore'
            ).then(selection => {
                if (selection === 'Evaluate') {
                    evaluateSuggestion(suggestion);
                }
            });
        }
    }
}

/**
 * Evaluate a Copilot suggestion using the MCP server or API
 */
async function evaluateSuggestion(suggestion) {
    if (!suggestion) {
        Logger.warn('No suggestion to evaluate', 'evaluation');
        vscode.window.showWarningMessage('No GitHub Copilot suggestion available for evaluation');
        return;
    }
    
    Logger.info('Evaluating GitHub Copilot suggestion', 'evaluation');
    lastEvaluation = suggestion;
    
    // Create a conversation ID for this evaluation
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    
    // Prepare message content
    const taskDescription = "Code completion";
    const filePath = suggestion.document ? suggestion.document.fileName : "unknown";
    const fileContent = suggestion.document ? suggestion.document.getText() : "";
    
    // Get file language from document or extension
    let language = "plaintext";
    if (suggestion.document) {
        language = suggestion.document.languageId;
    } else if (filePath) {
        const extension = filePath.split('.').pop();
        // Map extension to language
        const langMap = {
            "js": "javascript",
            "ts": "typescript",
            "py": "python",
            "java": "java",
            "c": "c",
            "cpp": "cpp",
            "cs": "csharp",
            "go": "go",
            "rs": "rust",
            "php": "php",
            "rb": "ruby",
            "swift": "swift",
            "kt": "kotlin"
        };
        language = langMap[extension] || "plaintext";
    }
    
    // Prepare the message for MCP
    const message = {
        context: {
            conversation_id: conversationId,
            message_id: messageId,
            parent_id: null,
            metadata: {
                file_path: filePath,
                language: language,
                editor: "vscode",
                extension_version: vscode.extensions.getExtension('local-publisher.ai-development-monitor').packageJSON.version
            }
        },
        message_type: "suggestion",
        content: {
            original_code: suggestion.originalCode || "",
            proposed_changes: suggestion.proposedChanges || "",
            task_description: taskDescription,
            file_path: filePath,
            language: language
        }
    };
    
    try {
        // Try using MCP client first if available
        if (mcpClient && mcpClient.connected) {
            Logger.info('Sending suggestion to MCP server for evaluation', 'evaluation');
            const response = await mcpClient.sendMessage(message);
            
            Logger.info('Received evaluation from MCP server', 'evaluation');
            Logger.logObject('DEBUG', 'Evaluation response', response, 'evaluation');
            
            handleEvaluationResponse(response);
        } else {
            // MCP client not available
            Logger.error('MCP client not available for evaluation', 'evaluation');
            vscode.window.showErrorMessage('Cannot evaluate suggestions: MCP connection is not available. Please check the server status.');
            return null;
            
            if (response.statusCode === 200) {
                Logger.info('Received evaluation from API', 'evaluation');
                handleEvaluationResponse(response.data);
            } else {
                throw new Error(`API returned status code ${response.statusCode}`);
            }
        }
    } catch (error) {
        Logger.error('Error evaluating suggestion', error, 'evaluation');
        vscode.window.showErrorMessage(`Error evaluating GitHub Copilot suggestion: ${error.message}`);
        
        // Handle retry if enabled
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        if (config.get('autoRetry', true)) {
            const retryInterval = config.get('retryInterval', 10000);
            
            Logger.info(`Will retry evaluation in ${retryInterval}ms`, 'evaluation');
            
            // Clear any existing retry
            if (retryTimeout) {
                clearTimeout(retryTimeout);
            }
            
            // Set up retry
            retryTimeout = setTimeout(() => {
                retryEvaluation();
            }, retryInterval);
        }
    }
}

/**
 * Handle the evaluation response from the MCP server or API
 */
function handleEvaluationResponse(response) {
    if (!response || !response.message_type) {
        Logger.warn('Invalid evaluation response received', 'evaluation');
        return;
    }
    
    // Store the evaluation
    lastEvaluation.evaluation = response;
    
    // Check if it's an evaluation response
    if (response.message_type === 'evaluation') {
        const content = response.content || {};
        const accept = content.accept || false;
        
        if (accept) {
            Logger.info('Suggestion evaluated positively', 'evaluation');
            vscode.window.showInformationMessage(
                'GitHub Copilot suggestion evaluated positively.',
                'Accept', 'Reject'
            ).then((selection) => {
                if (selection === 'Accept') {
                    acceptSuggestion();
                } else if (selection === 'Reject') {
                    rejectSuggestion();
                }
            });
        } else {
            // Show issues detected
            const issues = content.issues_detected || [];
            const recommendations = content.recommendations || [];
            
            Logger.info('Suggestion evaluated with concerns', 'evaluation');
            
            let message = 'GitHub Copilot suggestion has potential issues';
            if (issues.length > 0) {
                message += `: ${issues[0]}`;
            }
            
            vscode.window.showWarningMessage(
                message,
                'Details', 'Accept Anyway', 'Reject'
            ).then((selection) => {
                if (selection === 'Details') {
                    showEvaluationDetails(content);
                } else if (selection === 'Accept Anyway') {
                    acceptSuggestion();
                } else if (selection === 'Reject') {
                    rejectSuggestion();
                }
            });
        }
    } else if (response.message_type === 'error') {
        Logger.warn('Received error from evaluation', 'evaluation');
        vscode.window.showErrorMessage(`Error evaluating suggestion: ${response.content.message || 'Unknown error'}`);
    }
}

/**
 * Show detailed evaluation information
 */
function showEvaluationDetails(evaluation) {
    const issues = evaluation.issues_detected || [];
    const recommendations = evaluation.recommendations || [];
    
    // Create markdown content
    const content = new vscode.MarkdownString();
    content.appendMarkdown('# GitHub Copilot Suggestion Evaluation\n\n');
    
    // Add metrics
    content.appendMarkdown('## Metrics\n\n');
    content.appendMarkdown(`- **Acceptance**: ${evaluation.accept ? '✅ Recommended' : '❌ Not Recommended'}\n`);
    content.appendMarkdown(`- **Hallucination Risk**: ${(evaluation.hallucination_risk * 100).toFixed(1)}%\n`);
    content.appendMarkdown(`- **Recursive Risk**: ${(evaluation.recursive_risk * 100).toFixed(1)}%\n`);
    content.appendMarkdown(`- **Alignment Score**: ${(evaluation.alignment_score * 100).toFixed(1)}%\n\n`);
    
    // Add issues
    if (issues.length > 0) {
        content.appendMarkdown('## Issues Detected\n\n');
        issues.forEach((issue, index) => {
            content.appendMarkdown(`${index + 1}. ${issue}\n`);
        });
        content.appendMarkdown('\n');
    }
    
    // Add recommendations
    if (recommendations.length > 0) {
        content.appendMarkdown('## Recommendations\n\n');
        recommendations.forEach((rec, index) => {
            content.appendMarkdown(`${index + 1}. ${rec}\n`);
        });
    }
    
    // Show in webview panel
    const panel = vscode.window.createWebviewPanel(
        'aiDevMonitorEvaluation',
        'Copilot Suggestion Evaluation',
        vscode.ViewColumn.Beside,
        {}
    );
    
    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Copilot Suggestion Evaluation</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    padding: 20px;
                    line-height: 1.6;
                }
                .metrics {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 10px;
                    margin-bottom: 20px;
                }
                .metric {
                    padding: 10px;
                    border-radius: 4px;
                    background-color: #f0f0f0;
                }
                .metric-name {
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .issue, .recommendation {
                    padding: 10px;
                    margin-bottom: 10px;
                    border-left: 3px solid #e74c3c;
                    background-color: #fdedec;
                }
                .recommendation {
                    border-left-color: #3498db;
                    background-color: #ebf5fb;
                }
                .actions {
                    margin-top: 20px;
                    display: flex;
                    gap: 10px;
                }
                button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .accept {
                    background-color: #2ecc71;
                    color: white;
                }
                .reject {
                    background-color: #e74c3c;
                    color: white;
                }
            </style>
        </head>
        <body>
            <h1>GitHub Copilot Suggestion Evaluation</h1>
            
            <h2>Metrics</h2>
            <div class="metrics">
                <div class="metric">
                    <div class="metric-name">Acceptance</div>
                    <div>${evaluation.accept ? '✅ Recommended' : '❌ Not Recommended'}</div>
                </div>
                <div class="metric">
                    <div class="metric-name">Hallucination Risk</div>
                    <div>${(evaluation.hallucination_risk * 100).toFixed(1)}%</div>
                </div>
                <div class="metric">
                    <div class="metric-name">Recursive Risk</div>
                    <div>${(evaluation.recursive_risk * 100).toFixed(1)}%</div>
                </div>
                <div class="metric">
                    <div class="metric-name">Alignment Score</div>
                    <div>${(evaluation.alignment_score * 100).toFixed(1)}%</div>
                </div>
            </div>
            
            ${issues.length > 0 ? `
                <h2>Issues Detected</h2>
                ${issues.map(issue => `<div class="issue">${issue}</div>`).join('')}
            ` : ''}
            
            ${recommendations.length > 0 ? `
                <h2>Recommendations</h2>
                ${recommendations.map(rec => `<div class="recommendation">${rec}</div>`).join('')}
            ` : ''}
            
            <div class="actions">
                <button class="accept" onclick="window.parent.postMessage({ command: 'accept' }, '*')">Accept Suggestion</button>
                <button class="reject" onclick="window.parent.postMessage({ command: 'reject' }, '*')">Reject Suggestion</button>
            </div>
            
            <script>
                window.addEventListener('message', (event) => {
                    // Handle messages from VS Code
                });
            </script>
        </body>
        </html>
    `;
    
    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'accept') {
            acceptSuggestion();
        } else if (message.command === 'reject') {
            rejectSuggestion();
        }
    });
}

/**
 * Manual command to evaluate the current Copilot suggestion
 */
async function evaluateCopilotSuggestion() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor to evaluate Copilot suggestion');
        return;
    }
    
    // Check if we have a stored suggestion
    if (!lastEvaluation) {
        vscode.window.showWarningMessage('No recent GitHub Copilot suggestion detected to evaluate');
        return;
    }
    
    await evaluateSuggestion(lastEvaluation);
}

/**
 * Accept the current suggestion and log the acceptance
 */
async function acceptSuggestion() {
    if (!lastEvaluation) {
        vscode.window.showWarningMessage('No GitHub Copilot suggestion to accept');
        return;
    }
    
    Logger.info('User accepted Copilot suggestion', 'evaluation');
    
    // Send acceptance to MCP server
    try {
        if (mcpClient && mcpClient.connected) {
            const originalEvaluation = lastEvaluation.evaluation;
            if (originalEvaluation) {
                const acceptMessage = {
                    context: {
                        conversation_id: originalEvaluation.context.conversation_id,
                        message_id: crypto.randomUUID(),
                        parent_id: originalEvaluation.context.message_id,
                        metadata: originalEvaluation.context.metadata
                    },
                    message_type: "feedback",
                    content: {
                        accepted: true,
                        reason: "User accepted the suggestion",
                        original_evaluation: originalEvaluation
                    }
                };
                
                await mcpClient.sendMessage(acceptMessage);
                Logger.info('Sent acceptance feedback to MCP server', 'evaluation');
            }
        }
    } catch (error) {
        Logger.error('Error sending acceptance feedback', error, 'evaluation');
    }
    
    // Show success notification
    vscode.window.showInformationMessage('GitHub Copilot suggestion accepted and logged');
    
    // Clear evaluation
    lastEvaluation = null;
}

/**
 * Reject the current suggestion and log the rejection
 */
async function rejectSuggestion() {
    if (!lastEvaluation) {
        vscode.window.showWarningMessage('No GitHub Copilot suggestion to reject');
        return;
    }
    
    Logger.info('User rejected Copilot suggestion', 'evaluation');
    
    // Send rejection to MCP server
    try {
        if (mcpClient && mcpClient.connected) {
            const originalEvaluation = lastEvaluation.evaluation;
            if (originalEvaluation) {
                const rejectMessage = {
                    context: {
                        conversation_id: originalEvaluation.context.conversation_id,
                        message_id: crypto.randomUUID(),
                        parent_id: originalEvaluation.context.message_id,
                        metadata: originalEvaluation.context.metadata
                    },
                    message_type: "feedback",
                    content: {
                        accepted: false,
                        reason: "User rejected the suggestion",
                        original_evaluation: originalEvaluation
                    }
                };
                
                await mcpClient.sendMessage(rejectMessage);
                Logger.info('Sent rejection feedback to MCP server', 'evaluation');
            }
        }
    } catch (error) {
        Logger.error('Error sending rejection feedback', error, 'evaluation');
    }
    
    // Show success notification  
    vscode.window.showInformationMessage('GitHub Copilot suggestion rejected and logged');
    
    // Clear evaluation
    lastEvaluation = null;
}

/**
 * Retry the last evaluation with a Continue message
 */
async function retryEvaluation() {
    if (!lastEvaluation || !lastEvaluation.evaluation) {
        Logger.warn('No evaluation to retry', 'evaluation');
        return;
    }
    
    Logger.info('Retrying evaluation with Continue message', 'evaluation');
    
    try {
        const originalEvaluation = lastEvaluation.evaluation;
        
        // Create continue message
        const continueMessage = {
            context: {
                conversation_id: originalEvaluation.context.conversation_id,
                message_id: crypto.randomUUID(),
                parent_id: originalEvaluation.context.message_id,
                metadata: originalEvaluation.context.metadata
            },
            message_type: "continue",
            content: {
                reason: "Retry after timeout or error"
            }
        };
        
        // Send continue message
        if (mcpClient && mcpClient.connected) {
            Logger.info('Sending Continue message to MCP server', 'evaluation');
            const response = await mcpClient.sendMessage(continueMessage);
            
            Logger.info('Received response to Continue message', 'evaluation');
            handleEvaluationResponse(response);
        } else {
            // MCP client not available
            Logger.error('MCP client not available for Continue function', 'evaluation');
            vscode.window.showErrorMessage('Cannot process "Continue" action: MCP connection is not available. Please check the server status.');
            return null;
            
            if (response.statusCode === 200) {
                Logger.info('Received response to Continue from API', 'evaluation');
                handleEvaluationResponse(response.data);
            } else {
                throw new Error(`API returned status code ${response.statusCode}`);
            }
        }
    } catch (error) {
        Logger.error('Error retrying evaluation', error, 'evaluation');
        vscode.window.showErrorMessage(`Error retrying evaluation: ${error.message}`);
    }
}

// Export the functions that need to be accessible from other modules
module.exports = {
    setupCopilotListeners,
    evaluateCopilotSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    retryEvaluation,
    setMcpClient
};
