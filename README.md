![aidm-hydra](https://github.com/user-attachments/assets/941e7ca2-9e84-4e06-9110-b0b7af453d3f)
# AI Development Monitor


A comprehensive system for monitoring and evaluating GitHub Copilot code suggestions to detect potential hallucinations, recursive behaviors, and other issues. This project consists of several components that work together to provide a seamless development experience with AI code assistants.

## Components

### 1. Python Backend (v0.4.3)

- **MCP Server**: Model Context Protocol server for structured AI-to-AI communication
- **Web Interface**: Real-time visualization of communication logs
- **Monitor Agent**: Intelligent evaluation of code suggestions using LLM
- **TDD Framework**: Test-Driven Development support with automated test generation
- **Pydantic v2 Support**: Backward compatibility with modern data validation

### 2. VS Code Extension (v0.4.3)

- **Copilot Integration**: Captures and monitors GitHub Copilot suggestions
- **MCP Client**: Communicates with the MCP server via WebSockets
- **Evaluation UI**: Shows risk scores and recommendations in VS Code
- **TDD Support**: Enables Test-Driven Development workflows with Copilot suggestions
- **Dedicated Panel**: Rich visual interface for detailed evaluation results
- **Smart Notifications**: Configurable notification system with multiple verbosity levels
- **Context Manager**: Improved context sharing between components

## Getting Started

### Prerequisites

- Python 3.10 or higher
- Node.js 16 or higher
- VS Code 1.85.0 or higher
- GitHub Copilot extension
- Ollama running in the background (for LLM-based code evaluation)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/username/ai-development-monitor.git
   cd ai-development-monitor
   ```

2. Set up the Python environment:

   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Install the VS Code extension:

   ```bash
   cd vscode-extension
   npm install
   vsce package
   code --install-extension ai-development-monitor-0.3.1.vsix
   ```

## Usage

For the best experience, start both the MCP server and web interface:

1. Start the MCP server:

   ```bash
   ./start_mcp_server.sh
   ```

2. Start the web interface server:

   ```bash
   ./start_web_server.sh
   ```

3. Open VS Code and start using GitHub Copilot
   - Suggestions will be automatically evaluated using the MCP protocol
   - View communication logs at http://localhost:5002
   - Run TDD cycles by using the diagnostic test or invoking TDD commands

Alternatively, you can use just the REST API server:

```bash
./start_server.sh
```

## Architecture

The system uses a multi-component architecture:

1. **GitHub Copilot** generates code suggestions in VS Code
2. **VS Code Extension** captures these suggestions and sends them to the MCP server
3. **MCP Server** routes messages between components using a structured protocol
4. **Monitor Agent** evaluates code for risks using an LLM
5. **Web Interface** visualizes the communication with colorful logs and emoticons
6. **TDD Framework** generates tests and manages test-driven development cycles

### UML Diagrams

The following UML diagrams provide a detailed view of the system architecture:

- [Backend Components UML](./docs/diagrams/backend_components_uml.md) - Class diagram showing the backend components
- [VS Code Extension Components UML](./docs/diagrams/vscode_extension_components_uml.md) - Class diagram showing the VS Code extension components
- [Component Interaction UML](./docs/diagrams/component_interaction_uml.md) - Sequence diagram showing communication flow
- [Package Dependency UML](./docs/diagrams/package_dependency_uml.md) - Diagram showing dependencies between modules

## MCP Protocol

The Model Context Protocol (MCP) enables structured communication between AI systems:

- **Suggestions**: Code proposals from GitHub Copilot
- **Evaluations**: Risk assessments from the Monitor Agent
- **Continuations**: Follow-up requests when suggestions are incomplete
- **TDD Requests**: Requests for test generation in TDD workflow
- **TDD Tests**: Generated test code with validation suggestions

Each message includes context tracking, allowing for threaded conversations between AI systems.

## Test-Driven Development (TDD) Flow

The TDD functionality follows a 5-iteration cycle:

1. **Basic Testing**: Tests for basic functionality and simple edge cases
2. **Extended Coverage**: More comprehensive tests for normal use cases
3. **Error Handling**: Tests for invalid inputs and boundary conditions
4. **Performance Testing**: Tests for optimization and large inputs
5. **Comprehensive Review**: Final assessment and improvement suggestions

Each iteration improves both the test suite and the implementation, progressively enhancing code quality.

![TDD Flow Diagram](docs/tdd_flow_diagram.png)

## Known Issues

- GitHub Copilot does not provide a public API, so the extension uses heuristic methods to detect suggestions
- WebSocket connections may require reconnection in unstable network environments
- TDD workflow currently only supports Python and JavaScript code

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and release notes.
