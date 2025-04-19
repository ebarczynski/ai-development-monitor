# AI Development Monitor - Python Components Changelog

All notable changes to the Python components of the AI Development Monitor will be documented in this file.

## [0.2.0] - 2025-04-19

### Added
- Created a separate web interface server (`web_server.py`) to avoid interference with MCP protocol
- Implemented file-based log sharing between MCP server and web interface
- Added beautiful HTML interface with color-coded message display and emoticons
- Added support for different message types with appropriate visual indicators:
  - 💡 For incoming code suggestions
  - ✅/❌ For accepted/rejected evaluations
  - ⏩ For continue requests
  - 🔄 For continuation responses
  - ⚠️ For error messages
- Added automatic log saving/loading to persist communication history
- Enhanced error handling in both HTTP and WebSocket handlers
- Added support for handling both dictionary and Pydantic model message contents
- Improved WebSocket message handling with better error reporting

### Fixed
- Fixed import issues to ensure scripts run correctly from any directory
- Fixed model type inconsistency in message handlers
- Fixed shebang lines in Python scripts to use `python` instead of `python3`
- Fixed HTTP endpoint handler to properly handle message content structure
- Fixed WebSocket connection handling to properly report errors

### Changed
- Separated web interface to port 5002 (from MCP server on port 5001)
- Modified MCP server root endpoint to direct users to the web interface
- Improved logging with more detailed server status information
- Enhanced startup scripts for both MCP server and web interface

## [0.1.0] - 2025-04-19

### Added
- Initial implementation of MCP server with WebSocket support
- Basic HTTP API for evaluation requests
- Support for suggestion evaluation via LLM
- Added MCPMessage protocol definition with proper typing
- Created example scripts for testing MCP communication
- Implemented hallucination and recursive risk detection
- Added structured message types for bidirectional communication
