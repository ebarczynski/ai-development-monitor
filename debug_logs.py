#!/usr/bin/env python3
"""
Debug script to diagnose log loading issues
"""
import os
import sys
import json

# Add the src directory to the path so we can import from web_interface
current_dir = os.path.dirname(os.path.abspath(__file__))
src_dir = os.path.join(current_dir, 'src')
sys.path.append(src_dir)

# Try direct file loading first
log_file_path = os.path.join(current_dir, 'mcp_logs.json')
print(f"Testing direct file access for {log_file_path}")
print(f"File exists: {os.path.exists(log_file_path)}")

try:
    with open(log_file_path, 'r') as f:
        logs = json.load(f)
        print(f"Direct file access: Successfully loaded {len(logs)} log entries")
except Exception as e:
    print(f"Direct file access error: {e}")

# Now try importing from web_interface
print("\nTesting module import approach:")
try:
    from web_interface import communication_logs, load_logs_from_file, LOG_FILE_PATH
    
    print(f"Module LOG_FILE_PATH: {LOG_FILE_PATH}")
    print(f"Log file exists according to module path: {os.path.exists(LOG_FILE_PATH)}")
    
    # Check current state of communication_logs
    print(f"Current communication_logs: {len(communication_logs)} entries")
    
    # Try loading logs
    print("Calling load_logs_from_file()...")
    load_logs_from_file()
    
    # Check if logs were loaded
    print(f"After loading, communication_logs has {len(communication_logs)} entries")
    
    if len(communication_logs) > 0:
        print(f"First log entry type: {communication_logs[0].get('message_type', 'unknown')}")
    
except Exception as e:
    print(f"Module import error: {e}")
    import traceback
    traceback.print_exc()

print("\nDiagnostic complete. If direct access works but module import fails,")
print("the issue is likely with module paths or how the web server accesses the imported modules.")
