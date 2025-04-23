/**
 * Optimized MCP Client for AI Development Monitor extension
 * 
 * This module provides an optimized communication layer between the VS Code extension
 * and the backend MCP server, focusing on performance and reliability.
 */
const vscode = require('vscode');
const WebSocket = require('ws');
const zlib = require('zlib');
const Logger = require('./logger');
const crypto = require('crypto');

// Constants for optimization
const COMPRESSION_THRESHOLD = 1024; // Only compress messages larger than 1KB
const BATCH_DELAY = 50; // Milliseconds to wait before sending batched messages
const BATCH_MAX_SIZE = 5; // Maximum number of messages to batch together
const CONNECTION_TIMEOUT = 10000; // 10 seconds connection timeout
const PRIORITY_LEVELS = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2
};

class OptimizedMCPClient {
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
        this.lastReceivedTime = Date.now();
        
        // Enhanced context from Copilot Chat
        this.enhancedContext = {
            taskDescription: "",
            originalCode: "",
            language: "",
            sourceType: ""
        };
        
        // Message batching
        this.messageBatchQueue = [];
        this.batchTimer = null;
        
        // Connection health metrics
        this.latencyHistory = [];
        this.maxLatencyHistory = 20; // Keep last 20 latency measurements
        this.connectionQuality = 'unknown';
        
        // Message stats for optimization
        this.messageStats = {
            sent: 0,
            received: 0,
            compressed: 0,
            batched: 0,
            errors: 0,
            totalBytesSent: 0,
            totalBytesReceived: 0,
            compressedBytesSent: 0,
            savedBytes: 0
        };
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
                if (!wsUrl.endsWith('/ws')) {
                    if (!wsUrl.endsWith('/')) {
                        wsUrl += '/';
                    }
                    wsUrl += 'ws';
                }
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
                }, CONNECTION_TIMEOUT);
                
                // Connection options with better defaults
                const socketOptions = {
                    handshakeTimeout: 5000,
                    maxPayload: 5 * 1024 * 1024, // 5MB max payload
                    perMessageDeflate: true // Enable per-message compression
                };
                
                this.socket = new WebSocket(wsUrl, socketOptions);
                
                this.socket.on('open', () => {
                    clearTimeout(connectionTimeout);
                    Logger.info('Connected to MCP server', 'mcp');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 2000; // Reset delay
                    this.lastReceivedTime = Date.now();
                    this.startHeartbeat();
                    
                    // Measure initial connection quality
                    this.measureConnectionQuality();
                    
                    resolve(true);
                });
                
                this.socket.on('message', (data) => {
                    this.handleIncomingData(data);
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
                    
                    // Flush any pending messages to prevent data loss
                    this.flushMessageQueue();
                    
                    this.attemptReconnect();
                });
                
                // Set up ping/pong for connection health check
                this.socket.on('pong', () => {
                    const now = Date.now();
                    const latency = now - this.lastPongTime;
                    this.lastPongTime = now;
                    
                    // Record latency for connection quality measurements
                    this.recordLatency(latency);
                    
                    Logger.debug(`Received pong from server (latency: ${latency}ms)`, 'mcp');
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
     * Record latency measurement for connection quality
     */
    recordLatency(latency) {
        this.latencyHistory.push(latency);
        
        // Keep only the last N measurements
        if (this.latencyHistory.length > this.maxLatencyHistory) {
            this.latencyHistory.shift();
        }
        
        // Update connection quality
        this.updateConnectionQuality();
    }
    
    /**
     * Update connection quality based on latency history
     */
    updateConnectionQuality() {
        if (this.latencyHistory.length < 3) {
            this.connectionQuality = 'unknown';
            return;
        }
        
        const avgLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
        
        if (avgLatency < 100) {
            this.connectionQuality = 'excellent';
        } else if (avgLatency < 200) {
            this.connectionQuality = 'good';
        } else if (avgLatency < 500) {
            this.connectionQuality = 'fair';
        } else {
            this.connectionQuality = 'poor';
        }
    }
    
    /**
     * Measure connection quality actively
     */
    async measureConnectionQuality() {
        if (!this.connected) {
            return;
        }
        
        try {
            const start = Date.now();
            
            // Use WebSocket ping/pong for latency measurement instead of a custom message type
            // This avoids server compatibility issues with unsupported message types
            this.socket.ping();
            
            // We won't get an immediate response, but the pong handler will record the latency
            // For now, use the most recent latency value
            const latency = this.latencyHistory.length > 0 ? 
                this.latencyHistory[this.latencyHistory.length - 1] : null;
            
            if (latency) {
                Logger.debug(`Connection quality measurement: ${latency}ms (${this.connectionQuality})`, 'mcp');
            }
            
            return latency;
        } catch (error) {
            Logger.error('Error measuring connection quality', error, 'mcp');
            return null;
        }
    }
    
    /**
     * Handle incoming WebSocket data
     */
    handleIncomingData(data) {
        this.lastReceivedTime = Date.now();
        
        try {
            // Check if data is compressed (starts with gzip magic bytes)
            let messageData = data;
            if (data instanceof Buffer && data.length >= 2 && data[0] === 0x1F && data[1] === 0x8B) {
                // Decompress gzipped data
                messageData = zlib.gunzipSync(data).toString('utf8');
                Logger.debug('Decompressed incoming message', 'mcp');
            } else if (data instanceof Buffer) {
                // Convert buffer to string
                messageData = data.toString('utf8');
            }
            
            // Update statistics
            this.messageStats.received++;
            this.messageStats.totalBytesReceived += data.length || messageData.length;
            
            // Handle message data
            const messages = this.parseMessageData(messageData);
            
            for (const message of messages) {
                Logger.debug(`Received MCP message: ${message.message_type}`, 'mcp');
                this.handleMessage(message);
            }
        } catch (error) {
            this.messageStats.errors++;
            Logger.error('Error processing incoming message', error, 'mcp');
        }
    }
    
    /**
     * Parse message data, handling both single messages and batched messages
     */
    parseMessageData(data) {
        try {
            const parsed = JSON.parse(data);
            
            // Check if this is a batch of messages
            if (Array.isArray(parsed)) {
                Logger.debug(`Received batch of ${parsed.length} messages`, 'mcp');
                return parsed;
            }
            
            // Single message
            return [parsed];
        } catch (error) {
            Logger.error('Error parsing message data', error, 'mcp');
            return [];
        }
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
        
        // Use smarter backoff - shorter for first few attempts
        let delay;
        if (this.reconnectAttempts <= 2) {
            delay = this.reconnectDelay;
        } else {
            delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 2);
        }
        
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
                // Check if we've received any message recently
                const now = Date.now();
                if (now - this.lastReceivedTime > 30000) { // 30 seconds timeout
                    Logger.warn('No messages received in 30 seconds, connection may be dead', 'mcp');
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
     * Send an MCP message with optimizations
     */
    async sendMessage(messageType, content, parentId = null, priority = PRIORITY_LEVELS.MEDIUM) {
        if (!this.connected) {
            Logger.info('Not connected to MCP server, attempting to connect', 'mcp');
            try {
                await this.connect();
            } catch (error) {
                Logger.error('Failed to connect to MCP server', error, 'mcp');
                throw new Error(`Failed to connect to MCP server: ${error.message}`);
            }
        }
        
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
        
        // Set dynamic timeout based on message type and connection quality
        const baseTimeoutMs = this.getTimeoutForMessageType(messageType);
        
        // For high priority messages, send immediately
        if (priority === PRIORITY_LEVELS.HIGH) {
            return this.sendSingleMessage(message, baseTimeoutMs);
        }
        
        // For other messages, consider batching
        return this.queueMessageForBatch(message, baseTimeoutMs, priority);
    }
    
    /**
     * Get appropriate timeout for different message types
     */
    getTimeoutForMessageType(messageType) {
        // Adjust timeouts based on connection quality
        const qualityMultiplier = {
            'excellent': 1,
            'good': 1.2,
            'fair': 1.5,
            'poor': 2,
            'unknown': 1.5
        }[this.connectionQuality] || 1.5;
        
        // Base timeouts by message type
        switch (messageType) {
            case 'ping':
                return 5000;
            case 'suggestion':
                return 120000; // 2 minutes for suggestions
            case 'evaluation':
                return 120000; // 2 minutes for evaluations
            case 'tdd_request':
                return 180000; // 3 minutes for TDD requests
            case 'continue':
                return 60000; // 1 minute for continuations
            default:
                return 60000; // 1 minute default timeout
        }
    }
    
    /**
     * Queue a message for batched sending
     */
    queueMessageForBatch(message, timeoutMs, priority) {
        return new Promise((resolve, reject) => {
            // Create the callback for the response
            const timeoutId = setTimeout(() => {
                if (this.messageCallbacks.has(message.context.message_id)) {
                    Logger.warn(`Timeout waiting for response to message ${message.context.message_id}`, 'mcp');
                    this.messageCallbacks.delete(message.context.message_id);
                    reject(new Error(`Timeout waiting for response to ${message.message_type} message`));
                }
            }, timeoutMs);
            
            this.messageCallbacks.set(message.context.message_id, (response) => {
                clearTimeout(timeoutId);
                if (response.message_type === 'error') {
                    const errorMsg = response.error || 'Unknown error';
                    Logger.error(`MCP Error response: ${errorMsg}`, null, 'mcp');
                    reject(new Error(errorMsg));
                } else {
                    Logger.debug(`Received response for message ${message.context.message_id}`, 'mcp');
                    resolve(response);
                }
            });
            
            // Add to batch queue with priority
            this.messageBatchQueue.push({
                message,
                priority
            });
            
            // If this is the first message in the queue, start the batch timer
            if (this.messageBatchQueue.length === 1) {
                this.scheduleBatch();
            } else if (this.messageBatchQueue.length >= BATCH_MAX_SIZE) {
                // If we have enough messages, send the batch immediately
                this.sendBatch();
            }
        });
    }
    
    /**
     * Schedule a batch to be sent after a short delay
     */
    scheduleBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        
        this.batchTimer = setTimeout(() => {
            this.sendBatch();
        }, BATCH_DELAY);
    }
    
    /**
     * Send a batch of messages
     */
    sendBatch() {
        if (this.messageBatchQueue.length === 0) {
            return;
        }
        
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        // Sort by priority
        this.messageBatchQueue.sort((a, b) => a.priority - b.priority);
        
        // Extract just the messages
        const messages = this.messageBatchQueue.map(item => item.message);
        this.messageBatchQueue = [];
        
        // If only one message, send it directly
        if (messages.length === 1) {
            this.sendRawMessage(messages[0]);
            return;
        }
        
        Logger.debug(`Sending batch of ${messages.length} messages`, 'mcp');
        
        this.messageStats.batched += messages.length;
        
        // Send the batch as an array
        this.sendRawMessage(messages);
    }
    
    /**
     * Flush any pending message queue immediately
     */
    flushMessageQueue() {
        if (this.messageBatchQueue.length > 0) {
            Logger.info(`Flushing message queue with ${this.messageBatchQueue.length} pending messages`, 'mcp');
            this.sendBatch();
        }
    }
    
    /**
     * Send a single message and wait for the response
     */
    sendSingleMessage(message, timeoutMs) {
        return new Promise((resolve, reject) => {
            // Create callback for the response
            const timeoutId = setTimeout(() => {
                if (this.messageCallbacks.has(message.context.message_id)) {
                    Logger.warn(`Timeout waiting for response to message ${message.context.message_id}`, 'mcp');
                    this.messageCallbacks.delete(message.context.message_id);
                    reject(new Error(`Timeout waiting for response to ${message.message_type} message`));
                }
            }, timeoutMs);
            
            this.messageCallbacks.set(message.context.message_id, (response) => {
                clearTimeout(timeoutId);
                if (response.message_type === 'error') {
                    const errorMsg = response.error || 'Unknown error';
                    Logger.error(`MCP Error response: ${errorMsg}`, null, 'mcp');
                    reject(new Error(errorMsg));
                } else {
                    Logger.debug(`Received response for message ${message.context.message_id}`, 'mcp');
                    resolve(response);
                }
            });
            
            // Send the message directly
            this.sendRawMessage(message);
        });
    }
    
    /**
     * Send a raw message (or batch of messages) to the server
     */
    sendRawMessage(message) {
        if (!this.connected || !this.socket) {
            Logger.error('Cannot send message, not connected', null, 'mcp');
            throw new Error('Not connected to MCP server');
        }
        
        try {
            // Convert to JSON
            const jsonData = JSON.stringify(message);
            
            // Disable compression - backend doesn't support compressed messages
            // Always send as plain text
            this.socket.send(jsonData);
            
            // Update statistics
            this.messageStats.sent++;
            this.messageStats.totalBytesSent += jsonData.length;
            
            if (Array.isArray(message)) {
                Logger.debug(`Sent batch of ${message.length} messages (${jsonData.length} bytes)`, 'mcp');
            } else {
                Logger.debug(`Sent message: ${message.message_type} (${jsonData.length} bytes)`, 'mcp');
            }
        } catch (error) {
            this.messageStats.errors++;
            Logger.error('Error sending raw message', error, 'mcp');
            throw error;
        }
    }
    
    /**
     * Send a compressed message using gzip
     */
    sendCompressedMessage(jsonData) {
        try {
            // Compress with gzip
            const compressed = zlib.gzipSync(jsonData);
            
            // Send compressed data
            this.socket.send(compressed);
            
            // Update statistics
            this.messageStats.sent++;
            this.messageStats.compressed++;
            this.messageStats.totalBytesSent += compressed.length;
            this.messageStats.compressedBytesSent += compressed.length;
            this.messageStats.savedBytes += (jsonData.length - compressed.length);
            
            Logger.debug(`Sent compressed message (${jsonData.length} → ${compressed.length} bytes, saved ${jsonData.length - compressed.length} bytes)`, 'mcp');
        } catch (error) {
            this.messageStats.errors++;
            Logger.error('Error sending compressed message', error, 'mcp');
            
            // Fall back to uncompressed
            Logger.info('Falling back to uncompressed message', 'mcp');
            this.socket.send(jsonData);
            
            this.messageStats.sent++;
            this.messageStats.totalBytesSent += jsonData.length;
        }
    }
    
    /**
     * Get communication statistics
     */
    getStatistics() {
        const compressionRatio = this.messageStats.compressedBytesSent > 0 
            ? (this.messageStats.savedBytes / (this.messageStats.compressedBytesSent + this.messageStats.savedBytes) * 100).toFixed(1)
            : 0;
        
        return {
            ...this.messageStats,
            connectionQuality: this.connectionQuality,
            averageLatency: this.getAverageLatency(),
            compressionRatio: `${compressionRatio}%`
        };
    }
    
    /**
     * Get average connection latency
     */
    getAverageLatency() {
        if (this.latencyHistory.length === 0) {
            return null;
        }
        
        return this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
    }
    
    /**
     * Create an enhanced suggestion evaluation request
     */
    async createSuggestionEvaluation(suggestion, context = {}) {
        // Add enhanced context to request metadata
        const metadata = {
            ...context,
            task_description: this.enhancedContext.taskDescription || context.task_description,
            source_type: this.enhancedContext.sourceType || 'suggestion'
        };
        
        // Create suggestion with all necessary context
        const suggestionData = {
            original_code: suggestion.original_code || this.enhancedContext.originalCode || "",
            proposed_changes: suggestion.proposed_changes || suggestion.proposed_code || "",
            language: suggestion.language || this.enhancedContext.language || "",
            file_path: suggestion.file_path || context.file_path,
            task_description: this.enhancedContext.taskDescription || context.task_description || ""
        };
        
        // Track what type of context we used
        if (this.enhancedContext.taskDescription) {
            Logger.debug(`Using enhanced task description from ${this.enhancedContext.sourceType}`, 'mcp');
        }
        
        // Send evaluation request
        Logger.info('Sending suggestion evaluation request', 'mcp');
        
        // Higher priority than regular messages
        const response = await this.sendMessage('suggestion', suggestionData, null, PRIORITY_LEVELS.MEDIUM);
        return response;
    }
    
    /**
     * Clean up resources and close connections
     */
    dispose() {
        this.stopHeartbeat();
        
        // Flush any pending messages
        this.flushMessageQueue();
        
        // Close WebSocket connection
        if (this.socket) {
            try {
                this.socket.close();
            } catch (error) {
                // Ignore errors during disposal
            }
            this.socket = null;
        }
        
        // Clear any pending callbacks
        this.messageCallbacks.clear();
        
        Logger.info('MCP client disposed', 'mcp');
    }
}

/**
 * Submit a code suggestion for evaluation
 * This method provides compatibility with existing code that expects the evaluateSuggestion method
 */
OptimizedMCPClient.prototype.evaluateSuggestion = async function(originalCode, proposedChanges, taskDescription, filePath = null, language = null) {
    Logger.debug('Using evaluateSuggestion method on OptimizedMCPClient', 'mcp');
    
    // Create a suggestion object from the parameters
    const suggestion = {
        original_code: originalCode,
        proposed_changes: proposedChanges,
        task_description: taskDescription,
        file_path: filePath,
        language: language
    };
    
    // Use createSuggestionEvaluation to handle the request with all optimizations
    return this.createSuggestionEvaluation(suggestion);
};

module.exports = OptimizedMCPClient;
