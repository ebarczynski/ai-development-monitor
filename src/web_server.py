#!/usr/bin/env python
"""
Web Interface Server for AI Development Monitor

This module provides a web interface for monitoring MCP communication logs
on a separate port from the main MCP server to avoid protocol interference.
"""
import os
import asyncio
import uvicorn
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

# Handle imports properly whether running from root or src directory
import sys
from web_interface import get_html_interface, add_to_logs, communication_logs, load_logs_from_file

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app for web interface
app = FastAPI(title="AI Development Monitor - Web Interface")

@app.get("/", response_class=HTMLResponse)
async def get_root(request: Request):
    """Return the HTML web interface"""
    return HTMLResponse(content=get_html_interface())

@app.get("/api/logs")
async def get_logs():
    """Return the communication logs"""
    return JSONResponse(content=communication_logs)

@app.post("/api/logs/clear")
async def clear_logs():
    """Clear all communication logs"""
    global communication_logs
    communication_logs.clear()
    # Save the empty logs to file to ensure MCP server sees the change
    from web_interface import save_logs_to_file
    save_logs_to_file()
    return JSONResponse(content={"message": "Logs cleared"})

@app.get("/status")
async def status():
    """Status endpoint"""
    return {
        "status": "running",
        "log_count": len(communication_logs)
    }

@app.get("/api/reload")
async def reload_logs():
    """Reload logs from file"""
    load_logs_from_file()
    return JSONResponse(content={"message": "Logs reloaded", "count": len(communication_logs)})

def run_server(host: str = '0.0.0.0', port: int = 5002):
    """Run the web interface server"""
    # Load existing logs from file
    logger.info("Loading existing communication logs")
    load_logs_from_file()
    
    logger.info(f"Starting web interface server on {host}:{port}")
    logger.info(f"Web interface will be available at http://{host}:{port}")
    logger.info(f"Loaded {len(communication_logs)} existing log entries")
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    run_server()
