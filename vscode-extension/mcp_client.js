// MCP Client implementation for AI Development Monitor extension
const vscode = require('vscode');
const WebSocket = require('ws');
const Logger = require('./logger');

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
                const wsUrl = `${this.mcpUrl}/${this.clientId}`;
                Logger.info(`Connecting to MCP server at ${wsUrl}`, 'mcp');
                
                this.socket = new WebSocket(wsUrl);
                
                this.socket.on('open', () => {
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
                    Logger.error('WebSocket error', error, 'mcp');
                    this.connected = false;
                    this.stopHeartbeat();
                    
                    // Only reject if this is the first connection attempt
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                    
                    this.attemptReconnect();
                });
                
                this.socket.on('close', () => {
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
}

module.exports = MCPClient;
