# AI Development Monitor

A VS Code extension that monitors GitHub Copilot suggestions, evaluates them for hallucinations and recursive behaviors, and helps you decide whether to accept or reject them.

## Features

- Intercepts and evaluates GitHub Copilot suggestions
- Integrates with GitHub Copilot Chat to capture conversations and extract relevant context
- Implements intelligent duplicate detection to prevent excessive logging of suggestions
- Provides context sharing between different components for better collaboration
- Analyzes suggestions for potential hallucinations, inconsistencies, and recursive behaviors
- Provides visual feedback on suggestion quality with risk scores
- Allows you to accept or reject suggestions based on AI analysis
- Automatically handles timeouts and errors by sending "Continue" commands
- Supports Model Context Protocol (MCP) for structured AI-to-AI communication
- Includes a comprehensive logging system for debugging

## Requirements

- Visual Studio Code v1.85.0 or higher
- GitHub Copilot extension
- AI Development Monitor Python agent (choose one option):
  - REST API: Run with `./start_server.sh` on http://localhost:5000
  - MCP Server: Run with `./start_mcp_server.sh` on ws://localhost:5001
  - Web Interface: Run with `./start_web_server.sh` on http://localhost:5002

## Extension Settings

This extension contributes the following settings:

* `aiDevelopmentMonitor.enabled`: Enable/disable the AI Development Monitor
* `aiDevelopmentMonitor.apiUrl`: URL of the AI Development Monitor REST API server
* `aiDevelopmentMonitor.mcpUrl`: WebSocket URL of the AI Development Monitor MCP server
* `aiDevelopmentMonitor.useMcp`: Use Model Context Protocol (MCP) for communication
* `aiDevelopmentMonitor.autoEvaluate`: Automatically evaluate Copilot suggestions
* `aiDevelopmentMonitor.autoRetry`: Automatically retry with 'Continue' on timeouts or errors
* `aiDevelopmentMonitor.retryInterval`: Interval in milliseconds before retrying with 'Continue'

## Usage

1. Start both the MCP server and web interface:
   ```bash
   ./start_mcp_server.sh
   ./start_web_server.sh
   ```
2. Open a file in VS Code
3. Use GitHub Copilot to generate suggestions
4. The extension will automatically evaluate suggestions and show accept/reject options
5. View detailed analysis by clicking "Details" in the notification
6. Accept or reject the suggestion based on the evaluation
7. View communication logs in the web interface at http://localhost:5002

## Commands

- `AI Development Monitor: Enable` - Enable the monitor
- `AI Development Monitor: Disable` - Disable the monitor
- `AI Development Monitor: Evaluate Current Copilot Suggestion` - Manually trigger evaluation
- `AI Development Monitor: Accept Current Suggestion` - Accept the current suggestion
- `AI Development Monitor: Reject Current Suggestion` - Reject the current suggestion
- `AI Development Monitor: Show Logs` - Display extension logs for debugging

## Debugging

The extension includes a comprehensive logging system that helps diagnose issues:

1. Open the command palette and run `AI Development Monitor: Show Logs`
2. View the detailed logs in the output channel
3. Access the web interface at http://localhost:5002 to see colorful communication logs with emoticons

## Known Issues

- Since GitHub Copilot doesn't provide a public API for extensions to interact with it directly, this extension uses alternative methods to capture and evaluate suggestions
- The auto-continuation feature may not work in all contexts
- Websocket connections may require reconnection if the network is unstable

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md) for the latest updates.

### 0.1.0

Initial release of AI Development Monitor
