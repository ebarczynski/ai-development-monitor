# !/usr/bin/env python3
"""
Simple script to check if the MCP server is running
"""
import requests
import sys

def check_server(url):
    """Check if the MCP server is running"""
    print(f"Checking if MCP server is running at {url}...")
    try:
        response = requests.get(url)
        print(f"Server response status: {response.status_code}")
        print(f"Server response: {response.text}")
        return True
    except Exception as e:
        print(f"Error connecting to server: {e}")
        return False

if __name__ == "__main__":
    server_url = "http://localhost:5001"
    if len(sys.argv) > 1:
        server_url = sys.argv[1]
    
    result = check_server(server_url)
    print(f"Server check result: {'SUCCESS' if result else 'FAILED'}")
