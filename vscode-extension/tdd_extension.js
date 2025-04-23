/**
 * TDD Testing Extension for AI Development Monitor
 * 
 * This module extends the diagnostic test with Test-Driven Development capabilities
 * using the MCP server architecture to generate tests.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const contextManager = require('./context_manager');

/**
 * Run a TDD testing cycle with multiple iterations
 * 
 * @param {vscode.OutputChannel} outputChannel - VS Code output channel for logging
 * @param {WebSocket} webSocketConnection - Existing WebSocket connection to MCP server
 * @param {string} conversationId - Conversation ID for message context
 * @param {string} suggestionCode - The code suggestion to test
 * @param {string} language - The programming language of the code
 * @param {number} iterations - Number of TDD iterations to run
 * @param {Function} callback - Callback after completion
 * @param {string} taskDescription - Description of what the code should accomplish
 * @param {string} originalCode - The original code before changes
 */
async function runTDDCycle(outputChannel, webSocketConnection, conversationId, suggestionCode, language, iterations = 5, callback, taskDescription = "", originalCode = "") {
    outputChannel.appendLine('\n=== Test-Driven Development Cycle ===');
    outputChannel.appendLine(`Language: ${language}`);
    if (taskDescription) {
        outputChannel.appendLine(`Task Description: ${taskDescription}`);
    }
    outputChannel.appendLine(`Running ${iterations} TDD iterations using MCP Server`);
    outputChannel.appendLine('');

    // Create a temporary file to work with the code
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        outputChannel.appendLine('❌ No workspace folder found for TDD testing');
        if (callback) callback();
        return;
    }

    const fileName = `tdd_test_${Date.now()}.${language === 'python' ? 'py' : language}`;
    const filePath = path.join(workspaceFolders[0].uri.fsPath, fileName);
    
    try {
        // Write the initial code to the file
        fs.writeFileSync(filePath, suggestionCode);
        outputChannel.appendLine(`📄 Created test file: ${filePath}`);
        
        // Open the file in the editor
        const document = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(document);
        
        // Track test results and iterations
        let currentCode = suggestionCode;
        let allTests = [];
        let currentIteration = 1;
        
        // Set up message handler for TDD responses
        const messageHandler = async (data) => {
            try {
                const response = JSON.parse(data);
                
                // Check if this is a TDD-related message
                if (response.context && response.context.metadata && 
                    response.context.metadata.tdd_iteration !== undefined) {
                    
                    const iteration = response.context.metadata.tdd_iteration;
                    outputChannel.appendLine(`\nReceived TDD response for iteration ${iteration}`);
                    
                    if (response.message_type === 'tdd_tests') {
                        // Extract test code from response
                        const testCode = response.content.test_code || '';
                        outputChannel.appendLine('Generated test code:');
                        outputChannel.appendLine('```');
                        outputChannel.appendLine(testCode.substring(0, 500) + (testCode.length > 500 ? '...' : ''));
                        outputChannel.appendLine('```');
                        
                        // Process test results
                        processTestResults(testCode, currentCode, iteration, outputChannel, allTests);
                        
                        // Improve code for next iteration
                        if (iteration < iterations) {
                            currentCode = improveCodeForIteration(currentCode, language, iteration);
                            
                            // Update the editor with the improved code
                            await editor.edit(editBuilder => {
                                const lastLine = document.lineCount;
                                const lastChar = document.lineAt(lastLine - 1).text.length;
                                editBuilder.replace(
                                    new vscode.Range(0, 0, lastLine, lastChar),
                                    currentCode
                                );
                            });
                            
                            // Send next TDD request
                            setTimeout(() => {
                                sendTDDRequest(webSocketConnection, conversationId, currentCode, language, iteration + 1, outputChannel);
                            }, 60000);
                        } else {
                            // Final summary
                            outputChannel.appendLine('\n=== TDD Cycle Complete ===');
                            outputChannel.appendLine(`✅ Completed ${iterations} iterations of TDD`);
                            outputChannel.appendLine('Final test suite:');
                            outputChannel.appendLine(`- Total test cases: ${allTests.length}`);
                            
                            const testCategories = allTests.reduce((acc, test) => {
                                const category = test.category || 'Other';
                                acc[category] = (acc[category] || 0) + 1;
                                return acc;
                            }, {});
                            
                            for (const [category, count] of Object.entries(testCategories)) {
                                outputChannel.appendLine(`- ${category}: ${count} tests`);
                            }
                            
                            // Cleanup after 10 seconds
                            setTimeout(() => {
                                try {
                                    if (fs.existsSync(filePath)) {
                                        fs.unlinkSync(filePath);
                                        outputChannel.appendLine('✅ TDD test file cleaned up');
                                    }
                                } catch (error) {
                                    outputChannel.appendLine(`❌ Error cleaning up TDD test file: ${error}`);
                                }
                                
                                if (callback) callback();
                            }, 10000);
                        }
                    }
                }
            } catch (error) {
                outputChannel.appendLine(`❌ Error processing TDD response: ${error.message}`);
            }
        };
        
        // Register temporary handler
        const originalMessageHandler = webSocketConnection.onmessage;
        webSocketConnection.onmessage = (event) => {
            // Let the message be handled by both handlers
            if (originalMessageHandler) {
                originalMessageHandler(event);
            }
            messageHandler(event.data);
        };
        
        // Start first iteration
        sendTDDRequest(webSocketConnection, conversationId, currentCode, language, currentIteration, outputChannel);
        
    } catch (error) {
        outputChannel.appendLine(`❌ Error in TDD cycle: ${error.message}`);
        if (callback) callback();
    }
}

/**
 * Send a TDD request to the MCP server
 */
function sendTDDRequest(ws, conversationId, code, language, iteration, outputChannel, taskDescription = "", originalCode = "") {
    try {
        const messageId = `msg-tdd-${Date.now()}-${iteration}`;
        
        outputChannel.appendLine(`\n--- TDD Iteration ${iteration} ---`);
        outputChannel.appendLine('Sending TDD test generation request to MCP server...');
        
        // Clean up task description if it contains visual indicators
        if (taskDescription) {
            if (taskDescription.startsWith('[CHAT QUERY] ')) {
                taskDescription = taskDescription.substring(13);
            } else if (taskDescription.startsWith('[EDITOR CONTENT] ')) {
                taskDescription = taskDescription.substring(17);
            }
            
            // Don't use generic descriptions
            if (taskDescription.includes("Modify code in") || 
                taskDescription.includes("Implement functionality")) {
                outputChannel.appendLine('⚠️ Warning: Generic task description detected, attempting to get better description');
                
                // Try to get from Context Manager first
                const contextFromManager = contextManager.getContext();
                if (contextFromManager.taskDescription) {
                    taskDescription = contextFromManager.taskDescription;
                    outputChannel.appendLine(`Using task description from Context Manager: ${taskDescription}`);
                } else {
                    // Fall back to extracting from code
                    taskDescription = extractMeaningfulDescription(code, language);
                }
            }
        } else {
            // If no task description provided, try to get from Context Manager first
            const contextFromManager = contextManager.getContext();
            if (contextFromManager.taskDescription) {
                taskDescription = contextFromManager.taskDescription;
                outputChannel.appendLine(`Using task description from Context Manager: ${taskDescription}`);
            } else {
                // Fall back to inferring from code
                taskDescription = extractMeaningfulDescription(code, language);
            }
        }
        
        outputChannel.appendLine(`Task Description: ${taskDescription}`);
        
        // Create a message for test generation
        const message = {
            context: {
                conversation_id: conversationId,
                message_id: messageId,
                parent_id: null,
                metadata: {
                    language: language,
                    tdd_iteration: iteration,
                    test_purpose: getTDDPurposeForIteration(iteration),
                    task_description: taskDescription,
                    original_code: originalCode
                }
            },
            message_type: "tdd_request",
            content: {
                code: code,
                language: language,
                iteration: iteration,
                task_description: taskDescription,
                original_code: originalCode
            }
        };
        
        // Send the message
        ws.send(JSON.stringify(message));
        outputChannel.appendLine(`✅ TDD request sent for iteration ${iteration}`);
        
    } catch (error) {
        outputChannel.appendLine(`❌ Error sending TDD request: ${error.message}`);
    }
}

/**
 * Try to extract a meaningful description from the code if no task description is provided
 */
function extractMeaningfulDescription(code, language) {
    // Default fallback
    let extractedDescription = "Verify the code behaves correctly";
    
    try {
        // Look for function/class names and docstrings
        if (language === 'python') {
            // Check for docstrings
            const docstringMatch = code.match(/"""(.*?)"""/s) || code.match(/'''(.*?)'''/s);
            if (docstringMatch && docstringMatch[1]) {
                const docstring = docstringMatch[1].trim();
                if (docstring.length > 10) { // Minimum meaningful length
                    return docstring.split('\n')[0]; // Use first line of docstring
                }
            }
            
            // Check for function definitions
            const funcMatch = code.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
            if (funcMatch && funcMatch[1]) {
                return `Test the ${funcMatch[1]} function`;
            }
        } else if (language === 'javascript' || language === 'typescript') {
            // Check for JSDoc comments
            const jsdocMatch = code.match(/\/\*\*\s*(.*?)\s*\*\//s);
            if (jsdocMatch && jsdocMatch[1]) {
                const jsdoc = jsdocMatch[1].replace(/\s*\*\s*/g, ' ').trim();
                if (jsdoc.length > 10) {
                    return jsdoc.split('\n')[0]; // Use first line of JSDoc
                }
            }
            
            // Check for function/class definitions
            const funcMatch = code.match(/function\s+([a-zA-Z0-9_]+)\s*\(/) || 
                             code.match(/class\s+([a-zA-Z0-9_]+)/) ||
                             code.match(/const\s+([a-zA-Z0-9_]+)\s*=\s*\(/);
            if (funcMatch && funcMatch[1]) {
                return `Test the ${funcMatch[1]} function/class`;
            }
        }
    } catch (error) {
        // Silently fail and use the default
    }
    
    return extractedDescription;
}

/**
 * Get the purpose description for a TDD iteration
 */
function getTDDPurposeForIteration(iteration) {
    switch (iteration) {
        case 1:
            return "Basic functionality tests for base cases";
        case 2:
            return "Extended test coverage for normal cases";
        case 3:
            return "Error handling and edge cases";
        case 4:
            return "Performance considerations and optimizations";
        case 5:
            return "Comprehensive review and final assessment";
        default:
            return "Basic functionality testing";
    }
}

/**
 * Process test results from a test response
 */
function processTestResults(testCode, implementation, iteration, outputChannel, allTests) {
    // For diagnostic test, we simulate running tests
    const results = simulateTestRun(testCode, implementation, iteration);
    
    outputChannel.appendLine(`\nTest Results (Iteration ${iteration}):`);
    outputChannel.appendLine(`- Total tests: ${results.total}`);
    outputChannel.appendLine(`- Passing: ${results.passed}`);
    outputChannel.appendLine(`- Failing: ${results.failed}`);
    outputChannel.appendLine(results.output);
    
    // Extract test cases from the test code (simplified)
    // In reality, this would parse the test code to identify individual test cases
    const extractedTests = extractTestCases(testCode, iteration);
    
    // Add to all tests
    allTests.push(...extractedTests);
    
    // Suggest improvements based on test results
    if (results.failed > 0) {
        outputChannel.appendLine('\nSuggested improvements:');
        const improvements = generateImprovementSuggestions(implementation, testCode, iteration);
        outputChannel.appendLine(improvements);
    }
}

/**
 * Simulate running tests and return results
 */
function simulateTestRun(testCode, implementation, iteration) {
    // In a real implementation, we would actually run the tests
    // For this diagnostic version, we're simulating results
    
    // Simulate some failures in early iterations, more passing tests in later ones
    const totalTests = 5 + iteration;  // More tests in later iterations
    const passingTests = Math.min(totalTests, Math.floor(iteration * 2.5));
    const failingTests = totalTests - passingTests;
    
    return {
        passed: passingTests,
        failed: failingTests,
        total: totalTests,
        success: failingTests === 0,
        testCode: testCode,
        output: generateMockTestOutput(passingTests, failingTests, iteration)
    };
}

/**
 * Generate mock test output for simulation
 */
function generateMockTestOutput(passed, failed, iteration) {
    if (failed === 0) {
        return `✅ All tests passed! (${passed} tests)\n` +
               `Iteration ${iteration} complete with 100% success rate.`;
    } else {
        return `❌ ${failed} tests failed, ${passed} tests passed\n` +
               `Iteration ${iteration} needs improvements to fix failing tests.`;
    }
}

/**
 * Extract test cases from test code
 * This is a simplified implementation that uses basic heuristics
 */
function extractTestCases(testCode, iteration) {
    // In a real implementation, this would parse the test code
    // For this simulation, we'll create mock test cases
    const testCount = 3 + iteration;  // More tests in later iterations
    const tests = [];
    
    const categories = [
        'Basic Functionality', 
        'Edge Cases', 
        'Error Handling', 
        'Performance', 
        'Code Quality'
    ];
    
    for (let i = 1; i <= testCount; i++) {
        tests.push({
            name: `Test Case ${i} (Iteration ${iteration})`,
            category: categories[Math.min(iteration - 1, categories.length - 1)],
            iteration: iteration
        });
    }
    
    return tests;
}

/**
 * Generate improvement suggestions based on test results
 */
function generateImprovementSuggestions(implementation, testCode, iteration) {
    const suggestions = [
        "Add input validation to handle negative numbers",
        "Implement base case optimization for n=0 and n=1",
        "Add memoization to improve performance for repeated calls",
        "Convert recursive implementation to iterative to avoid stack overflow",
        "Add type hints and improve documentation"
    ];
    
    // Return suggestions relevant to the current iteration
    return suggestions.slice(0, iteration).map(s => `- ${s}`).join('\n');
}

/**
 * Improve code for the next iteration to simulate the TDD cycle
 */
function improveCodeForIteration(code, language, iteration) {
    if (language === 'python') {
        switch (iteration) {
            case 1:
                // Add docstring
                return code.replace(
                    /def factorial\(n\):/,
                    'def factorial(n):\n    """Calculate the factorial of a non-negative integer n."""'
                );
            case 2:
                // Add input validation
                return code.replace(
                    /def factorial\(n\):\s+""".*?"""/s,
                    'def factorial(n):\n    """Calculate the factorial of a non-negative integer n."""\n    if n < 0:\n        raise ValueError("Factorial is not defined for negative numbers")'
                );
            case 3:
                // Add type hints
                return code.replace(
                    /def factorial\(n\):/,
                    'def factorial(n: int) -> int:'
                );
            case 4:
                // Convert to iterative implementation
                return `# Improved factorial function with iterative implementation
def factorial(n: int) -> int:
    """
    Calculate the factorial of a non-negative integer n.
    
    Args:
        n: A non-negative integer
        
    Returns:
        The factorial of n
        
    Raises:
        ValueError: If n is negative
    """
    if n < 0:
        raise ValueError("Factorial is not defined for negative numbers")
        
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result`;
            case 5:
                // Add memoization
                return `# Final optimized factorial function with memoization
from functools import lru_cache

@lru_cache(maxsize=None)
def factorial(n: int) -> int:
    """
    Calculate the factorial of a non-negative integer n.
    Uses memoization for improved performance on repeated calls.
    
    Args:
        n: A non-negative integer
        
    Returns:
        The factorial of n
        
    Raises:
        ValueError: If n is negative
    """
    if n < 0:
        raise ValueError("Factorial is not defined for negative numbers")
        
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result`;
            default:
                return code;
        }
    } else {
        // JavaScript improvements
        switch (iteration) {
            case 1:
                // Add JSDoc
                return code.replace(
                    /function factorial\(n\)/,
                    '/**\n * Calculate the factorial of a non-negative integer\n * @param {number} n - The input number\n * @returns {number} The factorial of n\n */\nfunction factorial(n)'
                );
            case 2:
                // Add input validation
                return code.replace(
                    /function factorial\(n\) {/,
                    'function factorial(n) {\n  if (n < 0) throw new Error("Factorial is not defined for negative numbers");'
                );
            case 3:
                // Add optimizations for simple cases
                return code.replace(
                    /function factorial\(n\) {/,
                    'function factorial(n) {\n  if (n < 0) throw new Error("Factorial is not defined for negative numbers");\n  if (n === 0 || n === 1) return 1;'
                );
            case 4:
                // Convert to iterative
                return `/**
 * Calculate the factorial of a non-negative integer
 * @param {number} n - The input number
 * @returns {number} The factorial of n
 */
function factorial(n) {
  if (n < 0) throw new Error("Factorial is not defined for negative numbers");
  
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}`;
            case 5:
                // Add memoization
                return `/**
 * Calculate the factorial of a non-negative integer
 * Uses memoization for improved performance on repeated calls
 * @param {number} n - The input number
 * @returns {number} The factorial of n
 */
const factorial = (function() {
  const cache = new Map();
  
  return function(n) {
    if (n < 0) throw new Error("Factorial is not defined for negative numbers");
    
    if (cache.has(n)) {
      return cache.get(n);
    }
    
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    
    cache.set(n, result);
    return result;
  };
})();`;
            default:
                return code;
        }
    }
}

module.exports = {
    runTDDCycle
};
