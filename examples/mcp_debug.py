#!/usr/bin/env python3
"""
MCP Server Debug Script - Simpler version to diagnose connection issues
"""
import os
import sys
import json
import time
import datetime
import requests
from urllib.parse import urljoin

def write_to_file(output_file, message):
    """Write message to file and stdout"""
    print(message)
    if output_file:
        output_file.write(message + "\n")
        output_file.flush()

def test_mcp_server(base_url, output_file=None):
    """Test basic connectivity to the MCP server"""
    write_to_file(output_file, f"Starting MCP server test at {datetime.datetime.now()}")
    write_to_file(output_file, f"Testing MCP server at {base_url}")
    
    # Test 1: Basic connectivity
    write_to_file(output_file, "\n=== Test 1: Basic connectivity ===")
    try:
        response = requests.get(base_url)
        write_to_file(output_file, f"Status code: {response.status_code}")
        write_to_file(output_file, f"Response: {response.text}")
        if response.status_code == 200:
            write_to_file(output_file, "Basic connectivity test: PASSED")
        else:
            write_to_file(output_file, "Basic connectivity test: FAILED")
    except Exception as e:
        write_to_file(output_file, f"Error: {e}")
        write_to_file(output_file, "Basic connectivity test: FAILED")
        return False
    
    # Test 2: Status endpoint
    write_to_file(output_file, "\n=== Test 2: Status endpoint ===")
    try:
        status_url = urljoin(base_url, "/status")
        write_to_file(output_file, f"Checking status at {status_url}")
        response = requests.get(status_url)
        write_to_file(output_file, f"Status code: {response.status_code}")
        write_to_file(output_file, f"Response: {response.text}")
        
        if response.status_code == 200:
            status_data = response.json()
            write_to_file(output_file, f"Server status: {status_data.get('status', 'unknown')}")
            write_to_file(output_file, f"Agent connected: {status_data.get('agent_connected', False)}")
            write_to_file(output_file, f"Active connections: {status_data.get('active_connections', 0)}")
            write_to_file(output_file, "Status test: PASSED")
        else:
            write_to_file(output_file, "Status test: FAILED")
    except Exception as e:
        write_to_file(output_file, f"Error: {e}")
        write_to_file(output_file, "Status test: FAILED")
    
    # Test 3: Send a sample HTTP message
    write_to_file(output_file, "\n=== Test 3: HTTP message endpoint ===")
    try:
        message_url = urljoin(base_url, "/mcp/message")
        write_to_file(output_file, f"Sending message to {message_url}")
        
        # Create a test message
        test_message = {
            "context": {
                "conversation_id": "test-debug-conversation",
                "message_id": "test-debug-message",
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
        
        write_to_file(output_file, f"Sending message: {json.dumps(test_message, indent=2)}")
        
        response = requests.post(
            message_url, 
            json=test_message,
            headers={"Content-Type": "application/json"},
            timeout=60  # Longer timeout for evaluation
        )
        
        write_to_file(output_file, f"Status code: {response.status_code}")
        
        try:
            response_data = response.json()
            write_to_file(output_file, f"Response: {json.dumps(response_data, indent=2)}")
            if response.status_code == 200:
                write_to_file(output_file, "Message test: PASSED")
            else:
                write_to_file(output_file, "Message test: FAILED")
        except Exception as e:
            write_to_file(output_file, f"Error parsing response: {e}")
            write_to_file(output_file, f"Raw response: {response.text}")
            write_to_file(output_file, "Message test: FAILED")
            
    except Exception as e:
        write_to_file(output_file, f"Error: {e}")
        write_to_file(output_file, "Message test: FAILED")
    
    write_to_file(output_file, "\n=== Test completed ===")
    write_to_file(output_file, f"End time: {datetime.datetime.now()}")
    return True

if __name__ == "__main__":
    # Parse arguments
    base_url = "http://localhost:5001"
    output_path = "mcp_debug_result.txt"
    
    if len(sys.argv) > 1:
        base_url = sys.argv[1]
    if len(sys.argv) > 2:
        output_path = sys.argv[2]
    
    # Open output file
    try:
        with open(output_path, 'w') as output_file:
            test_mcp_server(base_url, output_file)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
