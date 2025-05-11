# Model Context Protocol (MCP) Server for AI Development Monitor

## Overview

The MCP Server enables structured, bidirectional communication between GitHub Copilot and the AI Development Monitor agent. It implements the Model Context Protocol, a standardized approach for AI-to-AI communication that maintains context and supports various message types.

## Features

- **WebSocket Support**: Real-time bidirectional communication
- **HTTP REST Endpoints**: Alternative access for clients that can't use WebSockets
- **Structured Message Format**: Type-safe message exchange using Pydantic models
- **Context-Aware Messaging**: Maintains conversation context and threading
- **Multiple Message Types**: Support for suggestions, evaluations, and continuations
- **Chat History Management**: Import and export chat sessions with timestamp preservation (see [Chat History Documentation](./chat_history.md))

## Architecture

```
┌─────────────────┐        ┌───────────────┐        ┌──────────────────┐
│                 │        │               │        │                  │
│  GitHub Copilot │◄─────► │   MCP Server  │◄─────► │ AI Development   │
│  VS Code Ext    │        │  (WebSocket)  │        │ Monitor Agent    │
│                 │        │               │        │                  │
└─────────────────┘        └───────────────┘        └──────────────────┘
```

## Chat History Management

The MCP Server now supports comprehensive chat history management with import/export capabilities:

### Features

- **Export Chat History**: Save complete chat sessions with timestamps to JSON files
- **Import Chat History**: Load previously exported chat sessions with timestamp preservation
- **Session Management**: Track and organize multiple chat sessions
- **Error Handling**: Robust validation of imported chat history files

### API Endpoints

- `POST /api/chat/export` - Export current chat history to a file
- `POST /api/chat/import` - Import chat history from a file
- `GET /api/chat/sessions` - List all available chat sessions
- `DELETE /api/chat/sessions/{session_id}` - Delete a specific chat session

## Message Types

### Suggestion
- Sent from GitHub Copilot to request evaluation of code
- Contains original code, proposed changes, and task description

### Evaluation
- Sent from AI Development Monitor in response to suggestions
- Contains accept/reject decision, risk scores, and issues detected

### Continue
- Sent when a timeout or error occurs
- Allows the conversation to resume

### Continuation
- Response to a continue request
- Contains the AI's response to continue the task

## How to Use

### Starting the Server

```bash
# Make sure the script is executable
chmod +x start_mcp_server.sh

# Start the MCP server
./start_mcp_server.sh
```

The server will start on port 5001 by default.

### Connection Methods

#### WebSocket Connection

Connect to the WebSocket endpoint:
```
ws://localhost:5001/ws/{client_id}
```

Where `{client_id}` is a unique identifier for your client.

#### HTTP REST API

For clients that cannot use WebSockets, the following HTTP endpoints are available:

- `GET /status` - Check server status
- `POST /connect` - Connect to the LLM
- `POST /mcp/message` - Send an MCP message (alternative to WebSocket)

## Message Format

All messages follow this general structure:

```json
{
  "context": {
    "conversation_id": "unique-conversation-id",
    "message_id": "unique-message-id",
    "parent_id": "parent-message-id-if-any",
    "metadata": {}
  },
  "message_type": "suggestion",
  "content": {
    // Content varies by message type
  }
}
```

## Example: Evaluating a Code Suggestion

1. **Client sends a suggestion**:

```json
{
  "context": {
    "conversation_id": "conv-123",
    "message_id": "msg-1",
    "parent_id": null,
    "metadata": {}
  },
  "message_type": "suggestion",
  "content": {
    "original_code": "def hello():\n    pass",
    "proposed_changes": "def hello():\n    print('Hello, world!')",
    "task_description": "Implement a function that prints a greeting",
    "file_path": "/example/hello.py",
    "language": "python"
  }
}
```

2. **Server responds with evaluation**:

```json
{
  "context": {
    "conversation_id": "conv-123",
    "message_id": "msg-2",
    "parent_id": "msg-1",
    "metadata": {}
  },
  "message_type": "evaluation",
  "content": {
    "accept": true,
    "hallucination_risk": 0.1,
    "recursive_risk": 0.0,
    "alignment_score": 0.95,
    "issues_detected": [],
    "recommendations": [],
    "reason": "The implementation correctly prints a greeting message as requested"
  }
}
```

## Configuration

Configuration is loaded from `config.json` in the root directory. Key settings include:

- `llm_api_endpoint`: URL for the LLM API (default: "http://localhost:11434")
- `ollama_model`: Model to use for evaluations (default: "llama3")
- `verification_threshold`: Threshold for accepting suggestions (default: 0.8)

## Troubleshooting

- **Connection Issues**: Ensure Ollama is running and the specified model is available
- **WebSocket Errors**: Check firewall settings and ensure port 5001 is accessible
- **Evaluation Failures**: Verify that the LLM is properly initialized and connected

## Dependencies

- FastAPI: Web framework for API endpoints
- Uvicorn: ASGI server for running FastAPI
- WebSockets: For real-time communication
- Pydantic: For data validation and settings management
