"""
TDD Results Evaluator

This module helps evaluate TDD test results and integrate them into the suggestion evaluation process.
"""
import logging
import re
from typing import Dict, List, Tuple, Any
from task_relevance import assess_task_relevance

# Configure logging
logger = logging.getLogger(__name__)

def evaluate_tdd_results(tdd_tests: List[Dict[str, Any]], suggestion_code: str, task_description: str) -> Dict[str, Any]:
    """
    Evaluate TDD test results and determine if they indicate the suggestion should be accepted
    
    Args:
        tdd_tests: List of test results from TDD iterations
        suggestion_code: The code being tested
        task_description: Description of what the code should do
        
    Returns:
        Dict containing evaluation results including:
        - tdd_score: Score from 0-1 representing test success
        - issues_detected: Issues found during TDD
        - recommendations: Recommendations based on TDD
        - accept: Boolean indicating if TDD results suggest accepting the code
    """
    if not tdd_tests:
        logger.warning("No TDD tests provided for evaluation")
        return {
            "tdd_score": 0.5,
            "issues_detected": ["No TDD tests ran"],
            "recommendations": ["Run TDD tests to verify code quality"],
            "accept": None  # Neutral - TDD doesn't influence decision
        }
    
    # Initialize counters
    total_tests = 0
    passed_tests = 0
    issues_detected = []
    recommendations = []
    max_iteration = 0

    def strip_comments_and_docstrings(code: str) -> str:
        # Remove Python and JS comments and docstrings for more accurate analysis
        code = re.sub(r'""".*?"""|\'\'\'.*?\'\'\'|//.*?$|/\*.*?\*/', '', code, flags=re.DOTALL | re.MULTILINE)
        code = re.sub(r'#.*', '', code)
        return code

    # Analyze test content for each iteration
    for test_result in tdd_tests:
        test_code = test_result.get("test_code", "")
        iteration = test_result.get("iteration", 0)
        max_iteration = max(max_iteration, iteration)
        code_no_comments = strip_comments_and_docstrings(test_code)

        # Count test functions (Python, JS, TS)
        test_func_count = len(re.findall(r'def\s+test_|function\s+test|it\s*\(|test\s*\(', code_no_comments))
        # Count assert statements
        assert_count = len(re.findall(r'assert\s+', code_no_comments))
        # Use the max of test functions and asserts as proxy for number of tests
        test_count = max(test_func_count, assert_count)
        total_tests += test_count

        # Detect clear pass/fail patterns
        # Consider a test failed if it contains 'assert False', 'fail()', or similar patterns
        fail_patterns = [r'assert\s+False', r'fail\s*\(', r'pytest\.fail', r'raise\s+AssertionError']
        fail_count = 0
        for pat in fail_patterns:
            fail_count += len(re.findall(pat, code_no_comments))

        # If no fail patterns, assume test passes (for LLM-generated code)
        if fail_count == 0 and test_count > 0:
            passed_tests += test_count

        # Check for error indicators in the tests (excluding comments)
        error_indicators = [
            "raises", "raise", "exception", "Error", "error", 
            "fail", "invalid", "incorrect", "wrong"
        ]
        for indicator in error_indicators:
            # Only match outside comments/docstrings
            if re.search(rf'\b{indicator}\b', code_no_comments, re.IGNORECASE):
                # Only add if not already counted as a fail
                issues_detected.append(f"Potential issue in iteration {iteration}: {indicator}")

        # For later iterations (3+), look for performance concerns
        if iteration >= 3:
            performance_indicators = [
                "performance", "timeout", "slow", "optimize", 
                "efficient", "complexity", "stack overflow"
            ]
            for indicator in performance_indicators:
                if re.search(rf'\b{indicator}\b', code_no_comments, re.IGNORECASE):
                    issues_detected.append(f"Performance concern identified in iteration {iteration}: {indicator}")

    # For the last iteration (max_iteration), check overall assessment
    final_tests = [t for t in tdd_tests if t.get("iteration", 0) == max_iteration]
    if final_tests:
        final_code = final_tests[0].get("test_code", "")
        code_no_comments = strip_comments_and_docstrings(final_code)
        # Check for positive indicators in the final assessment
        positive_indicators = [
            "complete", "comprehensive", "robust", "reliable", 
            "correct", "accurate", "proper", "good"
        ]
        for indicator in positive_indicators:
            if re.search(rf'\b{indicator}\b', code_no_comments, re.IGNORECASE):
                recommendations.append(f"Final assessment indicates code is {indicator}")

    # Calculate TDD score
    tdd_score = 0.5  # default neutral
    task_relevance = assess_task_relevance(tdd_tests, suggestion_code, task_description)
    if total_tests > 0:
        # Base score on apparent test passage and completeness
        base_score = min(0.8, (passed_tests / total_tests) if total_tests > 0 else 0.4)
        # Adjust score down for major issues
        issue_penalty = min(0.5, len(issues_detected) * 0.1)
        # Final score is based on test results, adjusted for issues and task relevance
        tdd_score = max(0.1, base_score - issue_penalty) * task_relevance

    # Generate additional recommendations
    if tdd_score < 0.4:
        recommendations.append("Consider revising code based on test failures or low relevance to task")
    elif tdd_score > 0.7:
        recommendations.append("Code performs well in tests and aligns with task requirements")
    elif not recommendations:
        recommendations.append("Code has mixed test results - consider reviewing manually")

    # Determine accept recommendation
    accept = tdd_score >= 0.6

    # Add task relevance to the output (always set explicitly)
    return {
        "tdd_score": tdd_score,
        "task_relevance": task_relevance,
        "issues_detected": issues_detected,
        "recommendations": recommendations,
        "accept": accept
    }

def combine_evaluation_results(tdd_evaluation: Dict[str, Any], llm_evaluation: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Combine TDD and LLM evaluations to make a final decision on code acceptance
    
    Args:
        tdd_evaluation: Results from TDD test evaluation
        llm_evaluation: Results from LLM evaluation
        
    Returns:
        Tuple containing (accept_bool, combined_evaluation_dict)
    """
    # Extract values from evaluations
    tdd_score = tdd_evaluation.get("tdd_score", 0.5)
    tdd_accept = tdd_evaluation.get("accept", None)
    
    llm_analysis = llm_evaluation.get("analysis", {})
    llm_accept = llm_evaluation.get("accept", False)
    hallucination_risk = llm_analysis.get("hallucination_risk", 0.5)
    recursive_risk = llm_analysis.get("recursive_risk", 0.5)
    alignment_score = llm_analysis.get("alignment_score", 0.5)
    
    # Merge issues and recommendations
    issues = llm_analysis.get("issues_detected", []) + tdd_evaluation.get("issues_detected", [])
    recommendations = llm_analysis.get("recommendations", []) + tdd_evaluation.get("recommendations", [])
    
    # Final decision logic (weighted combination)
    if tdd_accept is None:
        # If TDD wasn't run or was inconclusive, rely on LLM evaluation
        final_accept = llm_accept
        reason = llm_evaluation.get("reason", "Based on LLM evaluation only")
    else:
        # Weight TDD more heavily when available
        tdd_weight = 0.7
        llm_weight = 0.3
        
        # Calculate weighted score
        weighted_score = (tdd_score * tdd_weight) + (alignment_score * llm_weight)
        
        # Risk factors can still veto
        if hallucination_risk > 0.7 or recursive_risk > 0.7:
            final_accept = False
            reason = f"High risk detected: hallucination={hallucination_risk:.2f}, recursive={recursive_risk:.2f}"
        else:
            final_accept = weighted_score >= 0.6
            reason = f"Combined evaluation: TDD score={tdd_score:.2f}, alignment={alignment_score:.2f}"
    
    # Prepare combined evaluation
    combined_evaluation = {
        "accept": final_accept,
        "analysis": {
            "hallucination_risk": hallucination_risk,
            "recursive_risk": recursive_risk,
            "alignment_score": alignment_score,
            "tdd_score": tdd_score,
            "issues_detected": issues,
            "recommendations": recommendations
        },
        "reason": reason
    }
    
    return final_accept, combined_evaluation
