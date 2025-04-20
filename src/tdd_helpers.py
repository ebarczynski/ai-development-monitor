"""
TDD Helpers for MCP Server

This module provides helper functions for handling Test-Driven Development
requests in the MCP server.
"""
import json
import logging
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger(__name__)

"""
TDD Helpers for MCP Server

This module provides helper functions for handling Test-Driven Development
requests in the MCP server.
"""
import json
import logging
from typing import Dict, Any, Optional, Union
from fastapi import WebSocket
from pydantic import BaseModel

# Import from MCP server
# These need to be imported here to avoid circular imports
from src.web_interface import add_to_logs

# Configure logging
logger = logging.getLogger(__name__)

# Forward references for type hints
MCPMessage = Any  # This will be replaced with the actual import at runtime

async def handle_tdd_request(message, websocket: WebSocket):
    """Handle a TDD test generation request"""
    global agent
    
    # Extract TDD request data
    tdd_request = message.content
    
    # Check if content is a dict or a Pydantic model
    if hasattr(tdd_request, "__dict__"):
        # It's a Pydantic model
        tdd_dict = tdd_request.dict() if hasattr(tdd_request, "dict") else tdd_request.__dict__
        code = tdd_dict.get("code", "")
        language = tdd_dict.get("language", "python")
        iteration = tdd_dict.get("iteration", 1)
        task_description = tdd_dict.get("task_description", "")
        original_code = tdd_dict.get("original_code", "")
    else:
        # It's a dict
        code = tdd_request.get("code", "")
        language = tdd_request.get("language", "python")
        iteration = tdd_request.get("iteration", 1)
        task_description = tdd_request.get("task_description", "")
        original_code = tdd_request.get("original_code", "")
    
    # Get additional info from metadata if available
    test_purpose = "Generate unit tests"
    if hasattr(message.context, "metadata") and message.context.metadata:
        if isinstance(message.context.metadata, dict):
            test_purpose = message.context.metadata.get("test_purpose", test_purpose)
            
            # If task description not in content, try to get it from metadata
            if not task_description and "task_description" in message.context.metadata:
                task_description = message.context.metadata.get("task_description", "")
                
            # If original code not in content, try to get it from metadata
            if not original_code and "original_code" in message.context.metadata:
                original_code = message.context.metadata.get("original_code", "")
    
    # Create prompt for the LLM
    prompt = create_tdd_test_prompt(code, language, iteration, test_purpose, task_description, original_code)
    
    # Generate tests using LLM
    generated_tests = ""
    try:
        # Use the agent to generate tests
        if agent and agent.llm_client:
            # Generate tests
            response = await agent.llm_client.generate_async(prompt)
            generated_tests = response.get("content", "")
            
            # Basic cleanup and validation
            generated_tests = cleanup_generated_tests(generated_tests, language)
        else:
            generated_tests = generate_fallback_tests(code, language, iteration, task_description)
    except Exception as e:
        logger.error(f"Error generating tests: {e}")
        generated_tests = generate_fallback_tests(code, language, iteration, task_description)
    
    # Prepare response
    response = {
        "message_type": "tdd_tests",
        "context": message.context.dict(),
        "content": {
            "test_code": generated_tests,
            "language": language,
            "iteration": iteration,
            "task_description": task_description
        }
    }
    
    # Log outgoing TDD tests
    add_to_logs("outgoing", "tdd_tests", response["content"])
    
    # Send response
    await websocket.send_text(json.dumps(response))

def create_tdd_test_prompt(code, language, iteration, test_purpose, task_description="", original_code=""):
    """Create a prompt for generating TDD tests based on iteration number and task description"""
    base_prompt = f"""
You are a test-driven development expert. Generate unit tests for the following {language} code:

```{language}
{code}
```
"""
    
    # Add task description context if available
    if task_description:
        base_prompt += f"""
The code is intended to: {task_description}

Make sure your tests verify that the code correctly fulfills this purpose.
"""

    # Add original code for comparison if available
    if original_code and original_code != code:
        base_prompt += f"""
This is a modification of the original code:

```{language}
{original_code}
```

Your tests should verify that the modifications maintain correct behavior and fulfill the intended purpose.
"""
    
    # Add specific requirements based on iteration
    iteration_prompts = {
        1: """
For this first iteration, create basic tests that verify:
1. The function exists and is callable
2. It returns the correct result for basic input values (0, 1)
3. Include simple edge cases
4. Verify the behavior aligns with the task description
""",
        2: """
For the second iteration, extend test coverage to include:
1. Testing with larger inputs (5, 10)
2. Verify correctness of results with known values
3. Add more comprehensive edge cases
4. Ensure the implementation satisfies all requirements in the task description
""",
        3: """
For the third iteration, focus on error handling:
1. Test behavior with invalid inputs (negative numbers, non-integers)
2. Check for potential exceptions or error conditions
3. Verify function handles boundary conditions correctly
4. Test edge cases specific to the task description
""",
        4: """
For the fourth iteration, focus on performance considerations:
1. Test with larger inputs that might cause stack overflow
2. Consider performance implications and possible optimizations
3. Suggest potential improvements to handle large inputs
4. Verify the implementation is efficient for the task described
""",
        5: """
For the final iteration, conduct a comprehensive review:
1. Summarize test coverage
2. Identify any remaining gaps in testing
3. Suggest code improvements based on test findings
4. Provide a final assessment of code quality
5. Evaluate how well the implementation fulfills the task description
"""
    }
    
    # Get the appropriate prompt for this iteration, or use a default one
    iteration_prompt = iteration_prompts.get(iteration, "Generate appropriate tests for this iteration.")
    
    # Add custom test purpose if provided
    if test_purpose and test_purpose != "Generate unit tests":
        iteration_prompt += f"\n\nAdditional focus: {test_purpose}"
    
    final_prompt = base_prompt + iteration_prompt + """
Return ONLY the test code in the appropriate language, nothing else. Do not include explanations, just the executable test code that can be run directly.
For Python, use pytest or unittest framework.
Ensure tests are well-structured and follow best practices for the language.
"""
    
    return final_prompt

def cleanup_generated_tests(test_code, language):
    """Clean up the generated test code to ensure it's valid"""
    # Remove markdown code block markers if present
    test_code = test_code.replace("```python", "").replace("```", "")
    
    # Add appropriate imports for the language
    if language.lower() == "python" and "import " not in test_code:
        if "unittest" in test_code:
            test_code = "import unittest\n\n" + test_code
        elif "pytest" in test_code and "pytest" not in test_code:
            test_code = "import pytest\n\n" + test_code
    
    return test_code.strip()

def generate_fallback_tests(code, language, iteration, task_description=""):
    """Generate fallback tests if LLM generation fails"""
    if language.lower() == "python":
        # Include task description in the comment if available
        task_comment = f" for {task_description}" if task_description else ""
        
        return f"""
# Fallback tests for iteration {iteration}{task_comment}
import pytest

def test_factorial_exists():
    # Verify the function exists
    assert callable(factorial)

def test_factorial_base_cases():
    # Test base cases
    assert factorial(0) == 1
    assert factorial(1) == 1

def test_factorial_normal_cases():
    # Test with known values
    assert factorial(5) == 120
    assert factorial(10) == 3628800

def test_factorial_error_handling():
    # Test error handling
    with pytest.raises(ValueError):
        factorial(-1)
"""
    else:
        # JavaScript fallback
        return f"""
// Fallback tests for iteration {iteration}
const assert = require('assert');

describe('Factorial Function', () => {{
  it('should return 1 for input of 0', () => {{
    assert.equal(factorial(0), 1);
  }});
  
  it('should return 1 for input of 1', () => {{
    assert.equal(factorial(1), 1);
  }});
  
  it('should return 120 for input of 5', () => {{
    assert.equal(factorial(5), 120);
  }});
  
  it('should handle negative inputs appropriately', () => {{
    assert.throws(() => factorial(-1), Error);
  }});
}});
"""
