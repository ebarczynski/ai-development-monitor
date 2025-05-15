"""
Language-Specific Test Templates for TDD

This module provides specialized test templates for different programming languages,
ensuring that generated tests follow the best practices and conventions for each language.
"""
from typing import Dict, Any, Optional

# Test framework mapping for each language
TEST_FRAMEWORKS = {
    "python": "pytest",
    "javascript": "jest",
    "typescript": "jest",
    "java": "junit",
    "csharp": "nunit",
    "cpp": "gtest",
    "go": "testing",
    "rust": "cargo test",
    "ruby": "rspec"
}

def get_language_specific_template(language: str, iteration: int, code: str, task_description: str) -> str:
    """
    Get language-specific test template for the given language and iteration
    
    Args:
        language: The programming language
        iteration: The current TDD iteration (1-5)
        code: The code being tested
        task_description: Description of what the code should do
        
    Returns:
        String containing language-specific instructions for test generation
    """
    # Normalize language name
    language = language.lower()
    
    # Use language-specific handler if available, otherwise fall back to generic
    language_handlers = {
        "python": get_python_template,
        "javascript": get_javascript_template,
        "typescript": get_typescript_template,
        "java": get_java_template,
        "csharp": get_csharp_template,
        "cpp": get_cpp_template
    }
    
    handler = language_handlers.get(language, get_generic_template)
    return handler(iteration, code, task_description)

def get_python_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get Python-specific test template using pytest
    """
    templates = {
        1: """
For this first iteration, create pytest tests that:
1. Use the pytest framework with proper fixtures if needed
2. Include assertions that verify the function exists and is callable
3. Test basic input values using `assert` statements
4. Include parametrized tests for multiple similar cases using `@pytest.mark.parametrize`
5. Follow Python naming conventions (snake_case for functions like `test_function_name`)

Example structure:
```python
import pytest
from module import function_under_test  # Assume module/import based on the code

def test_function_exists():
    assert callable(function_under_test)

def test_basic_functionality():
    # Test basic functionality with simple inputs
    assert function_under_test(input) == expected_output

@pytest.mark.parametrize("input_value,expected", [
    (value1, expected1),
    (value2, expected2),
])
def test_multiple_cases(input_value, expected):
    assert function_under_test(input_value) == expected
```
""",
        2: """
For the second iteration, extend pytest coverage to include:
1. More comprehensive parametrized tests with `@pytest.mark.parametrize`
2. Test cases that verify all edge cases and boundary conditions
3. Include tests for docstring examples if present (doctest style examples)
4. Add typing tests if the function uses type hints
5. Test context managers with `with pytest.raises(Exception)` for expected exceptions

Focus on making tests comprehensive while maintaining readability.
""",
        3: """
For the third iteration, focus on error handling in Python:
1. Test for proper exception types using `with pytest.raises(SpecificException)`
2. Verify exception messages using `with pytest.raises(Exception) as excinfo` and then checking `str(excinfo.value)`
3. Test handling of None values, empty sequences, and other Python-specific edge cases
4. Include tests for type checking behavior (if relevant)
5. Test with mocked dependencies using pytest's monkeypatch or unittest.mock
""",
        4: """
For the fourth iteration, focus on performance and advanced Python features:
1. Add performance tests for large inputs using `@pytest.mark.benchmark` if appropriate
2. Test for memory leaks or resource handling with pytest-leaks if appropriate
3. Verify the implementation handles Python-specific cases like generators or iterators
4. Test recursive limits and stack depth if relevant
5. Add tests for Python-specific optimizations like memoization or lazy evaluation
""",
        5: """
For the final iteration, conduct a comprehensive Python test review:
1. Ensure tests follow Python best practices and PEP 8 style guide
2. Verify test coverage for all function branches and edge cases
3. Include tests for Pythonic features and idioms used in the code
4. Ensure proper use of pytest fixtures and parametrization
5. Provide a final assessment on how well the implementation fulfills the task

Include a summary of code quality from a Python perspective.
"""
    }
    
    return templates.get(iteration, templates[1])

def get_javascript_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get JavaScript-specific test template using Jest
    """
    templates = {
        1: """
For this first iteration, create Jest tests that:
1. Use proper Jest functions (`describe`, `it`, `expect`)
2. Test basic functionality with simple inputs
3. Use appropriate matchers like `toBe()`, `toEqual()`, `toBeTruthy()`
4. Follow JavaScript naming conventions (camelCase, descriptive test names)
5. Properly import/require the code being tested

Example structure:
```javascript
// Assuming the function is exported from a module
const { functionUnderTest } = require('./module');

describe('functionUnderTest', () => {
  it('should exist and be callable', () => {
    expect(typeof functionUnderTest).toBe('function');
  });

  it('should correctly handle basic input', () => {
    expect(functionUnderTest(input)).toBe(expectedOutput);
  });

  it('should handle edge cases', () => {
    expect(functionUnderTest(edgeCaseInput)).toBe(expectedOutput);
  });
});
```
""",
        2: """
For the second iteration, extend Jest test coverage to include:
1. More comprehensive test cases with properly nested `describe` blocks for grouping
2. Test multiple edge cases and boundary conditions
3. Use test.each() for multiple similar test cases
4. Use beforeEach/afterEach for test setup and teardown if needed
5. Test for object equality with toEqual() and structure matching with toMatchObject()
""",
        3: """
For the third iteration, focus on JavaScript error handling and asynchronous code:
1. Test error throwing with `expect(() => {}).toThrow()`
2. Test for proper error messages with `toThrow(/message pattern/)`
3. Test asynchronous code using async/await or .resolves/.rejects
4. Test promises with proper error handling
5. Use Jest spies or mocks for external dependencies using jest.fn() or jest.mock()
""",
        4: """
For the fourth iteration, focus on JavaScript-specific concerns:
1. Test JavaScript performance considerations with larger inputs
2. Test for JavaScript-specific edge cases like type coercion
3. Consider testing browser-specific behavior if relevant (with Jest DOM helpers)
4. Test handling of undefined, null, NaN, and other JavaScript special values
5. Add snapshot tests for complex output structures if appropriate
""",
        5: """
For the final iteration, conduct a comprehensive JavaScript test review:
1. Ensure tests follow JavaScript best practices
2. Verify tests handle JavaScript-specific concerns like hoisting and closure scope
3. Check for appropriate error handling and asynchronous code testing
4. Ensure proper use of Jest features for clean and maintainable tests
5. Provide a final assessment on how well the implementation fulfills the task from a JavaScript perspective
"""
    }
    
    return templates.get(iteration, templates[1])

def get_typescript_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get TypeScript-specific test template using Jest
    """
    templates = {
        1: """
For this first iteration, create TypeScript tests using Jest that:
1. Use proper type annotations for test inputs and expected outputs
2. Use proper Jest functions (`describe`, `it`, `expect`) with TypeScript syntax
3. Follow TypeScript naming conventions and best practices
4. Include proper imports with type information
5. Test basic functionality with type-safe assertions

Example structure:
```typescript
// Assuming the function is exported from a module
import { functionUnderTest } from './module';

describe('functionUnderTest', () => {
  it('should exist and be callable', () => {
    expect(typeof functionUnderTest).toBe('function');
  });

  it('should correctly handle basic input', () => {
    const input: InputType = // appropriate input based on types;
    const expected: OutputType = // expected result;
    expect(functionUnderTest(input)).toBe(expected);
  });
});
```
""",
        2: """
For the second iteration, extend TypeScript test coverage to include:
1. Type testing with more complex TypeScript types
2. Test generics if used in the code
3. Use interfaces and type aliases in tests for better readability
4. Test with union types and optional parameters
5. Use test.each() with properly typed parameters
""",
        3: """
For the third iteration, focus on TypeScript error handling and advanced types:
1. Test error cases with properly typed error classes
2. Test handling of null and undefined with appropriate strictNullChecks handling
3. Test type guards and type narrowing if used
4. Use utility types in tests (Partial, Record, etc.)
5. Test with conditional types and mapped types if used
""",
        4: """
For the fourth iteration, focus on TypeScript-specific concerns:
1. Test type compatibility and assignability
2. Test for proper typing of complex objects and functions
3. Test with TypeScript-specific features like enums and namespaces
4. Ensure tests are type-safe while remaining readable
5. Test TypeScript configuration settings impact if relevant
""",
        5: """
For the final iteration, conduct a comprehensive TypeScript test review:
1. Ensure tests follow TypeScript best practices
2. Verify proper use of types throughout the tests
3. Check for type safety in test assertions
4. Ensure tests handle TypeScript-specific features correctly
5. Provide a final assessment on how well the implementation fulfills the task from a TypeScript perspective
"""
    }
    
    # For early iterations, TypeScript can use JavaScript templates with additions
    if iteration == 1:
        return templates[1]
    elif iteration == 2:
        return get_javascript_template(iteration, code, task_description) + "\n" + templates[2]
    else:
        return templates.get(iteration, templates[1])

def get_java_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get Java-specific test template using JUnit
    """
    templates = {
        1: """
For this first iteration, create JUnit tests that:
1. Use proper JUnit 5 annotations (@Test, @DisplayName, etc.)
2. Follow Java naming conventions (camelCase for methods, descriptive test names)
3. Use appropriate assertions from org.junit.jupiter.api.Assertions
4. Include tests for basic functionality with simple inputs
5. Structure tests with proper setup and teardown if needed

Example structure:
```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import static org.junit.jupiter.api.Assertions.*;

class ClassNameTest {
    @Test
    @DisplayName("Function should exist and handle basic input")
    void testBasicFunctionality() {
        // Arrange
        ClassName instance = new ClassName();
        Input input = // appropriate input;
        
        // Act
        Output result = instance.methodUnderTest(input);
        
        // Assert
        assertEquals(expectedOutput, result);
    }
    
    @Test
    @DisplayName("Function should handle edge cases")
    void testEdgeCases() {
        // Test implementation
    }
}
```
""",
        2: """
For the second iteration, extend JUnit test coverage to include:
1. Use @ParameterizedTest with various sources (@ValueSource, @CsvSource, etc.)
2. Include more comprehensive test cases with detailed assertions
3. Use nested tests with @Nested for organizing test cases
4. Use JUnit assumptions to clarify test prerequisites
5. Test for object equality with proper equals and hashCode testing
""",
        3: """
For the third iteration, focus on Java error handling:
1. Test exceptions with assertThrows
2. Verify exception messages and types
3. Test try-catch-finally blocks and resource handling
4. Test Java-specific features like checked exceptions
5. Use mocks or stubs with frameworks like Mockito if needed
""",
        4: """
For the fourth iteration, focus on Java-specific concerns:
1. Test performance with larger inputs, considering Java memory model
2. Test concurrency issues if relevant
3. Test with Java streams and lambdas if used
4. Consider testing for memory leaks with weak references
5. Test serialization/deserialization if relevant
""",
        5: """
For the final iteration, conduct a comprehensive Java test review:
1. Ensure tests follow Java best practices
2. Verify proper use of JUnit features and Java testing patterns
3. Check for appropriate error handling testing
4. Ensure tests are maintainable and follow clean code principles
5. Provide a final assessment on how well the implementation fulfills the task from a Java perspective
"""
    }
    
    return templates.get(iteration, templates[1])

def get_csharp_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get C#-specific test template using NUnit or xUnit
    """
    templates = {
        1: """
For this first iteration, create C# tests using NUnit that:
1. Use proper NUnit attributes ([Test], [TestCase], etc.)
2. Follow C# naming conventions (PascalCase for methods, descriptive test names)
3. Use appropriate assertions from NUnit.Framework.Assert
4. Include tests for basic functionality with simple inputs
5. Structure tests with proper setup and teardown using [SetUp] and [TearDown]

Example structure:
```csharp
using NUnit.Framework;

namespace Tests
{
    [TestFixture]
    public class ClassNameTests
    {
        private ClassName _instance;

        [SetUp]
        public void Setup()
        {
            _instance = new ClassName();
        }

        [Test]
        public void MethodUnderTest_BasicInput_ReturnsExpectedResult()
        {
            // Arrange
            var input = // appropriate input;
            var expected = // expected output;
            
            // Act
            var result = _instance.MethodUnderTest(input);
            
            // Assert
            Assert.AreEqual(expected, result);
        }
        
        [TestCase(input1, expected1, Description = "Test case 1 description")]
        [TestCase(input2, expected2, Description = "Test case 2 description")]
        public void MethodUnderTest_TestCases_ReturnsExpectedResults(InputType input, OutputType expected)
        {
            var result = _instance.MethodUnderTest(input);
            Assert.AreEqual(expected, result);
        }
    }
}
```
""",
        2: """
For the second iteration, extend C# test coverage to include:
1. More comprehensive [TestCase] attributes for parametrized testing
2. Use [Theory] and [InlineData] if using xUnit
3. Test property patterns and object equality with proper assertions
4. Include tests for C# properties and indexers if relevant
5. Test with various collection types and LINQ expressions if used
""",
        3: """
For the third iteration, focus on C# error handling:
1. Test exceptions with Assert.Throws<ExceptionType>(() => { })
2. Test async exception handling with Assert.ThrowsAsync if relevant
3. Test C#-specific patterns like using IDisposable for resource management
4. Test with null values and use nullable reference types if C# 8.0+
5. Use mocks with libraries like Moq or NSubstitute for dependencies
""",
        4: """
For the fourth iteration, focus on C#-specific concerns:
1. Test performance with larger inputs
2. Test for proper use of async/await if used
3. Test for memory management with IDisposable implementation
4. Consider testing for thread safety in concurrent scenarios
5. Test with C# features like extension methods, generics, and delegates
""",
        5: """
For the final iteration, conduct a comprehensive C# test review:
1. Ensure tests follow C# best practices
2. Verify proper use of test attributes and patterns
3. Check for appropriate error handling testing
4. Ensure tests are maintainable and follow clean code principles
5. Provide a final assessment on how well the implementation fulfills the task from a C# perspective
"""
    }
    
    return templates.get(iteration, templates[1])

def get_cpp_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get a C++ test template with C++23 support
    
    Args:
        iteration: The current TDD iteration (1-5)
        code: The C++ code being tested
        task_description: Description of what the code should do
        
    Returns:
        String containing C++-specific test generation instructions with C++23 support
    """
    templates = {
        1: """
For this first iteration of C++ tests, create basic tests that:
1. Use Google Test framework (gtest)
2. Include necessary C++ headers (gtest/gtest.h, gmock/gmock.h)
3. Verify functionality with basic inputs and edge cases
4. Demonstrate proper use of modern C++23 features when appropriate, such as:
   - `std::expected` for error handling
   - `std::print` for formatted output
   - `std::format` for string formatting
   - `std::ranges` for container operations
   - C++23 modules if applicable
   - `auto(x)` shorthand for lambdas
   - `if consteval` compile-time conditions
5. Structure the test file with appropriate namespace usage
6. Include a main function that runs all tests

Example test structure:
```cpp
#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <expected> // C++23
#include <format>   // C++23
#include <print>    // C++23

// Include the code being tested
// #include "your_code_header.h"

TEST(YourClassTest, YourFunctionName) {
  // Test case implementation
  EXPECT_EQ(result, expected_value);
}

// Add additional test cases

int main(int argc, char** argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
```
""",
        2: """
For the second iteration of C++ tests, enhance your test suite to:
1. Use test fixtures with TEST_F macro where appropriate
2. Test handling of C++23 features such as:
   - `std::expected<T, E>` return values
   - `std::print` formatting variations
   - String formatting with `std::format` including proper use of `std::formatter` specializations
   - Modules imports/exports if applicable
   - Using C++23 additions to `<algorithm>` and `<ranges>`
   - `constexpr` templates and reflection improvements
3. Add parameterized tests using `INSTANTIATE_TEST_SUITE_P`
4. Include tests for overloaded operators and constructors
5. Test RAII resource management
6. Verify thread safety if applicable
7. Consider using C++23's improved metaprogramming capabilities

Example test fixture:
```cpp
class YourClassTest : public ::testing::Test {
protected:
  void SetUp() override {
    // Setup code
  }
  
  void TearDown() override {
    // Cleanup code
  }
  
  // Test object and other shared resources
};

TEST_F(YourClassTest, TestFeature) {
  // Test implementation using fixture members
}
```
""",
        3: """
For the third iteration of C++ tests, focus on error handling with C++23 features:
1. Test `std::expected<T, E>` error paths thoroughly
2. Verify exception handling using EXPECT_THROW, EXPECT_NO_THROW
3. Test boundary conditions and edge cases using:
   - C++23 extended `constexpr` support for complex compile-time computations
   - `std::expected` for propagating errors
   - C++23 pattern matching (if implemented by your compiler)
4. Add stress tests for complex operations
5. Test memory safety using address sanitizers where applicable
6. Check for proper handling of C++23 spaceship operator (<=>) if used
7. Test any coroutine functionality and async code paths

Test error handling example:
```cpp
TEST(ErrorHandlingTest, ExpectedReturnValue) {
  auto result = function_that_might_fail();
  EXPECT_TRUE(result.has_value()); // For success case
  
  auto error_result = function_with_bad_input();
  EXPECT_FALSE(error_result.has_value());
  EXPECT_EQ(error_result.error(), ExpectedErrorCode);
}
```
""",
        4: """
For the fourth iteration of C++ tests, add comprehensive test coverage:
1. Use test coverage tools like gcov/lcov to identify untested code paths
2. Add mock objects with GMock where appropriate
3. Test C++23-specific container adaptors and algorithms
4. Add performance tests using Google Benchmark if applicable
5. Test your code with different compiler implementations (GCC, Clang, MSVC)
6. Add tests for C++23 monadic operations (and_then, or_else, transform) on std::expected
7. Test compile-time behavior with static_assert
8. Test proper module imports/exports if using C++23 modules
9. Test interoperability with C++20 concepts

Mocking example:
```cpp
class MockDatabase : public Database {
public:
  MOCK_METHOD(std::expected<Record, DbError>, fetchRecord, (std::string_view id), (override));
  MOCK_METHOD(std::expected<void, DbError>, saveRecord, (const Record& record), (override));
};

TEST(DatabaseClient, FetchesRecordCorrectly) {
  MockDatabase db;
  EXPECT_CALL(db, fetchRecord("test-id"))
    .WillOnce(Return(std::expected<Record, DbError>{Record{"test-id", "data"}}));
    
  DatabaseClient client(&db);
  auto result = client.getRecordData("test-id");
  EXPECT_TRUE(result.has_value());
  EXPECT_EQ(result->data, "data");
}
```
""",
        5: """
For the final iteration of C++ tests, focus on robustness and C++23 integration:
1. Test multi-threading with C++23 features:
   - `std::expected` across threads
   - `std::barrier` and `std::latch` for synchronization
   - Thread-safety of your classes
2. Test proper memory management:
   - RAII principles
   - Smart pointers
   - Move semantics
   - Proper destruction sequence
3. Use static analysis tools to identify potential issues
4. Add tests for C++23 module functionality including proper isolation
5. Check performance impacts of C++23 feature usage
6. Test string formatting using C++23's std::format and std::print
7. Test proper usage of C++23 text encoding conversions if applicable
8. Test proper implementation of C++23's spaceship operator (<=>) for complex types

Test example with C++23 features:
```cpp
#include <gtest/gtest.h>
#include <format>
#include <print>
#include <expected>
#include <thread>
#include <vector>
#include <barrier>

TEST(ThreadingTest, BarrierSynchronization) {
  constexpr int thread_count = 4;
  std::barrier sync_point(thread_count);
  std::atomic<int> counter = 0;
  std::vector<std::thread> threads;
  
  for (int i = 0; i < thread_count; i++) {
    threads.emplace_back([&sync_point, &counter, i]() {
      // Phase 1
      std::print("Thread {} is preparing\n", i);
      counter++;
      
      sync_point.arrive_and_wait(); // All threads wait here until everyone arrives
      
      // Phase 2
      EXPECT_EQ(counter.load(), thread_count); // All threads should see the same counter value
      
      sync_point.arrive_and_wait(); // Wait again for test completion
    });
  }
  
  for (auto& t : threads) {
    t.join();
  }
}
```
"""
    }
    
    return templates.get(iteration, templates[1])

def get_generic_template(iteration: int, code: str, task_description: str) -> str:
    """
    Get a generic test template for languages without specific templates
    """
    templates = {
        1: """
For this first iteration, create basic tests that verify:
1. The function/method exists and is callable
2. It returns the correct result for basic input values
3. Include simple edge cases
4. Verify the behavior aligns with the task description
5. Follow standard testing patterns for your language
""",
        2: """
For the second iteration, extend test coverage to include:
1. Testing with a wider range of inputs
2. Verify correctness of results with known values
3. Add more comprehensive edge cases
4. Test special cases mentioned in the task description
5. Make sure tests follow language-specific best practices
""",
        3: """
For the third iteration, focus on error handling:
1. Test behavior with invalid inputs
2. Check for proper error messages or exceptions
3. Verify error handling for edge cases
4. Test error conditions specific to the task
5. Ensure proper resource management and cleanup
""",
        4: """
For the fourth iteration, focus on performance considerations:
1. Test with larger inputs that might cause performance issues
2. Consider memory usage and efficiency
3. Test for possible optimizations
4. Verify handling of resource-intensive operations
5. Check for potential bottlenecks
""",
        5: """
For the final iteration, conduct a comprehensive review:
1. Summarize test coverage
2. Identify any remaining gaps in testing
3. Suggest code improvements based on test findings
4. Provide a final assessment of code quality
5. Evaluate how well the implementation fulfills the task description
"""
    }
    
    return templates.get(iteration, templates[1])
