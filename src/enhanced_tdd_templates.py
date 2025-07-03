# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
Enhanced TDD Test Generation for Language-Specific Templates

This module enhances the TDD system by using language-specific test templates 
to generate more relevant and effective tests for different programming languages.
"""
import logging
from src.language_test_templates import get_language_specific_template

# Configure logging
logger = logging.getLogger(__name__)

def enhance_tdd_prompt(base_prompt, language, iteration, code, task_description, original_code=""):
    """
    Enhance a TDD test prompt with language-specific templates
    
    Args:
        base_prompt: The original base prompt for test generation
        language: The programming language (python, javascript, etc.)
        iteration: Current iteration number in the TDD cycle
        code: The code being tested
        task_description: Description of what the code should do
        original_code: Original code before modifications, if any
        
    Returns:
        Enhanced prompt with language-specific test templates
    """
    try:
        # Normalize language name
        language = language.lower() if language else "python"
        
        # Get language-specific template for this iteration
        language_specific_instructions = get_language_specific_template(language, iteration, code, task_description)
        
        # Add the language-specific instructions to the prompt
        enhanced_prompt = base_prompt + f"""
# Language-specific test guidance:
{language_specific_instructions}

Remember to write actual test code, not just explanations. Your response should include complete, runnable test code in {language} that can be executed to test the provided implementation.
"""
        logger.info(f"Enhanced TDD prompt with {language}-specific template for iteration {iteration}")
        return enhanced_prompt
        
    except Exception as e:
        logger.error(f"Error enhancing TDD prompt: {e}")
        # Return original prompt if enhancement fails
        return base_prompt + f"""
# Additional guidance:
Write tests that follow {language} best practices and conventions.
"""

def get_enhanced_fallback_tests(code, language, iteration, task_description=""):
    """
    Generate improved fallback tests if LLM generation fails, using language-specific templates
    
    Args:
        code: The code being tested
        language: The programming language
        iteration: Current iteration number in the TDD cycle
        task_description: Description of what the code should do
        
    Returns:
        Language-specific fallback test code
    """
    # Normalize language name
    language = language.lower() if language else "python"
    
    # Map of fallback test templates for common languages
    language_fallbacks = {
        "python": get_python_fallback(code, iteration, task_description),
        "javascript": get_javascript_fallback(code, iteration, task_description),
        "typescript": get_typescript_fallback(code, iteration, task_description),
        "java": get_java_fallback(code, iteration, task_description),
    }
    
    # Get language-specific fallback or use generic
    return language_fallbacks.get(language, get_generic_fallback(code, language, iteration, task_description))

def get_python_fallback(code, iteration, task_description):
    """Generate enhanced Python fallback tests"""
    task_comment = f" for {task_description}" if task_description else ""
    
    # Extract likely function/class name for testing
    import re
    function_match = re.search(r'def\s+([a-zA-Z0-9_]+)\s*\(', code)
    class_match = re.search(r'class\s+([a-zA-Z0-9_]+)', code)
    
    test_target = "function_under_test"
    if function_match:
        test_target = function_match.group(1)
    elif class_match:
        test_target = class_match.group(1)
    
    return f"""
# Fallback tests for iteration {iteration}{task_comment}
import pytest

# Assume the function/class is defined in a module
# Adjust import as needed for your actual code structure
# from module import {test_target}

def test_{test_target}_exists():
    # Verify the function/class exists and is callable
    # Uncomment and adjust as needed
    # assert callable({test_target})

def test_basic_functionality():
    # Basic test for core functionality
    # Example (adjust for your specific function):
    # result = {test_target}(input_value)
    # assert result == expected_output
    
    # This is a placeholder - implement actual tests for:
    # 1. Basic functionality with simple inputs
    # 2. Edge cases relevant to the task: "{task_description}"
    # 3. Error handling as appropriate
    assert True  # Replace with actual assertions

@pytest.mark.parametrize("input_value,expected", [
    # Add test cases appropriate for the function
    # (1, 1),
    # (2, 2),
])
def test_multiple_cases(input_value, expected):
    # Parametrized test for multiple cases
    # Example:
    # result = {test_target}(input_value)
    # assert result == expected
    assert True  # Replace with actual implementation
"""

def get_javascript_fallback(code, iteration, task_description):
    """Generate enhanced JavaScript fallback tests"""
    task_comment = f" for {task_description}" if task_description else ""
    
    # Extract likely function/class name for testing
    import re
    function_match = re.search(r'function\s+([a-zA-Z0-9_]+)\s*\(', code)
    class_match = re.search(r'class\s+([a-zA-Z0-9_]+)', code)
    const_func_match = re.search(r'const\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', code)
    
    test_target = "functionUnderTest"
    if function_match:
        test_target = function_match.group(1)
    elif class_match:
        test_target = class_match.group(1)
    elif const_func_match:
        test_target = const_func_match.group(1)
    
    return f"""
// Fallback tests for iteration {iteration}{task_comment}
// Using Jest testing framework

// Assume the function/class is exported from a module
// Adjust import as needed for your actual code structure
// const {{ {test_target} }} = require('./module');

describe('{test_target}', () => {{
  test('exists and is callable', () => {{
    // Uncomment and adjust as needed
    // expect(typeof {test_target}).toBe('function');
  }});

  test('handles basic functionality', () => {{
    // Basic test for core functionality
    // Example (adjust for your specific function):
    // const result = {test_target}(inputValue);
    // expect(result).toBe(expectedOutput);
    
    // This is a placeholder - implement actual tests for:
    // 1. Basic functionality with simple inputs
    // 2. Edge cases relevant to the task: "{task_description}"
    // 3. Error handling as appropriate
    expect(true).toBe(true);  // Replace with actual assertions
  }});

  test.each([
    // Add test cases appropriate for the function
    // [input1, expected1],
    // [input2, expected2],
  ])('handles multiple cases: %s -> %s', (input, expected) => {{
    // Parametrized test for multiple cases
    // Example:
    // const result = {test_target}(input);
    // expect(result).toBe(expected);
    expect(true).toBe(true);  // Replace with actual implementation
  }});
}});
"""

def get_typescript_fallback(code, iteration, task_description):
    """Generate enhanced TypeScript fallback tests"""
    # TypeScript fallback is similar to JavaScript but with type annotations
    js_fallback = get_javascript_fallback(code, iteration, task_description)
    return js_fallback.replace("// Using Jest testing framework", 
                              "// Using Jest testing framework with TypeScript")

def get_java_fallback(code, iteration, task_description):
    """Generate enhanced Java fallback tests"""
    task_comment = f" for {task_description}" if task_description else ""
    
    # Extract likely class name for testing
    import re
    class_match = re.search(r'class\s+([a-zA-Z0-9_]+)', code)
    method_match = re.search(r'(?:public|private|protected)?\s+(?:static\s+)?\w+\s+([a-zA-Z0-9_]+)\s*\(', code)
    
    class_name = "ClassUnderTest"
    method_name = "methodUnderTest"
    
    if class_match:
        class_name = class_match.group(1)
    if method_match:
        method_name = method_match.group(1)
    
    return f"""
// Fallback tests for iteration {iteration}{task_comment}
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.junit.jupiter.api.Assertions.*;

class {class_name}Test {{
    @Test
    @DisplayName("Test that {method_name} exists and handles basic input")
    void testBasicFunctionality() {{
        // Basic test for core functionality
        // Example (adjust for your specific method):
        // {class_name} instance = new {class_name}();
        // Type result = instance.{method_name}(inputValue);
        // assertEquals(expectedOutput, result);
        
        // This is a placeholder - implement actual tests for:
        // 1. Basic functionality with simple inputs
        // 2. Edge cases relevant to the task: "{task_description}"
        // 3. Error handling as appropriate
        assertTrue(true);  // Replace with actual assertions
    }}
    
    @ParameterizedTest
    @CsvSource({{
        // Add test cases appropriate for the method
        // "input1, expected1",
        // "input2, expected2",
    }})
    @DisplayName("Test that {method_name} handles multiple cases correctly")
    void testMultipleCases(String input, String expected) {{
        // Parametrized test for multiple cases
        // Example:
        // {class_name} instance = new {class_name}();
        // Type result = instance.{method_name}(input);
        // assertEquals(expected, result);
        assertTrue(true);  // Replace with actual implementation
    }}
}}
"""

def get_generic_fallback(code, language, iteration, task_description):
    """Generate a generic fallback for languages without specific templates"""
    task_comment = f" for {task_description}" if task_description else ""
    
    return f"""
// Fallback tests for iteration {iteration}{task_description} in {language}

// This is a generic test scaffold - ideally these tests would be
// generated specifically for the task: "{task_description}"

// Implement tests that:
// 1. Check the function/class exists and is callable
// 2. Test basic functionality with simple inputs
// 3. Test edge cases relevant to the task
// 4. Test error handling as appropriate

// Replace this scaffold with actual tests following best practices for {language}
"""
