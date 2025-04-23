"""
Task relevance assessment for TDD evaluation

This module contains functions to assess how well TDD tests and code
align with the original task description provided by the user.
"""
import re
import logging
from typing import List, Dict, Any, Set, Tuple, Optional

# Configure logging
logger = logging.getLogger(__name__)

def assess_task_relevance(tdd_tests: List[Dict[str, Any]], 
                          suggestion_code: str, 
                          task_description: str) -> float:
    """
    Assess how relevant the TDD tests and suggestion code are to the task description.
    
    Args:
        tdd_tests: List of test results from TDD iterations
        suggestion_code: The code being tested
        task_description: Description of what the code should do
        
    Returns:
        Float from 0.0 to 1.0 representing how well the tests align with the task
    """
    if not task_description or task_description.lower() in [
        "implement functionality", 
        "modify code",
        "update code"
    ]:
        logger.info("No specific task description provided, assuming full relevance")
        return 1.0  # Can't assess relevance without a meaningful task description
    
    # Extract key terms from task description
    task_terms = extract_key_terms(task_description)
    if not task_terms:
        logger.warning("No key terms extracted from task description")
        return 0.8  # Default to high but not perfect relevance
    
    # Track relevance metrics
    term_presence_scores = []
    
    # Analyze tests for presence of task terms
    all_test_code = " ".join([test.get("test_code", "") for test in tdd_tests])
    test_term_presence = calculate_term_presence(task_terms, all_test_code)
    term_presence_scores.append(test_term_presence)
    
    # Analyze suggestion code for presence of task terms
    code_term_presence = calculate_term_presence(task_terms, suggestion_code)
    term_presence_scores.append(code_term_presence)
    
    # Look for task-specific testing patterns
    task_patterns_score = assess_task_specific_patterns(task_description, all_test_code)
    if task_patterns_score is not None:
        term_presence_scores.append(task_patterns_score)
    
    # Combine all relevance metrics
    # Weight code relevance slightly more than test relevance
    if term_presence_scores:
        relevance_score = sum(term_presence_scores) / len(term_presence_scores)
        
        # Ensure score is in the valid range and not too low
        relevance_score = min(1.0, max(0.4, relevance_score))
        
        logger.debug(f"Task relevance score: {relevance_score:.2f}")
        return relevance_score
    else:
        logger.warning("No relevance metrics available")
        return 0.7  # Default to moderate relevance
    
def extract_key_terms(text: str) -> Set[str]:
    """
    Extract key technical terms from text, filtering out common words.
    
    Args:
        text: The text to extract terms from
        
    Returns:
        Set of key terms
    """
    # Clean the text
    text = re.sub(r'[^\w\s]', ' ', text.lower())
    
    # Split into words
    words = text.split()
    
    # Filter out common words and very short words
    common_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
        'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against',
        'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
        'from', 'up', 'down', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
        'can', 'could', 'may', 'might', 'must', 'ought', 'i', 'you', 'he', 'she', 'it',
        'we', 'they', 'this', 'that', 'these', 'those', 'who', 'which', 'all', 'any',
        'both', 'each', 'few', 'more', 'most', 'some', 'such', 'no', 'nor', 'not', 'only',
        'own', 'same', 'so', 'than', 'too', 'very', 'just', 'code', 'function', 'class',
        'method', 'implement', 'create', 'make', 'write', 'should', 'following', 'using'
    }
    
    key_terms = {word for word in words if word not in common_words and len(word) > 2}
    
    # Add multi-word technical terms by looking for consecutive capital letters 
    # in the original text (CamelCase detection)
    camel_case_terms = re.findall(r'[A-Z][a-z]+(?:[A-Z][a-z]+)+', text)
    for term in camel_case_terms:
        key_terms.add(term.lower())
    
    # Add snake_case terms
    snake_case_terms = re.findall(r'\b[a-z]+(?:_[a-z]+)+\b', text)
    for term in snake_case_terms:
        key_terms.add(term)
    
    return key_terms

def calculate_term_presence(terms: Set[str], text: str) -> float:
    """
    Calculate what proportion of key terms are present in the text.
    
    Args:
        terms: Set of key terms to look for
        text: The text to search in
        
    Returns:
        Float from 0.0 to 1.0 representing term presence
    """
    if not terms:
        return 0.0
    
    text = text.lower()
    present_terms = set()
    
    for term in terms:
        # Check for exact match or as part of a larger token
        if re.search(rf'\b{re.escape(term)}\b', text) or term in text:
            present_terms.add(term)
    
    return len(present_terms) / len(terms)

def assess_task_specific_patterns(task_description: str, test_code: str) -> Optional[float]:
    """
    Assess test code for patterns specific to particular types of tasks.
    
    Args:
        task_description: Description of the task
        test_code: The test code to analyze
        
    Returns:
        Float from 0.0 to 1.0 representing pattern alignment, or None if no patterns apply
    """
    task_lower = task_description.lower()
    
    # Define task patterns and their expected test patterns
    task_patterns = [
        # Data structure implementation tasks
        {
            "keywords": ["stack", "queue", "linked list", "tree", "hash", "map", "set", "heap"],
            "test_patterns": [r"push|pop|enqueue|dequeue|insert|remove|add|delete|contains|find"]
        },
        # Sorting algorithm tasks
        {
            "keywords": ["sort", "quick sort", "merge sort", "bubble sort", "heap sort"],
            "test_patterns": [r"sorted|ascending|descending|order"]
        },
        # API or HTTP related tasks
        {
            "keywords": ["api", "rest", "http", "endpoint", "request", "response", "fetch"],
            "test_patterns": [r"get|post|put|delete|response|status|json|http|api|mock"]
        },
        # File or I/O operation tasks
        {
            "keywords": ["file", "input", "output", "i/o", "read", "write", "stream"],
            "test_patterns": [r"file|open|close|read|write|input|output|stream|buffer"]
        },
        # Authentication tasks
        {
            "keywords": ["auth", "login", "password", "credential", "token", "jwt", "oauth"],
            "test_patterns": [r"auth|login|password|token|credential|session|jwt|oauth"]
        }
    ]
    
    # Check if any task pattern matches
    for pattern in task_patterns:
        for keyword in pattern["keywords"]:
            if keyword in task_lower:
                # Found a matching task type, check for expected test patterns
                for test_pattern in pattern["test_patterns"]:
                    if re.search(test_pattern, test_code, re.IGNORECASE):
                        logger.debug(f"Found matching test pattern for {keyword} task")
                        return 0.9  # High relevance if patterns match
                
                # Task keyword found but no matching test pattern
                logger.debug(f"Task keyword '{keyword}' found but no matching test patterns")
                return 0.5  # Medium relevance
    
    # No specific patterns identified
    return None  # Let other methods determine relevance
