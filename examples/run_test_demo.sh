#!/bin/bash
# Run a test example through the test execution system
# This script demonstrates the test execution capabilities

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"

# Create temporary test files if they don't exist
PYTHON_TEST_FILE="$ROOT_DIR/examples/test_fibonacci.py"
PYTHON_IMPL_FILE="$ROOT_DIR/examples/fibonacci.py"

# Create a test implementation file if it doesn't exist
if [ ! -f "$PYTHON_IMPL_FILE" ]; then
    cat > "$PYTHON_IMPL_FILE" << 'EOL'
def fibonacci(n):
    """Return the nth Fibonacci number."""
    if n <= 0:
        raise ValueError("Input must be a positive integer")
    if n == 1 or n == 2:
        return 1
    return fibonacci(n - 1) + fibonacci(n - 2)
EOL
fi

# Create a test file if it doesn't exist
if [ ! -f "$PYTHON_TEST_FILE" ]; then
    cat > "$PYTHON_TEST_FILE" << 'EOL'
import pytest
from fibonacci import fibonacci

def test_fibonacci_base_cases():
    assert fibonacci(1) == 1
    assert fibonacci(2) == 1

def test_fibonacci_positive_values():
    assert fibonacci(3) == 2
    assert fibonacci(4) == 3
    assert fibonacci(5) == 5
    assert fibonacci(6) == 8
    assert fibonacci(10) == 55

def test_fibonacci_invalid_input():
    with pytest.raises(ValueError):
        fibonacci(0)
    with pytest.raises(ValueError):
        fibonacci(-1)
EOL
fi

echo "Running test execution demo..."
echo "============================="
echo ""

# Run the test execution utility
"$ROOT_DIR/examples/run_test_execution.py" \
    --test "$PYTHON_TEST_FILE" \
    --impl "$PYTHON_IMPL_FILE" \
    --language python \
    --task "Implement the Fibonacci sequence" \
    --iteration 1 \
    --output "$ROOT_DIR/examples/test_report.json"

# Show the report
echo ""
echo "Test report contents:"
echo "--------------------"
cat "$ROOT_DIR/examples/test_report.json" | python3 -m json.tool

# Now let's run the C++23 tests
echo ""
echo "Running C++23 test example..."
echo "============================"

# Check if the execute_cpp23_tests.sh script exists
if [ -f "$ROOT_DIR/examples/cpp23/execute_cpp23_tests.sh" ]; then
    cd "$ROOT_DIR/examples/cpp23"
    ./execute_cpp23_tests.sh
else
    echo "C++23 test example not found"
fi

echo ""
echo "Test execution demo complete"
echo "==========================="
