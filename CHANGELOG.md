# AI Development Monitor - Python Components Changelog

All notable changes to the Python components of the AI Development Monitor will be documented in this file.

## [0.7.0] - 2025-05-23

### Added

- Added support for Hugging Face API integration as an alternative to local Ollama
- Created model provider abstraction layer for multiple LLM support
- Added configuration options for selecting between model providers
- Implemented caching for API responses to reduce token usage
- Added fallback mechanisms between different LLM providers

### Changed

- Updated MCP client to work with both local and cloud-based models
- Enhanced error handling for API connectivity issues
- Updated documentation to reflect multiple model provider support

## [0.6.0] - 2025-05-14

### Added

- Enhanced test execution capabilities for GitHub Copilot Chat integration
- Added JSON input/output format support to run_test_execution.py
- Added automatic test template generation for Copilot suggestions
- Improved error handling in test execution utilities

### Changed

- Updated run_test_execution.py to support programmatic use via JSON
- Improved test execution result formatting for display in VS Code

### Changed
- Updated run_test_execution.py to support programmatic use via JSON
- Improved test execution result formatting for display in VS Code

## [0.5.0] - 2025-05-13

### Added
- Update version to align with VS Code extension release cycle
- Improve backend communication handling with VS Code extension
- Standardize versioning across all components
- Performance optimizations in MCP server

### Changed
- Update web interface version to maintain consistency

## [0.4.4] - 2025-05-11

### Added
- Chat history management with import/export functionality
- New API endpoints for chat history operations
- Timestamp preservation for imported chat sessions
- Enhanced error handling for chat history operations
- Comprehensive tests for chat history functionality

## [0.4.3] - 2025-04-25

### Added
- Enhanced communication between backend components for better reliability
- Improved error handling in MCP server connection management

### Fixed
- Resolved issues with TDD framework test execution
- Fixed various minor bugs in the MCP server communication

## [0.4.0] - 2025-04-22

### Added
- Added the `setup_web_interface` function to improve web interface integration
- Enhanced TDD testing with improved error handling in test generation
- Implemented backward compatibility for Pydantic v2 by supporting both `dict()` and `model_dump()` methods
- Updated response handling in TDD helpers for more reliable test execution

### Fixed
- Fixed Pydantic deprecation warnings by updating to use `model_dump()` where appropriate
- Resolved `'dict' object has no attribute 'generate_async'` error in TDD helpers
- Fixed error handling in `generate_tests` function to properly use the LLM client
- Improved context serialization in MCP responses for compatibility with newer Pydantic versions

## [0.3.1] - 2025-04-21

### Added
- Implemented Test-Driven Development (TDD) framework with 5-iteration cycle
- Added new MCP message types for TDD workflow: `tdd_request` and `tdd_tests`
- Enhanced web interface with reliable real-time auto-refresh functionality
- Added visual indicators for auto-refresh status in web interface
- Improved error handling in web server for more reliable log viewing
- Added task description support in TDD test generation for context-aware tests

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
