# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
Adaptive Test Generation Strategies

This module provides enhanced test generation strategies that adapt to different
programming patterns, paradigms, and task types to create more relevant tests.
"""
import logging
import re
from typing import Dict, List, Any, Optional, Tuple

# Configure logging
logger = logging.getLogger(__name__)

# Define common programming patterns and their characteristics
PROGRAMMING_PATTERNS = {
    # Data structure implementations
    "data_structure": {
        "keywords": ["stack", "queue", "list", "tree", "graph", "hash", "map", "set", "heap", "dictionary"],
        "operations": ["add", "remove", "insert", "delete", "get", "find", "search", "contains"],
        "test_focus": ["correctness", "edge_cases", "performance"],
    },
    
    # Algorithms
    "algorithm": {
        "keywords": ["sort", "search", "path", "traversal", "algorithm", "recursive", "iteration"],
        "operations": ["compute", "calculate", "solve", "optimize", "find"],
        "test_focus": ["correctness", "edge_cases", "performance"],
    },
    
    # API/Web services
    "api_service": {
        "keywords": ["api", "endpoint", "service", "request", "response", "http", "rest", "graphql"],
        "operations": ["get", "post", "put", "delete", "fetch", "send"],
        "test_focus": ["integration", "error_handling", "authentication"],
    },
    
    # File operations
    "file_io": {
        "keywords": ["file", "directory", "path", "read", "write", "stream", "io"],
        "operations": ["open", "close", "read", "write", "append", "delete"],
        "test_focus": ["error_handling", "resource_management"],
    },
    
    # String processing
    "string_processing": {
        "keywords": ["string", "text", "parse", "format", "regex", "match", "replace"],
        "operations": ["parse", "format", "match", "replace", "split", "join"],
        "test_focus": ["correctness", "edge_cases", "localization"],
    },
    
    # Authentication/Authorization
    "auth": {
        "keywords": ["auth", "authentication", "authorization", "permission", "role", "user", "login", "password"],
        "operations": ["login", "logout", "verify", "validate", "check"],
        "test_focus": ["security", "edge_cases", "error_handling"],
    },
    
    # Math operations
    "mathematical": {
        "keywords": ["math", "calculate", "compute", "formula", "equation", "numeric"],
        "operations": ["calculate", "compute", "solve"],
        "test_focus": ["precision", "edge_cases", "performance"],
    },
    
    # Database operations
    "database": {
        "keywords": ["database", "db", "query", "sql", "nosql", "table", "collection", "document"],
        "operations": ["insert", "update", "delete", "select", "query", "find"],
        "test_focus": ["data_integrity", "error_handling", "performance"],
    },
    
    # Concurrency
    "concurrency": {
        "keywords": ["thread", "async", "concurrent", "parallel", "lock", "mutex", "semaphore"],
        "operations": ["wait", "notify", "lock", "unlock", "acquire", "release"],
        "test_focus": ["race_conditions", "deadlocks", "performance"],
    },
    
    # UI/Graphics
    "ui_graphics": {
        "keywords": ["ui", "interface", "graphic", "display", "render", "draw", "component"],
        "operations": ["render", "draw", "update", "refresh", "display"],
        "test_focus": ["visual_correctness", "user_interaction", "performance"],
    }
}

def identify_programming_patterns(code: str, task_description: str) -> List[str]:
    """
    Identify programming patterns in the code and task description
    
    Args:
        code: The code being tested
        task_description: Description of what the code should do
        
    Returns:
        List of identified programming patterns
    """
    # Combine code and task description for analysis
    combined_text = (code + " " + task_description).lower()
    
    # Track matches for each pattern
    pattern_scores = {}
    
    # Check each pattern for keyword and operation matches
    for pattern_name, pattern_data in PROGRAMMING_PATTERNS.items():
        score = 0
        
        # Count keyword matches
        for keyword in pattern_data["keywords"]:
            if keyword in combined_text:
                score += 2  # Keywords are strong indicators
        
        # Count operation matches
        for operation in pattern_data["operations"]:
            if operation in combined_text:
                score += 1  # Operations are secondary indicators
        
        # Record the score if there are any matches
        if score > 0:
            pattern_scores[pattern_name] = score
    
    # Sort patterns by score (highest first) and return the names
    sorted_patterns = sorted(pattern_scores.items(), key=lambda x: x[1], reverse=True)
    
    # Log the identified patterns
    if sorted_patterns:
        pattern_list = ", ".join([f"{p} (score: {s})" for p, s in sorted_patterns])
        logger.info(f"Identified programming patterns: {pattern_list}")
    else:
        logger.info("No specific programming patterns identified")
    
    # Return the pattern names in order of relevance
    return [pattern[0] for pattern in sorted_patterns]

def get_adaptive_test_strategy(code: str, language: str, task_description: str, iteration: int = 1, max_iterations: int = 5) -> Dict[str, Any]:
    """
    Generate an adaptive test strategy based on the code, language, and task
    
    Args:
        code: The code being tested
        language: The programming language
        task_description: Description of what the code should do
        iteration: Current iteration in the TDD cycle
        max_iterations: Maximum number of iterations
        
    Returns:
        Dictionary containing the adaptive test strategy
    """
    # Identify the programming patterns
    patterns = identify_programming_patterns(code, task_description)
    
    # Default strategy if no patterns are identified
    if not patterns:
        return {
            "focus": f"Iteration {iteration} standard tests",
            "test_types": ["functional", "edge_cases"],
            "suggested_frameworks": get_default_frameworks(language),
            "pattern_specific_guidance": None
        }
    
    # Use the top pattern for specialized strategy
    primary_pattern = patterns[0]
    pattern_data = PROGRAMMING_PATTERNS[primary_pattern]
    secondary_patterns = patterns[1:] if len(patterns) > 1 else []
    
    # Determine the focus based on the iteration and pattern
    test_focus = determine_test_focus(primary_pattern, iteration, max_iterations)
    
    # Get language-specific frameworks for this pattern
    frameworks = get_pattern_frameworks(primary_pattern, language)
    
    # Generate pattern-specific guidance
    guidance = generate_pattern_guidance(primary_pattern, language, iteration, max_iterations)
    
    # Build the combined strategy
    strategy = {
        "focus": f"Iteration {iteration} {test_focus}",
        "primary_pattern": primary_pattern,
        "secondary_patterns": secondary_patterns,
        "test_types": pattern_data["test_focus"],
        "suggested_frameworks": frameworks,
        "pattern_specific_guidance": guidance
    }
    
    logger.info(f"Generated adaptive test strategy for {primary_pattern} pattern, iteration {iteration}/{max_iterations}")
    return strategy

def determine_test_focus(pattern: str, iteration: int, max_iterations: int) -> str:
    """
    Determine the testing focus based on the pattern and iteration
    
    Args:
        pattern: The identified programming pattern
        iteration: Current iteration in the TDD cycle
        max_iterations: Maximum number of iterations
        
    Returns:
        String describing the test focus
    """
    # Calculate the progress percentage
    progress = iteration / max_iterations
    
    # Default focus sequence for all patterns
    if progress < 0.25:
        return "basic functionality tests"
    elif progress < 0.5:
        return "extended functionality tests"
    elif progress < 0.75:
        return "error handling tests"
    elif iteration < max_iterations:
        return "performance and edge case tests"
    else:
        return "comprehensive review"
    
    # Note: In a future enhancement, we could add pattern-specific focus sequences

def get_default_frameworks(language: str) -> List[str]:
    """
    Get default testing frameworks for a language
    
    Args:
        language: The programming language
        
    Returns:
        List of recommended frameworks
    """
    frameworks = {
        "python": ["pytest", "unittest"],
        "javascript": ["jest", "mocha"],
        "typescript": ["jest", "jasmine"],
        "java": ["junit", "testng"],
        "csharp": ["nunit", "xunit"],
        "go": ["testing", "testify"],
        "ruby": ["rspec", "minitest"],
        "php": ["phpunit", "codeception"],
        "rust": ["cargo test", "quickcheck"],
        "swift": ["xctest", "quick"],
        "kotlin": ["junit", "kotlintest"]
    }
    
    return frameworks.get(language.lower(), ["standard testing library"])

def get_pattern_frameworks(pattern: str, language: str) -> List[str]:
    """
    Get pattern-specific testing frameworks
    
    Args:
        pattern: The identified programming pattern
        language: The programming language
        
    Returns:
        List of recommended frameworks for this pattern and language
    """
    # Start with the default frameworks
    default_frameworks = get_default_frameworks(language)
    
    # Pattern-specific specialized frameworks by language
    specialized = {
        "data_structure": {
            "python": ["pytest", "hypothesis"],
            "java": ["junit", "jqwik"],
            "javascript": ["jest", "fast-check"]
        },
        "algorithm": {
            "python": ["pytest", "hypothesis"],
            "java": ["junit", "jmh"],
            "javascript": ["jest", "benchmark.js"]
        },
        "api_service": {
            "python": ["pytest", "requests-mock", "responses"],
            "javascript": ["jest", "nock", "supertest"],
            "java": ["mockito", "wiremock"]
        },
        "concurrency": {
            "python": ["pytest", "pytest-asyncio"],
            "java": ["junit", "testcontainers"],
            "javascript": ["jest", "supertest"]
        },
        "database": {
            "python": ["pytest", "sqlalchemy"],
            "javascript": ["jest", "knex"],
            "java": ["junit", "testcontainers"]
        }
    }
    
    # Get the specialized frameworks if available
    pattern_langs = specialized.get(pattern, {})
    specialized_frameworks = pattern_langs.get(language.lower(), [])
    
    # If no specialized frameworks, return defaults
    if not specialized_frameworks:
        return default_frameworks
    
    # Otherwise, combine default with specialized (removing duplicates)
    combined = specialized_frameworks.copy()
    for framework in default_frameworks:
        if framework not in combined:
            combined.append(framework)
    
    return combined

def generate_pattern_guidance(pattern: str, language: str, iteration: int, max_iterations: int) -> str:
    """
    Generate pattern-specific guidance for tests
    
    Args:
        pattern: The identified programming pattern
        language: The programming language
        iteration: Current iteration in the TDD cycle
        max_iterations: Maximum number of iterations
        
    Returns:
        String with pattern-specific guidance
    """
    # Basic pattern-specific guidance templates
    guidance_templates = {
        "data_structure": """
For this {structure_type} implementation, focus on testing:
1. Basic operations ({operations})
2. Edge cases (empty, single item, maximum capacity)
3. Error handling for invalid operations
4. Performance with larger data sets
""",
        "algorithm": """
For this algorithm, focus on testing:
1. Correctness with various inputs
2. Edge cases (empty input, single item, large inputs)
3. Performance characteristics
4. Expected complexity (time and space)
""",
        "api_service": """
For this API/service, focus on testing:
1. Correct handling of valid requests
2. Proper error responses for invalid inputs
3. Authentication and authorization if applicable
4. Edge cases in the request/response cycle
""",
        "file_io": """
For this file I/O code, focus on testing:
1. Correct reading/writing of valid files
2. Proper error handling for invalid files or permissions
3. Resource management (file handles being closed)
4. Performance with larger files if relevant
""",
        "string_processing": """
For this string processing code, focus on testing:
1. Correct handling of valid strings
2. Edge cases (empty string, very long strings, special characters)
3. Unicode and internationalization if relevant
4. Performance with larger inputs
""",
        "auth": """
For this authentication code, focus on testing:
1. Successful authentication with valid credentials
2. Rejection of invalid credentials
3. Proper security practices (password hashing, etc.)
4. Login attempt rate limiting if applicable
""",
        "mathematical": """
For this mathematical code, focus on testing:
1. Correctness for normal inputs
2. Edge cases (zero, negative numbers, very large numbers)
3. Precision and floating-point issues if relevant
4. Performance for complex calculations
""",
        "database": """
For this database code, focus on testing:
1. Correct data creation, reading, updating, and deletion
2. Proper error handling for database failures
3. Transaction management if applicable
4. Performance with larger datasets
""",
        "concurrency": """
For this concurrent code, focus on testing:
1. Correct behavior in single-threaded execution
2. Thread safety and race conditions
3. Deadlock prevention
4. Performance under concurrent load
""",
        "ui_graphics": """
For this UI/graphics code, focus on testing:
1. Correct rendering of components
2. Proper handling of user interactions
3. Visual consistency and layout
4. Performance and responsiveness
"""
    }
    
    # Get the operations for this pattern
    operations = ", ".join(PROGRAMMING_PATTERNS[pattern]["operations"])
    
    # For data structures, try to identify the specific type
    structure_type = ""
    if pattern == "data_structure":
        for keyword in PROGRAMMING_PATTERNS[pattern]["keywords"]:
            if keyword in ["stack", "queue", "list", "tree", "graph", "hash", "map", "dictionary"]:
                structure_type = keyword
                break
        if not structure_type:
            structure_type = "data structure"
    
    # Get the template or use a generic one
    template = guidance_templates.get(pattern, """
For this code, focus on testing:
1. Basic functionality
2. Edge cases
3. Error handling
4. Performance considerations
""")
    
    # Add iteration-specific guidance
    if iteration == 1:
        iteration_guidance = "Focus on basic functionality tests in this first iteration."
    elif iteration == max_iterations:
        iteration_guidance = "As this is the final iteration, provide a comprehensive assessment of the code."
    elif iteration == 2:
        iteration_guidance = "Now that basic tests are done, focus on more comprehensive test cases."
    elif iteration == 3:
        iteration_guidance = "Focus on error handling and edge cases in this iteration."
    else:
        iteration_guidance = "Focus on performance and advanced scenarios in this iteration."
    
    # Format the template with the available information
    guidance = template.format(
        operations=operations,
        structure_type=structure_type
    )
    
    return guidance + "\n\n" + iteration_guidance

def enhance_test_prompt_with_adaptive_strategy(base_prompt: str, code: str, language: str, task_description: str, iteration: int, max_iterations: int) -> str:
    """
    Enhance a TDD test prompt with adaptive test strategies
    
    Args:
        base_prompt: The original base prompt for test generation
        code: The code being tested
        language: The programming language
        task_description: Description of what the code should do
        iteration: Current iteration in the TDD cycle
        max_iterations: Maximum number of iterations
        
    Returns:
        Enhanced prompt with adaptive test strategies
    """
    try:
        # Generate the adaptive test strategy
        strategy = get_adaptive_test_strategy(code, language, task_description, iteration, max_iterations)
        
        # Create the strategy section of the prompt
        strategy_prompt = f"""
# Adaptive Test Strategy
Focus: {strategy['focus']}

"""
        # Add pattern information if available
        if "primary_pattern" in strategy:
            strategy_prompt += f"Detected pattern: {strategy['primary_pattern']}\n"
            if strategy["secondary_patterns"]:
                secondary = ", ".join(strategy["secondary_patterns"])
                strategy_prompt += f"Secondary patterns: {secondary}\n"
            strategy_prompt += "\n"
        
        # Add suggested test types
        if "test_types" in strategy:
            test_types = ", ".join(strategy["test_types"])
            strategy_prompt += f"Key areas to test: {test_types}\n"
        
        # Add suggested frameworks
        if "suggested_frameworks" in strategy:
            frameworks = ", ".join(strategy["suggested_frameworks"][:2])  # Top 2 frameworks
            strategy_prompt += f"Recommended testing frameworks: {frameworks}\n\n"
        
        # Add pattern-specific guidance
        if strategy["pattern_specific_guidance"]:
            strategy_prompt += f"Pattern-specific guidance:\n{strategy['pattern_specific_guidance']}\n"
        
        # Add a note about adapting tests to the specific task
        strategy_prompt += f"""
Remember to adapt these tests to the specific requirements of the task: "{task_description}"
Your tests should be thorough yet focused on the most relevant aspects for this type of code.
"""
        
        # Combine with base prompt
        enhanced_prompt = base_prompt + "\n" + strategy_prompt
        logger.info(f"Enhanced test prompt with adaptive strategy for iteration {iteration}/{max_iterations}")
        
        return enhanced_prompt
        
    except Exception as e:
        logger.error(f"Error enhancing prompt with adaptive strategy: {e}")
        # Return original prompt if enhancement fails
        return base_prompt
