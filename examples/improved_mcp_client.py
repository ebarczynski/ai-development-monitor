#!/usr/bin/env python3
"""
Improved MCP Test Client - Demonstrates both HTTP and WebSocket connectivity
"""
import os
import sys
import json
import uuid
import asyncio
import requests
import websockets
import datetime
from urllib.parse import urljoin

# Set up logging to a file
LOG_FILE = "mcp_client_log.txt"

def log_message(message):
    """Log a message to both console and file"""
    print(message)
    with open(LOG_FILE, 'a') as f:
        f.write(f"{message}\n")

async def test_http_endpoints():
    """Test the HTTP endpoints of the MCP server"""
    base_url = "http://localhost:5001"
    
    log_message("\n=== Testing MCP Server HTTP Endpoints ===")
    log_message(f"Time: {datetime.datetime.now()}")
    
    # Test 1: Root endpoint
    try:
        response = requests.get(base_url)
        log_message(f"Root endpoint response: {response.status_code}")
        log_message(f"Content: {response.text}")
    except Exception as e:
        log_message(f"Error accessing root endpoint: {e}")
    
    # Test 2: Status endpoint
    try:
        status_url = urljoin(base_url, "status")
        response = requests.get(status_url)
        log_message(f"Status endpoint response: {response.status_code}")
        log_message(f"Content: {response.text}")
        status_data = response.json()
        log_message(f"Server status: {status_data.get('status')}")
        log_message(f"Agent connected: {status_data.get('agent_connected')}")
        log_message(f"Active connections: {status_data.get('active_connections')}")
    except Exception as e:
        log_message(f"Error accessing status endpoint: {e}")
    
    # Test 3: Send a message via HTTP
    try:
        message_url = urljoin(base_url, "mcp/message")
        
        # Create test message
        test_message = {
            "context": {
                "conversation_id": "test-http-conversation",
                "message_id": "test-http-message",
                "parent_id": None,
                "metadata": {}
            },
            "message_type": "suggestion",
            "content": {
                "original_code": "def hello():\n    pass",
                "proposed_changes": "def hello():\n    print('Hello, world!')",
                "task_description": "Implement a function that prints a greeting",
                "file_path": "test.py",
                "language": "python"
            }
        }
        
        log_message("\nSending HTTP message to evaluate code:")
        log_message(json.dumps(test_message, indent=2))
        
        response = requests.post(
            message_url, 
            json=test_message,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        log_message(f"Response status: {response.status_code}")
        log_message("Response content:")
        log_message(json.dumps(response.json(), indent=2))
        
    except Exception as e:
        log_message(f"Error sending HTTP message: {e}")
        import traceback
        log_message(traceback.format_exc())

async def test_websocket():
    """Test the WebSocket connection to the MCP server"""
    client_id = f"test-client-{uuid.uuid4()}"
    server_url = f"ws://localhost:5001/ws/{client_id}"
    
    log_message("\n=== Testing MCP Server WebSocket Connection ===")
    log_message(f"Time: {datetime.datetime.now()}")
    log_message(f"Connecting to: {server_url}")
    
    try:
        async with websockets.connect(server_url, ping_interval=None, ping_timeout=None) as websocket:
            log_message("WebSocket connection established!")
            
            # Create a test message
            conversation_id = str(uuid.uuid4())
            message_id = str(uuid.uuid4())
            
            message = {
                "context": {
                    "conversation_id": conversation_id,
                    "message_id": message_id,
                    "parent_id": None,
                    "metadata": {}
                },
                "message_type": "suggestion",
                "content": {
                    "original_code": "def factorial(n):\n    pass",
                    "proposed_changes": "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n-1)",
                    "task_description": "Implement a factorial function",
                    "file_path": "example.py",
                    "language": "python"
                }
            }
            
            log_message("\nSending WebSocket message:")
            log_message(json.dumps(message, indent=2))
            
            # Send the message
            await websocket.send(json.dumps(message))
            log_message("Message sent, waiting for response...")
            
            # Wait for response with a timeout
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=60)
                log_message("\nReceived response:")
                
                # Parse and format the response
                response_data = json.loads(response)
                log_message(json.dumps(response_data, indent=2))
                
                # Display key evaluation metrics
                if response_data.get("message_type") == "evaluation":
                    content = response_data.get("content", {})
                    log_message("\nEvaluation Results:")
                    log_message(f"Accept: {content.get('accept', False)}")
                    log_message(f"Hallucination Risk: {content.get('hallucination_risk', 0)}")
                    log_message(f"Recursive Risk: {content.get('recursive_risk', 0)}")
                    log_message(f"Alignment Score: {content.get('alignment_score', 0)}")
                    
                    if content.get("issues_detected"):
                        log_message("\nIssues Detected:")
                        for issue in content.get("issues_detected", []):
                            log_message(f"- {issue}")
                    
                    if content.get("recommendations"):
                        log_message("\nRecommendations:")
                        for rec in content.get("recommendations", []):
                            log_message(f"- {rec}")
            
            except asyncio.TimeoutError:
                log_message("Error: Timed out waiting for response")
            
            log_message("\nWebSocket test completed")
    
    except Exception as e:
        log_message(f"Error with WebSocket connection: {e}")
        import traceback
        log_message(traceback.format_exc())

async def main():
    """Run all tests"""
    # Clear log file
    with open(LOG_FILE, 'w') as f:
        f.write(f"MCP Client Test Log - {datetime.datetime.now()}\n")
        f.write("-" * 80 + "\n\n")
    
    # Run HTTP tests
    await test_http_endpoints()
    
    # Run WebSocket tests
    await test_websocket()
    
    log_message("\n=== All tests completed ===")
    log_message(f"See full log at: {os.path.abspath(LOG_FILE)}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        log_message(f"Error running tests: {e}")
        import traceback
        log_message(traceback.format_exc())
