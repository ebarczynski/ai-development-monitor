// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

// Diagnostic Test for AI Development Monitor Extension
// This file will help test if the extension can react to GitHub Copilot Chat 
// messages and detect file changes in the editor

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const tddExtension = require('./tdd_extension');
const OptimizedMCPClient = require('./optimized_mcp_client');
const AIMonitorPanel = require('./ai_monitor_panel');

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
                        
                        // Start TDD cycle with the suggestion code
                        const suggestionMessage = {
                            content: {
                                original_code: "# Write a function to calculate factorial\n\ndef factorial(n):\n    pass",
                                proposed_changes: "# Write a function to calculate factorial\n\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n-1)",
                                language: "python",
                                task_description: "Implement a recursive factorial function that calculates the factorial of a non-negative integer."
                            }
                        };
                        
                        // Run TDD cycle with the suggestion code
                        outputChannel.appendLine('\n=== Starting TDD Testing Cycle ===');
                        outputChannel.appendLine('Using MCP server to generate tests for the factorial function');
                        
                        tddExtension.runTDDCycle(
                            outputChannel,
                            ws,
                            conversationId, 
                            suggestionMessage.content.proposed_changes,
                            suggestionMessage.content.language,
                            5,
                            () => {
                                // After TDD cycle, continue with the next test phase
                                setTimeout(() => {
                                    sendContinueMessage();
                                }, 1000);
                            },
                            suggestionMessage.content.task_description,
                            suggestionMessage.content.original_code
                        );
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
    
    // Test 7: Test Optimized MCP Client communication features
    outputChannel.appendLine('');
    outputChannel.appendLine('Test 7: Testing Optimized MCP Client communication features...');
    
    if (!config.get('useMcp', false)) {
        outputChannel.appendLine('⚠️ MCP is disabled in settings. Enable it to test the optimized client.');
    } else {
        try {
            // Initialize the optimized client
            const optimizedClient = new OptimizedMCPClient();
            outputChannel.appendLine('✅ Optimized MCP Client instantiated');
            
            // Connect to the server
            await optimizedClient.connect();
            outputChannel.appendLine('✅ Connected to MCP server with optimized client');
            
            // Test 7.1: Test compression with a large message
            outputChannel.appendLine('\nTest 7.1: Testing message compression...');
            
            // Create a large payload to ensure compression is triggered
            const largeContent = {
                code: generateLargeCode(5000), // Generate large code content to trigger compression
                language: "javascript",
                iteration: 1,
                task_description: "Testing compression with a large message payload",
                original_code: "",
                max_iterations: 2 // Reduce to 2 iterations for faster diagnostics
            };
            
            // Set a longer timeout for TDD operations
            const tddTimeout = 180000; // 3 minutes for TDD operations
            
            try {
                outputChannel.appendLine('Sending large message to test compression...');
                outputChannel.appendLine('This may take up to 3 minutes for the backend to process.');
                
                const startTime = Date.now();
                const compressionResponse = await Promise.race([
                    optimizedClient.sendMessage('tdd_request', largeContent, null),
                    new Promise((_, reject) => setTimeout(() => 
                        reject(new Error('Operation timed out after 3 minutes')), tddTimeout))
                ]);
                const compressionTime = Date.now() - startTime;
                
                outputChannel.appendLine(`✅ Request completed in ${compressionTime}ms`);
                outputChannel.appendLine('Response received from backend:');
                outputChannel.appendLine(JSON.stringify(compressionResponse, null, 2).substring(0, 500) + '...');
                
                // Get statistics to verify compression worked
                const stats = optimizedClient.getStatistics();
                outputChannel.appendLine('Compression statistics:');
                outputChannel.appendLine(`- Messages compressed: ${stats.compressed}`);
                outputChannel.appendLine(`- Compression ratio: ${stats.compressionRatio}`);
                outputChannel.appendLine(`- Bytes saved: ${formatBytes(stats.savedBytes)}`);
                
                if (stats.compressed > 0 && stats.savedBytes > 0) {
                    outputChannel.appendLine('✅ Message compression is working properly');
                } else {
                    outputChannel.appendLine('⚠️ Message compression may not be functioning as expected');
                }
            } catch (error) {
                outputChannel.appendLine(`⚠️ Large message test timed out or failed: ${error.message}`);
                outputChannel.appendLine('Continuing with other tests...');
            }
            
            // Test 7.2: Test message batching
            outputChannel.appendLine('\nTest 7.2: Testing message batching...');
            
            // Send multiple small messages quickly to trigger batching
            const batchPromises = [];
            const batchCount = 3;
            
            for (let i = 0; i < batchCount; i++) {
                const smallContent = {
                    message: `Test batch message ${i + 1}`,
                    timestamp: Date.now(),
                    index: i
                };
                
                // Use suggestion message type which is better supported by server
                batchPromises.push(optimizedClient.sendMessage('suggestion', smallContent, null, 1)); // 1 = MEDIUM priority
            }
            
            // Wait for all messages to complete
            await Promise.all(batchPromises);
            
            // Check batching statistics
            const batchStats = optimizedClient.getStatistics();
            outputChannel.appendLine(`Messages batched: ${batchStats.batched}`);
            
            if (batchStats.batched > 0) {
                outputChannel.appendLine('✅ Message batching is working properly');
            } else {
                outputChannel.appendLine('⚠️ Message batching may not be functioning as expected');
            }
            
            // Test 7.3: Test connection quality monitoring
            outputChannel.appendLine('\nTest 7.3: Testing connection quality monitoring...');
            
            // Measure connection quality
            try {
                // Just check if the connection quality stats are available
                const qualityStats = optimizedClient.getStatistics();
                
                outputChannel.appendLine(`Connection quality: ${qualityStats.connectionQuality || 'unknown'}`);
                outputChannel.appendLine(`Average latency: ${qualityStats.averageLatency?.toFixed(1) || 'unknown'}ms`);
                
                if (qualityStats.connectionQuality && qualityStats.connectionQuality !== 'unknown') {
                    outputChannel.appendLine('✅ Connection quality monitoring is working properly');
                } else {
                    outputChannel.appendLine('⚠️ Connection quality monitoring may not be functioning as expected');
                }
            } catch (error) {
                outputChannel.appendLine(`⚠️ Error measuring connection quality: ${error.message}`);
            }
            
            // Display overall optimization results
            outputChannel.appendLine('\nOptimized MCP Client Overall Statistics:');
            outputChannel.appendLine(`- Total messages sent: ${qualityStats.sent}`);
            outputChannel.appendLine(`- Total messages received: ${qualityStats.received}`);
            outputChannel.appendLine(`- Total bytes sent: ${formatBytes(qualityStats.totalBytesSent)}`);
            outputChannel.appendLine(`- Total bytes received: ${formatBytes(qualityStats.totalBytesReceived)}`);
            outputChannel.appendLine(`- Compression ratio: ${qualityStats.compressionRatio}`);
            
            // Clean up resources
            optimizedClient.dispose();
            outputChannel.appendLine('✅ Optimized MCP Client resources released');
            
        } catch (error) {
            outputChannel.appendLine(`❌ Error testing optimized MCP client: ${error.message}`);
            outputChannel.appendLine(error.stack);
        }
    }
    
    // Completion message
    outputChannel.appendLine('');
    outputChannel.appendLine('=== Diagnostic Tests Completed ===');
    outputChannel.appendLine('Check the logs above for details on each test');
}

module.exports = {
    runDiagnosticTests
};

/**
 * Format bytes to human-readable format
 * @param {number} bytes Number of bytes to format
 * @returns {string} Human-readable string
 */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Generate large code content for testing compression
 * @param {number} size Approximate size in characters
 * @returns {string} Large code content
 */
function generateLargeCode(size) {
    let code = '/**\n * This is a large function to test compression\n * with repeated content to ensure good compression ratios\n */\n\n';
    
    // Add function declaration
    code += 'function processLargeDataSet(data) {\n';
    code += '  const results = [];\n';
    code += '  const cache = new Map();\n\n';
    
    // Generate repetitive code to get good compression
    while (code.length < size) {
        code += '  // Process the data with multiple steps\n';
        code += '  for (let i = 0; i < data.length; i++) {\n';
        code += '    const item = data[i];\n';
        code += '    if (cache.has(item.id)) {\n';
        code += '      results.push(cache.get(item.id));\n';
        code += '      continue;\n';
        code += '    }\n\n';
        code += '    const processed = {\n';
        code += '      id: item.id,\n';
        code += '      name: item.name,\n';
        code += '      value: item.value * 2,\n';
        code += '      timestamp: Date.now(),\n';
        code += '      processed: true,\n';
        code += '      metadata: {\n';
        code += '        source: "compression-test",\n';
        code += '        version: "1.0.0",\n';
        code += '        complexity: "high",\n';
        code += '        author: "diagnostic-test"\n';
        code += '      }\n';
        code += '    };\n\n';
        code += '    cache.set(item.id, processed);\n';
        code += '    results.push(processed);\n';
        code += '  }\n\n';
    }
    
    code += '  return results;\n';
    code += '}\n\n';
    code += 'module.exports = processLargeDataSet;';
    
    return code;
}
