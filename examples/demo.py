#!/usr/bin/env python3
"""
Example script demonstrating how to use the AI Development Monitor Agent
with a local Ollama model to evaluate proposed changes.
"""
import sys
import os
import logging

# Add the src directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.monitor_agent import DevelopmentMonitorAgent


def main():
    """
    Main function demonstrating the AI Development Monitor Agent.
    """
    # Initialize the agent with the config file
    agent = DevelopmentMonitorAgent("config.json")
    print("AI Development Monitor Agent initialized")
    
    # Connect to Ollama
    if not agent.connect_llm():
        print("Failed to connect to Ollama. Make sure Ollama is running on http://localhost:11434")
        return
    
    print("Successfully connected to Ollama!")
    
    # Example task description
    task_description = "Create a function that calculates the sum of squares of numbers in a list"
    
    # Original code (placeholder)
    original_code = """
def sum_of_squares(numbers):
    # TODO: Implement this function
    pass
"""

    # Simulate AI-proposed changes
    proposed_changes = """
def sum_of_squares(numbers):
    result = 0
    for num in numbers:
        result += num * num
    return result
"""

    # Evaluate the proposed changes
    print("\nEvaluating proposed changes...")
    accepted, evaluation = agent.evaluate_proposed_changes(
        original_code, 
        proposed_changes, 
        task_description
    )
    
    # Process evaluation results
    print(f"\nChanges accepted: {accepted}")
    
    if accepted:
        print("\nApplying changes:")
        print(proposed_changes)
    else:
        print("\nChanges rejected due to the following issues:")
        analysis = evaluation.get("analysis", {})
        for issue in analysis.get("issues_detected", ["No specific issues provided"]):
            print(f"- {issue}")
        
        print("\nRecommendations:")
        for rec in analysis.get("recommendations", ["No recommendations provided"]):
            print(f"- {rec}")
    
    # Example of sending a direct prompt to the LLM
    print("\nSending a direct prompt to Ollama...")
    prompt = "Explain how to test a sum_of_squares function in Python"
    response = agent.send_prompt_to_llm(prompt)
    
    if response.get("success", False):
        print("\nOllama response:")
        print(response["response"])
    else:
        print(f"\nError: {response.get('error', 'Unknown error')}")


if __name__ == "__main__":
    main()
