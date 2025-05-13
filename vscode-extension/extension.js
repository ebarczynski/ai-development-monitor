// The module 'vscode' contains the VS Code extensibility API
const vscode = require('vscode');
const https = require('https');
const http = require('http');
const MCPClient = require('./mcp_client');
const OptimizedMCPClient = require('./optimized_mcp_client');
const Logger = require('./logger');
const CopilotIntegration = require('./copilot_integration');
const CopilotChatIntegration = require('./copilot_chat_integration');
const AIMonitorPanel = require('./ai_monitor_panel');
const contextManager = require('./context_manager');
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
    // Get configuration settings
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    const loggingConfig = vscode.workspace.getConfiguration('aiDevelopmentMonitor.logging');
    const debugVerbosity = loggingConfig.get('debugVerbosity', 'normal');
    
    // Determine appropriate log level based on verbosity setting
    let logLevel = Logger.LOG_LEVEL.INFO;
    switch (debugVerbosity) {
        case 'minimal':
            logLevel = Logger.LOG_LEVEL.INFO;
            break;
        case 'normal':
            logLevel = Logger.LOG_LEVEL.DEBUG;
            break;
        case 'verbose':
            logLevel = Logger.LOG_LEVEL.TRACE;
            break;
    }
    
    // Initialize logger with extension context and configuration
    Logger.initialize(vscode, context, {
        level: logLevel,
        logToOutputChannel: true,
        debugVerbosity: debugVerbosity,
        rateLimitDuration: loggingConfig.get('rateLimitDuration', 2000),
        maxDuplicateLogs: loggingConfig.get('maxDuplicateLogs', 3)
    });
    
    Logger.info('AI Development Monitor is now active', 'system');
    
    // Initialize context manager with extension context
    contextManager.initialize(context);
    Logger.info('Context manager initialized with extension context', 'system');
    
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
    
    // Create a context menu for the status bar item
    statusBarItem.command = undefined; // Remove direct command to use the menu instead
    
    // Show context menu when clicking the status bar item
    statusBarItem.tooltip = "AI Development Monitor";
    statusBarItem.command = 'ai-development-monitor.showStatusMenu';
    
    // Register command for showing the status menu
    const showStatusMenuCommand = vscode.commands.registerCommand('ai-development-monitor.showStatusMenu', () => {
        const items = [];
        
        if (mcpClient) {
            const status = mcpClient.getConnectionStatus ? mcpClient.getConnectionStatus() : { state: connectionStatus ? 'connected' : 'disconnected' };
            
            // Quick connection management actions
            if (status.state === 'connected') {
                items.push({
                    label: "$(shield-check) Monitor is Connected",
                    description: monitorEnabled ? "Active" : "Disabled",
                    detail: "Connection to MCP server is established"
                });
                
                items.push({
                    label: monitorEnabled ? "$(circle-slash) Disable Monitor" : "$(play-circle) Enable Monitor",
                    command: monitorEnabled ? 'ai-development-monitor.disable' : 'ai-development-monitor.enable'
                });
            } else {
                items.push({
                    label: "$(shield-x) Monitor is Disconnected",
                    description: "Not connected to MCP server"
                });
                
                items.push({
                    label: "$(debug-restart) Reconnect to MCP Server",
                    command: 'ai-development-monitor.retryConnection'
                });
            }
            
            // Additional actions
            items.push({
                label: "$(info) Show Connection Details",
                command: 'ai-development-monitor.showConnectionStatus'
            });
            
            items.push({
                label: "$(terminal) Show Logs",
                command: 'ai-development-monitor.showLogs'
            });
            
            if (monitorEnabled) {
                items.push({
                    label: "$(dashboard) Open Dashboard",
                    command: 'ai-development-monitor.showPanel'
                });
            }
        } else {
            items.push({
                label: "$(warning) MCP Client Not Initialized",
                detail: "Check the extension settings"
            });
        }
        
        // Show the quick pick menu
        vscode.window.showQuickPick(items, {
            placeHolder: "AI Development Monitor",
            matchOnDescription: true,
            matchOnDetail: true
        }).then(item => {
            if (item && item.command) {
                vscode.commands.executeCommand(item.command);
            }
        });
    });

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
    
    // Register TDD Dashboard command
    const showTddDashboardCommand = vscode.commands.registerCommand('ai-development-monitor.showTddDashboard', () => {
        const panel = AIMonitorPanel.createOrShow(context);
        panel.showTddDashboard();
        panel.addLogEntry('TDD Dashboard opened', 'info');
    });

    // Register diagnostic test command
    const diagnosticTest = require('./diagnostic_test');
    const runTestCommand = vscode.commands.registerCommand('ai-development-monitor.runDiagnosticTest', diagnosticTest.runDiagnosticTests);
    
    // Register command to retry MCP connection
    const retryConnectionCommand = vscode.commands.registerCommand('ai-development-monitor.retryConnection', async () => {
        if (mcpClient) {
            try {
                // Use the new reconnect method which handles the existing connection cleanup
                await mcpClient.reconnect();
                connectionStatus = mcpClient.connected;
                updateStatusBar();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to connect to MCP server: ${err.message}`);
            }
        } else {
            vscode.window.showErrorMessage('MCP client is not initialized. Please check your settings.');
        }
    });
    
    // Register debug command to show logs
    const showLogsCommand = vscode.commands.registerCommand('ai-development-monitor.showLogs', () => {
        Logger.show();
    });

    // Register command to show connection status details
    const showConnectionStatusCommand = vscode.commands.registerCommand('ai-development-monitor.showConnectionStatus', () => {
        if (mcpClient && typeof mcpClient.getConnectionStatus === 'function') {
            const status = mcpClient.getConnectionStatus();
            
            // Format the status information
            const statusMessage = [
                `Connection State: ${status.state}`,
                `Connected: ${status.connected}`,
                `Socket State: ${getSocketStateDescription(status.socketState)}`,
                `Reconnection Attempts: ${status.reconnectAttempts}`,
                `Queued Messages: ${status.queuedMessages}`,
                `Last Heartbeat Pong: ${status.lastPongTime ? formatTimeDifference(status.lastPongTime) : 'Never'}`
            ].join('\n');
            
            // Show the status information
            vscode.window.showInformationMessage('Connection Status', { modal: true, detail: statusMessage });
        } else {
            vscode.window.showInformationMessage('Connection status information is not available');
        }
    });
    
    // Helper function to describe WebSocket state
    function getSocketStateDescription(state) {
        if (state === 'no-socket') return 'No WebSocket';
        switch (state) {
            case WebSocket.CONNECTING: return 'CONNECTING (0)';
            case WebSocket.OPEN: return 'OPEN (1)';
            case WebSocket.CLOSING: return 'CLOSING (2)';
            case WebSocket.CLOSED: return 'CLOSED (3)';
            default: return `Unknown (${state})`;
        }
    }
    
    // Helper function to format time difference
    function formatTimeDifference(timeString) {
        try {
            const time = new Date(timeString);
            const now = new Date();
            const diffMs = now - time;
            
            if (diffMs < 1000) return 'Just now';
            if (diffMs < 60000) return `${Math.floor(diffMs / 1000)} seconds ago`;
            if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} minutes ago`;
            return `${Math.floor(diffMs / 3600000)} hours ago`;
        } catch (e) {
            return timeString || 'Unknown';
        }
    }
    
    // Get configuration
    const extensionConfig = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    monitorEnabled = extensionConfig.get('enabled', true);
    
    // Add the panel command to subscriptions
    context.subscriptions.push(
        enableCommand,
        disableCommand,
        evaluateCommand,
        acceptCommand,
        rejectCommand,
        showLogsCommand,
        showPanelCommand,
        showTddDashboardCommand,
        statusBarItem,
        runTestCommand,
        retryConnectionCommand,
        showConnectionStatusCommand,
        showStatusMenuCommand
    );
    
    // Initialize MCP client if enabled
    if (extensionConfig.get('useMcp', true)) {
        Logger.info('Initializing Optimized MCP client', 'mcp');
        // Use the new optimized MCP client instead of the original one
        mcpClient = new OptimizedMCPClient();
        try {
            await mcpClient.connect();
            connectionStatus = true;
            Logger.info('Successfully connected to MCP server with optimized client', 'mcp');
            
            // Start automatic reconnection monitoring
            if (extensionConfig.get('autoReconnect', true)) {
                Logger.info('Setting up automatic MCP reconnection monitor', 'mcp');
                // The client will now handle its own connection monitoring
            }
            
            // Add a statistics command to show optimization metrics
            const showStatsCommand = vscode.commands.registerCommand('ai-development-monitor.showConnectionStats', () => {
                const stats = mcpClient.getStatistics();
                const panel = AIMonitorPanel.createOrShow(context);
                panel.addLogEntry('Connection Statistics', 'info');
                panel.addLogEntry(`Messages sent: ${stats.sent}, Received: ${stats.received}`, 'info');
                panel.addLogEntry(`Total data sent: ${formatBytes(stats.totalBytesSent)}, Received: ${formatBytes(stats.totalBytesReceived)}`, 'info');
                panel.addLogEntry(`Compressed messages: ${stats.compressed} (saved ${formatBytes(stats.savedBytes)})`, 'info');
                panel.addLogEntry(`Compression ratio: ${stats.compressionRatio}`, 'info');
                panel.addLogEntry(`Batched messages: ${stats.batched}`, 'info');
                panel.addLogEntry(`Connection quality: ${stats.connectionQuality} (avg latency: ${stats.averageLatency?.toFixed(1) || 'unknown'}ms)`, 'info');
                
                vscode.window.showInformationMessage(`Connection Statistics: ${stats.compressionRatio} compression, ${stats.connectionQuality} connection quality`);
            });
            
            context.subscriptions.push(showStatsCommand);
        } catch (error) {
            Logger.error('Failed to connect to MCP server', error, 'mcp');
            vscode.window.showWarningMessage('Failed to connect to MCP server. Please check the server status.');
            // Connection failure
            // Do not proceed with API connection
        }
    } else {
        // MCP is disabled in settings
        Logger.info('MCP disabled in settings. Please enable MCP to use this extension.', 'api');
        vscode.window.showWarningMessage('MCP is disabled in settings. This extension now requires MCP. Please enable it in settings to use the extension.');
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
        
        // Register commands for interacting with Copilot Chat
        const continueCommand = vscode.commands.registerCommand('ai-development-monitor.copilotChatContinue', () => {
            copilotChatIntegration.sendContinue(true);
        });
        
        const requestChangesCommand = vscode.commands.registerCommand('ai-development-monitor.copilotChatRequestChanges', async () => {
            // Prompt the user for specific feedback
            const feedback = await vscode.window.showInputBox({
                placeHolder: "Enter specific feedback (optional)",
                prompt: "What changes would you like to request?"
            });
            
            // Send the request changes message
            copilotChatIntegration.requestChanges(feedback || "", true);
        });
        
        context.subscriptions.push(
            extractChatCommand,
            viewExtractedContextCommand,
            continueCommand,
            requestChangesCommand
        );
        
        // Set up callback to extract context when it changes
        copilotChatIntegration.onContextChange((context) => {
            // Update central context manager with the new context
            contextManager.updateContext({
                taskDescription: context.taskDescription,
                originalCode: context.originalCode,
                proposedCode: context.proposedCode,
                language: context.language,
                sourceType: 'chat'
            });
            
            // Log that we've updated the context manager
            Logger.info('Context manager updated from Copilot Chat integration', 'context');
            
            // Also process the context through the chat processor for backward compatibility
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
/**
 * This is now a stub function since we've removed REST API functionality
 * Only MCP connections are supported in this version
 */
async function checkApiConnection() {
    Logger.info('REST API functionality has been removed from this version', 'api');
    connectionStatus = false;
    
    // Update the status bar to reflect MCP-only mode
    updateStatusBar();
    
    return false;
}

/**
 * Check if a server is available using a TCP check
 */
function checkServerAvailability(url) {
    return new Promise(resolve => {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;
            const port = urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80);
            
            Logger.debug(`Checking server availability at ${hostname}:${port}`, 'api');
            
            const net = require('net');
            const socket = new net.Socket();
            
            // Set a short timeout for the connection attempt
            socket.setTimeout(3000);
            
            socket.on('connect', () => {
                Logger.debug('Server is available (TCP check successful)', 'api');
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                Logger.debug('Server availability check timed out', 'api');
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', (error) => {
                Logger.debug(`Server is unavailable: ${error.message}`, 'api');
                socket.destroy();
                resolve(false);
            });
            
            // Try to connect
            socket.connect(port, hostname);
            
        } catch (error) {
            Logger.error('Error in server availability check', error, 'api');
            resolve(false);
        }
    });
}

/**
 * Try to start the server automatically
 */
function tryStartServer() {
    // Get workspace root folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found to start server');
        return;
    }
    
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    // Look for start scripts
    const fs = require('fs');
    const path = require('path');
    
    const startScripts = [
        path.join(workspaceRoot, 'start_server.sh'),
        path.join(workspaceRoot, 'start_web_server.sh'),
        path.join(workspaceRoot, '..', 'start_server.sh')
    ];
    
    let scriptToRun = null;
    for (const script of startScripts) {
        try {
            if (fs.existsSync(script)) {
                scriptToRun = script;
                break;
            }
        } catch (error) {
            console.error(`Error checking script ${script}:`, error);
        }
    }
    
    if (!scriptToRun) {
        vscode.window.showErrorMessage(
            'Could not find server start script. Start the server manually and try again.'
        );
        return;
    }
    
    // Execute the script
    const terminal = vscode.window.createTerminal('AI Development Monitor Server');
    terminal.show();
    
    // Make script executable if needed
    terminal.sendText(`chmod +x "${scriptToRun}"`);
    terminal.sendText(`"${scriptToRun}"`);
    
    vscode.window.showInformationMessage(
        'Starting the server. Wait a moment and then check the connection.',
        'Check Connection'
    ).then(selection => {
        if (selection === 'Check Connection') {
            // Wait for server to start up
            setTimeout(() => {
                checkApiConnection();
            }, 5000);
        }
    });
}

/**
 * Show troubleshooting information to help users resolve connection issues
 */
function showTroubleshootingInfo() {
    const troubleshootingInfo = [
        '# AI Development Monitor Connection Troubleshooting',
        '',
        '## Common Issues',
        '1. **Server not running** - Start the server with `./start_server.sh`',
        '2. **Wrong API URL** - Check the `apiUrl` setting in extension configuration',
        '3. **Port already in use** - Check if another process is using port 5000',
        '4. **Server crashed** - Check server logs for errors',
        '',
        '## How to Start the Server',
        '1. Open a terminal in the project root',
        '2. Run the start script: `./start_server.sh`',
        '3. Wait for the server to initialize',
        '4. Check connection from the extension',
        '',
        '## Configuration',
        'Check your `settings.json` for proper configuration:',
        '```json',
        '{',
        '  "aiDevelopmentMonitor.mcpUrl": "ws://localhost:5001/ws",',
        '  "aiDevelopmentMonitor.apiUrl": "http://localhost:5000",',
        '  "aiDevelopmentMonitor.apiTimeout": 5000',
        '}',
        '```'
    ].join('\n');
    
    // Create a new untitled markdown file with the troubleshooting info
    vscode.workspace.openTextDocument({
        content: troubleshootingInfo,
        language: 'markdown'
    }).then(doc => {
        vscode.window.showTextDocument(doc);
    });
}

/**
 * Make an HTTP request using built-in http/https modules
 * @param {string} url - The URL to request
 * @param {string} method - HTTP method (GET, POST, etc)
 * @param {object} data - Data to send (for POST/PUT)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<object>} - Response with statusCode and data
 */
function httpRequest(url, method, data = null, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: timeoutMs // Set request timeout
        };
        
        const client = urlObj.protocol === 'https:' ? https : http;
        
        Logger.debug(`Making ${method} request to ${url}`, 'api');
        
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
        
        // Set timeout handler
        req.on('timeout', () => {
            Logger.error(`Request to ${url} timed out after ${timeoutMs}ms`, null, 'api');
            req.destroy();
            reject(new Error('Request timed out'));
        });
        
        req.on('error', (error) => {
            Logger.error(`Request error: ${error.message}`, error, 'api');
            reject(error);
        });
        
        if (data) {
            const postData = JSON.stringify(data);
            req.write(postData);
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
    
    // If we have an MCP client, use its detailed status
    if (mcpClient && typeof mcpClient.getConnectionStatus === 'function') {
        const status = mcpClient.getConnectionStatus();
        
        if (status.state === 'connected') {
            if (monitorEnabled) {
                statusBarItem.text = "$(shield-check) AI Monitor: Active";
                
                // Show queued messages if any
                const queueInfo = status.queuedMessages > 0 
                    ? ` (${status.queuedMessages} queued messages)` 
                    : '';
                    
                statusBarItem.tooltip = `AI Development Monitor is active and connected${queueInfo}`;
                statusBarItem.command = 'ai-development-monitor.disable';
            } else {
                statusBarItem.text = "$(shield) AI Monitor: Disabled";
                statusBarItem.tooltip = "AI Development Monitor is disabled (but connected)";
                statusBarItem.command = 'ai-development-monitor.enable';
            }
        } else if (status.state === 'reconnecting') {
            statusBarItem.text = "$(sync~spin) AI Monitor: Reconnecting...";
            statusBarItem.tooltip = `AI Development Monitor is reconnecting (attempt ${status.reconnectAttempts})`;
            statusBarItem.command = 'ai-development-monitor.retryConnection';
        } else if (status.state === 'connecting') {
            statusBarItem.text = "$(sync~spin) AI Monitor: Connecting...";
            statusBarItem.tooltip = "AI Development Monitor is establishing connection";
            statusBarItem.command = 'ai-development-monitor.showLogs';
        } else {
            // Disconnected state
            statusBarItem.text = "$(shield-x) AI Monitor: Disconnected";
            statusBarItem.tooltip = "AI Development Monitor is disconnected. Click to reconnect.";
            statusBarItem.command = 'ai-development-monitor.retryConnection';
        }
    } else {
        // Fall back to the simple connection status
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
            statusBarItem.tooltip = "AI Development Monitor is disconnected. Click to reconnect.";
            statusBarItem.command = 'ai-development-monitor.retryConnection';
        }
    }
}

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
            const reconnectConfig = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
            if (reconnectConfig.get('useMcp', true) && mcpClient) {
                Logger.info('Attempting to reconnect to MCP server', 'mcp');
                try {
                    // Use the improved reconnect method
                    const reconnected = await mcpClient.reconnect();
                    connectionStatus = reconnected;
                    
                    if (reconnected) {
                        Logger.info('Successfully reconnected to MCP server', 'mcp');
                    } else {
                        Logger.warn('Reconnection attempt did not succeed', 'mcp');
                    }
                } catch (error) {
                    Logger.error('Failed to reconnect to MCP server', error, 'mcp');
                    if (!await checkApiConnection()) {
                        Logger.error('Cannot evaluate suggestion: All connection methods failed', null, 'evaluation');
                        vscode.window.showErrorMessage('Cannot evaluate suggestion: AI Development Monitor is disconnected');
                        return;
                    }
                }
            } else {
                Logger.error('Cannot evaluate suggestion: MCP connection is not available', null, 'evaluation');
                vscode.window.showErrorMessage('Cannot evaluate suggestion: MCP is disconnected. Please check server status.');
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
            
            // Try to get the task description from Copilot Chat if available
            let taskDescription;
            let taskDescriptionSource = 'unknown';
            
            if (copilotChatIntegration && copilotChatIntegration.isAvailable) {
                const extractedContext = copilotChatIntegration.getExtractedContext();
                if (extractedContext && extractedContext.taskDescription) {
                    taskDescription = extractedContext.taskDescription;
                    taskDescriptionSource = extractedContext.sourceType || 'chat';
                    
                    // Remove any visual indicators we might have added for debugging purposes
                    if (taskDescription.startsWith('[CHAT QUERY] ')) {
                        taskDescription = taskDescription.substring(13);
                    } else if (taskDescription.startsWith('[EDITOR CONTENT] ')) {
                        taskDescription = taskDescription.substring(17);
                    }
                    
                    Logger.debug(`Using task description from Copilot Chat (source: ${taskDescriptionSource}): ${taskDescription.substring(0, 50)}...`, 'evaluation');
                }
            }
            
            // Fall back to a basic description if nothing was extracted from chat
            if (!taskDescription) {
                taskDescription = `Modify code in ${fileName} using ${fileType}`;
                taskDescriptionSource = 'fallback';
                Logger.debug(`Using generic task description: ${taskDescription}`, 'evaluation');
            }
            
            let response;
            
            // Use MCP if available and connected
            const mcpConfig = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
            if (mcpConfig.get('useMcp', true) && mcpClient && mcpClient.connected) {
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
                    
                    // Process the MCP response
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
                    vscode.window.showErrorMessage(`Error evaluating with MCP: ${error.message}. Please check the server status.`);
                    
                    // Don't proceed with evaluation
                    return null;
                }
            } else {
                // MCP is not connected
                Logger.warn("MCP client is not connected", 'mcp');
                vscode.window.showErrorMessage("MCP connection is not available. Please check the server status.");
                return null;
            }
            
            // Helper function for REST API fallback - now just a stub since we've removed REST API fallback
            async function useFallbackRestApi() {
                Logger.info('REST API fallback has been removed from this version', 'api');
                vscode.window.showErrorMessage("REST API fallback functionality has been removed. Please ensure the MCP server is running.");
                return null;
            }
            
            // Show results
            Logger.info(`Evaluation result: ${lastEvaluation.accept ? 'ACCEPTED' : 'REJECTED'}`, 'evaluation');
            Logger.debug('Evaluation details:', 'evaluation');
            Logger.debug(`- Hallucination risk: ${lastEvaluation.evaluation.analysis.hallucination_risk}`, 'evaluation');
            Logger.debug(`- Recursive risk: ${lastEvaluation.evaluation.analysis.recursive_risk}`, 'evaluation');
            Logger.debug(`- Alignment score: ${lastEvaluation.evaluation.analysis.alignment_score}`, 'evaluation');
            
            // Update the AI Monitor Panel with the evaluation results
            if (AIMonitorPanel.currentPanel) {
                AIMonitorPanel.currentPanel.updateEvaluationResult(lastEvaluation);
                Logger.info('Updated AIMonitorPanel with evaluation results', 'evaluation');
            } else {
                Logger.debug('AIMonitorPanel not available for result update', 'evaluation');
            }
            
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
    Logger.info('Deactivating AI Development Monitor extension...', 'extension');
    
    // Clean up MCP client resources
    if (mcpClient) {
        try {
            // First try to use our new disconnect method for a clean shutdown
            if (typeof mcpClient.disconnect === 'function') {
                Logger.info('Performing clean disconnect from MCP server', 'mcp');
                mcpClient.disconnect(true); // Pass true to suppress events during shutdown
            }
            // Then handle network change handlers cleanup
            if (typeof mcpClient.cleanupNetworkChangeHandlers === 'function') {
                Logger.info('Cleaning up network change handlers', 'mcp');
                mcpClient.cleanupNetworkChangeHandlers();
            }
            // Then fall back to the dispose method if available
            else if (typeof mcpClient.dispose === 'function') {
                Logger.info('Disposing MCP client resources', 'mcp');
                mcpClient.dispose();
            }
            // For basic connection cleanup, ensure socket is terminated
            else if (mcpClient.socket) {
                Logger.info('Terminating WebSocket connection', 'mcp');
                try {
                    mcpClient.socket.close(1000, 'Extension deactivating');
                } catch (e) {
                    // Ignore errors during close
                }
            }
            
            // Clear any intervals that might still be running
            if (mcpClient.persistentReconnectInterval) {
                clearInterval(mcpClient.persistentReconnectInterval);
                mcpClient.persistentReconnectInterval = null;
            }
            
            if (mcpClient.connectionMonitorInterval) {
                clearInterval(mcpClient.connectionMonitorInterval);
                mcpClient.connectionMonitorInterval = null;
            }
            
            if (mcpClient.heartbeatInterval) {
                clearInterval(mcpClient.heartbeatInterval);
                mcpClient.heartbeatInterval = null;
            }
        } catch (error) {
            Logger.error('Error during MCP client cleanup', error, 'mcp');
        }
        mcpClient = null;
    }
    
    // Clean up any other clients
    if (copilotIntegration) {
        try {
            Logger.info('Cleaning up Copilot integration resources', 'copilot');
            if (typeof copilotIntegration.dispose === 'function') {
                copilotIntegration.dispose();
            }
        } catch (error) {
            Logger.error('Error cleaning up Copilot integration', error, 'copilot');
        }
        copilotIntegration = null;
    }
    
    if (copilotChatIntegration) {
        try {
            Logger.info('Cleaning up Copilot Chat integration resources', 'copilot');
            if (typeof copilotChatIntegration.dispose === 'function') {
                copilotChatIntegration.dispose();
            }
        } catch (error) {
            Logger.error('Error cleaning up Copilot Chat integration', error, 'copilot');
        }
        copilotChatIntegration = null;
    }
    
    // Clear any timeouts
    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }
    
    // Update status bar
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = null;
    }
    
    // Final cleanup for other resources
    if (notificationHandler) {
        try {
            notificationHandler.dispose();
        } catch (e) {
            // Ignore errors
        }
        notificationHandler = null;
    }
    
    Logger.info('AI Development Monitor has been successfully deactivated', 'extension');
    console.log('AI Development Monitor is now deactivated');
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes Number of bytes to format
 * @returns {string} Human-readable string
 */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = {
    activate,
    deactivate
};
