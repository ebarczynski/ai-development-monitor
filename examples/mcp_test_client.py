
#!/usr/bin/env python3
"""
Test client for MCP Server - Demonstrates interacting with GitHub Copilot via MCP
"""
import asyncio
import json
import uuid
import sys
import datetime
import websockets
import argparse

async def connect_and_send_message(server_url, message_type, content, conversation_id=None):
    """Connect to the MCP server and send a message"""
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
    
    message_id = str(uuid.uuid4())
    
    # Create message
    message = {
        "context": {
            "conversation_id": conversation_id,
            "message_id": message_id,
            "parent_id": None,
            "metadata": {}
        },
        "message_type": message_type,
        "content": content
    }
    
    print(f"\n[Client] Connecting to {server_url}...")
    sys.stdout.flush()  # Force output to be flushed
    
    try:
        # Add a timeout to the connection
        async with websockets.connect(server_url, timeout=30) as websocket:
            print(f"[Client] Connected to MCP server")
            sys.stdout.flush()  # Force output to be flushed
            
            # Send message
            print(f"\n[Client] Sending {message_type} message:")
            print(json.dumps(message, indent=2))
            sys.stdout.flush()  # Force output to be flushed
            
            await websocket.send(json.dumps(message))
            
            # Receive response with timeout
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=30)
                response_data = json.loads(response)
                print(f"\n[Client] Received response:")
                print(json.dumps(response_data, indent=2))
                sys.stdout.flush()  # Force output to be flushed
                
                return response_data
            except asyncio.TimeoutError:
                print(f"[Client] Error: Response timeout after 30 seconds")
                sys.stdout.flush()
                return None
    
    except Exception as e:
        print(f"[Client] Error: {e}")
        print(f"[Client] Make sure the MCP server is running at {server_url}")
        print(f"[Client] Check server logs for more information")
        sys.stdout.flush()  # Force output to be flushed
        return None

async def simulate_copilot_suggestion(server_url, original_code, proposed_changes, task_description):
    """Simulate GitHub Copilot sending a suggestion for evaluation"""
    content = {
        "original_code": original_code,
        "proposed_changes": proposed_changes,
        "task_description": task_description,
        "file_path": "example.py",
        "language": "python"
    }
    
    return await connect_and_send_message(server_url, "suggestion", content)

async def simulate_timeout_continue(server_url, prompt, conversation_id):
    """Simulate sending a continue request after a timeout"""
    content = {
        "prompt": prompt,
        "timeout_occurred": True,
        "error_message": "Connection timed out"
    }
    
    return await connect_and_send_message(server_url, "continue", content, conversation_id)

async def main():
    parser = argparse.ArgumentParser(description="MCP Test Client")
    parser.add_argument("--url", default="ws://localhost:5001/ws/test-client", help="MCP server WebSocket URL")
    parser.add_argument("--mode", choices=["suggestion", "continue"], default="suggestion", help="Mode to run in")
    parser.add_argument("--output", default=None, help="Output file path")
    args = parser.parse_args()
    
    server_url = args.url
    
    # Set up output file if specified
    if args.output:
        try:
            output_file = open(args.output, 'w')
            sys.stdout = output_file
            print(f"MCP Test Client output - {args.mode} mode")
            print(f"Server URL: {server_url}")
            print(f"Time: {datetime.datetime.now()}")
            print("-" * 80)
        except Exception as e:
            print(f"Error opening output file: {e}")
            return
    
    try:
        if args.mode == "suggestion":
            # Example 1: Evaluate a good code suggestion
            original_code = "def factorial(n):\n    pass  # TODO: Implement factorial"
            proposed_changes = """def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)"""
            task_description = "Implement a recursive factorial function"
            
            print(f"\n=== Example 1: Evaluating a good factorial implementation ===")
            response = await simulate_copilot_suggestion(server_url, original_code, proposed_changes, task_description)
            
            if response:
                conversation_id = response["context"]["conversation_id"]
                
                # Example 2: Evaluate a potentially problematic suggestion (infinite recursion risk)
                original_code = "def fibonacci(n):\n    pass  # TODO: Implement fibonacci"
                proposed_changes = """def fibonacci(n):
    return fibonacci(n-1) + fibonacci(n-2)"""
                task_description = "Implement a fibonacci function"
                
                print(f"\n=== Example 2: Evaluating a problematic fibonacci implementation ===")
                await simulate_copilot_suggestion(server_url, original_code, proposed_changes, task_description)
        
        elif args.mode == "continue":
            # Example 3: Send a continue message after a timeout
            original_code = "def generate_report():\n    pass  # TODO: Implement report generator"
            proposed_changes = """def generate_report():
    # This function will gather data and create a comprehensive report
    data = gather_data()
    # ... more implementation needed"""
            task_description = "Implement a report generator function"
            
            print(f"\n=== Example 3: Sending a continue request after timeout ===")
            response = await simulate_copilot_suggestion(server_url, original_code, proposed_changes, task_description)
            
            if response:
                conversation_id = response["context"]["conversation_id"]
                
                print(f"\n=== Continuing the conversation with 'continue' message ===")
                await simulate_timeout_continue(server_url, "Please continue with the implementation of gather_data function", conversation_id)
    
    except Exception as e:
        print(f"Error in main execution: {e}")
        import traceback
        print(traceback.format_exc())
    
    finally:
        # Close output file if opened
        if args.output and sys.stdout != sys.__stdout__:
            sys.stdout.close()
            sys.stdout = sys.__stdout__

if __name__ == "__main__":
    asyncio.run(main())
