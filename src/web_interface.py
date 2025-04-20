"""
Web interface for MCP Server with communication logs

This module provides a simple, reliable web interface that shows incoming and outgoing MCP messages
with real-time updates.
"""
import os
import json
from datetime import datetime
from typing import Dict, List, Any

# Path to log file
LOG_FILE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mcp_logs.json")

# Global logs storage
communication_logs_data = []
MAX_LOGS = 200

def add_to_logs(direction: str, message_type: str, content: Any):
    """Add a message to the communication logs"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    
    # Determine emoticon based on message type and direction
    emoticon = "📝"  # Default
    if direction == "incoming":
        if message_type == "suggestion":
            emoticon = "💡"  # Incoming suggestion
        elif message_type == "continue":
            emoticon = "⏩"  # Continue request
        elif message_type == "tdd_request":
            emoticon = "🧪"  # TDD request
        else:
            emoticon = "📥"  # Other incoming
    else:  # outgoing
        if message_type == "evaluation":
            if isinstance(content, dict) and content.get("accept", False):
                emoticon = "✅"  # Accepted evaluation
            else:
                emoticon = "❌"  # Rejected evaluation
        elif message_type == "continuation":
            emoticon = "🔄"  # Continuation response
        elif message_type == "error":
            emoticon = "⚠️"  # Error response
        elif message_type == "tdd_tests":
            emoticon = "🧪"  # TDD tests
        else:
            emoticon = "📤"  # Other outgoing
    
    # Add log entry
    log_entry = {
        "timestamp": timestamp,
        "direction": direction,
        "message_type": message_type,
        "emoticon": emoticon,
        "content": content
    }
    
    # Add to global logs with limit
    global communication_logs_data
    communication_logs_data.append(log_entry)
    if len(communication_logs_data) > MAX_LOGS:
        communication_logs_data.pop(0)  # Remove oldest entry
    
    # Save logs to file for persistence
    save_logs_to_file()

def communication_logs():
    """Return all communication logs"""
    global communication_logs_data
    return communication_logs_data

def clear_logs():
    """Clear all logs"""
    global communication_logs_data
    communication_logs_data = []
    save_logs_to_file()

def save_logs_to_file():
    """Save communication logs to file"""
    try:
        with open(LOG_FILE_PATH, 'w') as f:
            json.dump(communication_logs_data, f, indent=2)
    except Exception as e:
        print(f"Error saving logs to file: {e}")

def load_logs_from_file():
    """Load communication logs from file"""
    global communication_logs_data
    try:
        if os.path.exists(LOG_FILE_PATH):
            with open(LOG_FILE_PATH, 'r') as f:
                loaded_logs = json.load(f)
                if isinstance(loaded_logs, list):
                    communication_logs_data = loaded_logs
                    print(f"Loaded {len(communication_logs_data)} logs from file")
    except Exception as e:
        print(f"Error loading logs from file: {e}")

def get_html_interface():
    """Generate HTML for the MCP server web interface"""
    html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MCP Server - Real-time Logs</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            header {
                background-color: #1e88e5;
                color: white;
                padding: 15px 20px;
                border-radius: 5px;
                margin-bottom: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            h1 {
                margin: 0;
                font-size: 24px;
            }
            .status {
                display: flex;
                align-items: center;
                font-size: 14px;
                background-color: rgba(255, 255, 255, 0.2);
                padding: 5px 10px;
                border-radius: 15px;
            }
            .status-dot {
                width: 10px;
                height: 10px;
                background-color: #4CAF50;
                border-radius: 50%;
                margin-right: 5px;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            .controls {
                margin-bottom: 20px;
                display: flex;
                gap: 10px;
                align-items: center;
                flex-wrap: wrap;
            }
            button {
                background-color: #1e88e5;
                color: white;
                border: none;
                padding: 8px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
            }
            button:hover {
                background-color: #1976d2;
            }
            button:disabled {
                background-color: #9e9e9e;
                cursor: not-allowed;
            }
            .last-updated {
                margin-left: auto;
                font-size: 12px;
                color: #666;
            }
            .log-container {
                background-color: #fff;
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                overflow: hidden;
                margin-bottom: 20px;
            }
            .log-header {
                background-color: #f0f0f0;
                padding: 10px 20px;
                font-weight: bold;
                border-bottom: 1px solid #ddd;
                display: flex;
                justify-content: space-between;
            }
            #log-count {
                font-weight: normal;
                color: #666;
            }
            .log-body {
                padding: 0;
                max-height: 70vh;
                overflow-y: auto;
            }
            .log-entry {
                padding: 12px 20px;
                border-bottom: 1px solid #eee;
                display: flex;
            }
            .log-entry:hover {
                background-color: #f9f9f9;
            }
            .log-time {
                color: #666;
                font-size: 0.85em;
                width: 180px;
                flex-shrink: 0;
            }
            .log-emoticon {
                font-size: 1.5em;
                margin-right: 15px;
                width: 30px;
                text-align: center;
            }
            .log-content {
                flex-grow: 1;
                min-width: 0;
            }
            .log-type {
                font-weight: bold;
                margin-bottom: 5px;
                display: flex;
                justify-content: space-between;
            }
            .log-message {
                font-family: Menlo, Monaco, 'Courier New', monospace;
                white-space: pre-wrap;
                background-color: #f8f8f8;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                font-size: 13px;
                max-height: 400px;
                overflow-y: auto;
            }
            .incoming {
                border-left: 4px solid #2196F3;
            }
            .outgoing {
                border-left: 4px solid #4CAF50;
            }
            .error {
                border-left: 4px solid #F44336;
            }
            .empty-logs {
                text-align: center;
                padding: 40px;
                color: #666;
            }
            footer {
                text-align: center;
                margin-top: 30px;
                color: #666;
                font-size: 0.9em;
            }
            .auto-refresh-toggle {
                display: flex;
                align-items: center;
                margin-right: 10px;
            }
            .toggle-switch {
                position: relative;
                display: inline-block;
                width: 50px;
                height: 24px;
                margin-right: 8px;
            }
            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #ccc;
                transition: .4s;
                border-radius: 24px;
            }
            .toggle-slider:before {
                position: absolute;
                content: "";
                height: 16px;
                width: 16px;
                left: 4px;
                bottom: 4px;
                background-color: white;
                transition: .4s;
                border-radius: 50%;
            }
            input:checked + .toggle-slider {
                background-color: #4CAF50;
            }
            input:focus + .toggle-slider {
                box-shadow: 0 0 1px #4CAF50;
            }
            input:checked + .toggle-slider:before {
                transform: translateX(26px);
            }
            @media (max-width: 768px) {
                .log-entry {
                    flex-direction: column;
                }
                .log-time {
                    width: 100%;
                    margin-bottom: 5px;
                }
                .controls {
                    flex-direction: column;
                    align-items: flex-start;
                }
                .last-updated {
                    margin-left: 0;
                    margin-top: 10px;
                }
            }
        </style>
    </head>
    <body>
        <header>
            <h1>MCP Server - Real-time Logs</h1>
            <div class="status"><span class="status-dot"></span> Monitoring</div>
        </header>
        
        <div class="controls">
            <div class="auto-refresh-toggle">
                <label class="toggle-switch">
                    <input type="checkbox" id="autoRefreshToggle" checked>
                    <span class="toggle-slider"></span>
                </label>
                <span>Auto-refresh</span>
            </div>
            
            <button id="refreshButton">Refresh Now</button>
            <button id="clearButton">Clear Logs</button>
            <div class="last-updated" id="lastUpdated">Last updated: Just now</div>
        </div>
        
        <div class="log-container">
            <div class="log-header">
                <span>Communication Logs</span>
                <span id="log-count">0 entries</span>
            </div>
            <div class="log-body" id="logs">
                <div class="empty-logs" id="empty-logs">No communication logs yet. Send messages to the MCP server to see them here.</div>
            </div>
        </div>
        
        <footer>
            Model Context Protocol (MCP) Server - AI Development Monitor
        </footer>
        
        <script>
            // State management
            let autoRefreshEnabled = true;
            let refreshInterval;
            let lastLogCount = 0;
            let isFirstLoad = true;
            
            // DOM elements
            const refreshButton = document.getElementById('refreshButton');
            const clearButton = document.getElementById('clearButton');
            const autoRefreshToggle = document.getElementById('autoRefreshToggle');
            const lastUpdatedElement = document.getElementById('lastUpdated');
            const logsContainer = document.getElementById('logs');
            const emptyLogsMessage = document.getElementById('empty-logs');
            const logCountElement = document.getElementById('log-count');
            
            // Initialize on page load
            document.addEventListener('DOMContentLoaded', () => {
                // Set up toggle state
                autoRefreshToggle.checked = autoRefreshEnabled;
                
                // Set up event listeners
                refreshButton.addEventListener('click', handleManualRefresh);
                clearButton.addEventListener('click', clearAllLogs);
                autoRefreshToggle.addEventListener('change', toggleAutoRefresh);
                
                // Initial fetch
                fetchLogs();
                
                // Start auto-refresh
                startAutoRefresh();
            });
            
            // Auto-refresh logic
            function startAutoRefresh() {
                // Clear any existing interval
                if (refreshInterval) {
                    clearInterval(refreshInterval);
                }
                
                // Set new interval (every 2 seconds)
                refreshInterval = setInterval(() => {
                    if (autoRefreshEnabled) {
                        fetchLogs(true);
                    }
                }, 2000);
            }
            
            // Toggle auto-refresh state
            function toggleAutoRefresh() {
                autoRefreshEnabled = autoRefreshToggle.checked;
                
                if (autoRefreshEnabled) {
                    fetchLogs(); // Immediate refresh when enabled
                }
            }
            
            // Manual refresh handler
            function handleManualRefresh() {
                refreshButton.disabled = true;
                refreshButton.textContent = 'Refreshing...';
                
                fetchLogs()
                    .finally(() => {
                        setTimeout(() => {
                            refreshButton.disabled = false;
                            refreshButton.textContent = 'Refresh Now';
                        }, 300);
                    });
            }
            
            // Clear all logs
            function clearAllLogs() {
                clearButton.disabled = true;
                
                fetch('/api/logs/clear', { 
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to clear logs');
                    }
                    return response.json();
                })
                .then(() => {
                    lastLogCount = 0;
                    fetchLogs();
                })
                .catch(error => {
                    console.error('Error clearing logs:', error);
                })
                .finally(() => {
                    clearButton.disabled = false;
                });
            }
            
            // Fetch logs from server
            function fetchLogs(isAutoRefresh = false) {
                // Add cache-busting parameter to prevent caching
                const cacheBuster = `?_=${Date.now()}`;
                
                return fetch(`/api/logs${cacheBuster}`)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Network error: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(data => {
                        // Check if we have new data before updating
                        const hasNewLogs = data.length !== lastLogCount;
                        lastLogCount = data.length;
                        
                        // Update logs display if there are changes or first load
                        if (hasNewLogs || isFirstLoad) {
                            updateLogDisplay(data);
                            isFirstLoad = false;
                        }
                        
                        // Update timestamp
                        updateLastUpdatedTime();
                        
                        // Scroll to bottom for new logs (only if auto-refresh and new logs)
                        if (hasNewLogs && autoRefreshEnabled && !isFirstLoad) {
                            logsContainer.scrollTop = logsContainer.scrollHeight;
                        }
                        
                        return data;
                    })
                    .catch(error => {
                        console.error('Error fetching logs:', error);
                    });
            }
            
            // Update the log display with data
            function updateLogDisplay(logs) {
                // Update log count
                logCountElement.textContent = `${logs.length} entries`;
                
                // Show/hide empty message
                if (logs.length === 0) {
                    emptyLogsMessage.style.display = 'block';
                    logsContainer.innerHTML = '';
                    return;
                } else {
                    emptyLogsMessage.style.display = 'none';
                }
                
                // Build HTML for logs
                let logContent = '';
                
                logs.forEach(log => {
                    const directionClass = log.direction === 'incoming' ? 'incoming' : 
                                        (log.message_type === 'error' ? 'error' : 'outgoing');
                    
                    // Format content as JSON with indentation
                    let formattedContent;
                    if (typeof log.content === 'object') {
                        try {
                            formattedContent = JSON.stringify(log.content, null, 2);
                        } catch (e) {
                            formattedContent = 'Error displaying content: ' + e.message;
                        }
                    } else {
                        formattedContent = log.content || '';
                    }
                    
                    logContent += `
                        <div class="log-entry ${directionClass}">
                            <div class="log-time">${log.timestamp}</div>
                            <div class="log-emoticon">${log.emoticon}</div>
                            <div class="log-content">
                                <div class="log-type">
                                    <span>${log.direction.toUpperCase()}: ${log.message_type}</span>
                                </div>
                                <pre class="log-message">${formattedContent}</pre>
                            </div>
                        </div>
                    `;
                });
                
                // Update the container
                logsContainer.innerHTML = logContent;
            }
            
            // Update the "last updated" timestamp
            function updateLastUpdatedTime() {
                const now = new Date();
                const hours = now.getHours().toString().padStart(2, '0');
                const minutes = now.getMinutes().toString().padStart(2, '0');
                const seconds = now.getSeconds().toString().padStart(2, '0');
                lastUpdatedElement.textContent = `Last updated: ${hours}:${minutes}:${seconds}`;
            }
        </script>
    </body>
    </html>
    """
    return html
