# TDD Evaluator Integration Documentation

This document describes how to integrate the new task relevance module with the TDD evaluator to improve test evaluation quality.

## 1. Import the task_relevance module

In `tdd_evaluator.py`, add the following import:

```python
from task_relevance import assess_task_relevance
```

## 2. Update the evaluate_tdd_results function

Modify the `evaluate_tdd_results` function to use the task relevance assessment:

```python
def evaluate_tdd_results(tdd_tests: List[Dict[str, Any]], suggestion_code: str, task_description: str) -> Dict[str, Any]:
    # Existing initialization code...
    
    # After analyzing the test content and before calculating the TDD score
    
    # Calculate TDD score
    tdd_score = 0.5  # default neutral
    if total_tests > 0:
        # Base score on apparent test passage and completeness
        base_score = min(0.8, (passed_tests / total_tests) if total_tests > 0 else 0.4)
        
        # Adjust score down for major issues
        issue_penalty = min(0.5, len(issues_detected) * 0.1)
        
        # Determine relevance to task description
        task_relevance = assess_task_relevance(tdd_tests, suggestion_code, task_description)
        
        # Final score is based on test results, adjusted for issues and task relevance
        tdd_score = max(0.1, base_score - issue_penalty) * task_relevance
    
    # Rest of evaluation logic...
```

## 3. Update the recommendations based on task relevance

Enhance the recommendations based on task relevance:

```python
# Add specific recommendations based on analysis
if not recommendations:
    if tdd_score > 0.7:
        recommendations.append("Code passes tests well and aligns with the intended task")
    elif tdd_score < 0.3:
        recommendations.append("Code has significant test failures or doesn't align with the task")
    else:
        recommendations.append("Code has mixed test results - consider reviewing manually")
```

## 4. Update the combine_evaluation_results function

Modify the `combine_evaluation_results` function to give more weight to task relevance:

```python
def combine_evaluation_results(tdd_evaluation: Dict[str, Any], llm_evaluation: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    # Existing initialization code...
    
    # Weight TDD more heavily when available, especially when task relevance is high
    tdd_weight = 0.7
    llm_weight = 0.3
    
    # If we have a task relevance score in the TDD evaluation, adjust weights
    if "task_relevance" in tdd_evaluation:
        task_relevance = tdd_evaluation["task_relevance"]
        # Increase TDD weight if task relevance is high
        if task_relevance > 0.8:
            tdd_weight = 0.8
            llm_weight = 0.2
    
    # Calculate weighted score
    weighted_score = (tdd_score * tdd_weight) + (alignment_score * llm_weight)
    
    # Rest of the function...
```

## 5. Testing the Integration

After implementing these changes, test the integration with the following scenarios:

1. A task with clear technical terms (e.g., "Implement a stack data structure")
2. A generic task with no clear technical terms
3. A task that matches one of the specific patterns in the task relevance module

## 6. Potential Future Enhancements

- Add more task patterns to the task relevance module
- Implement machine learning-based relevance assessment
- Add support for more programming languages and paradigms
