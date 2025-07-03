# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
TDD Results Evaluator

This module helps evaluate TDD test results and integrate them into the suggestion evaluation process.
It includes improved task analysis and test quality metrics.
"""
import logging
import re
from typing import Dict, List, Tuple, Any
from src.task_relevance import assess_task_relevance
from src.task_analyzer import analyze_task_for_testing
from src.test_quality_metrics import evaluate_test_quality
from src.test_execution import execute_tests, document_test_results, TestExecutionResult

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
    
    # Track test execution results
    test_execution_results = []

    def strip_comments_and_docstrings(code: str) -> str:
        # Remove Python and JS comments and docstrings for more accurate analysis
        code = re.sub(r'""".*?"""|\'\'\'.*?\'\'\'|//.*?$|/\*.*?\*/', '', code, flags=re.DOTALL | re.MULTILINE)
        code = re.sub(r'#.*', '', code)
        return code
        
    # Auto-detect language from code
    detected_language = None
    if suggestion_code:
        for lang_pattern in [
            (r'def\s+\w+.*:', "python"),
            (r'function\s+\w+|\(\)\s*=>\s*{', "javascript"),
            (r'import\s+{.*}\s+from|export\s+class', "typescript"),
            (r'public\s+class|private\s+\w+\s+\w+', "java"),
            (r'#include|namespace\s+\w+|::|std::|using\s+std::', "cpp"),
            (r'fn\s+\w+|impl\s+|let\s+mut', "rust"),
            (r'package\s+main|func\s+\w+', "go"),
            (r'using\s+\w+|namespace\s+\w+', "csharp")
        ]:
            if re.search(lang_pattern[0], suggestion_code):
                detected_language = lang_pattern[1]
                break
    
    # Analyze test content for each iteration
    for test_result in tdd_tests:
        test_code = test_result.get("test_code", "")
        implementation_code = test_result.get("implementation_code", suggestion_code)
        iteration = test_result.get("iteration", 0)
        max_iteration = max(max_iteration, iteration)
        code_no_comments = strip_comments_and_docstrings(test_code)

        # Count test functions (using more comprehensive patterns for multiple languages)
        test_func_patterns = [
            # Python
            r'def\s+test_\w+', 
            # JavaScript/TypeScript
            r'function\s+test|it\s*\(|test\s*\(|describe\s*\(', 
            # Java/C#
            r'@Test|void\s+test\w+', 
            # C++
            r'TEST\s*\(|TEST_F\s*\(|BOOST_(?:AUTO_)?TEST_CASE',
            # Rust
            r'#\[test\]|fn\s+test_\w+'
        ]
        
        test_func_count = 0
        for pattern in test_func_patterns:
            test_func_count += len(re.findall(pattern, code_no_comments))
            
        # Count assert statements (using more comprehensive patterns)
        assert_patterns = [
            r'assert\s+', r'expect\(', r'should\.', r'ASSERT_', r'EXPECT_',
            r'assertEquals', r'assertTrue', r'assertFalse', r'assert!', r'assertThat'
        ]
        
        assert_count = 0
        for pattern in assert_patterns:
            assert_count += len(re.findall(pattern, code_no_comments))
            
        # Use the max of test functions and asserts as proxy for number of tests
        test_count = max(test_func_count, assert_count)
        
        # Execute the tests if we have both test code and implementation code
        if test_code and implementation_code and detected_language:
            try:
                logger.info(f"Executing tests for iteration {iteration}")
                execution_result = execute_tests(
                    test_code, 
                    implementation_code, 
                    detected_language, 
                    iteration,
                    task_description
                )
                
                # Document the test results
                test_doc = document_test_results(
                    execution_result,
                    iteration,
                    detected_language,
                    task_description
                )
                
                # Store the execution result for reporting
                test_execution_results.append(test_doc)
                
                # Update counters based on actual execution results
                if execution_result.total_tests > 0:
                    test_count = execution_result.total_tests
                    total_tests += test_count
                    passed_tests += execution_result.passed_tests
                    
                    # Add any execution errors to issues
                    if execution_result.errors:
                        for error in execution_result.errors[:3]:  # Limit to 3 errors
                            issues_detected.append(f"Test error in iteration {iteration}: {error}")
                            
                    # Check success status
                    if not execution_result.success and execution_result.failed_tests > 0:
                        issues_detected.append(f"Failed {execution_result.failed_tests} tests in iteration {iteration}")
            except Exception as e:
                logger.error(f"Error executing tests: {e}")
                issues_detected.append(f"Error executing tests in iteration {iteration}: {str(e)}")
                # Still analyze the test code statically
                total_tests += test_count
        else:
            # Fallback to static analysis if tests can't be executed
            total_tests += test_count

        # Detect clear pass/fail patterns across languages
        fail_patterns = [
            r'assert\s+False', r'fail\s*\(', r'pytest\.fail', r'raise\s+AssertionError',
            r'Assert\.Fail', r'assertFalse\(true\)', r'FAIL\(', r'expect\(.*\)\.not\.toBe'
        ]
        fail_count = 0
        for pat in fail_patterns:
            fail_count += len(re.findall(pat, code_no_comments))

        # If no fail patterns, assume test passes (for LLM-generated code)
        if fail_count == 0 and test_count > 0:
            passed_tests += test_count

        # Check for error indicators in the tests (excluding comments)
        error_indicators = [
            "raises", "raise", "exception", "Error", "error", 
            "fail", "invalid", "incorrect", "wrong", "exception",
            "panic", "throw", "throws"
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
                "efficient", "complexity", "stack overflow", "memory leak"
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
            "correct", "accurate", "proper", "good", "successful", "passes"
        ]
        for indicator in positive_indicators:
            if re.search(rf'\b{indicator}\b', code_no_comments, re.IGNORECASE):
                recommendations.append(f"Final assessment indicates code is {indicator}")

    # Calculate task relevance
    task_relevance = assess_task_relevance(tdd_tests, suggestion_code, task_description)
    
    # Apply improved task analysis for better insights
    task_analysis = {}
    if task_description:
        task_analysis = analyze_task_for_testing(
            task_description, 
            suggestion_code, 
            detected_language
        )
        
        # Add domain-specific insights if available
        if task_analysis.get("domain"):
            domain = task_analysis.get("domain")
            recommendations.append(f"Task identified as {domain} domain")
        
        # Add analysis insights to recommendations if available
        if task_analysis.get("edge_cases"):
            edge_case_recs = [
                f"Consider testing: {case}" for case in task_analysis.get("edge_cases", [])[:3]
            ]
            recommendations.extend(edge_case_recs)
            
        # Add specific test scenarios if available
        if task_analysis.get("test_scenarios"):
            test_scenario_recs = [
                f"Suggested test: {scenario}" for scenario in task_analysis.get("test_scenarios", [])[:2]
            ]
            recommendations.extend(test_scenario_recs)
    
    # Calculate test quality metrics for the final iteration
    test_quality = {}
    quality_score = 0.5  # Default quality score
    
    if final_tests:
        final_code = final_tests[0].get("test_code", "")
        test_quality = evaluate_test_quality(
            final_code, 
            task_description, 
            suggestion_code, 
            detected_language
        )
        quality_score = test_quality.get("overall_quality", 0.5)
        
        # Add quality insights to recommendations
        if test_quality.get("strengths"):
            recommendations.extend(test_quality.get("strengths", [])[:2])
        if test_quality.get("weaknesses"):
            recommendations.extend([f"Improve: {w}" for w in test_quality.get("weaknesses", [])[:2]])
            
        # Add newly available metrics if present
        if test_quality.get("test_isolation_score") and test_quality.get("test_isolation_score") < 0.5:
            recommendations.append("Tests could benefit from better isolation")
            
        if test_quality.get("task_alignment_score") and test_quality.get("task_alignment_score") < 0.6:
            recommendations.append("Tests should align better with the task requirements")
            
        if test_quality.get("detected_language"):
            detected_language = test_quality.get("detected_language")

    # Calculate TDD score
    tdd_score = 0.5  # default neutral
    if total_tests > 0:
        # Base score on apparent test passage and completeness
        base_score = min(0.8, (passed_tests / total_tests) if total_tests > 0 else 0.4)
        # Adjust score down for major issues
        issue_penalty = min(0.5, len(issues_detected) * 0.1)
        # Final score combines test results, task relevance, and test quality
        test_result_score = max(0.1, base_score - issue_penalty)
        tdd_score = 0.5 * test_result_score + 0.3 * task_relevance + 0.2 * quality_score

    # Generate additional recommendations
    if tdd_score < 0.4:
        recommendations.append("Consider revising code based on test failures or low relevance to task")
    elif tdd_score > 0.7:
        recommendations.append("Code performs well in tests and aligns with task requirements")
    elif not recommendations:
        recommendations.append("Code has mixed test results - consider reviewing manually")

    # Determine accept recommendation
    accept = tdd_score >= 0.6

    # Prepare the evaluation result with enhanced metrics
    result = {
        "tdd_score": tdd_score,
        "task_relevance": task_relevance,
        "test_quality": quality_score,
        "issues_detected": issues_detected,
        "recommendations": recommendations,
        "accept": accept,
        "detected_language": detected_language,
        "metrics": {
            "test_count": total_tests,
            "passed_tests": passed_tests,
            "quality_metrics": test_quality,
            "test_execution_results": test_execution_results
        },
        "test_execution_results": test_execution_results  # Add the test execution results
    }
    
    # Calculate execution metrics if we have execution results
    if test_execution_results:
        execution_summary = {
            "total_tests_executed": sum(doc.get("execution_result", {}).get("total_tests", 0) for doc in test_execution_results),
            "total_passed": sum(doc.get("execution_result", {}).get("passed_tests", 0) for doc in test_execution_results),
            "total_failed": sum(doc.get("execution_result", {}).get("failed_tests", 0) for doc in test_execution_results),
            "success_rate": 0.0,
            "iterations_with_failures": 0
        }
        
        if execution_summary["total_tests_executed"] > 0:
            execution_summary["success_rate"] = execution_summary["total_passed"] / execution_summary["total_tests_executed"]
            
        execution_summary["iterations_with_failures"] = sum(
            1 for doc in test_execution_results 
            if doc.get("execution_result", {}).get("failed_tests", 0) > 0
        )
        
        result["execution_metrics"] = execution_summary

    # Include task analysis if available
    if task_analysis:
        result["task_analysis"] = {
            "key_requirements": task_analysis.get("key_requirements", []),
            "concepts": task_analysis.get("concepts", []),
            "edge_cases": task_analysis.get("edge_cases", []),
            "domain": task_analysis.get("domain", "general"),
            "detected_language": task_analysis.get("detected_language", detected_language)
        }
        
    return result

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
        
        # If we have test quality information, consider it in the weighting
        test_quality = tdd_evaluation.get("test_quality", 0.5)
        task_relevance = tdd_evaluation.get("task_relevance", 0.7)
        
        # Adjust weights based on test quality and task relevance
        if test_quality > 0.7 and task_relevance > 0.7:
            # If both quality and relevance are high, give TDD even more weight
            tdd_weight = 0.8
            llm_weight = 0.2
            logger.info("Giving TDD results higher weight due to high test quality and task relevance")
        
        # Calculate weighted score
        weighted_score = (tdd_score * tdd_weight) + (alignment_score * llm_weight)
            
        # Risk factors can still veto
        if hallucination_risk > 0.7 or recursive_risk > 0.7:
            final_accept = False
            reason = f"High risk detected: hallucination={hallucination_risk:.2f}, recursive={recursive_risk:.2f}"
        else:
            final_accept = weighted_score >= 0.6
            reason = f"Combined evaluation: TDD score={tdd_score:.2f}, alignment={alignment_score:.2f}"
    
    # Include language detection in the combined evaluation if available
    detected_language = tdd_evaluation.get("detected_language")
    
    # Prepare combined evaluation
    combined_evaluation = {
        "accept": final_accept,
        "analysis": {
            "hallucination_risk": hallucination_risk,
            "recursive_risk": recursive_risk,
            "alignment_score": alignment_score,
            "tdd_score": tdd_score,
            "issues_detected": issues,
            "recommendations": recommendations,
            "detected_language": detected_language
        },
        "reason": reason
    }
    
    return final_accept, combined_evaluation
