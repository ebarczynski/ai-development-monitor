// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

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
        this.maxReconnectAttempts = 5; // After this, we'll use persistentReconnect
        this.reconnectDelay = 2000; // Start with 2 seconds
        this.persistentReconnectInterval = null; // For long-term reconnection attempts
        this.connectionMonitorInterval = null; // To monitor connection status
        this.isReconnecting = false; // Flag to track reconnection in progress
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.mcpUrl = this.config.get('mcpUrl', 'ws://localhost:5001/ws');
        
        // Message queue for handling reconnection
        this.messageQueue = [];
        this.maxQueueLength = 50;  // Maximum messages to queue
        this.processingQueue = false; // Flag to avoid concurrent queue processing
        
        // Connection state for the UI
        this.connectionState = "disconnected"; // "connected", "disconnected", "connecting", "reconnecting", "recovery"
        
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
        
        // Set up network change detection if available
        this.setupNetworkChangeHandlers();
    }

    /**
     * Get configuration settings with defaults
     * @returns {Object} Configuration settings
     */
    getConnectionConfig() {
        // Get the configuration
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        
        return {
            // Connection settings
            mcpUrl: config.get('mcpUrl', 'ws://localhost:5001/ws'),
            connectionTimeoutMs: config.get('connectionTimeoutMs', 10000),
            
            // Reconnection settings
            maxReconnectAttempts: config.get('maxReconnectAttempts', 5),
            reconnectDelayMs: config.get('reconnectDelayMs', 2000),
            exponentialBackoffFactor: config.get('exponentialBackoffFactor', 1.5),
            persistentReconnectIntervalMs: config.get('persistentReconnectIntervalMs', 30000),
            
            // Heartbeat settings
            heartbeatIntervalMs: config.get('heartbeatIntervalMs', 15000),
            heartbeatTimeoutMs: config.get('heartbeatTimeoutMs', 30000),
            
            // Monitoring settings
            connectionMonitorIntervalMs: config.get('connectionMonitorIntervalMs', 30000),
            
            // Message queue settings
            maxQueueLength: config.get('maxQueueLength', 50),
            keepQueuedMessagesOnDisconnect: config.get('keepQueuedMessagesOnDisconnect', true),
            messageTimeoutMs: config.get('messageTimeoutMs', 30000)
        };
    }

    /**
     * Connect to the MCP server
     */
    connect() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // Clear any existing persistent reconnect timers
        if (this.persistentReconnectInterval) {
            clearInterval(this.persistentReconnectInterval);
            this.persistentReconnectInterval = null;
        }
        
        // Update connection state based on whether this is a reconnection
        if (this.isReconnecting) {
            this.updateConnectionState('reconnecting');
        } else {
            this.updateConnectionState('connecting');
        }

        this.connectionPromise = new Promise((resolve, reject) => {
            try {
                // Refresh configuration in case it changed
                const connectionConfig = this.getConnectionConfig();
                this.mcpUrl = connectionConfig.mcpUrl;
                
                // Update instance properties from configuration
                this.maxReconnectAttempts = connectionConfig.maxReconnectAttempts;
                this.reconnectDelay = connectionConfig.reconnectDelayMs;
                this.maxQueueLength = connectionConfig.maxQueueLength;
                
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
                
                // Clean up any existing socket
                if (this.socket) {
                    try {
                        this.socket.terminate();
                    } catch (error) {
                        // Ignore terminate errors
                        Logger.debug('Error terminating existing socket during reconnection', 'mcp');
                    }
                    this.socket = null;
                }
                
                // Set a connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.socket && !this.connected) {
                        Logger.error('Connection attempt timed out', null, 'mcp');
                        try {
                            this.socket.terminate();
                        } catch (error) {
                            // Ignore terminate errors
                        }
                        this.socket = null;
                        this.connectionPromise = null;
                        reject(new Error('Connection timeout'));
                    }
                }, connectionConfig.connectionTimeoutMs);
                
                // Create socket with proper error handling
                try {
                    this.socket = new WebSocket(wsUrl);
                } catch (error) {
                    clearTimeout(connectionTimeout);
                    Logger.error(`Failed to create WebSocket: ${error.message}`, error, 'mcp');
                    this.socket = null;
                    this.connectionPromise = null;
                    reject(new Error(`Failed to create WebSocket: ${error.message}`));
                    return;
                }
                
                // Handle socket opening - connection established
                this.socket.on('open', () => {
                    clearTimeout(connectionTimeout);
                    Logger.info('Connected to MCP server', 'mcp');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 2000; // Reset delay
                    this.isReconnecting = false;
                    
                    // Update connection state
                    this.updateConnectionState('connected');
                    
                    // Clear persistent reconnect if it was active
                    if (this.persistentReconnectInterval) {
                        clearInterval(this.persistentReconnectInterval);
                        this.persistentReconnectInterval = null;
                    }
                    
                    // Start heartbeat
                    this.startHeartbeat();
                    
                    // Start connection monitor
                    this.startConnectionMonitor();
                    
                    // Resolve the connection promise
                    resolve(true);
                    
                    // Process any queued messages
                    if (this.messageQueue.length > 0) {
                        Logger.info(`Processing ${this.messageQueue.length} queued messages`, 'mcp');
                        setTimeout(() => this.processMessageQueue(), 500); // Slight delay to ensure connection is stable
                    }
                });
                
                // Handle incoming messages
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
                
                // Handle socket errors
                this.socket.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    Logger.error(`WebSocket error: ${error.message}`, error, 'mcp');
                    this.connected = false;
                    this.stopHeartbeat();
                    
                    // Update connection state
                    this.updateConnectionState('disconnected');
                    
                    // Only reject if this is the first connection attempt
                    if (this.reconnectAttempts === 0) {
                        this.connectionPromise = null;
                        reject(error);
                    }
                    
                    // Don't trigger reconnect here - let the close handler do it
                    // to avoid double reconnection attempts
                });
                
                // Handle socket closing
                this.socket.on('close', (code, reason) => {
                    clearTimeout(connectionTimeout);
                    
                    // Only log and attempt reconnect if we were previously connected
                    // or this is the first connection attempt
                    if (this.connected || this.reconnectAttempts === 0) {
                        Logger.info(`Disconnected from MCP server (code: ${code}, reason: ${reason || 'none'})`, 'mcp');
                    }
                    
                    this.connected = false;
                    this.connectionPromise = null;
                    this.stopHeartbeat();
                    
                    // Update connection state
                    this.updateConnectionState('disconnected');
                    
                    // Only try to reconnect if this wasn't an intentional close (code 1000)
                    if (code !== 1000) {
                        // Use a small delay to avoid immediate reconnection 
                        // which can cause rapid reconnection loops
                        setTimeout(() => this.attemptReconnect(), 100);
                    } else {
                        Logger.info('Clean disconnection (code 1000), not attempting to reconnect', 'mcp');
                    }
                });
                
                // Handle pong messages for heartbeat
                this.socket.on('pong', () => {
                    this.lastPongTime = Date.now();
                    Logger.debug('Received pong from server', 'mcp');
                });
                
            } catch (error) {
                Logger.error('Error establishing connection to MCP server', error, 'mcp');
                this.connected = false;
                this.connectionPromise = null;
                reject(error);
            }
        });
        
        return this.connectionPromise;
    }
    
    /**
     * Attempt to reconnect to the MCP server
     * @param {boolean} immediate If true, attempts reconnection immediately without delay
     */
    attemptReconnect(immediate = false) {
        // Guard against multiple reconnection attempts
        if (this.isReconnecting) {
            Logger.debug('Reconnection already in progress, skipping duplicate attempt', 'mcp');
            return;
        }
        
        // Skip if we're already connected
        if (this.connected && this.socket && this.socket.readyState === WebSocket.OPEN) {
            Logger.debug('Already connected, skipping reconnection attempt', 'mcp');
            return;
        }
        
        this.isReconnecting = true;
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.warn(`Maximum immediate reconnection attempts (${this.maxReconnectAttempts}) reached. Switching to persistent mode.`, 'mcp');
            vscode.window.showWarningMessage(`Failed to reconnect to MCP server after ${this.maxReconnectAttempts} attempts. Will continue retrying in the background.`);
            
            // Start persistent reconnect mechanism
            this.startPersistentReconnect();
            return;
        }
        
        this.reconnectAttempts++;
        
        // Calculate delay with exponential backoff, unless immediate reconnection is requested
        const delay = immediate ? 0 : this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
        
        if (delay > 0) {
            Logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
        } else {
            Logger.info(`Attempting immediate reconnection (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
        }
        
        // Track the current reconnection attempt to prevent race conditions
        const currentAttempt = this.reconnectAttempts;
        
        setTimeout(() => {
            // Check if someone else already successfully reconnected
            if (!this.isReconnecting) {
                Logger.debug('Reconnection no longer needed, another process succeeded', 'mcp');
                return;
            }
            
            // Check if we're already connected somehow (rare race condition)
            if (this.connected && this.socket && this.socket.readyState === WebSocket.OPEN) {
                Logger.debug('Connection already established before reconnect executed', 'mcp');
                this.isReconnecting = false;
                return;
            }
            
            Logger.info(`Reconnecting to MCP server (attempt ${currentAttempt}/${this.maxReconnectAttempts})`, 'mcp');
            
            // Reset connection promise to force a new connection attempt
            this.connectionPromise = null;
            
            this.connect()
                .then(() => {
                    this.isReconnecting = false;
                    Logger.info('Reconnection successful', 'mcp');
                    vscode.window.showInformationMessage('Successfully reconnected to MCP server');
                    
                    // Update VS Code UI
                    vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.connected', true);
                    
                    // Track connection stability
                    this.trackConnectionStability(true);
                })
                .catch(error => {
                    this.isReconnecting = false;
                    Logger.error(`Reconnection attempt ${currentAttempt} failed: ${error.message}`, 'mcp');
                    
                    // Track connection stability
                    this.trackConnectionStability(false);
                    
                    // Don't show error for regular reconnection failures to avoid spamming the user
                    // Let the persistent reconnect mechanism handle it silently
                });
        }, delay);
    }
    
    /**
     * Start persistent reconnection attempts at regular intervals
     */
    startPersistentReconnect() {
        if (this.persistentReconnectInterval) {
            clearInterval(this.persistentReconnectInterval);
        }
        
        Logger.info('Starting persistent reconnection mode', 'mcp');
        
        // Set up a persistent reconnect interval 
        // Start with a 30 second interval but can be configured
        const persistentReconnectIntervalMs = this.config.get('persistentReconnectIntervalMs', 30000);
        
        // Create a function to handle reconnection attempts that we can reuse
        const attemptPersistentReconnect = () => {
            // Only attempt reconnection if we're not connected and not already trying to reconnect
            if (this.connected || this.isReconnecting) {
                return;
            }
            
            Logger.info('Persistent reconnection attempt starting', 'mcp');
            
            // Reset counters for a fresh connection attempt series
            this.reconnectAttempts = 0;
            this.connectionPromise = null;
            this.isReconnecting = true;
            
            // Try to connect
            this.connect()
                .then(() => {
                    // We keep the interval running even after successful connection
                    // because it will check connection status and only attempt reconnection when needed
                    this.isReconnecting = false;
                    Logger.info('Persistent reconnection successful', 'mcp');
                    
                    // Only show notification for first successful reconnection
                    if (!this.suppressReconnectMessages) {
                        vscode.window.showInformationMessage('Successfully reconnected to MCP server');
                        // Suppress future messages to avoid spamming
                        this.suppressReconnectMessages = true;
                        
                        // Reset suppression after a while
                        setTimeout(() => {
                            this.suppressReconnectMessages = false;
                        }, 60000); // 1 minute
                    }
                    
                    // Update VS Code UI
                    vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.connected', true);
                    
                    // Track connection stability
                    this.trackConnectionStability(true);
                })
                .catch(error => {
                    this.isReconnecting = false;
                    Logger.debug(`Persistent reconnection failed: ${error.message}, will try again later`, 'mcp');
                    
                    // Track connection stability
                    this.trackConnectionStability(false);
                });
        };
        
        // Set up the interval for persistent reconnection
        this.persistentReconnectInterval = setInterval(attemptPersistentReconnect, persistentReconnectIntervalMs);
        
        // Also attempt a reconnection immediately
        setTimeout(attemptPersistentReconnect, 1000);
    }
    
    /**
     * Start monitoring the connection status
     */
    startConnectionMonitor() {
        if (this.connectionMonitorInterval) {
            clearInterval(this.connectionMonitorInterval);
            this.connectionMonitorInterval = null;
        }
        
        // Get monitoring interval from config or use default (30 seconds)
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        const monitorIntervalMs = config.get('connectionMonitorIntervalMs', 30000);
        
        Logger.info(`Starting connection monitor with ${monitorIntervalMs}ms interval`, 'mcp');
        
        // Set up a connection monitor to periodically check connection health
        this.connectionMonitorInterval = setInterval(() => {
            // Skip if we're in the middle of reconnecting
            if (this.isReconnecting) {
                return;
            }
            
            // If we think we're connected, verify it
            if (this.connected && this.socket) {
                // Check if socket is in a good state
                const isSocketOpen = this.socket.readyState === WebSocket.OPEN;
                
                if (!isSocketOpen) {
                    Logger.warn('Socket is marked as connected but is not open, forcing reconnect', 'mcp');
                    this.connected = false;
                    this.socket.terminate();
                    this.attemptReconnect(true); // Immediate reconnection
                    return;
                }
                
                // Check actual connection health with a ping
                this.checkConnectionStatus()
                    .then(isHealthy => {
                        if (!isHealthy) {
                            Logger.warn('Connection check failed, attempting to reconnect', 'mcp');
                            // Force close and reconnect
                            this.socket.terminate(); 
                            // Socket close handler will trigger reconnection
                        }
                    })
                    .catch(error => {
                        Logger.error('Error checking connection status', error, 'mcp');
                    });
            } 
            // If we think we're disconnected but have a socket, clean it up
            else if (!this.connected && this.socket) {
                Logger.debug('Cleaning up inconsistent socket state', 'mcp');
                try {
                    this.socket.terminate();
                } catch (e) {
                    // Ignore termination errors
                }
                this.socket = null;
            }
        }, monitorIntervalMs); // Check based on configured interval
    }
    
    /**
     * Check if the connection is healthy by sending a ping
     * @returns {Promise<boolean>} True if the connection is healthy
     */
    checkConnectionStatus() {
        return new Promise((resolve) => {
            // First, verify basic connection state
            if (!this.socket) {
                Logger.debug('Connection check failed: no socket exists', 'mcp');
                resolve(false);
                return;
            }
            
            // Verify socket readyState
            if (this.socket.readyState !== WebSocket.OPEN) {
                Logger.debug(`Connection check failed: socket in wrong state (${this.socket.readyState})`, 'mcp');
                // Update our connected state to match reality
                this.connected = false;
                resolve(false);
                return;
            }
            
            // If we haven't received a pong in a long time, consider connection dead
            const currentTime = Date.now();
            if (currentTime - this.lastPongTime > 60000) { // 1 minute timeout
                Logger.warn('Connection check failed: no pong received in the last minute', 'mcp');
                resolve(false);
                return;
            }
            
            // Set up a timeout for ping-pong
            const pongTimeout = setTimeout(() => {
                Logger.warn('Connection check timed out without pong response', 'mcp');
                // Remove the handler to avoid memory leaks
                try {
                    this.socket.off('pong', pongHandler);
                } catch (e) {
                    // Ignore errors
                }
                resolve(false);
            }, 5000); // 5 second timeout
            
            // Set up a one-time pong handler for this check
            const pongHandler = () => {
                clearTimeout(pongTimeout);
                Logger.debug('Connection check successful: received pong', 'mcp');
                resolve(true);
            };
            
            // Use once to ensure the handler is removed after it's called
            this.socket.once('pong', pongHandler);
            
            try {
                // Send ping with a random payload for better debugging
                const pingId = Math.floor(Math.random() * 1000);
                this.socket.ping(Buffer.from(`check_${pingId}`));
                Logger.debug(`Connection check ping sent (id: ${pingId})`, 'mcp');
            } catch (error) {
                clearTimeout(pongTimeout);
                // Remove the handler to avoid memory leaks
                try {
                    this.socket.off('pong', pongHandler);
                } catch (e) {
                    // Ignore errors
                }
                Logger.error(`Error sending ping for connection check: ${error.message}`, error, 'mcp');
                resolve(false);
            }
        });
    }
    
    /**
     * Public method to force a reconnection
     * @param {boolean} suppressUI Whether to suppress UI notifications during reconnection
     * @returns {Promise<boolean>} True if reconnection was successful
     */
    async reconnect(suppressUI = false) {
        Logger.info('Manual reconnection requested', 'mcp');
        
        if (this.isReconnecting) {
            Logger.info('Reconnection already in progress', 'mcp');
            return false;
        }
        
        // Check if we're in recovery mode
        if (this.connectionState === 'recovery') {
            Logger.info('Exiting recovery mode for manual reconnection', 'mcp');
            this.exitConnectionRecoveryMode();
        }
        
        // Clean up existing connection
        this.disconnect();
        
        // Reset reconnection state
        this.reconnectAttempts = 0;
        this.connectionPromise = null;
        this.isReconnecting = true;
        
        try {
            // Show a progress notification during reconnection if UI is not suppressed
            if (suppressUI) {
                try {
                    await this.connect();
                    this.isReconnecting = false;
                    this.trackConnectionStability(true); // Track successful reconnection
                    return true;
                } catch (error) {
                    this.isReconnecting = false;
                    this.trackConnectionStability(false); // Track failed reconnection
                    throw error;
                }
            } else {
                // Show UI for reconnection progress
                return await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Reconnecting to MCP server",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: "Establishing connection..." });
                    
                    try {
                        await this.connect();
                        progress.report({ increment: 100, message: "Connected!" });
                        this.isReconnecting = false;
                        this.trackConnectionStability(true); // Track successful reconnection
                        return true;
                    } catch (error) {
                        progress.report({ increment: 100, message: "Failed" });
                        this.isReconnecting = false;
                        this.trackConnectionStability(false); // Track failed reconnection
                        throw error;
                    }
                });
            }
        } catch (error) {
            Logger.error('Manual reconnection failed', error, 'mcp');
            if (!suppressUI) {
                vscode.window.showErrorMessage(`Failed to reconnect to MCP server: ${error.message}`);
            }
            return false;
        }
    }
    
    /**
     * Disconnect from the MCP server cleanly
     * @param {boolean} suppressEvents If true, don't emit events or update UI
     * @returns {boolean} True if disconnect was successful
     */
    disconnect(suppressEvents = false) {
        Logger.info('Disconnecting from MCP server', 'mcp');
        
        // Stop heartbeat and monitoring processes
        this.stopHeartbeat();
        
        if (this.connectionMonitorInterval) {
            clearInterval(this.connectionMonitorInterval);
            this.connectionMonitorInterval = null;
        }
        
        if (this.persistentReconnectInterval) {
            clearInterval(this.persistentReconnectInterval);
            this.persistentReconnectInterval = null;
        }
        
        // Clear any pending connection attempts
        this.isReconnecting = false;
        this.connectionPromise = null;
        
        // Handle any queued messages - either reject them or keep them depending on settings
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        const keepQueuedMessages = config.get('keepQueuedMessagesOnDisconnect', true);
        
        if (!keepQueuedMessages && this.messageQueue.length > 0) {
            Logger.info(`Rejecting ${this.messageQueue.length} queued messages due to disconnect`, 'mcp');
            
            // Reject all queued messages
            for (const message of this.messageQueue) {
                if (this.messageCallbacks.has(message.messageId)) {
                    const callback = this.messageCallbacks.get(message.messageId);
                    this.messageCallbacks.delete(message.messageId);
                    
                    callback({
                        message_type: 'error',
                        error: 'Connection was closed',
                        context: {
                            message_id: message.messageId
                        }
                    });
                }
            }
            
            // Clear the queue
            this.messageQueue = [];
        }
        
        // Close the WebSocket if it exists
        if (this.socket) {
            try {
                // Remove all event listeners to prevent reconnection attempts from events
                this.socket.removeAllListeners();
                
                // Try to close the socket cleanly
                this.socket.close(1000, 'Disconnecting');
                
                // Set a timeout to forcibly terminate if clean close takes too long
                setTimeout(() => {
                    if (this.socket) {
                        try {
                            this.socket.terminate();
                        } catch (e) {
                            // Ignore termination errors
                        }
                        this.socket = null;
                    }
                }, 1000);
            } catch (error) {
                // If clean close fails, force terminate
                Logger.warn(`Error during clean disconnect: ${error.message}`, 'mcp');
                try {
                    this.socket.terminate();
                } catch (e) {
                    // Ignore errors during termination
                }
                this.socket = null;
            }
        }
        
        // Update state
        this.connected = false;
        
        // Update connection state unless suppressed
        if (!suppressEvents) {
            this.updateConnectionState('disconnected');
        }
        
        return true;
    }

    /**
     * Start heartbeat to detect connection issues
     */
    startHeartbeat() {
        this.stopHeartbeat(); // Clear any existing interval
        
        // Get configuration
        const config = this.getConnectionConfig();
        
        this.lastPongTime = Date.now();
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.connected) {
                // Check if we've received a pong recently
                const now = Date.now();
                if (now - this.lastPongTime > config.heartbeatTimeoutMs) {
                    Logger.warn(`No pong received in ${config.heartbeatTimeoutMs}ms, connection may be dead`, 'mcp');
                    
                    // Update state before terminating
                    this.updateConnectionState('disconnected');
                    
                    // Force close and trigger reconnect
                    if (this.socket) {
                        this.socket.terminate();
                    }
                    return;
                }
                
                try {
                    // Add a sequence number to help with debugging
                    const pingId = Math.floor(Math.random() * 10000);
                    Logger.debug(`Sending ping to server (id: ${pingId})`, 'mcp');
                    this.socket.ping(Buffer.from(`heartbeat_${pingId}`));
                } catch (error) {
                    Logger.error(`Error sending ping: ${error.message}`, error, 'mcp');
                    // If we can't send a ping, the connection is likely dead
                    this.updateConnectionState('disconnected');
                    if (this.socket) {
                        this.socket.terminate();
                    }
                }
            }
        }, config.heartbeatIntervalMs);
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
     * @param {string} messageType The type of message to send
     * @param {object} content The message content
     * @param {string|null} parentId Optional parent message ID
     * @param {number} timeoutMs Timeout in milliseconds
     * @returns {Promise<object>} Response from the server
     */
    async sendMessage(messageType, content, parentId = null, timeoutMs = 30000) {
        // Check if we need to reconnect
        if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            Logger.info('Not connected to MCP server, attempting to connect', 'mcp');
            
            // If we're already trying to reconnect, wait for that to finish or queue the message
            if (this.isReconnecting) {
                Logger.info(`Reconnection in progress, queueing ${messageType} message`, 'mcp');
                return new Promise((resolve, reject) => {
                    this.queueMessage(messageType, content, parentId, (response) => {
                        if (response.message_type === 'error') {
                            reject(new Error(response.error || 'Unknown error'));
                        } else {
                            resolve(response);
                        }
                    }, timeoutMs);
                });
            }
            
            // Try to connect
            try {
                await this.connect();
            } catch (error) {
                Logger.error('Failed to connect to MCP server', error, 'mcp');
                
                // Queue the message for later and return a promise that will resolve when processed
                Logger.info(`Connection failed, queueing ${messageType} message`, 'mcp');
                return new Promise((resolve, reject) => {
                    this.queueMessage(messageType, content, parentId, (response) => {
                        if (response.message_type === 'error') {
                            reject(new Error(response.error || 'Unknown error'));
                        } else {
                            resolve(response);
                        }
                    }, timeoutMs);
                });
            }
        }
        
        // Now we're connected (or we think we are), try to send the message
        return new Promise((resolve, reject) => {
            try {
                // Double check connection before attempting to send
                if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    // Connection was lost while we were preparing to send
                    Logger.warn('Connection lost before sending message, queueing instead', 'mcp');
                    
                    // Queue the message and return
                    this.queueMessage(messageType, content, parentId, (response) => {
                        if (response.message_type === 'error') {
                            reject(new Error(response.error || 'Unknown error'));
                        } else {
                            resolve(response);
                        }
                    }, timeoutMs);
                    return;
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
                
                // Add callback for response
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
                
                // Try to send the message
                try {
                    Logger.debug(`Sending MCP message: ${messageType}`, 'mcp');
                    Logger.logObject('DEBUG', 'Outgoing Message', message, 'mcp');
                    this.socket.send(JSON.stringify(message));
                    Logger.info(`Sent MCP message: ${messageType}`, 'mcp');
                } catch (error) {
                    // Handle send failure - could be due to connection loss
                    Logger.error(`Error sending message: ${error.message}`, error, 'mcp');
                    
                    // Remove the callback to avoid memory leak
                    this.messageCallbacks.delete(messageId);
                    clearTimeout(timeoutId);
                    
                    // Queue the message for later
                    Logger.info(`Send failed, queueing ${messageType} message`, 'mcp');
                    this.queueMessage(messageType, content, parentId, (response) => {
                        if (response.message_type === 'error') {
                            reject(new Error(response.error || 'Unknown error'));
                        } else {
                            resolve(response);
                        }
                    }, timeoutMs);
                }
            } catch (error) {
                Logger.error(`Error in sendMessage: ${error.message}`, error, 'mcp');
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

    /**
     * Add a message to the queue for sending when connection is restored
     * @param {string} messageType Type of message to send
     * @param {object} content Content of the message
     * @param {string|null} parentId Parent message ID
     * @param {Function} callback Callback to call with response
     * @param {number} timeoutMs Timeout in milliseconds
     * @returns {string} The message ID
     */
    queueMessage(messageType, content, parentId = null, callback, timeoutMs = 30000) {
        // Create a unique message ID
        const messageId = crypto.randomUUID();
        
        // If queue is too long, remove oldest messages
        if (this.messageQueue.length >= this.maxQueueLength) {
            const removedMessage = this.messageQueue.shift();
            Logger.warn(`Message queue too long, dropping oldest message: ${removedMessage.messageType}`, 'mcp');
            
            // If we had a callback for the dropped message, call it with an error
            if (this.messageCallbacks.has(removedMessage.messageId)) {
                const callback = this.messageCallbacks.get(removedMessage.messageId);
                this.messageCallbacks.delete(removedMessage.messageId);
                
                // Create an error response
                const errorResponse = {
                    message_type: 'error',
                    error: 'Message was dropped due to queue overflow',
                    context: {
                        message_id: removedMessage.messageId
                    }
                };
                
                callback(errorResponse);
            }
        }
        
        // Add message to queue
        Logger.info(`Queuing ${messageType} message during disconnection`, 'mcp');
        this.messageQueue.push({
            messageType,
            content,
            parentId,
            messageId,
            timestamp: Date.now(),
            timeoutMs
        });
        
        // Add callback to callback map
        if (callback) {
            this.messageCallbacks.set(messageId, callback);
            
            // Set up timeout
            setTimeout(() => {
                if (this.messageCallbacks.has(messageId)) {
                    Logger.warn(`Timeout waiting for response to queued message ${messageId}`, 'mcp');
                    this.messageCallbacks.delete(messageId);
                    
                    // Call callback with error
                    callback({
                        message_type: 'error',
                        error: 'Timeout waiting for response to queued message',
                        context: {
                            message_id: messageId
                        }
                    });
                    
                    // Remove from queue if still there
                    this.messageQueue = this.messageQueue.filter(m => m.messageId !== messageId);
                }
            }, timeoutMs);
        }
        
        // If we're connected, start processing the queue
        if (this.connected && !this.processingQueue) {
            this.processMessageQueue();
        }
        
        return messageId;
    }
    
    /**
     * Process queued messages when connection is restored
     */
    async processMessageQueue() {
        // Guard against multiple queue processing attempts
        if (this.processingQueue) {
            Logger.debug('Already processing message queue, skipping duplicate attempt', 'mcp');
            return;
        }

        // Check if we're actually connected
        if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            Logger.warn('Cannot process message queue while disconnected', 'mcp');
            return;
        }

        // Check if there's anything to process
        if (this.messageQueue.length === 0) {
            Logger.debug('No queued messages to process', 'mcp');
            return;
        }

        this.processingQueue = true;
        Logger.info(`Processing ${this.messageQueue.length} queued messages`, 'mcp');

        // Create a copy of the queue before processing
        const messagesToProcess = [...this.messageQueue];
        this.messageQueue = [];

        // Track success/failure counts
        let successCount = 0;
        let failureCount = 0;

        // Process each message in order
        for (const message of messagesToProcess) {
            // Skip expired messages
            const messageAge = Date.now() - message.timestamp;
            if (messageAge > message.timeoutMs) {
                Logger.warn(`Skipping expired queued message (id: ${message.messageId}, type: ${message.messageType})`, 'mcp');
                failureCount++;

                // Call callback with timeout error if it exists
                if (this.messageCallbacks.has(message.messageId)) {
                    const callback = this.messageCallbacks.get(message.messageId);
                    this.messageCallbacks.delete(message.messageId);

                    callback({
                        message_type: 'error',
                        error: 'Message expired in queue',
                        context: {
                            message_id: message.messageId
                        }
                    });
                }
                continue;
            }

            try {
                Logger.debug(`Sending queued message: ${message.messageType} (id: ${message.messageId})`, 'mcp');
                
                // Create the message
                const mcpMessage = {
                    context: {
                        conversation_id: this.clientId,
                        message_id: message.messageId,
                        parent_id: message.parentId,
                        metadata: {
                            queued: true,
                            queue_time_ms: messageAge
                        }
                    },
                    message_type: message.messageType,
                    content: message.content
                };

                // Check if we're still connected before sending
                if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    Logger.warn('Lost connection while processing queue, re-queuing remaining messages', 'mcp');
                    
                    // Put the current message and all remaining messages back in the queue
                    this.messageQueue.unshift(message);
                    this.messageQueue.unshift(...messagesToProcess.slice(messagesToProcess.indexOf(message) + 1));
                    
                    // Exit loop
                    break;
                }

                // Send the message
                this.socket.send(JSON.stringify(mcpMessage));
                successCount++;
                
                // Small delay between messages to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                Logger.error(`Error sending queued message: ${error.message}`, error, 'mcp');
                failureCount++;

                // Call callback with error if it exists
                if (this.messageCallbacks.has(message.messageId)) {
                    const callback = this.messageCallbacks.get(message.messageId);
                    this.messageCallbacks.delete(message.messageId);

                    callback({
                        message_type: 'error',
                        error: `Failed to send queued message: ${error.message}`,
                        context: {
                            message_id: message.messageId
                        }
                    });
                }

                // If send failed due to connection issue, requeue remaining messages
                if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    Logger.warn('Connection failed during queue processing, re-queuing remaining messages', 'mcp');
                    
                    // Put all remaining messages back in the queue
                    this.messageQueue.unshift(...messagesToProcess.slice(messagesToProcess.indexOf(message) + 1));
                    
                    // Attempt reconnection
                    this.attemptReconnect();
                    
                    // Exit loop
                    break;
                }
            }
        }

        this.processingQueue = false;
        
        // Log results
        if (successCount > 0 || failureCount > 0) {
            Logger.info(`Queue processing complete: ${successCount} messages sent, ${failureCount} failed`, 'mcp');
        }

        // If there are new messages in the queue, process them after a short delay
        if (this.messageQueue.length > 0) {
            Logger.info(`${this.messageQueue.length} new messages added to the queue, processing soon`, 'mcp');
            setTimeout(() => this.processMessageQueue(), 1000);
        }
    }
    
    /**
     * Update the connection state and notify VS Code UI
     * @param {string} state The new connection state ("connected", "disconnected", "connecting", "reconnecting", "recovery")
     */
    updateConnectionState(state) {
        if (this.connectionState === state) {
            return; // No change
        }

        const previousState = this.connectionState;
        this.connectionState = state;
        Logger.info(`Connection state changed from ${previousState} to ${state}`, 'mcp');

        // Update VS Code context for UI
        vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.connected', state === 'connected');
        vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.connecting', 
            state === 'connecting' || state === 'reconnecting');
        vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.recovery', state === 'recovery');
        vscode.commands.executeCommand('setContext', 'aiDevelopmentMonitor.disconnected', state === 'disconnected');
        
        // Update VS Code status bar with appropriate icon and message
        switch (state) {
            case 'connected':
                vscode.window.setStatusBarMessage('$(check) Connected to MCP server', 3000);
                break;
            case 'disconnected':
                vscode.window.setStatusBarMessage('$(circle-slash) Disconnected from MCP server', 3000);
                break;
            case 'connecting':
                vscode.window.setStatusBarMessage('$(sync~spin) Connecting to MCP server...', 5000);
                break;
            case 'reconnecting':
                vscode.window.setStatusBarMessage('$(sync~spin) Reconnecting to MCP server...', 5000);
                break;
            case 'recovery':
                vscode.window.setStatusBarMessage('$(warning) MCP Connection Recovery Mode...', 10000);
                break;
        }

        // Emit state change event for other components to react
        if (this.emit) {
            this.emit('connectionStateChange', {
                previous: previousState,
                current: state
            });
        }
        
        // Handle transitions between states
        if (state === 'connected' && previousState !== 'connected') {
            // Just connected - process any queued messages
            if (this.messageQueue.length > 0) {
                setTimeout(() => this.processMessageQueue(), 500);
            }
        } else if (state === 'disconnected' && previousState === 'connected') {
            // Just disconnected - try to reconnect unless it was intentional
            Logger.debug('Connection lost, checking if reconnection is needed', 'mcp');
            
            // Track disconnection time for unstable connection detection
            const now = Date.now();
            if (!this._lastDisconnectTime) {
                this._lastDisconnectTime = now;
                this._disconnectCount = 1;
            } else {
                const timeSinceLastDisconnect = now - this._lastDisconnectTime;
                this._lastDisconnectTime = now;
                
                // If we're getting frequent disconnects, this might be an unstable connection
                if (timeSinceLastDisconnect < 30000) { // Less than 30 seconds since last disconnect
                    this._disconnectCount++;
                    
                    // Enter recovery mode if we have multiple rapid disconnects
                    if (this._disconnectCount >= 3) {
                        Logger.warn(`${this._disconnectCount} rapid disconnections detected, entering recovery mode`, 'mcp');
                        this.enterConnectionRecoveryMode(60000); // Wait 60 seconds before trying again
                        return;
                    }
                } else {
                    // Reset count if it's been a while
                    this._disconnectCount = 1;
                }
            }
        }
        
        // Update status bar item if we have access to it
        this._updateStatusBarItem();
    }
    
    /**
     * Update status bar item with connection state
     * @private
     */
    _updateStatusBarItem() {
        const extension = vscode.extensions.getExtension('luxoft.ai-development-monitor');
        if (extension && extension.isActive) {
            vscode.commands.executeCommand('ai-development-monitor.updateStatusBar', {
                state: this.connectionState,
                queuedMessages: this.messageQueue.length
            });
        }
    }

    /**
     * Enter connection recovery mode for very unstable connections
     * This is used when we've had multiple rapid disconnections
     * @param {number} recoveryDelayMs Time to wait before attempting recovery in ms
     */
    enterConnectionRecoveryMode(recoveryDelayMs = 60000) {
        Logger.warn(`Entering connection recovery mode - pausing for ${recoveryDelayMs}ms`, 'mcp');
        
        // Stop all existing reconnection attempts
        this.isReconnecting = false;
        
        if (this.persistentReconnectInterval) {
            clearInterval(this.persistentReconnectInterval);
            this.persistentReconnectInterval = null;
        }
        
        // Update UI to show recovery status
        this.updateConnectionState('recovery');
        vscode.window.showWarningMessage(
            `MCP connection is unstable. Entering recovery mode for ${recoveryDelayMs/1000} seconds.`, 
            'Retry Now'
        ).then(selection => {
            if (selection === 'Retry Now') {
                // User wants to retry immediately
                Logger.info('User requested immediate retry from recovery mode', 'mcp');
                this.exitConnectionRecoveryMode();
                this.reconnect();
            }
        });
        
        // Set timer to exit recovery mode
        setTimeout(() => {
            this.exitConnectionRecoveryMode();
        }, recoveryDelayMs);
    }
    
    /**
     * Exit connection recovery mode and attempt to reconnect
     */
    exitConnectionRecoveryMode() {
        Logger.info('Exiting connection recovery mode', 'mcp');
        
        // Reset counters
        this.reconnectAttempts = 0;
        this.connectionPromise = null;
        
        // Update state
        this.updateConnectionState('connecting');
        
        // Attempt to connect
        this.connect().catch(error => {
            Logger.error(`Failed to connect after recovery mode: ${error.message}`, error, 'mcp');
            // Start persistent reconnection
            this.startPersistentReconnect();
        });
    }

    /**
     * Get the current connection status for UI display
     * @returns {Object} Connection status information
     */
    getConnectionStatus() {
        return {
            connected: this.connected,
            state: this.connectionState,
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length,
            lastPongTime: this.lastPongTime ? new Date(this.lastPongTime).toISOString() : null,
            socketState: this.socket ? this.socket.readyState : 'no-socket'
        };
    }

    /**
     * Set up handlers for network connectivity changes
     * This helps detect when the network comes back online after being disconnected
     */
    setupNetworkChangeHandlers() {
        try {
            // In VS Code extensions, we don't have direct browser events
            // but we can set up our own network checking logic
            
            // Set up interval to check network connectivity periodically
            const networkCheckIntervalMs = 30000; // 30 seconds
            
            // Current network state
            let isOnline = true;
            
            // Function to check connection to the MCP server
            const checkMcpServerConnection = async () => {
                const config = this.getConnectionConfig();
                const mcpUrl = config.mcpUrl;
                
                // Only check if we're not already connected or reconnecting
                if (this.connected || this.isReconnecting) {
                    return;
                }
                
                try {
                    // Extract the host and port from the WebSocket URL
                    let url = mcpUrl;
                    if (url.startsWith('ws://')) {
                        url = url.replace('ws://', 'http://');
                    } else if (url.startsWith('wss://')) {
                        url = url.replace('wss://', 'https://');
                    }
                    
                    // Remove path components
                    if (url.includes('/')) {
                        url = url.substring(0, url.indexOf('/'));
                    }
                    
                    Logger.debug(`Checking network connectivity to MCP server at ${url}`, 'mcp');
                    
                    // Try to fetch a health endpoint or just connect to the server
                    const networkStatusChanged = await new Promise((resolve) => {
                        const client = require(url.startsWith('https') ? 'https' : 'http').request(url, {
                            method: 'HEAD',
                            timeout: 5000, // 5-second timeout
                            rejectUnauthorized: false,
                        }, (res) => {
                            const newOnlineStatus = res.statusCode < 500; // Consider any response under 500 as "online"
                            resolve(newOnlineStatus !== isOnline);
                            isOnline = newOnlineStatus;
                        });
                        
                        client.on('error', () => {
                            const newOnlineStatus = false;
                            resolve(newOnlineStatus !== isOnline);
                            isOnline = newOnlineStatus;
                        });
                        
                        client.on('timeout', () => {
                            const newOnlineStatus = false;
                            resolve(newOnlineStatus !== isOnline);
                            isOnline = newOnlineStatus;
                        });
                        
                        client.end();
                    });
                    
                    // If network status changed from offline to online, attempt reconnection
                    if (networkStatusChanged && isOnline) {
                        Logger.info('Network connection detected - server is reachable', 'mcp');
                        // Reset reconnect attempts to start clean
                        this.reconnectAttempts = 0;
                        this.attemptReconnect(true); // Immediate reconnection
                    } else if (networkStatusChanged && !isOnline) {
                        Logger.info('Network connection lost - server is unreachable', 'mcp');
                        // Update state if we think we're connected
                        if (this.connected) {
                            this.updateConnectionState('disconnected');
                        }
                    }
                } catch (error) {
                    Logger.debug(`Error checking network connectivity: ${error.message}`, 'mcp');
                    // Don't update online status on error, it could be temporary
                }
            };
            
            // Set up the interval
            const networkCheckInterval = setInterval(checkMcpServerConnection, networkCheckIntervalMs);
            
            // Store the interval for cleanup
            this._networkCheckInterval = networkCheckInterval;
            
            Logger.info('Network change detection set up', 'mcp');
            
            // Run initial check after a short delay
            setTimeout(checkMcpServerConnection, 10000);
        } catch (error) {
            Logger.warn(`Error setting up network change detection: ${error.message}`, 'mcp');
        }
    }
    
    /**
     * Clean up network change detection on deactivation
     */
    cleanupNetworkChangeHandlers() {
        if (this._networkCheckInterval) {
            clearInterval(this._networkCheckInterval);
            this._networkCheckInterval = null;
            Logger.debug('Network change detection cleaned up', 'mcp');
        }
    }

    /**
     * Track connection stability metrics and enter recovery mode if connection is unstable
     * @param {boolean} reconnectSuccess Whether the reconnection attempt was successful
     */
    trackConnectionStability(reconnectSuccess) {
        const now = Date.now();
        
        // Initialize stability tracking data if needed
        if (!this._connectionMetrics) {
            this._connectionMetrics = {
                reconnectAttempts: [],       // Timestamps of reconnection attempts
                reconnectSuccesses: [],      // Timestamps of successful reconnections
                disconnectEvents: [],        // Timestamps of disconnection events
                lastStableTimestamp: now,    // Last time we determined connection was stable
                recoveryModeCount: 0         // Number of times we've entered recovery mode
            };
        }
        
        // Track this event
        if (reconnectSuccess === true) {
            this._connectionMetrics.reconnectSuccesses.push(now);
        } else if (reconnectSuccess === false) {
            this._connectionMetrics.reconnectAttempts.push(now);
        } else {
            // This is a disconnect event
            this._connectionMetrics.disconnectEvents.push(now);
        }
        
        // Keep only the last hour of data
        const oneHourAgo = now - (60 * 60 * 1000);
        this._connectionMetrics.reconnectAttempts = this._connectionMetrics.reconnectAttempts.filter(t => t > oneHourAgo);
        this._connectionMetrics.reconnectSuccesses = this._connectionMetrics.reconnectSuccesses.filter(t => t > oneHourAgo);
        this._connectionMetrics.disconnectEvents = this._connectionMetrics.disconnectEvents.filter(t => t > oneHourAgo);

        // Look for signs of connection instability (multiple disconnects in a short period)
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        const recentDisconnects = this._connectionMetrics.disconnectEvents.filter(t => t > fiveMinutesAgo).length;
        const recentReconnectAttempts = this._connectionMetrics.reconnectAttempts.filter(t => t > fiveMinutesAgo).length;
        const recentReconnectSuccesses = this._connectionMetrics.reconnectSuccesses.filter(t => t > fiveMinutesAgo).length;
        
        // Calculate stability metrics
        const isDisconnectingFrequently = recentDisconnects >= 3;
        const hasFailedReconnects = recentReconnectAttempts - recentReconnectSuccesses >= 3;
        const connectionSuccessRate = recentReconnectAttempts > 0 ? 
            recentReconnectSuccesses / recentReconnectAttempts : 1;
        
        // Check if we should enter recovery mode
        const needsRecovery = isDisconnectingFrequently || 
                             hasFailedReconnects || 
                             connectionSuccessRate < 0.5;
        
        // Log stability metrics periodically or when concerning
        if (needsRecovery || (now - this._lastMetricsLog > 60000)) {
            Logger.info(`Connection stability metrics - disconnects: ${recentDisconnects}, attempts: ${recentReconnectAttempts}, successes: ${recentReconnectSuccesses}, success rate: ${connectionSuccessRate.toFixed(2)}`, 'mcp');
            this._lastMetricsLog = now;
        }
        
        if (needsRecovery) {
            Logger.warn('Connection appears to be unstable, entering recovery mode', 'mcp');
            
            // Determine recovery time based on frequency of recovery mode
            let recoveryTime = 30000; // Start with 30 seconds
            
            if (this._connectionMetrics.recoveryModeCount > 0) {
                // Increase recovery time for repeated instability, up to 5 minutes
                recoveryTime = Math.min(300000, recoveryTime * Math.pow(2, this._connectionMetrics.recoveryModeCount));
            }
            
            this._connectionMetrics.recoveryModeCount++;
            this.enterConnectionRecoveryMode(recoveryTime);
            
            return true;
        }
        
        // If we've been stable for a while, reset the recovery mode count
        if (recentDisconnects === 0 && recentReconnectAttempts === 0 && now - this._connectionMetrics.lastStableTimestamp > 300000) {
            if (this._connectionMetrics.recoveryModeCount > 0) {
                Logger.info('Connection has been stable for 5 minutes, resetting recovery counter', 'mcp');
                this._connectionMetrics.recoveryModeCount = 0;
            }
            this._connectionMetrics.lastStableTimestamp = now;
        }
        
        return false;
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
