"""
Web interface for MCP Server with communication logs

This module provides a web interface that shows incoming and outgoing MCP messages
with color-coding and emoticons.
"""
import os
import json
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Use a class to manage logs instead of global variables
class LogManager:
    def __init__(self):
        self.logs = []
        self.max_logs = 100
        self.log_file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mcp_logs.json")
        # Load logs on initialization
        self.load_logs_from_file()
    
    def save_logs_to_file(self):
        """Save communication logs to a file for sharing between servers"""
        try:
            with open(self.log_file_path, 'w') as f:
                json.dump(self.logs, f)
        except Exception as e:
            print(f"Error saving logs to file: {e}")
    
    def load_logs_from_file(self):
        """Load communication logs from file"""
        try:
            if os.path.exists(self.log_file_path):
                print(f"Found log file at {self.log_file_path}")
                with open(self.log_file_path, 'r') as f:
                    loaded_logs = json.load(f)
                    print(f"Loaded {len(loaded_logs)} logs from file")
                    if isinstance(loaded_logs, list):
                        self.logs = loaded_logs
                        print(f"Updated logs, now has {len(self.logs)} entries")
                    else:
                        print(f"Loaded data is not a list: {type(loaded_logs)}")
            else:
                print(f"Log file not found at {self.log_file_path}")
        except Exception as e:
            print(f"Error loading logs from file: {e}")
    
    def add_to_logs(self, direction: str, message_type: str, content: Any):
        """Add a message to the communication logs"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        
        # Determine emoticon based on message type and direction
        emoticon = "📝"  # Default
        if direction == "incoming":
            if message_type == "suggestion":
                emoticon = "💡"  # Incoming suggestion
            elif message_type == "continue":
                emoticon = "⏩"  # Continue request
            else:
                emoticon = "📥"  # Other incoming
        else:  # outgoing
            if message_type == "evaluation":
                if content.get("accept", False):
                    emoticon = "✅"  # Accepted evaluation
                else:
                    emoticon = "❌"  # Rejected evaluation
            elif message_type == "continuation":
                emoticon = "🔄"  # Continuation response
            elif message_type == "error":
                emoticon = "⚠️"  # Error response
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
        
        # Add to logs with limit
        self.logs.append(log_entry)
        if len(self.logs) > self.max_logs:
            self.logs.pop(0)  # Remove oldest entry
        
        # Save logs to file for sharing between servers
        self.save_logs_to_file()
    
    def get_logs(self):
        """Return all logs"""
        return self.logs
    
    def clear_logs(self):
        """Clear all logs"""
        self.logs = []
        self.save_logs_to_file()

# Create a single instance of the log manager
log_manager = LogManager()

# Keep these for backwards compatibility
def save_logs_to_file():
    log_manager.save_logs_to_file()

def load_logs_from_file():
    log_manager.load_logs_from_file()

def add_to_logs(direction: str, message_type: str, content: Any):
    log_manager.add_to_logs(direction, message_type, content)

# Make communication_logs a function instead of a property for compatibility
def communication_logs():
    return log_manager.get_logs()

def get_html_interface():
    """Generate HTML for the MCP server web interface"""
    html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI Development Monitor - MCP Server</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
                padding: 20px;
                border-radius: 5px;
                margin-bottom: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            h1 {
                margin: 0;
            }
            .status {
                font-size: 0.9em;
                background-color: rgba(255, 255, 255, 0.2);
                padding: 5px 10px;
                border-radius: 15px;
            }
            .status-dot {
                display: inline-block;
                width: 10px;
                height: 10px;
                background-color: #4CAF50;
                border-radius: 50%;
                margin-right: 5px;
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
            .log-body {
                padding: 0;
                max-height: 600px;
                overflow-y: auto;
            }
            .log-entry {
                padding: 15px 20px;
                border-bottom: 1px solid #eee;
                display: flex;
                transition: background-color 0.2s;
            }
            .log-entry:hover {
                background-color: #f9f9f9;
            }
            .log-entry:last-child {
                border-bottom: none;
            }
            .log-time {
                color: #666;
                font-size: 0.8em;
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
            }
            .log-type {
                font-weight: bold;
                margin-bottom: 5px;
            }
            .log-message {
                font-family: 'Courier New', monospace;
                white-space: pre-wrap;
                background-color: #f8f8f8;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                font-size: 0.9em;
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
            .controls {
                margin-bottom: 20px;
                display: flex;
                gap: 10px;
            }
            button {
                background-color: #1e88e5;
                color: white;
                border: none;
                padding: 10px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.2s;
            }
            button:hover {
                background-color: #1976d2;
            }
            footer {
                text-align: center;
                margin-top: 30px;
                color: #666;
                font-size: 0.9em;
            }
            .empty-logs {
                text-align: center;
                padding: 40px;
                color: #666;
            }
            @media (max-width: 768px) {
                .log-entry {
                    flex-direction: column;
                }
                .log-time {
                    width: 100%;
                    margin-bottom: 5px;
                }
            }
        </style>
    </head>
    <body>
        <header>
            <h1>AI Development Monitor - MCP Server</h1>
            <div class="status"><span class="status-dot"></span> Running</div>
        </header>
        
        <div class="controls">
            <button onclick="refreshLogs()">Refresh Logs</button>
            <button onclick="clearLogs()">Clear Logs</button>
            <button onclick="reloadLogsFromFile()">Reload from File</button>
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
            Model Context Protocol (MCP) Server - AI Development Monitor - &copy; 2025
        </footer>
        
        <script>
            // Fetch logs on page load
            document.addEventListener('DOMContentLoaded', fetchLogs);
            
            // Set up auto-refresh every 5 seconds
            setInterval(fetchLogs, 5000);
            
            function fetchLogs() {
                fetch('/api/logs')
                    .then(response => response.json())
                    .then(data => {
                        updateLogs(data);
                    })
                    .catch(error => console.error('Error fetching logs:', error));
            }
            
            function updateLogs(logs) {
                const logsContainer = document.getElementById('logs');
                const emptyLogsMessage = document.getElementById('empty-logs');
                const logCountElement = document.getElementById('log-count');
                
                // Update log count
                logCountElement.textContent = `${logs.length} entries`;
                
                // Check if we have logs
                if (logs.length === 0) {
                    emptyLogsMessage.style.display = 'block';
                    return;
                }
                
                // Hide empty message
                emptyLogsMessage.style.display = 'none';
                
                // Clear existing logs
                let logContent = '';
                
                // Generate log entries
                logs.forEach(log => {
                    const directionClass = log.direction === 'incoming' ? 'incoming' : 
                                        (log.message_type === 'error' ? 'error' : 'outgoing');
                    
                    const content = typeof log.content === 'object' ? 
                        JSON.stringify(log.content, null, 2) : log.content;
                    
                    logContent += `
                        <div class="log-entry ${directionClass}">
                            <div class="log-time">${log.timestamp}</div>
                            <div class="log-emoticon">${log.emoticon}</div>
                            <div class="log-content">
                                <div class="log-type">${log.direction.toUpperCase()}: ${log.message_type}</div>
                                <div class="log-message">${content}</div>
                            </div>
                        </div>
                    `;
                });
                
                logsContainer.innerHTML = logContent;
            }
            
            function refreshLogs() {
                fetchLogs();
            }
            
            function clearLogs() {
                fetch('/api/logs/clear', { method: 'POST' })
                    .then(() => fetchLogs())
                    .catch(error => console.error('Error clearing logs:', error));
            }
            
            function reloadLogsFromFile() {
                fetch('/api/reload', { method: 'GET' })
                    .then(response => response.json())
                    .then(data => {
                        console.log('Logs reloaded:', data);
                        fetchLogs();
                    })
                    .catch(error => console.error('Error reloading logs:', error));
            }
        </script>
    </body>
    </html>
    """
    return html

def setup_web_interface(app: FastAPI):
    """Set up the web interface routes for the MCP server"""
    
    @app.get("/", response_class=HTMLResponse)
    async def get_root(request: Request):
        """Return the HTML web interface"""
        return HTMLResponse(content=get_html_interface())
    
    @app.get("/api/logs")
    async def get_logs():
        """Return the communication logs"""
        return JSONResponse(content=log_manager.get_logs())
    
    @app.post("/api/logs/clear")
    async def clear_logs():
        """Clear all communication logs"""
        log_manager.clear_logs()
        return JSONResponse(content={"message": "Logs cleared"})
    
    @app.get("/api/reload")
    async def reload_logs():
        """Reload logs from file"""
        log_manager.load_logs_from_file()
        return JSONResponse(content={"message": "Logs reloaded", "count": len(log_manager.get_logs())})
