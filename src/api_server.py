# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
API Server for AI Development Monitor

This module implements a simple API server that allows the VS Code extension
to communicate with the AI Development Monitor Agent.
"""
import os
import json
import logging
import threading
from typing import Dict, Any
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs

# Add the src directory to the path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.monitor_agent import DevelopmentMonitorAgent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global agent instance
agent = None


class MonitorAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the AI Development Monitor API"""
    
    def _set_headers(self, status_code=200, content_type='application/json'):
        self.send_response(status_code)
        self.send_header('Content-type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_OPTIONS(self):
        self._set_headers()
        
    def do_GET(self):
        """Handle GET requests"""
        if self.path.startswith('/status'):
            self._handle_status()
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())
    
    def do_POST(self):
        """Handle POST requests"""
        global agent
        
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(post_data)
            
            if self.path.startswith('/evaluate'):
                self._handle_evaluate(data)
            elif self.path.startswith('/connect'):
                self._handle_connect()
            elif self.path.startswith('/analyze'):
                self._handle_analyze(data)
            else:
                self._set_headers(404)
                self.wfile.write(json.dumps({'error': 'Not found'}).encode())
        except json.JSONDecodeError:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode())
        except Exception as e:
            logger.error(f"Error handling request: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def _handle_status(self):
        """Handle status check"""
        global agent
        
        status = {
            'status': 'running',
            'agent_connected': agent is not None and agent.llm_client is not None
        }
        
        self._set_headers()
        self.wfile.write(json.dumps(status).encode())
    
    def _handle_connect(self):
        """Handle LLM connection request"""
        global agent
        
        # Initialize agent if not already done
        if agent is None:
            agent = DevelopmentMonitorAgent('config.json')
        
        # Connect to LLM
        success = agent.connect_llm()
        
        response = {
            'success': success
        }
        
        self._set_headers(200 if success else 500)
        self.wfile.write(json.dumps(response).encode())
    
    def _handle_evaluate(self, data):
        """Handle code evaluation request"""
        global agent
        
        if agent is None or agent.llm_client is None:
            self._set_headers(400)
            self.wfile.write(json.dumps({
                'success': False,
                'error': 'Agent not connected to LLM'
            }).encode())
            return
        
        # Required fields
        original_code = data.get('original_code', '')
        proposed_changes = data.get('proposed_changes', '')
        task_description = data.get('task_description', '')
        
        # If task_description is empty, try to get it from context or metadata
        if not task_description and 'context' in data:
            context = data.get('context', {})
            if isinstance(context, dict):
                # Try to get from metadata
                metadata = context.get('metadata', {})
                if isinstance(metadata, dict):
                    task_description = metadata.get('task_description', '')
        
        # Only use default if we still have no task description
        if not task_description:
            task_description = "Unknown task"
        
        # Evaluate the changes
        accept, evaluation = agent.evaluate_proposed_changes(
            original_code, 
            proposed_changes, 
            task_description
        )
        
        # Format the response
        response = {
            'accept': accept,
            'evaluation': evaluation,
            'success': True
        }
        
        self._set_headers()
        self.wfile.write(json.dumps(response).encode())
    
    def _handle_analyze(self, data):
        """Handle analysis request for any AI output"""
        global agent
        
        if agent is None or agent.llm_client is None:
            self._set_headers(400)
            self.wfile.write(json.dumps({
                'success': False,
                'error': 'Agent not connected to LLM'
            }).encode())
            return
        
        # Required fields
        ai_output = data.get('ai_output', '')
        expected_behavior = data.get('expected_behavior', 'Respond appropriately')
        
        # Analyze the output
        analysis = agent.capture_and_analyze_output(ai_output, expected_behavior)
        
        # Format the response
        response = {
            'analysis': analysis,
            'success': True
        }
        
        self._set_headers()
        self.wfile.write(json.dumps(response).encode())


def run_server(host='localhost', port=5000):
    """Run the API server"""
    global agent
    
    # Initialize the agent
    logger.info("Initializing AI Development Monitor Agent...")
    agent = DevelopmentMonitorAgent('config.json')
    
    # Connect to the LLM
    logger.info("Connecting to LLM...")
    if agent.connect_llm():
        logger.info("Successfully connected to LLM")
    else:
        logger.warning("Failed to connect to LLM. Will attempt connection when requested via API")
    
    # Start the server
    server_address = (host, port)
    httpd = HTTPServer(server_address, MonitorAPIHandler)
    logger.info(f"Starting API server on {host}:{port}")
    
    # Run in a separate thread
    server_thread = threading.Thread(target=httpd.serve_forever)
    server_thread.daemon = True
    server_thread.start()
    
    return httpd, server_thread


if __name__ == "__main__":
    httpd, server_thread = run_server()
    
    try:
        logger.info("Server is running. Press Ctrl+C to stop")
        server_thread.join()
    except KeyboardInterrupt:
        logger.info("Stopping server...")
        httpd.shutdown()
        logger.info("Server stopped")
