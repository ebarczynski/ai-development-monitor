// Diagnostic Test for AI Development Monitor Extension
// This file will help test if the extension can react to GitHub Copilot Chat 
// messages and detect file changes in the editor

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Diagnostic test function to check extension capabilities
 */
async function runDiagnosticTests() {
    const outputChannel = vscode.window.createOutputChannel('AI Dev Monitor Tests');
    outputChannel.show();

    outputChannel.appendLine('=== AI Development Monitor Diagnostic Tests ===');
    outputChannel.appendLine(`Date/Time: ${new Date().toISOString()}`);
    outputChannel.appendLine('');

    // Test 1: Check if the extension is installed and activated
    outputChannel.appendLine('Test 1: Checking extension installation status...');
    const extension = vscode.extensions.getExtension('local-publisher.ai-development-monitor');
    
    if (!extension) {
        outputChannel.appendLine('❌ Extension not found! Please ensure it is installed correctly.');
        return;
    }
    
    if (!extension.isActive) {
        outputChannel.appendLine('Activating extension...');
        await extension.activate();
    }
    
    outputChannel.appendLine('✅ Extension is installed and activated');
    outputChannel.appendLine('');

    // Test 2: Check if GitHub Copilot and Copilot Chat are installed
    outputChannel.appendLine('Test 2: Checking for GitHub Copilot...');
    
    const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
    const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
    
    if (!copilotExtension) {
        outputChannel.appendLine('⚠️ GitHub Copilot extension not found. This is required for suggestion detection.');
    } else {
        outputChannel.appendLine('✅ GitHub Copilot is installed');
    }
    
    if (!copilotChatExtension) {
        outputChannel.appendLine('⚠️ GitHub Copilot Chat extension not found. This is required for chat message detection.');
    } else {
        outputChannel.appendLine('✅ GitHub Copilot Chat is installed');
    }
    outputChannel.appendLine('');

    // Test 3: Check extension settings
    outputChannel.appendLine('Test 3: Checking extension settings...');
    
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    outputChannel.appendLine(`Enabled: ${config.get('enabled', false)}`);
    outputChannel.appendLine(`Use MCP: ${config.get('useMcp', false)}`);
    outputChannel.appendLine(`MCP URL: ${config.get('mcpUrl', 'not set')}`);
    outputChannel.appendLine(`API URL: ${config.get('apiUrl', 'not set')}`);
    outputChannel.appendLine('');

    // Test 4: File modification monitoring test
    outputChannel.appendLine('Test 4: File modification monitoring test...');
    
    // Create a test file for monitoring
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders) {
        outputChannel.appendLine('❌ No workspace folder found');
        return;
    }
    
    const testFilePath = path.join(workspaceFolders[0].uri.fsPath, 'copilot-test-file.js');
    
    try {
        // Create the test file
        fs.writeFileSync(testFilePath, '// Test file for Copilot suggestions\n\n// Write a function to calculate factorial\n');
        outputChannel.appendLine(`Created test file: ${testFilePath}`);
        
        // Open the file in editor
        const document = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(document);
        
        outputChannel.appendLine('✅ Test file created and opened in editor');
        
        // Set up a file system watcher to detect changes
        const watcher = vscode.workspace.createFileSystemWatcher(testFilePath);
        
        watcher.onDidChange(uri => {
            outputChannel.appendLine(`🔄 Test file changed: ${uri.fsPath}`);
        });
        
        outputChannel.appendLine('✅ File watcher set up successfully');
        
        // Now simulate a modification to the file
        setTimeout(async () => {
            try {
                // Edit the file through the VS Code API
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document.uri.fsPath === testFilePath) {
                    await editor.edit(editBuilder => {
                        editBuilder.insert(new vscode.Position(3, 0), 'function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n-1);\n}\n');
                    });
                    outputChannel.appendLine('✅ Successfully made test edit to file');
                }
            } catch (error) {
                outputChannel.appendLine(`❌ Error making test edit: ${error}`);
            }
        }, 2000);
        
        // Cleanup after 10 seconds
        setTimeout(() => {
            try {
                watcher.dispose();
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                    outputChannel.appendLine('✅ Test file deleted');
                }
            } catch (error) {
                outputChannel.appendLine(`❌ Error cleaning up: ${error}`);
            }
        }, 10000);
    } catch (error) {
        outputChannel.appendLine(`❌ Error in file test: ${error}`);
    }
    
    // Test 5: Test connection to MCP server
    outputChannel.appendLine('');
    outputChannel.appendLine('Test 5: Testing connection to MCP server and all message types...');
    
    if (!config.get('useMcp', false)) {
        outputChannel.appendLine('⚠️ MCP is disabled in settings. Enable it to test the connection.');
    } else {
        const mcpUrl = config.get('mcpUrl', '');
        outputChannel.appendLine(`Attempting to connect to MCP server at: ${mcpUrl}`);
        
        try {
            // Create a WebSocket connection to test
            const WebSocket = require('ws');
            const clientId = Date.now().toString();
            const wsUrl = `${mcpUrl}/${clientId}`;
            
            const ws = new WebSocket(wsUrl);
            
            // Track messages for conversation flow
            const conversationId = `test-${Date.now()}`;
            let lastMessageId = null;
            let testPhase = 1;
            
            ws.on('open', () => {
                outputChannel.appendLine('✅ Connected to MCP server successfully!');
                
                // Test 1: Send a suggestion message with Python code
                sendSuggestionMessage();
            });
            
            function sendSuggestionMessage() {
                const messageId = `msg-suggestion-${Date.now()}`;
                lastMessageId = messageId;
                
                // Create a suggestion message
                const suggestionMessage = {
                    context: {
                        conversation_id: conversationId,
                        message_id: messageId,
                        parent_id: null,
                        metadata: {
                            language: "python",
                            file_path: "test_factorial.py",
                            test_phase: 1
                        }
                    },
                    message_type: "suggestion",
                    content: {
                        original_code: "# Write a function to calculate factorial\n\ndef factorial(n):\n    pass",
                        proposed_changes: "# Write a function to calculate factorial\n\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n-1)",
                        file_path: "test_factorial.py",
                        language: "python",
                        task_description: "Implement a recursive factorial function"
                    }
                };
                
                ws.send(JSON.stringify(suggestionMessage));
                outputChannel.appendLine('✅ Test 1: Suggestion message sent to MCP server');
                outputChannel.appendLine('Message content:');
                outputChannel.appendLine(JSON.stringify(suggestionMessage, null, 2));
            }
            
            function sendContinueMessage() {
                const messageId = `msg-continue-${Date.now()}`;
                
                // Create a continue message referring to previous message
                const continueMessage = {
                    context: {
                        conversation_id: conversationId,
                        message_id: messageId,
                        parent_id: lastMessageId,
                        metadata: {
                            language: "python",
                            file_path: "test_factorial.py",
                            test_phase: 2
                        }
                    },
                    message_type: "continue",
                    content: {
                        prompt: "Please suggest an iterative version of the factorial function",
                        timeout_occurred: false,
                        error_message: null
                    }
                };
                
                lastMessageId = messageId;
                
                ws.send(JSON.stringify(continueMessage));
                outputChannel.appendLine('✅ Test 2: Continue message sent to MCP server');
                outputChannel.appendLine('Message content:');
                outputChannel.appendLine(JSON.stringify(continueMessage, null, 2));
            }
            
            ws.on('message', (data) => {
                outputChannel.appendLine(`✅ Received response from MCP server (Phase ${testPhase}):`);
                try {
                    const response = JSON.parse(data);
                    outputChannel.appendLine(JSON.stringify(response, null, 2));
                    
                    // Process based on test phase
                    if (testPhase === 1) {
                        // After receiving evaluation, send continue message
                        testPhase = 2;
                        setTimeout(() => {
                            sendContinueMessage();
                        }, 1000);
                    } else if (testPhase === 2) {
                        // After receiving continuation response, we're done
                        outputChannel.appendLine('✅ All message types tested successfully!');
                        setTimeout(() => {
                            ws.close();
                        }, 1000);
                    }
                    
                } catch (e) {
                    outputChannel.appendLine(data.toString());
                }
            });
            
            ws.on('error', (error) => {
                outputChannel.appendLine(`❌ Error connecting to MCP server: ${error.message}`);
            });
            
            ws.on('close', () => {
                outputChannel.appendLine('WebSocket connection closed');
            });
        } catch (error) {
            outputChannel.appendLine(`❌ Error testing MCP connection: ${error}`);
        }
    }
    
    // Test 6: Check if extension can detect GitHub Copilot Chat via API
    outputChannel.appendLine('');
    outputChannel.appendLine('Test 6: Check for GitHub Copilot Chat API access...');
    
    if (copilotChatExtension && copilotChatExtension.isActive) {
        try {
            const copilotChatApi = copilotChatExtension.exports;
            
            if (copilotChatApi) {
                outputChannel.appendLine('✅ GitHub Copilot Chat exports available:');
                outputChannel.appendLine(JSON.stringify(Object.keys(copilotChatApi), null, 2));
            } else {
                outputChannel.appendLine('⚠️ GitHub Copilot Chat does not expose a public API');
                outputChannel.appendLine('The extension cannot directly access chat messages.');
            }
        } catch (error) {
            outputChannel.appendLine(`❌ Error accessing GitHub Copilot Chat API: ${error}`);
        }
    } else {
        outputChannel.appendLine('⚠️ GitHub Copilot Chat extension not active');
    }
    
    // Completion message
    outputChannel.appendLine('');
    outputChannel.appendLine('=== Diagnostic Tests Completed ===');
    outputChannel.appendLine('Check the logs above for details on each test');
}

module.exports = {
    runDiagnosticTests
};
