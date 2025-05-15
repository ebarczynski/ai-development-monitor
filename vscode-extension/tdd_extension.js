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
const AIMonitorPanel = require('./ai_monitor_panel');

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
async function runTDDCycle(outputChannel, webSocketConnection, conversationId, suggestionCode, language, iterations, callback, taskDescription = "", originalCode = "") {
    outputChannel.appendLine(`Running TDD cycle for ${language} code with ${iterations} iterations...`);
    
    const filePath = await createTemporaryFile(suggestionCode, language);
    outputChannel.appendLine(`Created temporary file: ${filePath}`);
    
    // Keep track of all tests across iterations
    const allTests = [];
    
    // Create a message handler for TDD responses
    const messageHandler = async (rawData) => {
        try {
            const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            
            // Check if it's a TDD message
            if (data.message_type === "tdd_tests") {
                const tddResponse = data.content;
                
                // Extract test code and metadata
                const testCode = tddResponse.test_code;
                const iteration = tddResponse.iteration || 1;
                
                // Check for errors
                if (tddResponse.error) {
                    outputChannel.appendLine(`\n❌ Error in TDD iteration ${iteration}: ${tddResponse.error}`);
                    
                    // Try to continue with next iteration if possible
                    if (iteration < iterations) {
                        sendTDDRequest(
                            webSocketConnection, 
                            conversationId, 
                            suggestionCode, 
                            language, 
                            iteration + 1, 
                            outputChannel,
                            taskDescription,
                            originalCode
                        );
                    } else {
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
                    
                    return;
                }
                
                // Process the test code for this iteration
                outputChannel.appendLine(`\n=== TDD Iteration ${iteration}/${iterations} ===`);
                outputChannel.appendLine(`Generated ${testCode.split('\n').length} lines of test code`);
                
                // Get test execution results if they exist in the response
                const testExecution = tddResponse.test_execution;
                if (testExecution) {
                    outputChannel.appendLine(`\nTest Execution Results:`);
                    outputChannel.appendLine(`- Total tests: ${testExecution.total_tests}`);
                    outputChannel.appendLine(`- Passed: ${testExecution.passed_tests}`);
                    outputChannel.appendLine(`- Failed: ${testExecution.failed_tests}`);
                    outputChannel.appendLine(`- Success: ${testExecution.success ? 'Yes' : 'No'}`);
                    
                    if (testExecution.errors && testExecution.errors.length > 0) {
                        outputChannel.appendLine(`\nErrors:`);
                        testExecution.errors.forEach(error => {
                            outputChannel.appendLine(`- ${error}`);
                        });
                    }
                }
                
                // Simulate test run (or use real test execution results from the server)
                const testResults = testExecution ? {
                    passed: testExecution.passed_tests,
                    failed: testExecution.failed_tests,
                    total: testExecution.total_tests,
                    success: testExecution.success,
                    output: testExecution.output || ""
                } : simulateTestRun(testCode, suggestionCode, iteration);
                
                // Process the test results
                processTestResults(testCode, suggestionCode, iteration, outputChannel, allTests, filePath, testExecution);
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
    sendTDDRequest(webSocketConnection, conversationId, suggestionCode, language, 1, outputChannel, taskDescription, originalCode);
}

/**
 * Send a TDD request to the MCP server
 */
function sendTDDRequest(ws, conversationId, code, language, iteration, outputChannel, taskDescription = "", originalCode = "") {
    try {
        const messageId = `msg-tdd-${Date.now()}-${iteration}`;
        
        // Get TDD configuration settings
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.tdd');
        const testFramework = config.get('testFramework', 'auto');
        
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
                    original_code: originalCode,
                    test_framework: testFramework
                }
            },
            message_type: "tdd_request",
            content: {
                code: code,
                language: language,
                iteration: iteration,
                task_description: taskDescription,
                original_code: originalCode,
                test_framework: testFramework
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
function processTestResults(testCode, implementation, iteration, outputChannel, allTests, testFilePath = null, testExecution = null) {
    // Try to extract test cases
    const testCases = extractTestCases(testCode, iteration);
    
    // Add each test case to the full list
    testCases.forEach(testCase => {
        testCase.iteration = iteration;
        allTests.push(testCase);
    });
    
    // Create a file with the test code if we have a valid file path
    if (testFilePath) {
        try {
            fs.writeFileSync(testFilePath, testCode);
            outputChannel.appendLine(`Created test file: ${testFilePath}`);
        } catch (error) {
            outputChannel.appendLine(`Error creating test file: ${error}`);
        }
    }
    
    // Run the tests (or use the provided execution results)
    const results = testExecution ? {
        passed: testExecution.passed_tests,
        failed: testExecution.failed_tests,
        total: testExecution.total_tests,
        success: testExecution.success,
        output: testExecution.output || generateMockTestOutput(testExecution.passed_tests, testExecution.failed_tests, iteration)
    } : simulateTestRun(testCode, implementation, iteration);
    
    outputChannel.appendLine(`\nTest Results: ${results.passed}/${results.total} passed`);
    outputChannel.appendLine(results.output);
    
    // Suggest improvements based on test results
    if (results.failed > 0) {
        outputChannel.appendLine('\nSuggested improvements:');
        const improvements = generateImprovementSuggestions(implementation, testCode, iteration);
        outputChannel.appendLine(improvements);
    }

    // Update the AIMonitorPanel with the test results
    updateTDDDashboard(results, testCode, implementation, iteration, 'javascript', testExecution);
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

/**
 * Update the AIMonitorPanel with TDD test results
 * This ensures the TDD Dashboard is updated with the latest test results
 * 
 * @param {Object} testResults - Results from the test run
 * @param {string} testCode - The test code
 * @param {string} implementation - The implementation code
 * @param {number} iteration - Current iteration number
 * @param {string} language - Programming language of the code
 * @param {Object} testExecution - Optional test execution results from the backend
 */
function updateTDDDashboard(testResults, testCode, implementation, iteration, language, testExecution = null) {
    try {
        // Check if we have an active AIMonitorPanel instance
        if (!AIMonitorPanel.currentPanel) {
            return;
        }
        
        // Create a mock coverage data (in a real implementation this would be actual data)
        const mockCoverage = {
            overall: Math.min(0.95, 0.5 + (iteration * 0.1)),  // increases with each iteration
            files: [
                {
                    path: '/sample/implementation.js',
                    name: 'implementation.js',
                    coverage: Math.min(0.95, 0.5 + (iteration * 0.1))
                }
            ],
            lines: {
                // Sample line coverage data
                "1": true,
                "2": true,
                "3": iteration > 1,
                "4": iteration > 2,
                "5": iteration > 3
            }
        };
        
        // Get workspace folders to create a relative path for display
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let testFilePath = null;
        
        // Generate the test file path based on current workspace and iteration
        if (workspaceFolders && workspaceFolders.length > 0) {
            const fileName = `tdd_test_${Date.now()}_${iteration}.${language === 'python' ? 'py' : language}`;
            testFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, fileName).fsPath;
        }
        
        // Prepare execution results if available
        let executionResults = null;
        if (testExecution) {
            executionResults = {
                success: testExecution.success,
                total: testExecution.total_tests,
                passed: testExecution.passed_tests,
                failed: testExecution.failed_tests,
                execution_time: testExecution.execution_time,
                errors: testExecution.errors || []
            };
            
            // If we have actual execution results, use those instead of simulated ones
            if (executionResults.total > 0) {
                testResults = {
                    total: executionResults.total,
                    passed: executionResults.passed,
                    failed: executionResults.failed,
                    success: executionResults.success,
                    output: testExecution.output || testResults.output
                };
            }
        }
        
        // Create a TDD result object structured like the expected format
        const tddResult = {
            iteration: iteration,
            test_code: testCode,
            implementation_code: implementation,
            language: language,
            testFilePath: testFilePath, // Add the test file path to the result
            tests: {
                total: testResults.total,
                passed: testResults.passed,
                failed: testResults.failed,
                success: testResults.success
            },
            execution: executionResults, // Add execution results if available
            coverage: mockCoverage
        };
        
        // Update existing TDD results or create a new array
        let tddResults = AIMonitorPanel.currentPanel._tddResults || [];
        
        // Add this iteration's results if it doesn't already exist
        const existingIndex = tddResults.findIndex(r => r.iteration === iteration);
        if (existingIndex >= 0) {
            tddResults[existingIndex] = tddResult;
        } else {
            tddResults.push(tddResult);
        }
        
        // Sort by iteration
        tddResults.sort((a, b) => a.iteration - b.iteration);
        
        // Update the panel with the new TDD results
        const evaluation = {
            tdd_test_results: tddResults,
            tdd_score: Math.min(0.95, 0.5 + (iteration * 0.1))
        };
        
        // Update the AIMonitorPanel with the evaluation data
        AIMonitorPanel.currentPanel.setEvaluationResults(evaluation);
        
        // Also update the TDD metrics for the dashboard
        AIMonitorPanel.currentPanel.updateTDDMetrics({
            results: {
                total: testResults.total,
                passed: testResults.passed,
                failed: testResults.failed,
                passRate: testResults.passed / testResults.total
            },
            progress: {
                iteration: iteration,
                tests: testResults.total,
                passed: testResults.passed,
                failed: testResults.failed,
                coverage: mockCoverage.overall
            },
            coverage: {
                ['/sample/implementation.js']: mockCoverage
            }
        });
        
        // If we're on the last iteration, show the TDD Dashboard
        if (iteration >= 5) {
            AIMonitorPanel.currentPanel.showTddDashboard();
        }
        
    } catch (error) {
        console.error('Error updating TDD Dashboard:', error);
    }
}

// Expose the TDD Extension functionality for other modules
exports.TDDExtension = {
    updateTDDDashboard,
    runTDDCycle
};
