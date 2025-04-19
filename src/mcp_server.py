"""
MCP Server for AI Development Monitor

This module implements a Model Context Protocol server that allows structured
communication between GitHub Copilot and the AI Development Monitor Agent.
"""
import os
import json
import logging
import asyncio
from typing import Dict, List, Any, Optional, Union
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn
from pydantic import BaseModel, Field

# Add the src directory to the path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.monitor_agent import DevelopmentMonitorAgent
from src.web_interface import add_to_logs, setup_web_interface, get_html_interface

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global agent instance
agent = None

# FastAPI app
app = FastAPI(title="AI Development Monitor MCP Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connections
active_connections: Dict[str, WebSocket] = {}

# MCP Message Models
class MCPContext(BaseModel):
    """Context information for MCP messages"""
    conversation_id: str = Field(..., description="Unique identifier for the conversation")
    message_id: str = Field(..., description="Unique identifier for the message")
    parent_id: Optional[str] = Field(None, description="ID of the parent message this is responding to")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class MCPSuggestion(BaseModel):
    """A code suggestion from GitHub Copilot"""
    original_code: str = Field(..., description="The original code before changes")
    proposed_changes: str = Field(..., description="The proposed code changes")
    file_path: Optional[str] = Field(None, description="The file path for the changes")
    language: Optional[str] = Field(None, description="The programming language")
    task_description: Optional[str] = Field(None, description="Description of the task being performed")

class MCPEvaluation(BaseModel):
    """An evaluation of a code suggestion"""
    accept: bool = Field(..., description="Whether to accept the suggestion")
    hallucination_risk: float = Field(..., description="Risk of hallucination (0-1)")
    recursive_risk: float = Field(..., description="Risk of recursive behavior (0-1)")
    alignment_score: float = Field(..., description="Alignment with task (0-1)")
    issues_detected: List[str] = Field(default_factory=list, description="List of issues detected")
    recommendations: List[str] = Field(default_factory=list, description="List of recommendations")
    reason: str = Field(..., description="Reason for the evaluation result")

class MCPContinueRequest(BaseModel):
    """A request to continue generation"""
    prompt: str = Field(..., description="The prompt to continue with")
    timeout_occurred: bool = Field(False, description="Whether a timeout occurred")
    error_message: Optional[str] = Field(None, description="Error message if applicable")

class MCPMessage(BaseModel):
    """Base MCP message structure"""
    context: MCPContext
    message_type: str = Field(..., description="Type of message (suggestion, evaluation, continue, etc)")
    content: Union[MCPSuggestion, MCPEvaluation, MCPContinueRequest, Dict[str, Any]] = Field(
        ..., description="The message content, varies by message_type"
    )


@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "AI Development Monitor MCP Server", 
            "note": "For the web interface with communication logs, please visit http://localhost:5002"}

@app.get("/api/simple")
async def simple_status():
    """Simple status endpoint for API checks"""
    return {"message": "AI Development Monitor MCP Server"}

@app.get("/status")
async def status():
    """Status endpoint"""
    global agent
    
    return {
        "status": "running",
        "agent_connected": agent is not None and agent.llm_client is not None,
        "active_connections": len(active_connections)
    }

@app.post("/connect")
async def connect_llm():
    """Connect to the LLM"""
    global agent
    
    # Initialize agent if not already done
    if agent is None:
        agent = DevelopmentMonitorAgent('config.json')
    
    # Connect to LLM
    success = agent.connect_llm()
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to connect to LLM")
    
    return {"success": True}

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for MCP communication"""
    global agent, active_connections
    
    await websocket.accept()
    active_connections[client_id] = websocket
    logger.info(f"WebSocket connection established with client: {client_id}")
    
    # Initialize agent if not already done
    if agent is None:
        agent = DevelopmentMonitorAgent('config.json')
        
        # Connect to LLM
        if not agent.connect_llm():
            error_msg = {"error": "Failed to connect to LLM", "message_type": "error"}
            # Log outgoing error message
            add_to_logs("outgoing", "error", error_msg)
            await websocket.send_text(json.dumps(error_msg))
            await websocket.close()
            return
    
    try:
        # Handle messages
        while True:
            # Receive message
            data = await websocket.receive_text()
            logger.info(f"Received message from client {client_id}")
            
            try:
                # Parse message
                message_data = json.loads(data)
                message = MCPMessage(**message_data)
                
                # Log incoming message
                add_to_logs("incoming", message.message_type, message_data)
                
                # Process message based on type
                if message.message_type == "suggestion":
                    await handle_suggestion(message, websocket)
                elif message.message_type == "continue":
                    await handle_continue(message, websocket)
                else:
                    error_msg = {
                        "error": f"Unsupported message type: {message.message_type}",
                        "message_type": "error",
                        "context": message.context.dict()
                    }
                    # Log outgoing error message
                    add_to_logs("outgoing", "error", error_msg)
                    await websocket.send_text(json.dumps(error_msg))
            
            except json.JSONDecodeError:
                error_msg = {"error": "Invalid JSON message", "message_type": "error"}
                # Log outgoing error message
                add_to_logs("outgoing", "error", error_msg)
                await websocket.send_text(json.dumps(error_msg))
            
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                error_msg = {"error": f"Error processing message: {str(e)}", "message_type": "error"}
                # Log outgoing error message
                add_to_logs("outgoing", "error", error_msg)
                await websocket.send_text(json.dumps(error_msg))
    
    except WebSocketDisconnect:
        # Remove connection when client disconnects
        if client_id in active_connections:
            del active_connections[client_id]
        logger.info(f"WebSocket connection closed with client: {client_id}")

async def handle_suggestion(message: MCPMessage, websocket: WebSocket):
    """Handle a suggestion message"""
    global agent
    
    # Extract suggestion data
    suggestion = message.content
    
    # Check if content is a dict or a Pydantic model
    if hasattr(suggestion, "__dict__"):
        # It's a Pydantic model
        suggestion_dict = suggestion.dict() if hasattr(suggestion, "dict") else suggestion.__dict__
        original_code = suggestion_dict.get("original_code", "")
        proposed_changes = suggestion_dict.get("proposed_changes", "")
        task_description = suggestion_dict.get("task_description", "Implement functionality")
    else:
        # It's a dict
        original_code = suggestion.get("original_code", "")
        proposed_changes = suggestion.get("proposed_changes", "")
        task_description = suggestion.get("task_description", "Implement functionality")
    
    # Evaluate the changes
    accept, evaluation = agent.evaluate_proposed_changes(
        original_code, 
        proposed_changes, 
        task_description
    )
    
    # Prepare response
    analysis = evaluation.get("analysis", {})
    response = {
        "message_type": "evaluation",
        "context": message.context.dict(),
        "content": {
            "accept": accept,
            "hallucination_risk": analysis.get("hallucination_risk", 0.5),
            "recursive_risk": analysis.get("recursive_risk", 0.5),
            "alignment_score": analysis.get("alignment_score", 0.5),
            "issues_detected": analysis.get("issues_detected", []),
            "recommendations": analysis.get("recommendations", []),
            "reason": evaluation.get("reason", "Automated evaluation")
        }
    }
    
    # Log outgoing evaluation
    add_to_logs("outgoing", "evaluation", response["content"])
    
    # Send response
    await websocket.send_text(json.dumps(response))

async def handle_continue(message: MCPMessage, websocket: WebSocket):
    """Handle a continue message"""
    global agent
    
    # Extract continue data
    continue_request = message.content
    
    # Check if content is a dict or a Pydantic model
    if hasattr(continue_request, "__dict__"):
        # It's a Pydantic model
        continue_dict = continue_request.dict() if hasattr(continue_request, "dict") else continue_request.__dict__
        prompt = continue_dict.get("prompt", "Continue")
    else:
        # It's a dict
        prompt = continue_request.get("prompt", "Continue")
    
    # Send to LLM for continuation
    llm_response = agent.send_prompt_to_llm(prompt)
    
    # Prepare response
    response = {
        "message_type": "continuation",
        "context": message.context.dict(),
        "content": {
            "response": llm_response.get("response", ""),
            "success": llm_response.get("success", False),
            "model": llm_response.get("model", "")
        }
    }
    
    # Log outgoing continuation
    add_to_logs("outgoing", "continuation", response["content"])
    
    # Send response
    await websocket.send_text(json.dumps(response))

@app.post("/mcp/message")
async def handle_http_message(message: Dict[str, Any] = Body(...)):
    """HTTP endpoint for MCP messages (for clients that can't use WebSockets)"""
    global agent
    
    # Initialize agent if not already done
    if agent is None:
        agent = DevelopmentMonitorAgent('config.json')
        
        # Connect to LLM
        if not agent.connect_llm():
            raise HTTPException(status_code=500, detail="Failed to connect to LLM")
    
    try:
        # Parse message
        mcp_message = MCPMessage(**message)
        
        # Process message based on type
        if mcp_message.message_type == "suggestion":
            # Extract suggestion data
            suggestion = mcp_message.content
            
            # Check if content is a dict or a Pydantic model
            if hasattr(suggestion, "__dict__"):
                # It's a Pydantic model
                suggestion_dict = suggestion.dict() if hasattr(suggestion, "dict") else suggestion.__dict__
                original_code = suggestion_dict.get("original_code", "")
                proposed_changes = suggestion_dict.get("proposed_changes", "")
                task_description = suggestion_dict.get("task_description", "Implement functionality")
            else:
                # It's a dict
                original_code = suggestion.get("original_code", "")
                proposed_changes = suggestion.get("proposed_changes", "")
                task_description = suggestion.get("task_description", "Implement functionality")
            
            # Evaluate the changes
            accept, evaluation = agent.evaluate_proposed_changes(
                original_code, 
                proposed_changes, 
                task_description
            )
            
            # Prepare response
            analysis = evaluation.get("analysis", {})
            return {
                "message_type": "evaluation",
                "context": mcp_message.context,
                "content": {
                    "accept": accept,
                    "hallucination_risk": analysis.get("hallucination_risk", 0.5),
                    "recursive_risk": analysis.get("recursive_risk", 0.5),
                    "alignment_score": analysis.get("alignment_score", 0.5),
                    "issues_detected": analysis.get("issues_detected", []),
                    "recommendations": analysis.get("recommendations", []),
                    "reason": evaluation.get("reason", "Automated evaluation")
                }
            }
        
        elif mcp_message.message_type == "continue":
            # Extract continue data
            continue_request = mcp_message.content
            prompt = continue_request.get("prompt", "Continue")
            
            # Send to LLM for continuation
            llm_response = agent.send_prompt_to_llm(prompt)
            
            # Prepare response
            return {
                "message_type": "continuation",
                "context": mcp_message.context,
                "content": {
                    "response": llm_response.get("response", ""),
                    "success": llm_response.get("success", False),
                    "model": llm_response.get("model", "")
                }
            }
        
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported message type: {mcp_message.message_type}"
            )
    
    except Exception as e:
        logger.error(f"Error processing HTTP message: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def run_server(host: str = '0.0.0.0', port: int = 5001):
    """Run the MCP server"""
    global agent
    
    # Initialize the agent
    logger.info("Initializing AI Development Monitor Agent...")
    agent = DevelopmentMonitorAgent('config.json')
    
    # Connect to the LLM
    logger.info("Connecting to LLM...")
    if agent.connect_llm():
        logger.info("Successfully connected to LLM")
    else:
        logger.warning("Failed to connect to LLM. Will attempt connection when requested via API")
    
    # Set up web interface
    setup_web_interface(app)
    
    # Start the server
    logger.info(f"Starting MCP server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    run_server()
