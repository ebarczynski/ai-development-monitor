# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

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
from src.web_interface import add_to_logs, get_html_interface
from src.tdd_helpers import handle_tdd_request, create_tdd_test_prompt, cleanup_generated_tests, set_agent
from src.tdd_evaluator import evaluate_tdd_results, combine_evaluation_results

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import agent conditionally to avoid circular imports
try:
    from src.monitor_agent import DevelopmentMonitorAgent
    agent = None  # Will be set by the MCP server
except ImportError:
    agent = None

# FastAPI app

import time
from collections import deque, defaultdict

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

# Track active connections and per-client request queues
active_connections: Dict[str, WebSocket] = {}
client_request_queues = defaultdict(deque)  # client_id -> deque of (timestamp, data)
client_processing_flags = defaultdict(lambda: False)  # client_id -> bool
client_last_backoff = defaultdict(lambda: 1.0)  # client_id -> last backoff in seconds

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

class MCPTDDRequest(BaseModel):
    """A request to generate tests for TDD"""
    code: str = Field(..., description="The code to test")
    language: str = Field(..., description="The programming language")
    iteration: int = Field(..., description="The current TDD iteration number")

class MCPMessage(BaseModel):
    """Base MCP message structure"""
    context: MCPContext
    message_type: str = Field(..., description="Type of message (suggestion, evaluation, continue, etc)")
    content: Union[MCPSuggestion, MCPEvaluation, MCPContinueRequest, MCPTDDRequest, Dict[str, Any]] = Field(
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
    """WebSocket endpoint for MCP communication with queuing and granular logging"""
    global agent, active_connections, client_request_queues, client_processing_flags, client_last_backoff

    await websocket.accept()
    active_connections[client_id] = websocket
    logger.info(f"[CONNECT] WebSocket connection established with client: {client_id} at {time.strftime('%Y-%m-%d %H:%M:%S')} | Active connections: {len(active_connections)}")

    # Initialize agent if not already done
    if agent is None:
        agent = DevelopmentMonitorAgent('config.json')
        if not agent.connect_llm():
            error_msg = {"error": "Failed to connect to LLM", "message_type": "error"}
            add_to_logs("outgoing", "error", error_msg)
            await websocket.send_text(json.dumps(error_msg))
            await websocket.close()
            logger.info(f"[DISCONNECT] Client {client_id} closed due to LLM connection failure at {time.strftime('%Y-%m-%d %H:%M:%S')}")
            if client_id in active_connections:
                del active_connections[client_id]
            return

    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"[RECEIVE] Message from client {client_id} at {time.strftime('%Y-%m-%d %H:%M:%S')} | Queue length: {len(client_request_queues[client_id])}")
            # Enqueue the request
            client_request_queues[client_id].append((time.time(), data))
            # Start processing if not already
            if not client_processing_flags[client_id]:
                asyncio.create_task(process_client_queue(client_id))
    except WebSocketDisconnect:
        if client_id in active_connections:
            del active_connections[client_id]
        logger.info(f"[DISCONNECT] WebSocket connection closed with client: {client_id} at {time.strftime('%Y-%m-%d %H:%M:%S')} | Active connections: {len(active_connections)}")
    except Exception as e:
        logger.error(f"[ERROR] Exception in websocket_endpoint for client {client_id}: {e}")
        if client_id in active_connections:
            del active_connections[client_id]
        logger.info(f"[DISCONNECT] WebSocket connection forcibly closed for client: {client_id} at {time.strftime('%Y-%m-%d %H:%M:%S')} | Active connections: {len(active_connections)}")


# Exponential backoff parameters
MIN_BACKOFF = 1.0  # seconds
MAX_BACKOFF = 30.0  # seconds
BACKOFF_MULTIPLIER = 2.0

async def process_client_queue(client_id):
    global client_processing_flags, client_request_queues, client_last_backoff, active_connections
    client_processing_flags[client_id] = True
    websocket = active_connections.get(client_id)
    while client_request_queues[client_id]:
        timestamp, data = client_request_queues[client_id].popleft()
        # Directly process the message (no LLM health check)
        client_last_backoff[client_id] = MIN_BACKOFF  # Always reset backoff
        try:
            message_data = json.loads(data)
            # If message_data is a list, process each message in the batch
            if isinstance(message_data, list):
                for single_message_data in message_data:
                    await process_single_message(single_message_data, client_id, websocket)
            else:
                await process_single_message(message_data, client_id, websocket)
        except Exception as e:
            logger.error(f"[ERROR] Failed to process message for client {client_id}: {e}")
    client_processing_flags[client_id] = False

async def process_single_message(message_data, client_id, websocket):
    try:
        message = MCPMessage(**message_data)
        add_to_logs("incoming", message.message_type, message_data)
        if message.message_type == "suggestion":
            await handle_suggestion(message, websocket)
        elif message.message_type == "continue":
            await handle_continue(message, websocket)
        elif message.message_type == "tdd_request":
            await handle_tdd_request(message, websocket)
        else:
            error_msg = {
                "error": f"Unsupported message type: {message.message_type}",
                "message_type": "error",
                "context": message.context.model_dump() if hasattr(message.context, "model_dump") else message.context.dict()
            }
            add_to_logs("outgoing", "error", error_msg)
            try:
                await websocket.send_text(json.dumps(error_msg))
            except Exception as e:
                logger.error(f"Failed to send error message on WebSocket: {e}")
    except Exception as e:
        logger.error(f"[ERROR] Exception in process_single_message for client {client_id}: {e}")

async def handle_suggestion(message: MCPMessage, websocket: WebSocket):
    """Handle a suggestion message"""
    global agent        # Extract suggestion data
    suggestion = message.content
    
    # Check if content is a dict or a Pydantic model
    if hasattr(suggestion, "__dict__"):
        # It's a Pydantic model
        suggestion_dict = suggestion.model_dump() if hasattr(suggestion, "model_dump") else (
            suggestion.dict() if hasattr(suggestion, "dict") else suggestion.__dict__
        )
        original_code = suggestion_dict.get("original_code", "")
        proposed_changes = suggestion_dict.get("proposed_changes", "")
        task_description = suggestion_dict.get("task_description", "")
        language = suggestion_dict.get("language", "python")
    else:
        # It's a dict
        original_code = suggestion.get("original_code", "")
        proposed_changes = suggestion.get("proposed_changes", "")
        task_description = suggestion.get("task_description", "")
        language = suggestion.get("language", "python")
        
    # If task_description is empty, try to get it from context metadata
    if not task_description and hasattr(message.context, "metadata") and message.context.metadata:
        if isinstance(message.context.metadata, dict):
            task_description = message.context.metadata.get("task_description", "")
            
    # Only use default if we still have no task description
    if not task_description:
        task_description = "Unknown task"
    
    # Check if TDD testing is requested in metadata
    run_tdd = True
    max_iterations = 5
    
    if hasattr(message.context, "metadata") and message.context.metadata:
        if isinstance(message.context.metadata, dict):
            run_tdd = message.context.metadata.get("run_tdd", run_tdd)
            max_iterations = message.context.metadata.get("max_iterations", max_iterations)
    
    # First get the LLM's evaluation
    accept, llm_evaluation = agent.evaluate_proposed_changes(
        original_code, 
        proposed_changes, 
        task_description
    )
    
    # Initialize TDD evaluation results
    tdd_evaluation = {
        "tdd_score": 0.5,
        "issues_detected": [],
        "recommendations": [],
        "accept": None
    }
    
    # Run TDD tests if requested
    tdd_test_results = []
    if run_tdd:
        try:
            # Log TDD process beginning
            logger.info(f"Starting TDD evaluation with {max_iterations} iterations")
            add_to_logs("outgoing", "info", {"message": f"Starting TDD evaluation with {max_iterations} iterations"})
            
            # Run TDD tests for each iteration
            for iteration in range(1, max_iterations + 1):
                # Create a TDD request for this iteration
                tdd_request_context = MCPContext(
                    conversation_id=message.context.conversation_id,
                    message_id=f"{message.context.message_id}_tdd_{iteration}",
                    parent_id=message.context.message_id,
                    metadata={
                        "tdd_iteration": iteration,
                        "max_iterations": max_iterations,
                        "task_description": task_description,
                        "original_code": original_code
                    }
                )
                
                tdd_request_content = {
                    "code": proposed_changes,
                    "language": language,
                    "iteration": iteration,
                    "task_description": task_description,
                    "original_code": original_code,
                    "max_iterations": max_iterations
                }
                
                tdd_request = MCPMessage(
                    context=tdd_request_context,
                    message_type="tdd_request",
                    content=tdd_request_content
                )
                
                # Log the TDD request
                add_to_logs("outgoing", "tdd_request", {
                    "iteration": iteration,
                    "language": language,
                    "max_iterations": max_iterations
                })
                
                # Process the TDD request and get tests
                tdd_response = await process_tdd_request(tdd_request, proposed_changes, language)
                
                if tdd_response:
                    tdd_test_results.append(tdd_response)
            
            # Evaluate TDD results
            if tdd_test_results:
                tdd_evaluation = evaluate_tdd_results(tdd_test_results, proposed_changes, task_description)
                logger.info(f"TDD evaluation complete. Score: {tdd_evaluation.get('tdd_score', 0.5)}, Accept: {tdd_evaluation.get('accept', None)}")
        
        except Exception as e:
            logger.error(f"Error during TDD evaluation: {e}")
            add_to_logs("outgoing", "error", {"message": f"TDD evaluation error: {str(e)}"})
    
    # Combine LLM and TDD evaluations for final decision
    final_accept, final_evaluation = combine_evaluation_results(tdd_evaluation, llm_evaluation)
    
    # Prepare response
    analysis = final_evaluation.get("analysis", {})
    response = {
        "message_type": "evaluation",
        "context": message.context.model_dump() if hasattr(message.context, "model_dump") else message.context.dict(),
        "content": {
            "accept": final_accept,
            "hallucination_risk": analysis.get("hallucination_risk", 0.5),
            "recursive_risk": analysis.get("recursive_risk", 0.5),
            "alignment_score": analysis.get("alignment_score", 0.5),
            "tdd_score": analysis.get("tdd_score", 0.5),
            "issues_detected": analysis.get("issues_detected", []),
            "recommendations": analysis.get("recommendations", []),
            "reason": final_evaluation.get("reason", "Combined TDD and LLM evaluation"),
            "tdd_test_results": tdd_test_results if run_tdd else []
        }
    }
    
    # Log outgoing evaluation
    add_to_logs("outgoing", "evaluation", response["content"])
    
    # Send response
    await websocket.send_text(json.dumps(response))

async def process_tdd_request(tdd_request, code, language):
    """Process a TDD request and return the test results"""
    try:
        # Create a virtual websocket to handle the response
        class VirtualWebSocket:
            async def send_text(self, text):
                self.response = json.loads(text)
        
        virtual_ws = VirtualWebSocket()
        
        # Process the TDD request
        await handle_tdd_request(tdd_request, virtual_ws)
        
        # Return the test result
        if hasattr(virtual_ws, 'response'):
            return virtual_ws.response.get('content', {})
        
        return None
    
    except Exception as e:
        logger.error(f"Error processing TDD request: {e}")
        return None

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
        "context": message.context.model_dump() if hasattr(message.context, "model_dump") else message.context.dict(),
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
    
    # Set the agent in the TDD helpers
    set_agent(agent)
    
    # Connect to the LLM
    logger.info("Connecting to LLM...")
    if agent.connect_llm():
        logger.info("Successfully connected to LLM")
    else:
        logger.warning("Failed to connect to LLM. Will attempt connection when requested via API")
    
    # # Set up web interface
    # setup_web_interface(app)
    
    # Start the server
    logger.info(f"Starting MCP server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    run_server()
