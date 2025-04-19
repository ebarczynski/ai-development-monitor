# Change Log

All notable changes to the "AI Development Monitor" extension will be documented in this file.

## [0.2.0] - 2025-04-19

- Add improved Copilot integration with better suggestion detection
- Implement robust MCP client with reconnection logic and error handling
- Add comprehensive logging system with multiple log levels and categories
- Add heartbeat mechanism to detect and recover from dead connections
- Implement message timeout handling to prevent hanging requests
- Create dedicated CopilotIntegration module for more reliable suggestion detection
- Add automatic retries with exponential backoff for connection failures
- Improve error reporting with detailed user notifications
- Add manual evaluation fallback when automatic detection doesn't work
- Add "Show Logs" command for easier debugging

## [0.1.1] - 2025-04-19

- Add Model Context Protocol (MCP) integration for AI-to-AI communication
- Implement WebSocket connection for real-time bidirectional messaging
- Add structured message types for suggestions, evaluations, and continuations
- Support context-aware message threading between agents
- Improve error handling with fallback to REST API when MCP is unavailable
- Add configuration options for MCP in extension settings
- Enhance "Continue" functionality for handling timeouts and connection issues

## [0.1.0] - 2025-04-19

- Initial release
- Add monitoring and evaluation of GitHub Copilot suggestions
- Implement risk analysis for hallucinations and recursive behaviors
- Add detailed evaluation view with visual risk indicators
- Add auto-continuation feature for timeouts and errors
