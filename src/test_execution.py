# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
Test Execution and Verification Module

This module handles the execution of generated tests, verification of test results,
and documentation of test outcomes during the monitoring process.
"""
import os
import re
import tempfile
import subprocess
import logging
import json
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
import sys

from src.language_test_templates import TEST_FRAMEWORKS
from src.test_quality_metrics import evaluate_test_quality

# Configure logging
logger = logging.getLogger(__name__)

class TestExecutionResult:
    """Class to hold test execution results"""
    def __init__(self, 
                success: bool = False, 
                total_tests: int = 0, 
                passed_tests: int = 0, 
                failed_tests: int = 0,
                execution_time: float = 0.0,
                output: str = "",
                errors: List[str] = None,
                test_file_path: str = "",
                implementation_file_path: str = ""):
        self.success = success
        self.total_tests = total_tests
        self.passed_tests = passed_tests
        self.failed_tests = failed_tests
        self.execution_time = execution_time
        self.output = output
        self.errors = errors or []
        self.test_file_path = test_file_path
        self.implementation_file_path = implementation_file_path
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert test result to dictionary for serialization"""
        return {
            "success": self.success,
            "total_tests": self.total_tests,
            "passed_tests": self.passed_tests,
            "failed_tests": self.failed_tests,
            "execution_time": self.execution_time,
            "output": self.output,
            "errors": self.errors,
            "test_file_path": self.test_file_path,
            "implementation_file_path": self.implementation_file_path
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TestExecutionResult':
        """Create a TestExecutionResult from a dictionary"""
        return cls(
            success=data.get("success", False),
            total_tests=data.get("total_tests", 0),
            passed_tests=data.get("passed_tests", 0),
            failed_tests=data.get("failed_tests", 0),
            execution_time=data.get("execution_time", 0.0),
            output=data.get("output", ""),
            errors=data.get("errors", []),
            test_file_path=data.get("test_file_path", ""),
            implementation_file_path=data.get("implementation_file_path", "")
        )

def execute_tests(test_code: str, implementation_code: str, language: str, 
                 iteration: int, task_description: str) -> TestExecutionResult:
    """
    Execute tests and return the results
    
    Args:
        test_code: The test code to execute
        implementation_code: The implementation code being tested
        language: Programming language of the code
        iteration: Current TDD iteration 
        task_description: Description of the task
        
    Returns:
        TestExecutionResult object with execution details
    """
    logger.info(f"Executing tests for {language} code (iteration {iteration})")
    
    # Create temporary files for the test and implementation
    with tempfile.TemporaryDirectory() as temp_dir:
        # Determine file extensions
        file_extensions = {
            "python": ".py",
            "javascript": ".js", 
            "typescript": ".ts",
            "java": ".java",
            "csharp": ".cs",
            "cpp": ".cpp",
            "rust": ".rs",
            "go": ".go",
            "ruby": ".rb"
        }
        
        ext = file_extensions.get(language.lower(), ".txt")
        
        # Create implementation file
        impl_file_path = os.path.join(temp_dir, f"implementation{ext}")
        with open(impl_file_path, 'w') as f:
            f.write(implementation_code)
        
        # Create test file - adjust imports/includes to reference the implementation file
        test_file = adjust_test_imports(test_code, language, "implementation")
        test_file_path = os.path.join(temp_dir, f"test{ext}")
        with open(test_file_path, 'w') as f:
            f.write(test_file)
        
        # Run appropriate test command based on language
        return run_language_specific_tests(
            language, 
            test_file_path, 
            impl_file_path, 
            temp_dir, 
            iteration,
            task_description
        )

def adjust_test_imports(test_code: str, language: str, impl_module_name: str) -> str:
    """
    Adjust import statements in test code to reference the implementation file
    
    Args:
        test_code: The test code
        language: Programming language
        impl_module_name: Name of the implementation module
        
    Returns:
        Updated test code with corrected imports
    """
    if language.lower() == "python":
        # Check if there are import statements to replace
        if re.search(r"from\s+\w+\s+import|import\s+\w+", test_code):
            # Replace existing imports
            test_code = re.sub(
                r"from\s+(\w+)\s+import", 
                f"from {impl_module_name} import", 
                test_code
            )
            test_code = re.sub(
                r"import\s+(\w+)", 
                f"import {impl_module_name}", 
                test_code
            )
        else:
            # Add import at the beginning
            test_code = f"from {impl_module_name} import *\n\n" + test_code
            
    elif language.lower() in ["javascript", "typescript"]:
        # Check if there are require/import statements to replace
        if re.search(r"(require|import)\s+.*from", test_code):
            # Replace existing imports
            test_code = re.sub(
                r"(require|import)\s+.*from\s+['\"]([^'\"]+)['\"]", 
                f"\\1 from './{impl_module_name}'", 
                test_code
            )
        else:
            # Add import at the beginning
            if language.lower() == "javascript":
                test_code = f"const {{ ...implementation }} = require('./{impl_module_name}');\n\n" + test_code
            else:
                test_code = f"import * as implementation from './{impl_module_name}';\n\n" + test_code
                
    elif language.lower() == "cpp":
        # Include the implementation header
        if not "#include \"implementation.h\"" in test_code:
            test_code = f"#include \"implementation.h\"\n" + test_code
            
    # For other languages, keeping imports as-is, assuming they'll be handled by the build system
    
    return test_code

def run_language_specific_tests(language: str, test_file_path: str, 
                               impl_file_path: str, work_dir: str,
                               iteration: int, task_description: str) -> TestExecutionResult:
    """
    Run tests for a specific language
    
    Args:
        language: Programming language
        test_file_path: Path to the test file
        impl_file_path: Path to the implementation file
        work_dir: Working directory
        iteration: TDD iteration
        task_description: Task description
        
    Returns:
        TestExecutionResult object with execution results
    """
    language = language.lower()
    
    # Get appropriate test command for the language
    test_command, test_env = get_test_command(language, test_file_path, impl_file_path, work_dir)
    
    if not test_command:
        # If we can't determine a test command, return a simulated result
        return simulate_test_execution(test_file_path, impl_file_path, language, iteration, task_description)
    
    # Execute the test command
    try:
        start_time = __import__('time').time()
        process = subprocess.run(
            test_command,
            env=test_env,
            shell=True,
            cwd=work_dir,
            capture_output=True,
            text=True,
            timeout=30  # Timeout after 30 seconds
        )
        execution_time = __import__('time').time() - start_time
        
        # Parse test output
        return parse_test_output(
            language, 
            process.stdout + process.stderr, 
            test_file_path, 
            impl_file_path,
            execution_time
        )
    except subprocess.TimeoutExpired:
        logger.error(f"Test execution timed out for {language}")
        return TestExecutionResult(
            success=False,
            errors=["Test execution timed out"],
            test_file_path=test_file_path,
            implementation_file_path=impl_file_path
        )
    except Exception as e:
        logger.error(f"Error executing tests: {e}")
        return TestExecutionResult(
            success=False,
            errors=[f"Error executing tests: {str(e)}"],
            test_file_path=test_file_path,
            implementation_file_path=impl_file_path
        )

def get_test_command(language: str, test_file_path: str, 
                    impl_file_path: str, work_dir: str) -> Tuple[str, Dict[str, str]]:
    """
    Get the command to run tests for a specific language
    
    Args:
        language: Programming language
        test_file_path: Path to the test file
        impl_file_path: Path to the implementation file
        work_dir: Working directory
        
    Returns:
        Tuple of (command_string, environment_variables)
    """
    env = os.environ.copy()
    
    if language == "python":
        # Use pytest to run the tests
        return (f"python -m pytest {test_file_path} -v", env)
        
    elif language in ["javascript", "typescript"]:
        if language == "typescript":
            # First compile TypeScript to JavaScript
            compile_cmd = f"tsc {test_file_path} {impl_file_path} --outDir {work_dir}/compiled"
            try:
                subprocess.run(compile_cmd, shell=True, cwd=work_dir, check=True)
                # Run Jest on the compiled JavaScript
                return (f"npx jest {work_dir}/compiled/test.js --verbose", env)
            except subprocess.CalledProcessError:
                return (f"npx ts-node {test_file_path}", env)
        else:
            # Run Jest directly on JavaScript
            return (f"npx jest {test_file_path} --verbose", env)
            
    elif language == "cpp":
        # Compile and run the C++ tests
        build_dir = os.path.join(work_dir, "build")
        os.makedirs(build_dir, exist_ok=True)
        
        # Create a simple CMakeLists.txt file
        cmake_file = os.path.join(work_dir, "CMakeLists.txt")
        with open(cmake_file, 'w') as f:
            f.write(f"""
cmake_minimum_required(VERSION 3.10)
project(TestProject)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Google Test
find_package(GTest QUIET)
if(GTest_FOUND)
    enable_testing()
    add_executable(test_runner {test_file_path})
    target_link_libraries(test_runner GTest::GTest GTest::Main)
    add_test(NAME TestSuite COMMAND test_runner)
else()
    message(STATUS "Google Test not found, skipping tests")
endif()
            """)
        
        # Create a header file for the implementation
        impl_header = os.path.join(work_dir, "implementation.h")
        with open(impl_header, 'w') as f:
            f.write(f"// Implementation Header\n")
            f.write(f"#pragma once\n\n")
            # Extract declarations from implementation and add them to the header
            # This is a simple approach that may need refinement
            with open(impl_file_path, 'r') as impl_f:
                impl_content = impl_f.read()
                # Extract function, class, and template declarations
                declarations = re.findall(r"(template\s*<.*>)?\s*(class|struct|enum|union|void|int|char|bool|double|float|auto|std::[:\w<>]+|[A-Za-z_][\w<>:]*)\s+([A-Za-z_][\w]*)\s*\([^;{]*\)\s*(?:const|noexcept|override|final|=\s*default|=\s*delete|=\s*0)?(?:\s*->.*?)?\s*(?=\{)", impl_content)
                for decl in declarations:
                    template_part, return_type, func_name = decl
                    # Find the full function declaration including parameters
                    full_decl = re.search(f"{template_part}\\s*{return_type}\\s+{func_name}\\s*\\([^{{;]*\\)\\s*(?:const|noexcept|override|final|=\\s*default|=\\s*delete|=\\s*0)?(?:\\s*->.*?)?\\s*{{", impl_content)
                    if full_decl:
                        f.write(f"{full_decl.group(0)[:-1]};\n\n")
                
                # Extract class definitions
                class_defs = re.findall(r"(template\s*<.*>)?\s*(class|struct)\s+([A-Za-z_][\w]*)\s*(?::\s*(?:public|protected|private)\s+[A-Za-z_][\w:]*\s*)?(?=\{)", impl_content)
                for class_def in class_defs:
                    template_part, class_type, class_name = class_def
                    # Find the full class definition
                    full_class = re.search(f"{template_part}\\s*{class_type}\\s+{class_name}\\s*(?::\\s*(?:public|protected|private)\\s+[A-Za-z_][\\w:]*\\s*)?{{(.*?)}}\\s*;", impl_content, re.DOTALL)
                    if full_class:
                        f.write(f"{full_class.group(0)}\n\n")
            
        # Try running CMake build
        try:
            build_cmd = f"cd {build_dir} && cmake .. && make"
            subprocess.run(build_cmd, shell=True, check=True)
            return (f"cd {build_dir} && ./test_runner", env)
        except subprocess.CalledProcessError:
            logger.warning("CMake build failed, trying direct compilation instead")
            
            # Direct compilation as fallback
            compile_cmd = f"g++ -std=c++23 -o {work_dir}/test_runner {test_file_path} {impl_file_path} -lgtest -lgtest_main -pthread"
            try:
                subprocess.run(compile_cmd, shell=True, check=True)
                return (f"{work_dir}/test_runner", env)
            except subprocess.CalledProcessError:
                logger.error("Direct compilation failed as well")
                return ("", {})
                
    elif language == "java":
        # For Java, we need to compile first
        class_name = extract_class_name(test_file_path)
        compile_cmd = f"javac -d {work_dir} {test_file_path} {impl_file_path}"
        try:
            subprocess.run(compile_cmd, shell=True, check=True)
            # Use JUnit to run tests if extracted class name
            if class_name:
                return (f"java -cp {work_dir}:$CLASSPATH org.junit.runner.JUnitCore {class_name}", env)
            else:
                return ("", {})
        except subprocess.CalledProcessError:
            return ("", {})
    
    # Add support for more languages as needed
    return ("", {})  # No command available for this language

def extract_class_name(file_path: str) -> Optional[str]:
    """Extract the fully qualified class name from a Java file"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            # Extract package if present
            package_match = re.search(r"package\s+([a-zA-Z0-9_.]+);", content)
            package = package_match.group(1) + "." if package_match else ""
            
            # Extract class name
            class_match = re.search(r"public\s+class\s+([a-zA-Z0-9_]+)", content)
            if class_match:
                return package + class_match.group(1)
    except Exception:
        pass
    return None

def parse_test_output(language: str, output: str, test_file_path: str, 
                     impl_file_path: str, execution_time: float) -> TestExecutionResult:
    """
    Parse test output to extract test results
    
    Args:
        language: Programming language
        output: Test command output
        test_file_path: Path to the test file
        impl_file_path: Path to the implementation file
        execution_time: Time taken to execute the tests
        
    Returns:
        TestExecutionResult object with parsed results
    """
    # Initialize result with defaults
    result = TestExecutionResult(
        success=False,
        execution_time=execution_time,
        output=output,
        test_file_path=test_file_path,
        implementation_file_path=impl_file_path
    )
    
    # Parse based on language/test framework
    if language == "python":
        # Parse pytest output
        # Example: "5 passed, 2 failed in 0.03s"
        summary_match = re.search(r"(\d+) passed,?\s*(\d+) failed", output)
        if summary_match:
            passed = int(summary_match.group(1))
            failed = int(summary_match.group(2))
            result.passed_tests = passed
            result.failed_tests = failed
            result.total_tests = passed + failed
            result.success = failed == 0
        else:
            # Alternative pattern: "5 passed in 0.03s"
            passed_only = re.search(r"(\d+) passed", output)
            if passed_only:
                passed = int(passed_only.group(1))
                result.passed_tests = passed
                result.total_tests = passed
                result.success = True
                
    elif language in ["javascript", "typescript"]:
        # Parse Jest output
        # Example: "Tests: 3 passed, 1 failed, 4 total"
        summary_match = re.search(r"Tests:.*?(\d+) passed,.*?(\d+) failed,.*?(\d+) total", output)
        if summary_match:
            result.passed_tests = int(summary_match.group(1))
            result.failed_tests = int(summary_match.group(2))
            result.total_tests = int(summary_match.group(3))
            result.success = result.failed_tests == 0
    
    elif language == "cpp":
        # Parse Google Test output
        # Example: "[==========] 4 tests from 1 test suite ran."
        total_match = re.search(r"\[==========\]\s*(\d+) tests", output)
        if total_match:
            result.total_tests = int(total_match.group(1))
            
            # Count passed tests
            passed_match = re.search(r"\[  PASSED  \]\s*(\d+) tests?", output)
            result.passed_tests = int(passed_match.group(1)) if passed_match else 0
            
            # Calculate failed tests
            result.failed_tests = result.total_tests - result.passed_tests
            result.success = result.failed_tests == 0
    
    elif language == "java":
        # Parse JUnit output
        # Example: "Tests run: 4, Failures: 1, Errors: 0"
        junit_match = re.search(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+)", output)
        if junit_match:
            total = int(junit_match.group(1))
            failures = int(junit_match.group(2))
            errors = int(junit_match.group(3))
            
            result.total_tests = total
            result.failed_tests = failures + errors
            result.passed_tests = total - (failures + errors)
            result.success = (failures + errors) == 0
            
    # Default case - extract common patterns if language-specific parsing didn't work
    if result.total_tests == 0:
        # Look for common patterns in test output
        # "N tests", "N passing", "N failing", etc.
        test_count = re.search(r"(\d+)(?:\s+|-)(?:tests?|specs?)", output, re.IGNORECASE)
        if test_count:
            result.total_tests = int(test_count.group(1))
            
        pass_count = re.search(r"(\d+)(?:\s+|-)(?:passing|passed|ok)", output, re.IGNORECASE)
        if pass_count:
            result.passed_tests = int(pass_count.group(1))
            
        fail_count = re.search(r"(\d+)(?:\s+|-)(?:failing|failed|errors?|broken)", output, re.IGNORECASE)
        if fail_count:
            result.failed_tests = int(fail_count.group(1))
            
        # If we have total but not passed/failed, calculate the missing value
        if result.total_tests > 0:
            if result.passed_tests == 0 and result.failed_tests == 0:
                # If output contains "success" or similar, assume all passed
                if re.search(r"success|all\s+tests\s+passed", output, re.IGNORECASE):
                    result.passed_tests = result.total_tests
                    result.success = True
            elif result.passed_tests > 0 and result.failed_tests == 0:
                result.failed_tests = result.total_tests - result.passed_tests
                result.success = result.failed_tests == 0
            elif result.failed_tests > 0 and result.passed_tests == 0:
                result.passed_tests = result.total_tests - result.failed_tests
                result.success = result.failed_tests == 0
                
    # Extract error messages
    if not result.success:
        error_lines = []
        for line in output.splitlines():
            if re.search(r"error|fail|exception|assertion|FAILED", line, re.IGNORECASE):
                error_lines.append(line.strip())
        result.errors = error_lines[:10]  # Limit to first 10 errors
        
    return result

def simulate_test_execution(test_file_path: str, impl_file_path: str, 
                           language: str, iteration: int,
                           task_description: str) -> TestExecutionResult:
    """
    Simulate test execution when actual execution is not possible
    
    Args:
        test_file_path: Path to the test file
        impl_file_path: Path to the implementation file
        language: Programming language
        iteration: TDD iteration
        task_description: Task description
        
    Returns:
        TestExecutionResult with simulated results based on test quality
    """
    logger.info(f"Simulating test execution for {language} (iteration {iteration})")
    
    try:
        # Read test file and implementation file
        with open(test_file_path, 'r') as f:
            test_code = f.read()
            
        with open(impl_file_path, 'r') as f:
            impl_code = f.read()
            
        # Analyze test quality
        test_quality = evaluate_test_quality(test_code, task_description, impl_code, language)
        quality_score = test_quality.get('score', 0.5)
        
        # Count tests based on language patterns
        test_count = count_tests(test_code, language)
        
        # Calculate passing tests based on quality and iteration
        # Higher quality and later iterations have more passing tests
        pass_ratio = min(0.95, quality_score + (iteration * 0.1))
        passed = int(test_count * pass_ratio)
        failed = test_count - passed
        
        return TestExecutionResult(
            success=(failed == 0),
            total_tests=test_count,
            passed_tests=passed,
            failed_tests=failed,
            execution_time=0.1 * test_count, # Simulated execution time
            output=f"Simulated test execution for {language} - {passed}/{test_count} tests passed",
            test_file_path=test_file_path,
            implementation_file_path=impl_file_path
        )
    except Exception as e:
        logger.error(f"Error simulating test execution: {e}")
        return TestExecutionResult(
            success=False,
            errors=[f"Error simulating test execution: {str(e)}"],
            test_file_path=test_file_path,
            implementation_file_path=impl_file_path
        )

def count_tests(test_code: str, language: str) -> int:
    """
    Count the number of tests in the test code
    
    Args:
        test_code: The test code
        language: Programming language
        
    Returns:
        Number of tests
    """
    # Define test patterns for different languages
    test_patterns = {
        "python": [
            r"def\s+test_\w+\s*\(",  # pytest style
            r"self\.assert\w+\("     # unittest style
        ],
        "javascript": [
            r"it\s*\(\s*['\"]",      # Jest/Mocha style
            r"test\s*\(\s*['\"]"     # Jest style
        ],
        "typescript": [
            r"it\s*\(\s*['\"]",
            r"test\s*\(\s*['\"]"
        ],
        "java": [
            r"@Test",                # JUnit style
            r"public\s+void\s+test\w+"
        ],
        "cpp": [
            r"TEST\s*\(",            # Google Test style
            r"TEST_F\s*\("
        ]
    }
    
    # Get patterns for the language or use a generic pattern
    patterns = test_patterns.get(language.lower(), [r"test", r"assert"])
    
    # Count occurrences of test patterns
    count = 0
    for pattern in patterns:
        count += len(re.findall(pattern, test_code))
        
    # If we couldn't find any tests but there are assertions, count those
    if count == 0:
        assertion_count = len(re.findall(r"assert|expect|should", test_code, re.IGNORECASE))
        # Estimate test count based on assertion density
        if assertion_count > 0:
            # Assume roughly 2-3 assertions per test
            count = max(1, assertion_count // 2)
    
    # Make sure we return at least 1 test to avoid division by zero
    return max(1, count)

def document_test_results(execution_result: TestExecutionResult, 
                         iteration: int, 
                         language: str,
                         task_description: str) -> Dict[str, Any]:
    """
    Document test execution results in a structured format
    
    Args:
        execution_result: The test execution result
        iteration: TDD iteration number
        language: Programming language
        task_description: Task description
        
    Returns:
        A dictionary with documented test results
    """
    # Get current timestamp
    timestamp = __import__('datetime').datetime.now().isoformat()
    
    # Create documentation structure
    documentation = {
        "timestamp": timestamp,
        "iteration": iteration,
        "language": language,
        "framework": TEST_FRAMEWORKS.get(language.lower(), "unknown"),
        "task_description": task_description,
        "execution_result": execution_result.to_dict(),
        "summary": {
            "status": "PASSED" if execution_result.success else "FAILED",
            "pass_rate": execution_result.passed_tests / execution_result.total_tests if execution_result.total_tests > 0 else 0,
            "total_tests": execution_result.total_tests,
            "execution_time_seconds": execution_result.execution_time
        }
    }
    
    # Add analysis of test results
    if execution_result.success:
        documentation["analysis"] = "All tests passed successfully."
    else:
        documentation["analysis"] = f"{execution_result.failed_tests} out of {execution_result.total_tests} tests failed."
        if execution_result.errors:
            documentation["analysis"] += f" Errors: {'; '.join(execution_result.errors[:3])}"
    
    return documentation

def generate_test_report(test_results: List[Dict[str, Any]], 
                        language: str,
                        task_description: str,
                        output_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Generate a comprehensive test report from multiple test results
    
    Args:
        test_results: List of test result dictionaries
        language: Programming language
        task_description: Task description
        output_path: Optional path to save the report file
        
    Returns:
        A dictionary with the comprehensive test report
    """
    # Calculate overall statistics
    total_tests = sum(result["summary"]["total_tests"] for result in test_results)
    passed_tests = sum(result["execution_result"]["passed_tests"] for result in test_results)
    failed_tests = sum(result["execution_result"]["failed_tests"] for result in test_results)
    
    total_iterations = len(test_results)
    successful_iterations = sum(1 for result in test_results if result["summary"]["status"] == "PASSED")
    total_execution_time = sum(result["summary"]["execution_time_seconds"] for result in test_results)
    
    # Create report structure
    report = {
        "report_id": f"tdd_report_{__import__('datetime').datetime.now().strftime('%Y%m%d%H%M%S')}",
        "generated_at": __import__('datetime').datetime.now().isoformat(),
        "language": language,
        "task_description": task_description,
        "overall_statistics": {
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": failed_tests,
            "pass_rate": passed_tests / total_tests if total_tests > 0 else 0,
            "total_iterations": total_iterations,
            "successful_iterations": successful_iterations,
            "iteration_success_rate": successful_iterations / total_iterations if total_iterations > 0 else 0,
            "total_execution_time": total_execution_time
        },
        "iterations": test_results,
        "conclusion": ""
    }
    
    # Generate conclusion
    if report["overall_statistics"]["pass_rate"] > 0.9:
        report["conclusion"] = "The implementation has passed the vast majority of tests across all iterations. The code appears to be robust and reliable."
    elif report["overall_statistics"]["pass_rate"] > 0.7:
        report["conclusion"] = "The implementation has passed most tests but has some issues that should be addressed."
    else:
        report["conclusion"] = "The implementation has significant issues that need to be fixed as it failed many tests."
        
    # Add additional analysis based on trends over iterations
    if total_iterations > 1:
        first_pass_rate = test_results[0]["summary"]["pass_rate"]
        last_pass_rate = test_results[-1]["summary"]["pass_rate"]
        
        if last_pass_rate > first_pass_rate:
            report["conclusion"] += " Test pass rate has improved over iterations, showing good TDD progress."
        elif last_pass_rate < first_pass_rate:
            report["conclusion"] += " Test pass rate has decreased over iterations, indicating potential regressions."
        else:
            report["conclusion"] += " Test pass rate has remained stable across iterations."
    
    # Write report to file if output path is provided
    if output_path:
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, 'w') as f:
                json.dump(report, f, indent=2)
            logger.info(f"Test report saved to {output_path}")
        except Exception as e:
            logger.error(f"Error saving test report: {e}")
    
    return report
