"""
TDD Results Evaluator

This module helps evaluate TDD test results and integrate them into the suggestion evaluation process.
"""
import logging
import re
from typing import Dict, List, Tuple, Any

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
    
    # Analyze test content for each iteration
    for test_result in tdd_tests:
        test_code = test_result.get("test_code", "")
        iteration = test_result.get("iteration", 0)
        
        # Count assert statements as a proxy for number of tests
        assert_count = len(re.findall(r'assert\s+', test_code))
        total_tests += assert_count
        
        # Check for error indicators in the tests
        error_indicators = [
            "raises", "raise", "exception", "Error", "error", 
            "fail", "invalid", "incorrect", "wrong"
        ]
        
        # For later iterations (3+), look for performance concerns
        if iteration >= 3:
            performance_indicators = [
                "performance", "timeout", "slow", "optimize", 
                "efficient", "complexity", "stack overflow"
            ]
            
            for indicator in performance_indicators:
                if indicator in test_code:
                    issues_detected.append(f"Performance concern identified in iteration {iteration}: {indicator}")
        
        # Check if test errors were expected or actual problems
        for indicator in error_indicators:
            matches = re.findall(rf'(?:assert|with pytest\.raises).*{indicator}', test_code)
            if matches and iteration < 3:
                # In early iterations, these are likely expected validations
                passed_tests += len(matches)
            elif matches:
                # In later iterations, may indicate problems
                issues_detected.append(f"Potential issue in iteration {iteration}: {indicator}")
    
    # For the last iteration (usually 5), check overall assessment
    final_tests = [t for t in tdd_tests if t.get("iteration", 0) == len(tdd_tests)]
    if final_tests:
        final_code = final_tests[0].get("test_code", "")
        
        # Check for positive indicators in the final assessment
        positive_indicators = [
            "complete", "comprehensive", "robust", "reliable", 
            "correct", "accurate", "proper", "good"
        ]
        
        for indicator in positive_indicators:
            if indicator in final_code:
                recommendations.append(f"Final assessment indicates code is {indicator}")
    
    # Calculate TDD score
    tdd_score = 0.5  # default neutral
    if total_tests > 0:
        # Base score on apparent test passage and completeness
        base_score = min(0.8, (passed_tests / total_tests) if total_tests > 0 else 0.4)
        
        # Adjust score down for major issues
        issue_penalty = min(0.5, len(issues_detected) * 0.1)
        
        # Final score calculation
        tdd_score = max(0.1, base_score - issue_penalty)
    
    # Generate additional recommendations
    if tdd_score < 0.4:
        recommendations.append("Consider revising code based on test failures")
    elif tdd_score > 0.7:
        recommendations.append("Code performs well in tests")
    
    # Determine accept recommendation
    accept = tdd_score >= 0.6
    
    return {
        "tdd_score": tdd_score,
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
