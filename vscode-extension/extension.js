// The module 'vscode' contains the VS Code extensibility API
const vscode = require('vscode');
const https = require('https');
const http = require('http');
const MCPClient = require('./mcp_client');
const Logger = require('./logger');
const CopilotIntegration = require('./copilot_integration');
const CopilotChatIntegration = require('./copilot_chat_integration');
const AIMonitorPanel = require('./ai_monitor_panel');
// Import integration modules
const evaluationDisplay = require('./evaluation_display');
const chatProcessor = require('./chat_processor');
const suggestionEvaluator = require('./suggestion_evaluator');

// Keep track of state
let statusBarItem;
let monitorEnabled = true;
let lastEvaluation = null;
let retryTimeout = null;
let connectionStatus = false;
let mcpClient = null;
let copilotIntegration = null;
let copilotChatIntegration = null;
let notificationHandler;

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    // Initialize logger with extension context
    Logger.initialize(vscode, context, {
        level: Logger.LOG_LEVEL.DEBUG,
        logToOutputChannel: true
    });
    
    Logger.info('AI Development Monitor is now active', 'system');
    console.log('MCPClient imported:', typeof MCPClient);
    // Initialize notification handler
    const NotificationHandler = require('./notification_handler');
    notificationHandler = new NotificationHandler();
    notificationHandler.setContext(context);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(shield) AI Monitor: Starting...";
    statusBarItem.tooltip = "AI Development Monitor";
    statusBarItem.command = 'ai-development-monitor.enable';
    statusBarItem.show();
    
    // Register commands
    const enableCommand = vscode.commands.registerCommand('ai-development-monitor.enable', enableMonitor);
    const disableCommand = vscode.commands.registerCommand('ai-development-monitor.disable', disableMonitor);
    const evaluateCommand = vscode.commands.registerCommand('ai-development-monitor.evaluateCopilotSuggestion', evaluateCopilotSuggestion);
    const acceptCommand = vscode.commands.registerCommand('ai-development-monitor.acceptSuggestion', acceptSuggestion);
    const rejectCommand = vscode.commands.registerCommand('ai-development-monitor.rejectSuggestion', rejectSuggestion);
    
    // Register UI panel command
    const showPanelCommand = vscode.commands.registerCommand('ai-development-monitor.showPanel', () => {
        const panel = AIMonitorPanel.createOrShow(context);
        panel.addLogEntry('Panel opened', 'info');
    });

    // Register diagnostic test command
    const diagnosticTest = require('./diagnostic_test');
    const runTestCommand = vscode.commands.registerCommand('ai-development-monitor.runDiagnosticTest', diagnosticTest.runDiagnosticTests);
    
    // Register debug command to show logs
    const showLogsCommand = vscode.commands.registerCommand('ai-development-monitor.showLogs', () => {
        Logger.show();
    });
    
    // Get configuration
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    monitorEnabled = config.get('enabled', true);
    
    // Add the panel command to subscriptions
    context.subscriptions.push(
        enableCommand,
        disableCommand,
        evaluateCommand,
        acceptCommand,
        rejectCommand,
        showLogsCommand,
        showPanelCommand,
        statusBarItem,
        runTestCommand
    );
    
    // Initialize MCP client if enabled
    if (config.get('useMcp', true)) {
        Logger.info('Initializing MCP client', 'mcp');
        mcpClient = new MCPClient();
        try {
            await mcpClient.connect();
            connectionStatus = true;
            Logger.info('Successfully connected to MCP server', 'mcp');
        } catch (error) {
            Logger.error('Failed to connect to MCP server', error, 'mcp');
            vscode.window.showWarningMessage('Failed to connect to MCP server. Falling back to REST API.');
            // Fall back to REST API
            await checkApiConnection();
        }
    } else {
        // Use REST API
        Logger.info('MCP disabled, using REST API', 'api');
        await checkApiConnection();
    }
    
    const copilotHandlers = require('./copilot_handlers');
    
    // Set up event listeners for Copilot
    // setupCopilotListeners(context);
    await copilotHandlers.setupCopilotListeners(context);
    
    // Initialize Copilot Chat integration
    copilotChatIntegration = new CopilotChatIntegration();
    const chatAvailable = await copilotChatIntegration.initialize();
    if (chatAvailable) {
        Logger.info('GitHub Copilot Chat integration initialized successfully', 'copilot-chat');
        
        // Register additional Chat-specific commands
        const extractChatCommand = vscode.commands.registerCommand('ai-development-monitor.extractChatContext', () => {
            copilotChatIntegration.extractChatContext(true);
        });
        
        const viewExtractedContextCommand = vscode.commands.registerCommand('ai-development-monitor.viewExtractedContext', () => {
            copilotChatIntegration.showExtractedContext();
        });
        
        context.subscriptions.push(
            extractChatCommand,
            viewExtractedContextCommand
        );
        
        // Set up callback to extract context when it changes
        copilotChatIntegration.onContextChange((context) => {
            chatProcessor.processChatContext(context);
        });
        
    } else {
        Logger.warn('GitHub Copilot Chat integration not available', 'copilot-chat');
    }

        // Initialize integration modules
    evaluationDisplay.initialize({
        context,
        statusBarItem,
        AIMonitorPanel,
        notificationHandler
    });

    chatProcessor.initialize({
        mcpClient,
        monitorEnabled,
        notificationHandler,
        AIMonitorPanel,
        evaluateChatSuggestion: suggestionEvaluator.evaluateChatSuggestion
    });

    suggestionEvaluator.initialize({
        mcpClient,
        connectionStatus,
        notificationHandler,
        AIMonitorPanel,
        checkApiConnection,
        httpRequest,
        showEvaluationResult: evaluationDisplay.showEvaluationResult
    });

    // Update status bar
    updateStatusBar();
}

/**
 * Check connection to the AI Development Monitor API
 */
async function checkApiConnection() {
    try {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        const apiUrl = config.get('apiUrl', 'http://localhost:5000');
        
        // Check status
        const statusResponse = await httpRequest(`${apiUrl}/status`, 'GET');
        
        if (statusResponse.statusCode === 200) {
            connectionStatus = true;
            console.log('Successfully connected to AI Development Monitor API');
            
            // If agent is not connected to LLM, try to connect
            if (!statusResponse.data.agent_connected) {
                await httpRequest(`${apiUrl}/connect`, 'POST');
            }
        } else {
            connectionStatus = false;
            console.error('Failed to connect to AI Development Monitor API');
        }
    } catch (error) {
        connectionStatus = false;
        console.error('Error connecting to AI Development Monitor API:', error.message);
        vscode.window.showErrorMessage('Failed to connect to AI Development Monitor. Make sure the API server is running.');
    }
    
    updateStatusBar();
    return connectionStatus;
}
        
/**
 * Make an HTTP request using built-in http/https modules
 */
function httpRequest(url, method, data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const req = client.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                let parsedData;
                try {
                    parsedData = JSON.parse(data);
                } catch (e) {
                    parsedData = data;
                }
                
                resolve({
                    statusCode: res.statusCode,
                    data: parsedData
                });
            });
        });
        
        req.on('error', (e) => {
            reject(e);
        });
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}


/**
 * Enable the AI Development Monitor
 */
function enableMonitor() {
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    config.update('enabled', true, true);
    monitorEnabled = true;
    vscode.window.showInformationMessage('AI Development Monitor enabled');
    updateStatusBar();
}

/**
 * Disable the AI Development Monitor
 */
function disableMonitor() {
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    config.update('enabled', false, true);
    monitorEnabled = false;
    vscode.window.showInformationMessage('AI Development Monitor disabled');
    updateStatusBar();
}

/**
 * Update the status bar item
 */
function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    
    if (connectionStatus) {
        if (monitorEnabled) {
            statusBarItem.text = "$(shield-check) AI Monitor: Active";
            statusBarItem.tooltip = "AI Development Monitor is active and connected";
            statusBarItem.command = 'ai-development-monitor.disable';
        } else {
            statusBarItem.text = "$(shield) AI Monitor: Disabled";
            statusBarItem.tooltip = "AI Development Monitor is disabled";
            statusBarItem.command = 'ai-development-monitor.enable';
        }
    } else {
        statusBarItem.text = "$(shield-x) AI Monitor: Disconnected";
        statusBarItem.tooltip = "AI Development Monitor is disconnected";
        statusBarItem.command = 'ai-development-monitor.enable';
    }
}

// /**
//  * Set up event listeners for GitHub Copilot
//  */
// function setupCopilotListeners(context) {
//     // Listen for inline suggestion events
//     // This requires accessing internal Copilot APIs which may change over time
    
//     Logger.info('Setting up GitHub Copilot listeners', 'copilot');
    
//     // First, check if Copilot is installed
//     const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
//     if (!copilotExtension) {
//         Logger.warn('GitHub Copilot extension not found. AI Development Monitor requires Copilot to function.', 'copilot');
//         vscode.window.showWarningMessage('GitHub Copilot extension not found. AI Development Monitor requires Copilot to function.');
//         return;
//     }
    
//     Logger.info('GitHub Copilot extension found', 'copilot');
    
//     // Try to access Copilot API (this is experimental and may not work consistently)
//     try {
//         if (copilotExtension.isActive) {
//             Logger.debug('Copilot extension is already active', 'copilot');
//             setupCopilotApi(copilotExtension.exports);
//         } else {
//             Logger.debug('Activating Copilot extension', 'copilot');
//             copilotExtension.activate().then(exports => {
//                 setupCopilotApi(exports);
//             }).catch(err => {
//                 Logger.error('Failed to activate Copilot extension', err, 'copilot');
//             });
//         }
//     } catch (error) {
//         Logger.error('Error accessing Copilot API', error, 'copilot');
//     }
    
//     // Set up API polling to check for suggestions as fallback
//     Logger.info('Setting up suggestion polling as fallback', 'copilot');
//     const suggestionCheckInterval = setInterval(async () => {
//         if (!monitorEnabled || !connectionStatus) {
//             return;
//         }
        
//         try {
//             // Check for visual indicators of active suggestions
//             const editor = vscode.window.activeTextEditor;
//             if (!editor) {
//                 return;
//             }
            
//             // Check for Copilot's ghost text decorations
//             // This is a heuristic approach that might not always work
//             const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
//             if (config.get('autoEvaluate', true)) {
//                 // Look for changes in the document that might indicate a suggestion
//                 // For now, this just serves as a placeholder for more sophisticated detection
//                 Logger.trace('Checking for Copilot suggestions', 'copilot');
//             }
            
//             // Auto-continuation for errors or timeouts
//             handleAutoContinuation();
//         } catch (error) {
//             Logger.error('Error in suggestion polling', error, 'copilot');
//         }
//     }, 1000);
    
//     context.subscriptions.push({ dispose: () => clearInterval(suggestionCheckInterval) });
// }

/**
 * Set up access to GitHub Copilot API if available
 * Note: This relies on internal Copilot APIs which may change or be restricted
 */
function setupCopilotApi(copilotExports) {
    Logger.info('Setting up Copilot API integration', 'copilot');
    
    try {
        // Check if the Copilot exports contain any usable APIs
        if (!copilotExports) {
            Logger.warn('No accessible Copilot API found', 'copilot');
            return;
        }
        
        // Log available Copilot exports (for debugging)
        Logger.debug('Available Copilot exports: ' + Object.keys(copilotExports).join(', '), 'copilot');
        
        // Try to access suggestion related APIs
        // Note: This is experimental and may not work as Copilot's API is not public
        
        // The specific implementation will depend on the current structure of Copilot's API
        // For now, this serves as a placeholder for when we discover more stable integration points
        Logger.info('Registered with Copilot API hooks', 'copilot');
    } catch (error) {
        Logger.error('Failed to set up Copilot API integration', error, 'copilot');
    }
}

/**
 * Handle auto-continuation for errors or timeouts
 */
async function handleAutoContinuation() {
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    const autoRetry = config.get('autoRetry', true);
    const retryInterval = config.get('retryInterval', 10000);
    
    if (!autoRetry) {
        return;
    }
    
    // For now, this is a simplified implementation
    // In a real implementation, you would need to detect actual Copilot error states or timeouts
    
    // Example of detecting potential timeout or error state
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    
    // For demonstration, we'll just set up the capability to send "Continue" commands via MCP
    // This could be triggered by a detection mechanism or by user action
    
    // Set up a command to send "Continue" via MCP
    if (config.get('useMcp', true) && mcpClient && mcpClient.connected) {
        // Check if a "Continue" command is registered for timeouts
        if (retryTimeout) {
            clearTimeout(retryTimeout);
        }
        
        // Create a function to send "Continue" via MCP
        const sendContinueViaMcp = async () => {
            try {
                const response = await mcpClient.sendContinue("Continue", true);
                console.log('Sent "Continue" command via MCP');
                
                if (response && response.content && response.content.response) {
                    vscode.window.showInformationMessage('AI responded to "Continue" command', 'View Response')
                        .then(selection => {
                            if (selection === 'View Response') {
                                // Show the response in a document
                                const newDocument = vscode.workspace.openTextDocument({
                                    content: response.content.response,
                                    language: 'markdown'
                                }).then(doc => {
                                    vscode.window.showTextDocument(doc);
                                });
                            }
                        });
                }
            } catch (error) {
                console.error('Error sending "Continue" via MCP:', error);
            }
        };
        
        // This is a placeholder for actual timeout detection
        // In a real implementation, you would detect Copilot timeouts or errors
        // and then trigger this function
        
        // For now, we'll just expose it as a command that can be triggered
        // context.subscriptions.push(
        //     vscode.commands.registerCommand('ai-development-monitor.sendContinue', sendContinueViaMcp)
        // );
        const evaluateCommand = vscode.commands.registerCommand(
            'ai-development-monitor.evaluateCopilotSuggestion', 
            copilotHandlers.evaluateCopilotSuggestion
            );
        const acceptCommand = vscode.commands.registerCommand(
            'ai-development-monitor.acceptSuggestion', 
            copilotHandlers.acceptSuggestion
            );
        const rejectCommand = vscode.commands.registerCommand(
            'ai-development-monitor.rejectSuggestion', 
            copilotHandlers.rejectSuggestion
            );
}
}

/**
 * Evaluate the current Copilot suggestion
 */
async function evaluateCopilotSuggestion() {
    try {
        Logger.info('Starting evaluation of Copilot suggestion', 'evaluation');
        
        // Get the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            Logger.warn('No active editor when attempting to evaluate suggestion', 'evaluation');
            vscode.window.showInformationMessage('No active editor');
            return;
        }
        
        // Check connection
        if (!connectionStatus) {
            const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
            if (config.get('useMcp', true) && mcpClient) {
                Logger.info('Attempting to reconnect to MCP server', 'mcp');
                try {
                    await mcpClient.connect();
                    connectionStatus = true;
                    Logger.info('Successfully reconnected to MCP server', 'mcp');
                } catch (error) {
                    Logger.error('Failed to reconnect to MCP server', error, 'mcp');
                    if (!await checkApiConnection()) {
                        Logger.error('Cannot evaluate suggestion: All connection methods failed', null, 'evaluation');
                        vscode.window.showErrorMessage('Cannot evaluate suggestion: AI Development Monitor is disconnected');
                        return;
                    }
                }
            } else if (!await checkApiConnection()) {
                Logger.error('Cannot evaluate suggestion: REST API connection failed', null, 'evaluation');
                vscode.window.showErrorMessage('Cannot evaluate suggestion: AI Development Monitor is disconnected');
                return;
            }
        }
        
        // Get current file content
        const document = editor.document;
        const fullText = document.getText();
        
        // For demonstration, we'll use the selected text as the "suggestion"
        // In a real implementation, you would need to access Copilot's actual suggestion
        const selection = editor.selection;
        const proposedChanges = selection.isEmpty ? 
            await vscode.env.clipboard.readText() : 
            document.getText(selection);
        
        if (!proposedChanges) {
            Logger.warn('No text selected or in clipboard to evaluate', 'evaluation');
            vscode.window.showInformationMessage('No text selected or in clipboard to evaluate');
            return;
        }
        
        Logger.debug('Evaluating code suggestion', 'evaluation');
        Logger.debug(`Original code length: ${fullText.length} characters`, 'evaluation');
        Logger.debug(`Proposed changes length: ${proposedChanges.length} characters`, 'evaluation');
        
        // Show progress notification
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Evaluating suggestion",
            cancellable: false
        }, async (progress) => {
            // Get file type and context
            const fileType = document.languageId;
            const fileName = document.fileName;
            
            // Get task description (for now, use filename and language)
            const taskDescription = `Implement functionality in ${fileName} using ${fileType}`;
            
            let response;
            
            // Use MCP if available, otherwise fall back to REST API
            const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
            if (config.get('useMcp', true) && mcpClient && mcpClient.connected) {
                Logger.info('Sending evaluation request via MCP', 'mcp');
                
                // Send evaluation request via MCP
                try {
                    response = await mcpClient.evaluateSuggestion(
                        fullText,
                        proposedChanges,
                        taskDescription,
                        fileName,
                        fileType
                    );
                    
                    Logger.debug('Received MCP evaluation response', 'mcp');
                    Logger.logObject('DEBUG', 'MCP Response', response, 'mcp');
                    
                    // Format the response to match the REST API format for compatibility
                    lastEvaluation = {
                        accept: response.content.accept,
                        evaluation: {
                            analysis: {
                                hallucination_risk: response.content.hallucination_risk,
                                recursive_risk: response.content.recursive_risk,
                                alignment_score: response.content.alignment_score,
                                issues_detected: response.content.issues_detected,
                                recommendations: response.content.recommendations
                            },
                            reason: response.content.reason,
                            proposed_changes: proposedChanges,
                            original_code: fullText,
                            task_description: taskDescription
                        }
                    };
                } catch (error) {
                    Logger.error('Error during MCP evaluation', error, 'mcp');
                    vscode.window.showErrorMessage(`Error evaluating with MCP: ${error.message}. Falling back to REST API.`);
                    
                    // Fall back to REST API
                    await useFallbackRestApi();
                }
            } else {
                // Send to AI Development Monitor API using REST
                await useFallbackRestApi();
            }
            
            // Helper function for REST API fallback
            async function useFallbackRestApi() {
                Logger.info('Using REST API fallback for evaluation', 'api');
                const apiUrl = config.get('apiUrl', 'http://localhost:5000');
                
                try {
                    const httpResponse = await httpRequest(`${apiUrl}/evaluate`, 'POST', {
                        original_code: fullText,
                        proposed_changes: proposedChanges,
                        task_description: taskDescription
                    });
                    
                    Logger.debug('Received REST API evaluation response', 'api');
                    Logger.logObject('DEBUG', 'REST API Response', httpResponse, 'api');
                    
                    lastEvaluation = httpResponse.data;
                } catch (error) {
                    Logger.error('Error during REST API evaluation', error, 'api');
                    vscode.window.showErrorMessage(`Error evaluating with REST API: ${error.message}`);
                    throw error; // Re-throw to exit the process
                }
            }
            
            // Show results
            Logger.info(`Evaluation result: ${lastEvaluation.accept ? 'ACCEPTED' : 'REJECTED'}`, 'evaluation');
            Logger.debug('Evaluation details:', 'evaluation');
            Logger.debug(`- Hallucination risk: ${lastEvaluation.evaluation.analysis.hallucination_risk}`, 'evaluation');
            Logger.debug(`- Recursive risk: ${lastEvaluation.evaluation.analysis.recursive_risk}`, 'evaluation');
            Logger.debug(`- Alignment score: ${lastEvaluation.evaluation.analysis.alignment_score}`, 'evaluation');
            
            if (lastEvaluation.accept) {
                vscode.window.showInformationMessage('Suggestion ACCEPTED ✅', 'Details', 'Apply')
                    .then(selection => {
                        if (selection === 'Details') {
                            showEvaluationDetails(lastEvaluation);
                        } else if (selection === 'Apply') {
                            acceptSuggestion();
                        }
                    });
            } else {
                vscode.window.showWarningMessage('Suggestion REJECTED ❌', 'Details', 'Apply Anyway')
                    .then(selection => {
                        if (selection === 'Details') {
                            showEvaluationDetails(lastEvaluation);
                        } else if (selection === 'Apply Anyway') {
                            acceptSuggestion();
                        }
                    });
            }
        });
    } catch (error) {
        Logger.error('Error evaluating suggestion', error, 'evaluation');
        vscode.window.showErrorMessage(`Error evaluating suggestion: ${error.message}`);
    }
}

/**
 * Show evaluation details in a webview
 */
function showEvaluationDetails(evaluation) {
    // Create and show webview with evaluation details
    const panel = vscode.window.createWebviewPanel(
        'evaluationDetails',
        'Suggestion Evaluation',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
    );
    
    const analysis = evaluation.evaluation.analysis;
    
    // Create HTML content
    panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Suggestion Evaluation</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                .score { display: flex; margin-bottom: 10px; }
                .score-bar { height: 20px; background-color: #eee; border-radius: 10px; flex-grow: 1; margin-left: 10px; overflow: hidden; }
                .score-fill { height: 100%; }
                .good { background-color: #4CAF50; }
                .warning { background-color: #FF9800; }
                .danger { background-color: #F44336; }
                .code { background-color: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap; font-family: monospace; }
                h2 { margin-top: 20px; }
                ul { padding-left: 20px; }
            </style>
        </head>
        <body>
            <h1>Suggestion Evaluation ${evaluation.accept ? '✅ ACCEPTED' : '❌ REJECTED'}</h1>
            
            <h2>Risk Analysis</h2>
            
            <div class="score">
                <span>Hallucination Risk:</span>
                <div class="score-bar">
                    <div class="score-fill ${analysis.hallucination_risk < 0.3 ? 'good' : analysis.hallucination_risk < 0.7 ? 'warning' : 'danger'}" 
                         style="width: ${analysis.hallucination_risk * 100}%"></div>
                </div>
                <span>${Math.round(analysis.hallucination_risk * 100)}%</span>
            </div>
            
            <div class="score">
                <span>Inconsistency Risk:</span>
                <div class="score-bar">
                    <div class="score-fill ${analysis.inconsistency_risk < 0.3 ? 'good' : analysis.inconsistency_risk < 0.7 ? 'warning' : 'danger'}" 
                         style="width: ${analysis.inconsistency_risk * 100}%"></div>
                </div>
                <span>${Math.round(analysis.inconsistency_risk * 100)}%</span>
            </div>
            
            <div class="score">
                <span>Recursive Risk:</span>
                <div class="score-bar">
                    <div class="score-fill ${analysis.recursive_risk < 0.3 ? 'good' : analysis.recursive_risk < 0.7 ? 'warning' : 'danger'}" 
                         style="width: ${analysis.recursive_risk * 100}%"></div>
                </div>
                <span>${Math.round(analysis.recursive_risk * 100)}%</span>
            </div>
            
            <div class="score">
                <span>Alignment Score:</span>
                <div class="score-bar">
                    <div class="score-fill ${analysis.alignment_score > 0.7 ? 'good' : analysis.alignment_score > 0.3 ? 'warning' : 'danger'}" 
                         style="width: ${analysis.alignment_score * 100}%"></div>
                </div>
                <span>${Math.round(analysis.alignment_score * 100)}%</span>
            </div>
            
            <h2>Issues Detected</h2>
            <ul>
                ${analysis.issues_detected.length > 0 
                    ? analysis.issues_detected.map(issue => `<li>${issue}</li>`).join('')
                    : '<li>No issues detected</li>'}
            </ul>
            
            <h2>Recommendations</h2>
            <ul>
                ${analysis.recommendations.length > 0 
                    ? analysis.recommendations.map(rec => `<li>${rec}</li>`).join('')
                    : '<li>No recommendations</li>'}
            </ul>
            
            <h2>Proposed Changes</h2>
            <div class="code">${escapeHtml(evaluation.evaluation.proposed_changes)}</div>
            
            <h2>Decision</h2>
            <p>${evaluation.evaluation.reason}</p>
            
            <div style="margin-top: 20px; display: flex; justify-content: space-between;">
                <button onclick="vscode.postMessage({command: 'reject'})">Reject</button>
                <button onclick="vscode.postMessage({command: 'accept'})">Accept</button>
            </div>
        </body>
        </html>
    `;
    
    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(message => {
        switch (message.command) {
            case 'accept':
                acceptSuggestion();
                panel.dispose();
                break;
            case 'reject':
                rejectSuggestion();
                panel.dispose();
                break;
        }
    });
}

/**
 * Helper function to escape HTML special characters
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Accept the current suggestion
 */
async function acceptSuggestion() {
    if (!lastEvaluation) {
        vscode.window.showInformationMessage('No evaluated suggestion available');
        return;
    }
    
    // Get the active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
    }
    
    // For demonstration, we'll insert the proposed changes at the cursor position
    // In a real implementation, you would accept the actual Copilot suggestion
    try {
        // Insert at cursor position
        const position = editor.selection.active;
        const proposedChanges = lastEvaluation.evaluation.proposed_changes;
        
        await editor.edit(editBuilder => {
            editBuilder.insert(position, proposedChanges);
        });
        
        vscode.window.showInformationMessage('Suggestion applied successfully');
        lastEvaluation = null;
    } catch (error) {
        console.error('Error applying suggestion:', error);
        vscode.window.showErrorMessage(`Error applying suggestion: ${error.message}`);
    }
}

/**
 * Reject the current suggestion
 */
function rejectSuggestion() {
    // In a real implementation, you would need to dismiss Copilot's suggestion
    // Since we can't directly control Copilot's UI, this is mostly a placeholder
    lastEvaluation = null;
    vscode.window.showInformationMessage('Suggestion rejected');
}

/**
 * Send "Continue" command to GitHub Copilot
 */
async function sendContinueCommand() {
    try {
        // Since we can't directly interact with Copilot's internals,
        // we'll simulate sending "Continue" by programmatically typing it
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        
        // Type "Continue" at the cursor position
        // Note: This is a simplified example. In a real integration, you would
        // need to use the appropriate Copilot API to continue a conversation
        const cursorPosition = editor.selection.active;
        
        await editor.edit(editBuilder => {
            editBuilder.insert(cursorPosition, "\nContinue\n");
        });
        
        // Trigger "Send to Copilot" command
        // This assumes there's a command to send the current line to Copilot
        await vscode.commands.executeCommand('github.copilot.generate');
        
        vscode.window.showInformationMessage('Sent "Continue" command to Copilot');
    } catch (error) {
        console.error('Error sending Continue command:', error);
    }
}

// This method is called when your extension is deactivated
function deactivate() {
    // Clear any timeouts
    if (retryTimeout) {
        clearTimeout(retryTimeout);
    }
    
    // Update status bar
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    
    console.log('AI Development Monitor is now deactivated');
}

module.exports = {
    activate,
    deactivate
};
