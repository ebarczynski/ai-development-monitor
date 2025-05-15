#!/usr/bin/env python3
"""
Test Execution Utility

This script provides a simple utility to directly use the test execution functionality
of the AI Development Monitor.
"""
import os
import sys
import json
import argparse
from pathlib import Path

# Add the parent directory to the Python path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.test_execution import execute_tests, document_test_results, generate_test_report
from src.language_test_templates import get_language_specific_template

def parse_json_input(json_file_path):
    """Parse JSON input file with test execution request"""
    try:
        with open(json_file_path, 'r') as f:
            request_data = json.load(f)
            
        # Validate required fields
        if 'implementation_code' not in request_data:
            raise ValueError("Missing required field: implementation_code")
        
        if 'language' not in request_data:
            raise ValueError("Missing required field: language")
            
        # If test_code isn't provided and generate_test is true, generate a test template
        if 'test_code' not in request_data and request_data.get('generate_test', False):
            language = request_data['language']
            task_description = request_data.get('task_description', '')
            implementation_code = request_data['implementation_code']
            iteration = request_data.get('iteration', 1)
            
            test_template = get_language_specific_template(
                language,
                iteration,
                implementation_code,
                task_description
            )
            
            # Create a basic test based on the template guidance
            test_code = f"""
# Automatically generated test for {language} code
# Task: {task_description}

{test_template}

"""
            request_data['test_code'] = test_code
        
        return request_data
        
    except Exception as e:
        print(f"Error parsing JSON input: {e}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Test Execution Utility for AI Development Monitor")
    
    # Allow either command line arguments or a JSON input file
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--json", "-j", help="Path to JSON file with test execution request")
    input_group.add_argument("--test", "-t", help="Path to the test file")
    
    parser.add_argument("--impl", "-i", help="Path to the implementation file")
    parser.add_argument("--language", "-l", help="Programming language (python, javascript, typescript, cpp, java, etc.)")
    parser.add_argument("--task", "-d", default="", help="Task description for context")
    parser.add_argument("--iteration", "-n", type=int, default=1, help="TDD iteration number (1-5)")
    parser.add_argument("--output", "-o", help="Path to save output report (optional)")
    parser.add_argument("--json-output", action="store_true", help="Output results as JSON (for programmatic use)")
    
    if len(sys.argv) == 2 and os.path.exists(sys.argv[1]) and sys.argv[1].endswith('.json'):
        # If a single JSON file is provided without flags, assume it's the --json argument
        args = parser.parse_args(['--json', sys.argv[1]])
    else:
        args = parser.parse_args()
    
    # Process JSON input if provided
    if args.json:
        request_data = parse_json_input(args.json)
        test_code = request_data.get('test_code', '')
        impl_code = request_data.get('implementation_code', '')
        language = request_data.get('language', '')
        task_description = request_data.get('task_description', '')
        iteration = request_data.get('iteration', 1)
        json_output = True  # Always use JSON output when JSON input is provided
    else:
        # Use command line arguments
        if not args.test or not args.impl or not args.language:
            parser.error("When not using --json, the --test, --impl, and --language arguments are required")
        
        # Read the files
        try:
            with open(args.test, 'r') as f:
                test_code = f.read()
                
            with open(args.impl, 'r') as f:
                impl_code = f.read()
        except Exception as e:
            print(f"Error reading files: {e}")
            return 1
        
        language = args.language
        task_description = args.task
        iteration = args.iteration
        json_output = args.json_output
    
    if not json_output:
        print(f"Executing {language} tests (iteration {iteration})...")
    
    # Execute the tests
    try:
        result = execute_tests(
            test_code=test_code,
            implementation_code=impl_code,
            language=language,
            iteration=iteration,
            task_description=task_description
        )
    except Exception as e:
        if json_output:
            error_result = {
                "success": False,
                "error": str(e),
                "total_tests": 0,
                "passed_tests": 0,
                "failed_tests": 0,
                "execution_time": 0.0
            }
            print(json.dumps(error_result))
            return 1
        else:
            print(f"Error executing tests: {e}")
            return 1
    
    # Document the results
    doc = document_test_results(
        execution_result=result,
        iteration=iteration,
        language=language,
        task_description=task_description
    )
    
    # Output as JSON if requested
    if json_output:
        result_dict = result.to_dict()
        # Add the generated test code if it was generated
        if args.json and 'generate_test' in request_data and request_data['generate_test']:
            result_dict['test_code'] = test_code
        
        print(json.dumps(result_dict))
        return 0 if result.success else 1
    
    # Otherwise print human-readable output
    print("\n" + "=" * 50)
    print(f"TEST EXECUTION RESULTS")
    print("=" * 50)
    print(f"Language: {language}")
    if args.test:
        print(f"Test file: {args.test}")
        print(f"Implementation file: {args.impl}")
    print(f"Task description: {task_description or 'N/A'}")
    print(f"Iteration: {iteration}")
    print("-" * 50)
    print(f"Total tests: {result.total_tests}")
    print(f"Passed tests: {result.passed_tests}")
    print(f"Failed tests: {result.failed_tests}")
    print(f"Success: {'Yes' if result.success else 'No'}")
    print(f"Execution time: {result.execution_time:.2f} seconds")
    
    if result.errors:
        print("\nErrors:")
        for error in result.errors:
            print(f" - {error}")
    
    print("-" * 50)
    
    # Save report if output path provided
    if args.output:
        report = generate_test_report(
            test_results=[doc],
            language=language,
            task_description=task_description,
            output_path=args.output
        )
        print(f"Detailed report saved to {args.output}")
    
    return 0 if result.success else 1

if __name__ == "__main__":
    sys.exit(main())
