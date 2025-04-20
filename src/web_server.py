#!/usr/bin/env python
"""
Web Interface Server for AI Development Monitor

A simplified, reliable web server that provides real-time access to MCP communication logs.
This server runs on a separate port from the main MCP server to avoid protocol interference.
"""
import os
import sys
import logging
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Ensure we can import from the current directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.web_interface import (
    get_html_interface, 
    communication_logs, 
    load_logs_from_file, 
    clear_logs
)

# Initialize FastAPI app
app = FastAPI(
    title="MCP Server - Real-time Logs",
    description="Web interface for monitoring MCP communication in real-time",
    version="1.0.0"
)

# Add CORS middleware to allow requests from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_class=HTMLResponse)
async def get_root(request: Request):
    """Return the HTML web interface"""
    return HTMLResponse(content=get_html_interface())

@app.get("/api/logs")
async def get_logs():
    """
    Return the communication logs
    
    Loads fresh logs from file each time to ensure real-time updates
    """
    # Always load fresh logs from file to ensure we have the latest data
    load_logs_from_file()
    
    # Return the logs as JSON
    return JSONResponse(content=communication_logs())

@app.post("/api/logs/clear")
async def clear_all_logs():
    """Clear all communication logs"""
    clear_logs()
    return JSONResponse(content={"status": "success", "message": "Logs cleared"})

@app.get("/api/status")
async def get_status():
    """Status endpoint with basic server information"""
    return {
        "status": "running",
        "log_count": len(communication_logs()),
        "server": "MCP Web Interface"
    }

def run_server(host: str = "0.0.0.0", port: int = 5002):
    """
    Run the web interface server
    
    Args:
        host: Host to bind the server to (default: 0.0.0.0 - all interfaces)
        port: Port to run the server on (default: 5002)
    """
    # Load existing logs from file on startup
    logger.info("Loading existing communication logs")
    load_logs_from_file()
    
    # Log startup information
    log_count = len(communication_logs())
    logger.info(f"Starting web interface server on {host}:{port}")
    logger.info(f"Web interface will be available at http://localhost:{port}")
    logger.info(f"Loaded {log_count} existing log entries")
    
    # Run the server with Uvicorn
    uvicorn.run(
        app, 
        host=host, 
        port=port,
        log_level="info"
    )

if __name__ == "__main__":
    # Start the server if this script is run directly
    run_server()
