#!/bin/bash
# Start the AI Development Monitor API server
cd "$(dirname "$0")"
source venv/bin/activate
python src/api_server.py
