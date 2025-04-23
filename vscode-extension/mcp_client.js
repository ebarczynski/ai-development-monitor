// MCP Client implementation for AI Development Monitor extension
const vscode = require('vscode');
const WebSocket = require('ws');
const Logger = require('./logger');
const crypto = require('crypto');

class MCPClient {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.clientId = crypto.randomUUID();
        this.messageCallbacks = new Map(); // Map of message_id -> callback
        this.connectionPromise = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // Start with 2 seconds
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.mcpUrl = this.config.get('mcpUrl', 'ws://localhost:5001/ws');
        
        // Set up heartbeat
        this.heartbeatInterval = null;
        this.lastPongTime = Date.now();
        
        // Enhanced context from Copilot Chat
        this.enhancedContext = {
            taskDescription: "",
            originalCode: "",
            language: "",
            sourceType: "" // Add source type to track where the context came from
        };
        
        // Progress notification
        this.progressNotification = null;
    }

    /**
     * Connect to the MCP server
     */
    connect() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = new Promise((resolve, reject) => {
            try {
                // Refresh configuration in case it changed
                this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
                this.mcpUrl = this.config.get('mcpUrl', 'ws://localhost:5001/ws');
                
                // Construct the URL correctly
                let wsUrl = this.mcpUrl;
                // Make sure we have the correct format - add /ws if needed
                if (!wsUrl.endsWith('/ws')) {
                    if (!wsUrl.endsWith('/')) {
                        wsUrl += '/';
                    }
                    wsUrl += 'ws';
                }
                // Append the client ID
                wsUrl = `${wsUrl}/${this.clientId}`;
                
                Logger.info(`Connecting to MCP server at ${wsUrl}`, 'mcp');
                
                // Set a connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (!this.connected) {
                        Logger.error('Connection attempt timed out', null, 'mcp');
                        if (this.socket) {
                            this.socket.terminate();
                            this.socket = null;
                        }
                        reject(new Error('Connection timeout'));
                    }
                }, 10000); // 10 second timeout
                
                this.socket = new WebSocket(wsUrl);
                
                this.socket.on('open', () => {
                    clearTimeout(connectionTimeout);
                    Logger.info('Connected to MCP server', 'mcp');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 2000; // Reset delay
                    this.startHeartbeat();
                    resolve(true);
                });
                
                
                this.socket.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        Logger.debug(`Received MCP message: ${message.message_type}`, 'mcp');
                        Logger.logObject('DEBUG', 'MCP Message Content', message, 'mcp');
                        this.handleMessage(message);
                    } catch (error) {
                        Logger.error('Error parsing MCP message', error, 'mcp');
                    }
                });
                
                this.socket.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    Logger.error(`WebSocket error: ${error.message}`, error, 'mcp');
                    this.connected = false;
                    this.stopHeartbeat();
                    
                    // Only reject if this is the first connection attempt
                    if (this.reconnectAttempts === 0) {
                        this.connectionPromise = null;
                        reject(error);
                    }
                    
                    this.attemptReconnect();
                });
                
                this.socket.on('close', () => {
                    clearTimeout(connectionTimeout);
                    Logger.info('Disconnected from MCP server', 'mcp');
                    this.connected = false;
                    this.connectionPromise = null;
                    this.stopHeartbeat();
                    
                    this.attemptReconnect();
                });
                
                // Set up ping/pong for connection health check
                this.socket.on('pong', () => {
                    this.lastPongTime = Date.now();
                    Logger.debug('Received pong from server', 'mcp');
                });
                
            } catch (error) {
                Logger.error('Error connecting to MCP server', error, 'mcp');
                this.connected = false;
                this.connectionPromise = null;
                reject(error);
            }
        });
        
        return this.connectionPromise;
    }
    
    /**
     * Attempt to reconnect to the MCP server
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.warn(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`, 'mcp');
            vscode.window.showErrorMessage(`Failed to reconnect to MCP server after ${this.maxReconnectAttempts} attempts`);
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff
        
        Logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
        
        setTimeout(() => {
            Logger.info(`Reconnecting to MCP server (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
            this.connectionPromise = null;
            this.connect().catch(error => {
                Logger.error(`Reconnection attempt ${this.reconnectAttempts} failed`, error, 'mcp');
            });
        }, delay);
    }
    
    /**
     * Start heartbeat to detect connection issues
     */
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing interval
        
        this.lastPongTime = Date.now();
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.connected) {
                // Check if we've received a pong recently
                const now = Date.now();
                if (now - this.lastPongTime > 30000) { // 30 seconds timeout
                    Logger.warn('No pong received in 30 seconds, connection may be dead', 'mcp');
                    this.socket.terminate(); // Force close and trigger reconnect
                    return;
                }
                
                try {
                    Logger.debug('Sending ping to server', 'mcp');
                    this.socket.ping();
                } catch (error) {
                    Logger.error('Error sending ping', error, 'mcp');
                    this.socket.terminate();
                }
            }
        }, 15000); // Send ping every 15 seconds
    }
    
    /**
     * Stop the heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Handle incoming MCP messages
     */
    handleMessage(message) {
        Logger.debug(`Processing MCP message: ${message.message_type}`, 'mcp');
        
        // Extract context
        const context = message.context;
        if (!context || !context.message_id) {
            Logger.error('Invalid message context', null, 'mcp');
            return;
        }
        
        // Check if we have a callback for this message
        if (this.messageCallbacks.has(context.message_id)) {
            Logger.debug(`Found callback for message ID: ${context.message_id}`, 'mcp');
            const callback = this.messageCallbacks.get(context.message_id);
            this.messageCallbacks.delete(context.message_id);
            callback(message);
        } else if (context.parent_id && this.messageCallbacks.has(context.parent_id)) {
            // This is a response to a parent message
            Logger.debug(`Found callback for parent ID: ${context.parent_id}`, 'mcp');
            const callback = this.messageCallbacks.get(context.parent_id);
            this.messageCallbacks.delete(context.parent_id);
            callback(message);
        } else {
            // No callback found, handle based on message type
            Logger.debug(`No callback found for message: ${context.message_id}`, 'mcp');
            if (message.message_type === 'error') {
                const errorMsg = message.error || 'Unknown error';
                Logger.error(`MCP Error: ${errorMsg}`, null, 'mcp');
                vscode.window.showErrorMessage(`MCP Error: ${errorMsg}`);
            }
        }
    }

    /**
     * Send an MCP message
     */
    async sendMessage(messageType, content, parentId = null) {
        if (!this.connected) {
            Logger.info('Not connected to MCP server, attempting to connect', 'mcp');
            try {
                await this.connect();
            } catch (error) {
                Logger.error('Failed to connect to MCP server', error, 'mcp');
                throw new Error(`Failed to connect to MCP server: ${error.message}`);
            }
        }
        
        return new Promise((resolve, reject) => {
            try {
                // Create message ID
                const messageId = crypto.randomUUID();
                
                // Create message
                const message = {
                    context: {
                        conversation_id: this.clientId,
                        message_id: messageId,
                        parent_id: parentId,
                        metadata: {}
                    },
                    message_type: messageType,
                    content: content
                };
                
                // Add callback for response
                const timeoutMs = 30000; // 30 second timeout
                const timeoutId = setTimeout(() => {
                    if (this.messageCallbacks.has(messageId)) {
                        Logger.warn(`Timeout waiting for response to message ${messageId}`, 'mcp');
                        this.messageCallbacks.delete(messageId);
                        reject(new Error(`Timeout waiting for response to ${messageType} message`));
                    }
                }, timeoutMs);
                
                this.messageCallbacks.set(messageId, (response) => {
                    clearTimeout(timeoutId);
                    if (response.message_type === 'error') {
                        const errorMsg = response.error || 'Unknown error';
                        Logger.error(`MCP Error response: ${errorMsg}`, null, 'mcp');
                        reject(new Error(errorMsg));
                    } else {
                        Logger.debug(`Received response for message ${messageId}`, 'mcp');
                        resolve(response);
                    }
                });
                
                // Send message
                Logger.debug(`Sending MCP message: ${messageType}`, 'mcp');
                Logger.logObject('DEBUG', 'Outgoing Message', message, 'mcp');
                this.socket.send(JSON.stringify(message));
                Logger.info(`Sent MCP message: ${messageType}`, 'mcp');
            } catch (error) {
                Logger.error('Error sending MCP message', error, 'mcp');
                reject(error);
            }
        });
    }

    /**
     * Submit a code suggestion for evaluation
     */
    async evaluateSuggestion(originalCode, proposedChanges, taskDescription, filePath = null, language = null) {
        return this.sendMessage('suggestion', {
            original_code: originalCode,
            proposed_changes: proposedChanges,
            task_description: taskDescription,
            file_path: filePath,
            language: language
        });
    }

    /**
     * Send a continue request
     */
    async sendContinue(prompt, timeoutOccurred = false, errorMessage = null) {
        return this.sendMessage('continue', {
            prompt: prompt,
            timeout_occurred: timeoutOccurred,
            error_message: errorMessage
        });
    }

    /**
     * Disconnect from the MCP server
     */
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.connected = false;
            this.connectionPromise = null;
        }
    }
    
    /**
     * Update enhanced context with Copilot Chat data
     * This is a crucial method for task description handling
     * @param {Object} context The context data from Copilot Chat
     */
    updateEnhancedContext(context) {
        if (!context) return;
        
        // Clean up any visual indicators from task description if present
        let taskDescription = context.taskDescription || this.enhancedContext.taskDescription;
        if (taskDescription) {
            // Remove visual indicators if present
            if (taskDescription.startsWith('[CHAT QUERY] ')) {
                taskDescription = taskDescription.substring(13);
            } else if (taskDescription.startsWith('[EDITOR CONTENT] ')) {
                taskDescription = taskDescription.substring(17);
            }
        }
        
        // Store the enhanced context from Copilot Chat
        this.enhancedContext = {
            taskDescription: taskDescription,
            originalCode: context.originalCode || this.enhancedContext.originalCode,
            language: context.language || this.enhancedContext.language,
            sourceType: context.sourceType || this.enhancedContext.sourceType || 'unknown'
        };
        
        // Log the enhanced context update with detailed information
        Logger.debug(`Enhanced context updated from ${this.enhancedContext.sourceType} source`, 'mcp');
        if (taskDescription) {
            Logger.debug(`Task description: ${taskDescription.substring(0, 50)}...`, 'mcp');
        }
        if (this.enhancedContext.originalCode) {
            Logger.debug(`Original code: ${this.enhancedContext.originalCode.length} chars`, 'mcp');
        }
        if (this.enhancedContext.language) {
            Logger.debug(`Language: ${this.enhancedContext.language}`, 'mcp');
        }
    }
}

/**
 * Set enhanced context from Copilot Chat
 * @param {Object} context Enhanced context with taskDescription, originalCode, etc
 */
MCPClient.prototype.setEnhancedContext = function(context) {
    // Use our improved updateEnhancedContext method
    this.updateEnhancedContext(context);
};

/**
 * Send a suggestion for evaluation
 * @param {Object} suggestion The suggestion data
 * @returns {Promise<Object>} The evaluation response
 */
MCPClient.prototype.sendSuggestion = async function(suggestion) {
    try {
        // Show progress in the VS Code UI
        this.showProgress("Evaluating code suggestion...");
        
        // Enhance suggestion with chat context if available
        if (this.enhancedContext.taskDescription && (!suggestion.task_description || 
            suggestion.task_description.includes("Modify code in") || 
            suggestion.task_description.includes("Implement functionality"))) {
            
            // Only replace generic descriptions with our better ones
            suggestion.task_description = this.enhancedContext.taskDescription;
            Logger.info(`Using enhanced task description: ${suggestion.task_description.substring(0, 50)}...`, 'mcp');
        }
        
        if (this.enhancedContext.language && !suggestion.language) {
            suggestion.language = this.enhancedContext.language;
        }
        
        // If original code is not provided but we have it from chat context, use that
        if (!suggestion.original_code && this.enhancedContext.originalCode) {
            suggestion.original_code = this.enhancedContext.originalCode;
        }
        
        Logger.info('Sending suggestion for evaluation', 'mcp');
        Logger.debug(`Suggestion data: ${JSON.stringify(suggestion)}`, 'mcp');
        
        // Add TDD metadata to request
        const metadata = {
            run_tdd: true,
            max_iterations: 5, // Default to 5 iterations
            source: suggestion.source || this.enhancedContext.sourceType || 'copilot_chat',
            task_description: suggestion.task_description // Duplicate task description in metadata for TDD
        };
        
        // Create message with enhanced metadata
        const message = {
            context: {
                conversation_id: this.clientId,
                message_id: crypto.randomUUID(),
                parent_id: null,
                metadata: metadata
            },
            message_type: 'suggestion',
            content: suggestion
        };
        
        // Send directly without using sendMessage to customize metadata
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                this.hideProgress();
                reject(new Error('Not connected to MCP server'));
                return;
            }
            
            const messageId = message.context.message_id;
            const timeoutMs = 60000; // 60 second timeout for TDD processing
            
            // Add callback for response
            const timeoutId = setTimeout(() => {
                if (this.messageCallbacks.has(messageId)) {
                    Logger.warn(`Timeout waiting for evaluation response`, 'mcp');
                    this.messageCallbacks.delete(messageId);
                    this.hideProgress();
                    reject(new Error('Timeout waiting for evaluation response'));
                }
            }, timeoutMs);
            
            this.messageCallbacks.set(messageId, (response) => {
                clearTimeout(timeoutId);
                this.hideProgress();
                
                if (response.message_type === 'error') {
                    const errorMsg = response.error || 'Unknown error';
                    Logger.error(`MCP Error response: ${errorMsg}`, null, 'mcp');
                    reject(new Error(errorMsg));
                } else {
                    Logger.debug(`Received evaluation response`, 'mcp');
                    resolve(response);
                }
            });
            
            // Send message
            const messageStr = JSON.stringify(message);
            this.socket.send(messageStr);
            Logger.debug(`Sent suggestion message: ${messageId}`, 'mcp');
        });
    } catch (error) {
        this.hideProgress();
        Logger.error(`Error sending suggestion: ${error.message}`, error, 'mcp');
        throw error;
    }
};

/**
 * Show progress notification in VS Code
 * @param {string} message The message to show
 */
MCPClient.prototype.showProgress = function(message) {
    // Hide any existing progress first
    this.hideProgress();
    
    // Create a new progress notification
    this.progressNotification = vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
    
    // Also show as notification if it's a longer operation
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false
    }, async (progress) => {
        // Initial progress
        progress.report({ increment: 0 });
        
        // Update progress at intervals to show activity
        let percent = 10;
        const interval = setInterval(() => {
            percent += 10;
            if (percent > 90) {
                percent = 90; // Max at 90% until complete
            }
            progress.report({ increment: 10, message: `Processing ${percent}%...` });
        }, 2000);
        
        // Return a promise that resolves when the operation completes
        return new Promise(resolve => {
            // Store the cleanup function to be called by hideProgress
            this._progressCleanup = () => {
                clearInterval(interval);
                resolve();
            };
        });
    });
};

/**
 * Hide any active progress notification
 */
MCPClient.prototype.hideProgress = function() {
    if (this.progressNotification) {
        this.progressNotification.dispose();
        this.progressNotification = null;
    }
    
    // Clean up any withProgress notification
    if (this._progressCleanup) {
        this._progressCleanup();
        this._progressCleanup = null;
    }
};

/**
 * Make evaluateSuggestion available as a prototype method for compatibility
 * This resolves the "mcpClient.evaluateSuggestion is not a function" error
 */
MCPClient.prototype.evaluateSuggestion = async function(originalCode, proposedChanges, taskDescription, filePath = null, language = null) {
    Logger.debug('Using evaluateSuggestion prototype method', 'mcp');
    
    // Create a suggestion object from the parameters
    const suggestion = {
        original_code: originalCode,
        proposed_changes: proposedChanges,
        task_description: taskDescription,
        file_path: filePath,
        language: language
    };
    
    // Use our sendSuggestion method to handle the evaluation
    return this.sendSuggestion(suggestion);
};

// Export the MCPClient class
module.exports = MCPClient;
