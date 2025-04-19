#!/bin/bash
# Start the AI Development Monitor Web Interface Server
cd "$(dirname "$0")"
source venv/bin/activate
python src/web_server.py
