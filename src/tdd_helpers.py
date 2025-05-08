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
from src.language_test_templates import get_language_specific_template
from src.enhanced_tdd_templates import enhance_tdd_prompt, get_enhanced_fallback_tests
from src.adaptive_test_generation import enhance_test_prompt_with_adaptive_strategy

# Import from MCP server
# These need to be imported here to avoid circular imports
from src.web_interface import add_to_logs

# Configure logging
logger = logging.getLogger(__name__)

# Global references
try:
    from src.monitor_agent import DevelopmentMonitorAgent
    agent = None  # Will be set by MCP server
except ImportError:
    logger.warning("Unable to import DevelopmentMonitorAgent in tdd_helpers")
    agent = None

# Default max iterations for TDD cycles
DEFAULT_MAX_ITERATIONS = 5

# Forward references for type hints
MCPMessage = Any  # This will be replaced with the actual import at runtime

def set_agent(agent_instance):
    """Set the agent instance from MCP server"""
    global agent
    agent = agent_instance
    logger.info("Agent instance set in TDD helpers")

import asyncio

# Global lock for serializing LLM requests
llm_request_lock = asyncio.Lock()

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
        max_iterations = tdd_dict.get("max_iterations", DEFAULT_MAX_ITERATIONS)
    else:
        # It's a dict
        code = tdd_request.get("code", "")
        language = tdd_request.get("language", "python")
        iteration = tdd_request.get("iteration", 1)
        task_description = tdd_request.get("task_description", "")
        original_code = tdd_request.get("original_code", "")
        max_iterations = tdd_request.get("max_iterations", DEFAULT_MAX_ITERATIONS)
    
    # Ensure iteration is within bounds
    if iteration > max_iterations:
        logger.warning(f"Requested iteration {iteration} exceeds max_iterations {max_iterations}")
        iteration = max_iterations
    
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
            
            # Check for max iterations in metadata
            if "max_iterations" in message.context.metadata:
                metadata_max_iterations = message.context.metadata.get("max_iterations")
                if isinstance(metadata_max_iterations, int) and metadata_max_iterations > 0:
                    max_iterations = metadata_max_iterations
    
    # Create prompt for the LLM
    prompt = create_tdd_test_prompt(code, language, iteration, test_purpose, task_description, original_code, max_iterations)
    
    # Enhance the prompt with language-specific templates
    prompt = enhance_tdd_prompt(prompt, language, iteration, code, task_description, original_code)
    
    # Further enhance with adaptive test generation strategies
    prompt = enhance_test_prompt_with_adaptive_strategy(prompt, code, language, task_description, iteration, max_iterations)
    
    # Generate tests using LLM with extended timeout and clear error reporting
    generated_tests = ""
    try:
        if agent and hasattr(agent, 'send_prompt_to_llm'):
            logger.info(f"Generating tests for iteration {iteration}/{max_iterations} using agent.send_prompt_to_llm (serialized)")
            import asyncio
            loop = asyncio.get_event_loop()
            async with llm_request_lock:
                llm_response = await loop.run_in_executor(None, agent.send_prompt_to_llm, prompt)
            if llm_response.get("success") and llm_response.get("response"):
                generated_tests = cleanup_generated_tests(llm_response["response"], language)
            else:
                logger.error(f"LLM test generation failed: {llm_response.get('error', 'Unknown error')}")
                generated_tests = ""
                error_message = f"LLM model error: {llm_response.get('error', 'No response from LLM')}"
        else:
            logger.error("Agent or send_prompt_to_llm not available. Cannot generate tests.")
            generated_tests = ""
            error_message = "LLM backend is not available. Please check your Olama/LLM connection."
    except Exception as e:
        logger.error(f"Unexpected error in test generation: {e}")
        generated_tests = ""
        error_message = f"Unexpected error: {e}"
    
    # Prepare response
    response_content = {
        "test_code": generated_tests,
        "language": language,
        "iteration": iteration,
        "task_description": task_description,
        "max_iterations": max_iterations
    }
    if not generated_tests:
        response_content["error"] = error_message if 'error_message' in locals() else "Unknown error: No tests generated."

    response = {
        "message_type": "tdd_tests",
        "context": message.context.model_dump() if hasattr(message.context, "model_dump") else message.context.dict(),
        "content": response_content
    }

    # Log outgoing TDD tests
    add_to_logs("outgoing", "tdd_tests", response["content"])

    # Send response with error handling for closed WebSocket
    import logging
    try:
        await websocket.send_text(json.dumps(response))
    except Exception as e:
        logging.error(f"Failed to send TDD response on WebSocket: {e}")

def create_tdd_test_prompt(code, language, iteration, test_purpose, task_description="", original_code="", max_iterations=DEFAULT_MAX_ITERATIONS):
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
    
    # Handle custom max_iterations by adapting prompts as needed
    if max_iterations != 5:
        if iteration == max_iterations:
            # Final iteration: always use comprehensive review
            iteration_prompt = iteration_prompts.get(5, "Conduct a comprehensive review of the code and tests.")
        elif iteration == 1:
            iteration_prompt = iteration_prompts.get(1, "Generate basic tests for the code.")
        else:
            # Adapt prompt based on progress through custom iterations
            progress_percentage = iteration / max_iterations
            if progress_percentage < 0.25:
                iteration_prompt = iteration_prompts.get(1, "Generate basic tests for the code.")
            elif progress_percentage < 0.5:
                iteration_prompt = iteration_prompts.get(2, "Generate extended tests for the code.")
            elif progress_percentage < 0.75:
                iteration_prompt = iteration_prompts.get(3, "Focus on error handling in your tests.")
            else:
                iteration_prompt = iteration_prompts.get(4, "Focus on performance considerations in your tests.")
    else:
        # Use standard 5-iteration prompts
        iteration_prompt = iteration_prompts.get(iteration, "Generate appropriate tests for this iteration.")
    
    # Add iteration context
    iteration_prompt = f"This is iteration {iteration} of {max_iterations}.\n{iteration_prompt}"
    
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
    test_code = test_code.replace("```python", "").replace("```javascript", "").replace("```js", "").replace("```", "")
    
    # Add appropriate imports for the language
    if language.lower() == "python" and "import " not in test_code:
        if "unittest" in test_code:
            test_code = "import unittest\n\n" + test_code
        elif "pytest" in test_code and "pytest" not in test_code:
            test_code = "import pytest\n\n" + test_code
    

    return test_code.strip()


# The following function stub and code were left over from a previous implementation and are now removed.
# All test generation must now come from the LLM backend. If LLM fails, an error is returned and logged.
