# AI Development Monitor

A VS Code extension that monitors GitHub Copilot suggestions, evaluates them for hallucinations and recursive behaviors, and helps you decide whether to accept or reject them.

## Features

- Intercepts and evaluates GitHub Copilot suggestions
- Analyzes suggestions for potential hallucinations, inconsistencies, and recursive behaviors
- Provides visual feedback on suggestion quality with risk scores
- Allows you to accept or reject suggestions based on AI analysis
- Automatically handles timeouts and errors by sending "Continue" commands

## Requirements

- Visual Studio Code v1.85.0 or higher
- GitHub Copilot extension
- AI Development Monitor Python agent running on http://localhost:5000

## Extension Settings

This extension contributes the following settings:

* `aiDevelopmentMonitor.enabled`: Enable/disable the AI Development Monitor
* `aiDevelopmentMonitor.apiUrl`: URL of the AI Development Monitor API server
* `aiDevelopmentMonitor.autoEvaluate`: Automatically evaluate Copilot suggestions
* `aiDevelopmentMonitor.autoRetry`: Automatically retry with 'Continue' on timeouts or errors
* `aiDevelopmentMonitor.retryInterval`: Interval in milliseconds before retrying with 'Continue'

## Usage

1. Start the AI Development Monitor server: `./start_server.sh`
2. Open a file in VS Code
3. Use GitHub Copilot to generate suggestions
4. The extension will automatically evaluate suggestions and show accept/reject options
5. View detailed analysis by clicking "Details" in the notification
6. Accept or reject the suggestion based on the evaluation

## Commands

- `AI Development Monitor: Enable` - Enable the monitor
- `AI Development Monitor: Disable` - Disable the monitor
- `AI Development Monitor: Evaluate Current Copilot Suggestion` - Manually trigger evaluation
- `AI Development Monitor: Accept Current Suggestion` - Accept the current suggestion
- `AI Development Monitor: Reject Current Suggestion` - Reject the current suggestion

## Known Issues

- Since GitHub Copilot doesn't provide a public API for extensions to interact with it directly, this extension uses alternative methods to capture and evaluate suggestions
- The auto-continuation feature may not work in all contexts

## Release Notes

### 0.1.0

Initial release of AI Development Monitor
