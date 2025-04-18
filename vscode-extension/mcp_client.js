// MCP Client implementation for AI Development Monitor extension
const vscode = require('vscode');
const WebSocket = require('ws');
const crypto = require('crypto');

class MCPClient {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.clientId = crypto.randomUUID();
        this.messageCallbacks = new Map(); // Map of message_id -> callback
        this.connectionPromise = null;
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.mcpUrl = this.config.get('mcpUrl', 'ws://localhost:5001/ws');
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
                console.log(`Connecting to MCP server at ${wsUrl}`);
                
                this.socket = new WebSocket(wsUrl);
                
                this.socket.on('open', () => {
                    console.log('Connected to MCP server');
                    this.connected = true;
                    resolve(true);
                });
                
                this.socket.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                });
                
                this.socket.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    this.connected = false;
                    reject(error);
                });
                
                this.socket.on('close', () => {
                    console.log('Disconnected from MCP server');
                    this.connected = false;
                    this.connectionPromise = null;
                });
            } catch (error) {
                console.error('Error connecting to MCP server:', error);
                this.connected = false;
                this.connectionPromise = null;
                reject(error);
            }
        });
        
        return this.connectionPromise;
    }

    /**
     * Handle incoming MCP messages
     */
    handleMessage(message) {
        console.log('Received MCP message:', message.message_type);
        
        // Extract context
        const context = message.context;
        if (!context || !context.message_id) {
            console.error('Invalid message context');
            return;
        }
        
        // Check if we have a callback for this message
        if (this.messageCallbacks.has(context.message_id)) {
            const callback = this.messageCallbacks.get(context.message_id);
            this.messageCallbacks.delete(context.message_id);
            callback(message);
        } else if (context.parent_id && this.messageCallbacks.has(context.parent_id)) {
            // This is a response to a parent message
            const callback = this.messageCallbacks.get(context.parent_id);
            this.messageCallbacks.delete(context.parent_id);
            callback(message);
        } else {
            // No callback found, handle based on message type
            if (message.message_type === 'error') {
                vscode.window.showErrorMessage(`MCP Error: ${message.error || 'Unknown error'}`);
            }
        }
    }

    /**
     * Send an MCP message
     */
    async sendMessage(messageType, content, parentId = null) {
        if (!this.connected) {
            try {
                await this.connect();
            } catch (error) {
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
                this.messageCallbacks.set(messageId, (response) => {
                    if (response.message_type === 'error') {
                        reject(new Error(response.error || 'Unknown error'));
                    } else {
                        resolve(response);
                    }
                });
                
                // Send message
                this.socket.send(JSON.stringify(message));
                console.log(`Sent MCP message: ${messageType}`);
            } catch (error) {
                console.error('Error sending MCP message:', error);
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
