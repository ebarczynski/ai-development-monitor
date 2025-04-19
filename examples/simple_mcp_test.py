#!/usr/bin/env python3
"""
Simple synchronous MCP test script with direct file writing
"""
import os
import sys
import json
import requests
import traceback
from datetime import datetime

# Output file path
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "simple_mcp_test.txt")

def main():
    """Test MCP server with simple HTTP requests"""
    # Open the output file first to make sure we can write to it
    with open(OUTPUT_FILE, 'w') as f:
        f.write(f"Simple MCP Test - Started at {datetime.now()}\n")
        f.write("-" * 50 + "\n\n")
        
        base_url = "http://localhost:5001"
        f.write(f"Testing MCP server at {base_url}\n\n")
        
        # Test root endpoint
        try:
            f.write("Testing root endpoint...\n")
            response = requests.get(base_url, timeout=10)
            f.write(f"Status code: {response.status_code}\n")
            f.write(f"Response: {response.text}\n\n")
        except Exception as e:
            f.write(f"Error testing root endpoint: {e}\n")
            f.write(traceback.format_exc() + "\n\n")
        
        # Test status endpoint
        try:
            f.write("Testing status endpoint...\n")
            response = requests.get(f"{base_url}/status", timeout=10)
            f.write(f"Status code: {response.status_code}\n")
            f.write(f"Response: {response.text}\n\n")
        except Exception as e:
            f.write(f"Error testing status endpoint: {e}\n")
            f.write(traceback.format_exc() + "\n\n")
        
        # Test sending a simple message
        try:
            f.write("Testing message endpoint...\n")
            
            test_message = {
                "context": {
                    "conversation_id": "simple-test",
                    "message_id": "simple-message",
                    "parent_id": None,
                    "metadata": {}
                },
                "message_type": "suggestion",
                "content": {
                    "original_code": "def hello():\n    pass",
                    "proposed_changes": "def hello():\n    print('Hello')",
                    "task_description": "Implement hello function"
                }
            }
            
            f.write(f"Sending message: {json.dumps(test_message)[:200]}...\n")
            
            response = requests.post(
                f"{base_url}/mcp/message",
                json=test_message,
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            f.write(f"Status code: {response.status_code}\n")
            f.write(f"Response: {response.text[:500]}...\n\n")
        except Exception as e:
            f.write(f"Error testing message endpoint: {e}\n")
            f.write(traceback.format_exc() + "\n\n")
        
        f.write(f"Test completed at {datetime.now()}\n")
        f.write(f"Output file: {os.path.abspath(OUTPUT_FILE)}\n")
        
        # Also write to stdout for confirmation
        print(f"Test completed. Check output file: {os.path.abspath(OUTPUT_FILE)}")

if __name__ == "__main__":
    main()
