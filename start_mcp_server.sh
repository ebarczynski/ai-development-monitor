#!/bin/bash
# Start the AI Development Monitor MCP server
cd "$(dirname "$0")"
source venv/bin/activate
python src/mcp_server.py
