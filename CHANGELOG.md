# AI Development Monitor - Python Components Changelog

All notable changes to the Python components of the AI Development Monitor will be documented in this file.

## [0.3.1] - 2025-04-21

### Added
- Implemented Test-Driven Development (TDD) framework with 5-iteration cycle
- Added new MCP message types for TDD workflow: `tdd_request` and `tdd_tests`
- Enhanced web interface with reliable real-time auto-refresh functionality
- Added visual indicators for auto-refresh status in web interface
- Improved error handling in web server for more reliable log viewing
- Added task description support in TDD test generation for context-aware tests

### Fixed
- Fixed web interface auto-refresh functionality that previously required manual refresh
- Resolved issues with the TDD function parameter handling
- Fixed caching issues in the web interface that prevented real-time updates
- Improved error reporting and recovery in communication logs

## [0.3.0] - 2025-04-19

### Added
- Implemented class-based log management system for better memory management
- Added robust error handling for file system operations
- Enhanced web interface with "Reload from File" functionality
- Improved debugging capabilities with detailed log output
- Added proper namespace handling for module imports

### Fixed
- Fixed log persistence issues between server restarts
- Resolved namespace conflicts in communication_logs variable
- Fixed module import and initialization sequence
- Corrected handling of WebSocket message processing

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

### Fixed
- Resolved issues with WebSocket connections dropping unexpectedly
- Fixed data rendering issues in the web interface
- Improved error handling in MCP message processing

## [0.1.0] - 2025-04-18

### Added
- Initial release of MCP server with basic functionality
- Support for handling suggestion and evaluation messages
- Basic Web UI for viewing communication logs
- Integration with Ollama for LLM-based code evaluation
