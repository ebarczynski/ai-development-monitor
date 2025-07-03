// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

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
const modelProviderService = require('./model_provider_service');

// Constants for optimization
const COMPRESSION_THRESHOLD = 1024; // Only compress messages larger than 1KB
const BATCH_DELAY = 50; // Milliseconds to wait before sending batched messages
const BATCH_MAX_SIZE = 5; // Maximum number of messages to batch together
const CONNECTION_TIMEOUT = 15000; // 15 seconds connection timeout (increased from 10s)
const HANDSHAKE_TIMEOUT = 8000; // 8 seconds handshake timeout (increased from 5s)
const MAX_RECONNECT_ATTEMPTS = 3; // Reduced from 10 to fail faster
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
        this.maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
        this.reconnectDelay = 2000; // Reduced from 10s for quicker recovery
        this.config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.mcpUrl = this.config.get('mcpUrl', 'ws://localhost:5001/ws');
        this.serverAvailable = true; // Track if server is available
        
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
        
        // Connection notification and health check
        this.connectionNotification = null;
        this.healthCheckInterval = null;
        this.connectionMetrics = null;
        
        // Initialize connection notification on startup
        this.updateConnectionNotification();
    }

    /**
     * Start heartbeat to detect connection issues
     * This sends regular pings to the server and monitors responses
     * to detect network issues or failed connections
     */
    startHeartbeat() {
        // Clear any existing heartbeat interval first
        this.stopHeartbeat();
        
        this.lastPongTime = Date.now();
        
        // Use configuration for heartbeat timing if available, or fallback to defaults
        const pingInterval = this.config.get('heartbeatPingInterval', 15000); // 15 seconds
        const pongTimeout = this.config.get('heartbeatPongTimeout', 30000);  // 30 seconds
        
        Logger.debug(`Starting heartbeat (ping every ${pingInterval}ms, timeout: ${pongTimeout}ms)`, 'mcp');
        
        this.heartbeatInterval = setInterval(() => {
            if (!this.socket || !this.connected) {
                return;
            }
            
            // Check if we've received a pong recently
            const now = Date.now();
            if (now - this.lastPongTime > pongTimeout) {
                Logger.warn(`No pong received in ${pongTimeout/1000} seconds, connection may be dead`, 'mcp');
                
                // Record connection issue
                this.recordConnectionMetrics('heartbeat_timeout', { 
                    lastPong: this.lastPongTime,
                    currentTime: now,
                    timeout: pongTimeout
                });
                
                // Force close and trigger reconnect
                this.socket.terminate();
                return;
            }
            
            try {
                // Only send ping if we're not already waiting for a pong
                if (now - this.lastPongTime < pingInterval * 1.5) {
                    Logger.debug('Sending ping to server', 'mcp');
                    this.socket.ping();
                }
            } catch (error) {
                Logger.error('Error sending ping', error, 'mcp');
                this.socket.terminate();
            }
        }, pingInterval);
    }
    
    /**
     * Stop the heartbeat monitoring
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Connect to the MCP server
     */
    connect() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // If we've established the server is not available, fail fast
        if (!this.serverAvailable) {
            return Promise.reject(new Error("MCP server is not available"));
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
                        // Mark server as unavailable after timeout
                        this.serverAvailable = false;
                        vscode.window.showErrorMessage(`Connection to MCP server timed out. Server may be down at ${this.mcpUrl}. Click the connection indicator to retry.`);
                        reject(new Error('Connection timeout'));
                    }
                }, CONNECTION_TIMEOUT);
                
                // Connection options with better defaults
                const socketOptions = {
                    handshakeTimeout: HANDSHAKE_TIMEOUT, // Use constant
                    maxPayload: 5 * 1024 * 1024, // 5MB max payload
                    perMessageDeflate: true // Enable per-message compression
                };
                
                // Try to ping the server first to check availability (TCP check)
                this.checkServerAvailability(wsUrl)
                    .then(isAvailable => {
                        if (!isAvailable) {
                            clearTimeout(connectionTimeout);
                            this.serverAvailable = false;
                            Logger.error(`MCP server at ${wsUrl} is not available`, null, 'mcp');
                            vscode.window.showErrorMessage(`MCP server is not available at ${this.mcpUrl}. Click the connection indicator to retry.`);
                            reject(new Error('Server unavailable'));
                            return;
                        }
                        
                        // Server seems available, try to connect
                        this.socket = new WebSocket(wsUrl, socketOptions);
                        
                        this.socket.on('open', () => {
                            clearTimeout(connectionTimeout);
                            Logger.info('Connected to MCP server', 'mcp');
                            this.connected = true;
                            this.serverAvailable = true;
                            this.reconnectAttempts = 0;
                            this.reconnectDelay = 2000; // Reset delay
                            this.lastReceivedTime = Date.now();
                            this.startHeartbeat();
                            
                            // Record successful connection in metrics
                            this.recordConnectionMetrics('connect_success', { url: this.mcpUrl });
                            
                            // Update connection notification
                            this.updateConnectionNotification();
                            
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
                            
                            // Record error in connection metrics
                            this.recordConnectionMetrics('error', { 
                                message: error.message,
                                type: error.name || 'WebSocketError' 
                            });
                            
                            // Show appropriate error message based on error type
                            if (error.message.includes('ECONNREFUSED')) {
                                this.serverAvailable = false;
                                vscode.window.showErrorMessage(`MCP server connection refused at ${this.mcpUrl}. Make sure the server is running.`);
                            } else if (error.message.includes('timed out')) {
                                vscode.window.showErrorMessage(`MCP server connection timed out. Check network and server status.`);
                            }
                            
                            // Update connection notification
                            this.updateConnectionNotification();
                            
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
                            
                            // Record disconnect in metrics
                            this.recordConnectionMetrics('disconnect', { url: this.mcpUrl });
                            
                            // Flush any pending messages to prevent data loss
                            this.flushMessageQueue();
                            
                            // Update connection notification
                            this.updateConnectionNotification();
                            
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
                    })
                    .catch(error => {
                        clearTimeout(connectionTimeout);
                        this.serverAvailable = false;
                        Logger.error(`Error checking server availability: ${error.message}`, error, 'mcp');
                        vscode.window.showErrorMessage('Failed to check MCP server availability. Click the connection indicator to retry.');
                        reject(error);
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
     * Check if the MCP server is available before attempting a connection
     * This performs a quick TCP check to see if the server is listening
     */
    checkServerAvailability(wsUrl) {
        return new Promise(resolve => {
            try {
                // Extract hostname and port from WebSocket URL
                const url = new URL(wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
                const hostname = url.hostname;
                // Default to 80/443 if not specified in the URL
                const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
                
                Logger.debug(`Checking server availability at ${hostname}:${port}`, 'mcp');
                
                // Use a TCP socket to check if the server is listening
                const net = require('net');
                const socket = new net.Socket();
                
                // Set a short timeout for the connection attempt
                socket.setTimeout(3000);
                
                socket.on('connect', () => {
                    Logger.debug('Server is available (TCP check successful)', 'mcp');
                    socket.destroy();
                    resolve(true);
                });
                
                socket.on('timeout', () => {
                    Logger.debug('Server availability check timed out', 'mcp');
                    socket.destroy();
                    resolve(false);
                });
                
                socket.on('error', (error) => {
                    Logger.debug(`Server is unavailable: ${error.message}`, 'mcp');
                    socket.destroy();
                    resolve(false);
                });
                
                // Try to connect
                socket.connect(port, hostname);
                
            } catch (error) {
                Logger.error('Error in server availability check', error, 'mcp');
                resolve(false);
            }
        });
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
        
        // Special handling for server health messages
        if (message.message_type === 'server_health') {
            this.handleServerHealthMessage(message);
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
                
                // Record error in metrics
                this.recordConnectionMetrics('error', { 
                    type: 'server_error',
                    message: errorMsg
                });
                
                vscode.window.showErrorMessage(`MCP Error: ${errorMsg}`);
            }
        }
    }
    
    /**
     * Handle server health messages for monitoring
     */
    handleServerHealthMessage(message) {
        try {
            const healthData = message.content;
            
            // Update our health metrics
            if (healthData.status === 'healthy') {
                this.recordConnectionMetrics('server_health', { 
                    status: 'healthy',
                    memory: healthData.memory_usage || null,
                    cpu: healthData.cpu_usage || null
                });
            } else {
                // Server reporting issues
                Logger.warn(`Server health issues reported: ${healthData.details || 'Unknown issue'}`, 'mcp');
                this.recordConnectionMetrics('server_health', { 
                    status: 'unhealthy',
                    details: healthData.details || 'Unknown issue'
                });
            }
        } catch (error) {
            Logger.error('Error handling server health message', error, 'mcp');
        }
    }
    
    /**
     * Attempt to reconnect to the MCP server
     */
    attemptReconnect() {
        // Don't attempt reconnect if we know server is not available
        if (!this.serverAvailable) {
            Logger.warn('Not attempting reconnection as server has been marked unavailable', 'mcp');
            
            // Start health check polling to detect when server becomes available again
            this.startHealthCheckPolling();
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.warn(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`, 'mcp');
            
            // Mark server as unavailable after max attempts
            this.serverAvailable = false;
            
            // Start health check polling to detect when server comes back
            this.startHealthCheckPolling();
            
            vscode.window.showErrorMessage(
                `Failed to reconnect to MCP server after ${this.maxReconnectAttempts} attempts. ` +
                `Check that the MCP server is running at ${this.mcpUrl}.`,
                'Check Server Status', 'Retry Connection'
            ).then(selection => {
                if (selection === 'Check Server Status') {
                    // Check if the MCP server is actually running
                    this.checkServerStatus();
                } else if (selection === 'Retry Connection') {
                    // Reset and try again
                    this.serverAvailable = true;
                    this.reconnectAttempts = 0;
                    this.connectionPromise = null;
                    this.connect().catch(error => {
                        Logger.error('Manual reconnection failed', error, 'mcp');
                    });
                }
            });
            
            return;
        }
        
        this.reconnectAttempts++;
        
        // Record reconnect attempt in metrics
        this.recordConnectionMetrics('reconnect_attempt', { 
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });
        
        // Use smarter backoff - shorter for first few attempts
        let delay;
        if (this.reconnectAttempts <= 2) {
            delay = this.reconnectDelay;
        } else {
            delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 2);
        }
        
        Logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
        
        // Show reconnection status to user
        const statusMessage = vscode.window.setStatusBarMessage(
            `Reconnecting to MCP server (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );
        
        setTimeout(() => {
            statusMessage.dispose();
            Logger.info(`Reconnecting to MCP server (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'mcp');
            
            // Before reconnecting, check if server is available
            this.checkServerAvailability(this.mcpUrl)
                .then(isAvailable => {
                    if (!isAvailable) {
                        Logger.warn('Server is still unavailable, marking as unavailable and stopping reconnection', 'mcp');
                        this.serverAvailable = false;
                        vscode.window.showErrorMessage(
                            `MCP server is not available at ${this.mcpUrl}. Click the connection indicator to retry.`
                        );
                        return;
                    }
                    
                    // Server appears to be available, try to reconnect
                    this.connectionPromise = null;
                    this.connect().catch(error => {
                        Logger.error(`Reconnection attempt ${this.reconnectAttempts} failed`, error, 'mcp');
                    });
                });
                
        }, delay);
    }
    
    /**
     * Check MCP server status and provide more detailed diagnostics
     */
    checkServerStatus() {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Checking MCP Server Status",
            cancellable: true
        }, async (progress) => {
            progress.report({ increment: 0, message: "Checking network connectivity..." });
            
            try {
                // First check basic connectivity
                const wsUrl = this.mcpUrl;
                const httpUrl = wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
                
                progress.report({ increment: 25, message: "Checking if server is running..." });
                
                const isServerAvailable = await this.checkServerAvailability(wsUrl);
                
                progress.report({ increment: 50, message: "Checking server response..." });
                
                if (!isServerAvailable) {
                    // Show troubleshooting dialog
                    const troubleshoot = await vscode.window.showErrorMessage(
                        `MCP server is not running at ${wsUrl}. Would you like to try to start it?`,
                        'Start Server', 'View Troubleshooting Tips'
                    );
                    
                    if (troubleshoot === 'Start Server') {
                        progress.report({ increment: 75, message: "Trying to start MCP server..." });
                        
                        // Try to start the MCP server
                        this.tryStartServer();
                    } else if (troubleshoot === 'View Troubleshooting Tips') {
                        // Show troubleshooting information
                        this.showTroubleshootingInfo();
                    }
                } else {
                    progress.report({ increment: 100, message: "Server is running but connection failed" });
                    
                    vscode.window.showInformationMessage(
                        `MCP server appears to be running at ${wsUrl}, but WebSocket connection failed. ` +
                        `Check for firewalls or other connection blockers.`,
                        'Retry Connection'
                    ).then(selection => {
                        if (selection === 'Retry Connection') {
                            // Reset and try again
                            this.serverAvailable = true;
                            this.reconnectAttempts = 0;
                            this.connectionPromise = null;
                            this.connect().catch(() => {});
                        }
                    });
                }
                
            } catch (error) {
                Logger.error('Error checking server status', error, 'mcp');
                vscode.window.showErrorMessage(`Error checking server status: ${error.message}`);
            }
        });
    }
    
    /**
     * Try to start the MCP server automatically
     */
    tryStartServer() {
        // Get workspace root folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found to start MCP server');
            return;
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        // Look for start_mcp_server.sh or similar script
        const fs = require('fs');
        const path = require('path');
        
        const startScripts = [
            path.join(workspaceRoot, 'start_mcp_server.sh'),
            path.join(workspaceRoot, 'start_server.sh'),
            path.join(workspaceRoot, '..', 'start_mcp_server.sh')
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
                'Could not find MCP server start script. Start the server manually and try again.'
            );
            return;
        }
        
        // Execute the script
        const terminal = vscode.window.createTerminal('MCP Server');
        terminal.show();
        
        // Make script executable if needed
        terminal.sendText(`chmod +x "${scriptToRun}"`);
        terminal.sendText(`"${scriptToRun}"`);
        
        vscode.window.showInformationMessage(
            'Attempting to start MCP server. Wait a moment and then try to reconnect.',
            'Reconnect'
        ).then(selection => {
            if (selection === 'Reconnect') {
                // Wait for server to start up
                setTimeout(() => {
                    this.serverAvailable = true;
                    this.reconnectAttempts = 0;
                    this.connectionPromise = null;
                    this.connect().catch(() => {});
                }, 5000);
            }
        });
    }
    
    /**
     * Show troubleshooting information to help users resolve connection issues
     */
    showTroubleshootingInfo() {
        const troubleshootingInfo = [
            '# MCP Connection Troubleshooting',
            '',
            '## Common Issues',
            '1. **MCP Server not running** - Start the MCP server with `./start_mcp_server.sh`',
            '2. **Wrong server URL** - Check the `mcpUrl` setting in extension configuration',
            '3. **Port already in use** - Check if another process is using port 5001',
            '4. **Server crashed** - Check server logs for errors',
            '',
            '## How to Start the Server',
            '1. Open a terminal in the project root',
            '2. Run the start script: `./start_mcp_server.sh`',
            '3. Wait for the server to initialize',
            '4. Try reconnecting from the extension',
            '',
            '## Configuration',
            'Check your `settings.json` for proper configuration:',
            '```json',
            '{',
            '  "aiDevelopmentMonitor.mcpUrl": "ws://localhost:5001/ws",',
            '  "aiDevelopmentMonitor.apiUrl": "http://localhost:5000"',
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
        
        // Validate message type
        if (!this.isMessageTypeSupported(messageType)) {
            throw new Error(`Unsupported message type: ${messageType}`);
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
     * Check if a message type is supported by the server
     */
    isMessageTypeSupported(messageType) {
        // List of message types that are known to be supported
        const supportedTypes = [
            'ping',
            'suggestion',
            'continue',
            'tdd_request',
            'feedback',
            'server_health',
            'evaluation'  // Added evaluation as a supported type
        ];
        
        return supportedTypes.includes(messageType);
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
        
        // Check if we should use Hugging Face API or another external provider
        if (modelProviderService.shouldUseExternalProvider()) {
            try {
                Logger.info(`Using ${modelProviderService.getProviderInfo().type} for code evaluation`, 'mcp');
                
                // Create request for external provider
                const requestData = {
                    originalCode: suggestionData.original_code,
                    proposedChanges: suggestionData.proposed_changes,
                    language: suggestionData.language,
                    taskDescription: suggestionData.task_description
                };
                
                // Process request through model provider service
                const externalResponse = await modelProviderService.processRequest(requestData, 'evaluation');
                
                // If we got a valid response from the external provider, return it
                if (externalResponse) {
                    Logger.info(`Received evaluation from ${modelProviderService.getProviderInfo().type}`, 'mcp');
                    return externalResponse;
                }
                
                // Otherwise, fall back to MCP/Ollama
                Logger.info('Falling back to Ollama via MCP server for evaluation', 'mcp');
            } catch (error) {
                Logger.error('Error using external provider for evaluation, falling back to Ollama:', error, 'mcp');
                // Continue with MCP/Ollama as fallback
            }
        }
        
        // Send evaluation request to MCP server (Ollama)
        Logger.info('Sending suggestion evaluation request to MCP server', 'mcp');
        
        // Higher priority than regular messages
        const response = await this.sendMessage('suggestion', suggestionData, null, PRIORITY_LEVELS.MEDIUM);
        return response;
    }
    
    /**
     * Clean up resources and close connections
     */
    dispose() {
        this.stopHeartbeat();
        this.stopHealthCheckPolling();
        
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
        
        // Clear persistent notifications
        this.clearConnectionNotification();
        
        Logger.info('MCP client disposed', 'mcp');
    }
    
    /**
     * Start health check polling to detect when server becomes available
     * This is useful after a server has been marked as unavailable
     */
    startHealthCheckPolling() {
        // Stop any existing polling
        this.stopHealthCheckPolling();
        
        // Get polling interval from settings, default to 30 seconds
        const pollingIntervalMs = this.config.get('serverHealthCheckInterval', 30000);
        
        Logger.info(`Starting server health check polling (every ${pollingIntervalMs}ms)`, 'mcp');
        
        // Create a polling interval
        this.healthCheckInterval = setInterval(() => {
            // Only run health check if server is marked as unavailable
            if (!this.serverAvailable && !this.connected) {
                this.performHealthCheck();
            }
        }, pollingIntervalMs);
        
        // Run an initial health check immediately
        if (!this.serverAvailable && !this.connected) {
            this.performHealthCheck();
        }
    }
    
    /**
     * Stop the health check polling
     */
    stopHealthCheckPolling() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    
    /**
     * Perform a health check to see if the server has become available
     */
    async performHealthCheck() {
        try {
            Logger.debug('Performing server health check', 'mcp');
            
            const isAvailable = await this.checkServerAvailability(this.mcpUrl);
            
            if (isAvailable && !this.serverAvailable) {
                Logger.info('Server is now available!', 'mcp');
                this.serverAvailable = true;
                
                // Show notification to user
                vscode.window.showInformationMessage(
                    `MCP server at ${this.mcpUrl} is now available.`,
                    'Connect'
                ).then(selection => {
                    if (selection === 'Connect') {
                        // Reset connection state
                        this.reconnectAttempts = 0;
                        this.connectionPromise = null;
                        
                        // Try to connect
                        this.connect().catch(error => {
                            Logger.error('Failed to connect after server became available', error, 'mcp');
                        });
                    }
                });
                
                // Update connection notification
                this.updateConnectionNotification();
            } else if (!isAvailable && this.serverAvailable) {
                Logger.warn('Server is no longer available', 'mcp');
                this.serverAvailable = false;
                
                // Update connection notification
                this.updateConnectionNotification();
            }
        } catch (error) {
            Logger.error('Error performing server health check', error, 'mcp');
        }
    }
    
    /**
     * Create or update the persistent connection notification
     * This provides users with continuous visibility into connection status
     */
    updateConnectionNotification() {
        // Use a persistent notification for connection status
        if (!this.connectionNotification) {
            this.connectionNotification = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                100
            );
            
            // Add command to retry connection
            this.connectionNotification.command = 'ai-development-monitor.retryConnection';
        }
        
        // Update text based on connection status
        if (this.connected) {
            this.connectionNotification.text = `$(plug) MCP: Connected (${this.connectionQuality})`;
            this.connectionNotification.tooltip = `Connected to MCP server at ${this.mcpUrl}`;
            this.connectionNotification.backgroundColor = undefined;
        } else if (this.serverAvailable) {
            this.connectionNotification.text = `$(plug) MCP: Connecting...`;
            this.connectionNotification.tooltip = `Attempting to connect to MCP server at ${this.mcpUrl}`;
            this.connectionNotification.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.connectionNotification.text = `$(plug) MCP: Disconnected`;
            this.connectionNotification.tooltip = `MCP server at ${this.mcpUrl} is unavailable. Using fallback.`;
            this.connectionNotification.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        
        this.connectionNotification.show();
    }
    
    /**
     * Clear the connection notification
     */
    clearConnectionNotification() {
        if (this.connectionNotification) {
            this.connectionNotification.dispose();
            this.connectionNotification = null;
        }
    }
    
    /**
     * Add connection reliability metrics
     * This helps track connection stability over time
     */
    recordConnectionMetrics(event, details = {}) {
        if (!this.connectionMetrics) {
            this.connectionMetrics = {
                connectAttempts: 0,
                successfulConnects: 0,
                failedConnects: 0,
                disconnects: 0,
                reconnectAttempts: 0,
                successfulReconnects: 0, 
                errors: 0,
                events: []
            };
        }
        
        // Update counters based on event type
        switch (event) {
            case 'connect_attempt':
                this.connectionMetrics.connectAttempts++;
                break;
            case 'connect_success':
                this.connectionMetrics.successfulConnects++;
                break;
            case 'connect_failure':
                this.connectionMetrics.failedConnects++;
                break;
            case 'disconnect':
                this.connectionMetrics.disconnects++;
                break;
            case 'reconnect_attempt':
                this.connectionMetrics.reconnectAttempts++;
                break;
            case 'reconnect_success':
                this.connectionMetrics.successfulReconnects++;
                break;
            case 'error':
                this.connectionMetrics.errors++;
                break;
        }
        
        // Record event with timestamp
        this.connectionMetrics.events.push({
            timestamp: new Date().toISOString(),
            event: event,
            ...details
        });
        
        // Limit event history to avoid excessive memory usage
        if (this.connectionMetrics.events.length > 100) {
            this.connectionMetrics.events.shift();
        }
        
        // Log metrics periodically
        if (this.connectionMetrics.events.length % 10 === 0) {
            Logger.debug(`Connection metrics: ${JSON.stringify(this.connectionMetrics)}`, 'mcp');
        }
    }
    
    /**
     * Get connection metrics data
     */
    getConnectionMetrics() {
        return this.connectionMetrics || {
            connectAttempts: 0,
            successfulConnects: 0,
            failedConnects: 0,
            disconnects: 0,
            reconnectAttempts: 0,
            successfulReconnects: 0,
            errors: 0,
            events: []
        };
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

/**
 * Initialize the MCP client and validate connection
 * This should be called when the extension activates
 */
OptimizedMCPClient.prototype.initialize = async function() {
    Logger.info('Initializing MCP client', 'mcp');
    
    try {
        // Try to connect
        await this.connect();
        return true;
    } catch (error) {
        Logger.error('Failed to initialize MCP client, will use fallback', error, 'mcp');
        
        // Start health check polling if server is unavailable
        if (!this.serverAvailable) {
            this.startHealthCheckPolling();
        }
        
        // Update connection notification
        this.updateConnectionNotification();
        
        return false;
    }
};

module.exports = OptimizedMCPClient;
