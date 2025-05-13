# Change Log

All notable changes to the "AI Development Monitor" extension will be documented in this file.

## [0.5.0] - 2025-05-13

- Add GitHub Copilot Chat interaction functions:
  - Implement "Continue" command to accept suggestions
  - Add "Request Changes" function with customizable feedback
  - Enhance chat panel detection and handling
  - Add commands to VS Code command palette
- Improve chat panel state management with automatic opening when needed
- Add user notification system for chat interactions
- Add error handling for chat interactions

## [0.4.5] - 2025-05-11

- Implement chat history management with import/export functionality
- Add UI components for chat history operations in the panel
- Enhance optimized MCP client with chat history protocol support
- Implement timestamp preservation for imported chat sessions
- Add error handling for chat history import/export operations

## [0.4.4] - 2025-05-10

- Add missing `retryConnection` command to fix connection indicator functionality
- Remove REST API fallback mechanism, making MCP connection mandatory
- Fix heartbeat functionality in optimized MCP client
- Improve error messages for connection issues
- Add documentation for MCP-only connection approach

## [0.4.3] - 2025-04-25

- Add missing `evaluateSuggestion` method to OptimizedMCPClient for proper suggestion evaluation
- Fix message batching and connection quality testing in diagnostic tools
- Enhance context manager integration with improved two-way communication
- Fix VS Code Memento handling in context_manager.js
- Add task description editing functionality to context manager
- Improve cleanup in dispose() methods for better resource management

## [0.4.1] - 2025-04-23

- Enhance GitHub Copilot Chat integration with intelligent duplicate suggestion detection
- Improve debouncing mechanism in Copilot Chat integration (increased from 500ms to 1000ms)
- Add suggestion caching with configurable timeout (default: 5000ms) to prevent duplicate logging
- Implement robust message hashing for accurate duplicate detection
- Fix issue with frequent duplicate logs of the same Copilot suggestions

## [0.4.0] - 2025-04-22

- Add dedicated monitoring panel (ai_monitor_panel.js) for visualizing evaluation results
- Implement improved notification system with customizable verbosity levels
- Fix WebSocket connection timeout issues in MCP client
- Add robust error handling for server connection failures
- Fix syntax error with reserved keyword 'eval' in monitoring panel
- Improve URL construction for WebSocket connections
- Add connection timeout to prevent indefinite hanging
- Implement progress indicators for long-running operations
- Enhance logging with more detailed error messages
- Add configuration options for notification levels and panel display
- Implement integrated modules (evaluation_display.js, chat_processor.js, suggestion_evaluator.js)

## [0.3.1] - 2025-04-21

- Add Test-Driven Development (TDD) framework with 5-iteration workflow
- Implement TDD support for Python and JavaScript code
- Add integration with MCP server for test generation
- Implement code evolution visualization during TDD cycles
- Add task description support for context-aware test generation
- Fix WebSocket connection stability issues with MCP server
- Improve error handling in diagnostic test
- Add tdd_extension.js module for TDD workflow management
- Add proper error handling for WebSocket connections
- Enhance suggestion detection reliability

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
