#!/bin/bash
# Tests execution and verification for C++23 features
# This script executes C++23 features test cases and verifies the output

# Set up environment variables
CLANG_PATH=${CLANG_PATH:-/usr/bin/clang++}
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SOURCE_FILE="$SCRIPT_DIR/cpp23_features_test.cpp"
BINARY_FILE="$SCRIPT_DIR/cpp23_test_runner"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}C++23 Test Execution & Verification${NC}"
echo -e "${YELLOW}================================${NC}"

# Create test file with both implementation and tests
cat > "$SOURCE_FILE" << 'EOL'
#include <iostream>
#include <gtest/gtest.h>
#include <string>
#include <vector>
#include <expected>
#include <format>
#include <ranges>
#include <memory>
#include <thread>
#include <mutex>
#include <source_location>

// C++23 features implementation

// std::expected example
template <typename T>
std::expected<T, std::string> divide(T a, T b) {
    if (b == 0) {
        return std::unexpected("Division by zero");
    }
    return a / b;
}

// std::format example
std::string format_person(const std::string& name, int age) {
    return std::format("Person: {} (age {})", name, age);
}

// Deducing this (C++23) feature
class Counter {
public:
    Counter(int start = 0) : count(start) {}
    
    // Deducing this pattern
    auto& increment(this auto& self) {
        self.count++;
        return self;
    }
    
    auto& decrement(this auto& self) {
        self.count--;
        return self;
    }
    
    auto get_count(this auto const& self) {
        return self.count;
    }
    
private:
    int count;
};

// If consteval feature
consteval int compile_time_computation(int n) {
    return n * 2;
}

constexpr int maybe_constexpr(int n) {
    if consteval {
        return compile_time_computation(n);
    } else {
        return n * 3; // Different behavior at runtime
    }
}

// C++23 multithreading enhancement example
class ThreadSafeCounter {
public:
    void increment() {
        std::unique_lock lock(mutex);
        count++;
    }
    
    int get() const {
        std::unique_lock lock(mutex);
        return count;
    }
    
private:
    int count = 0;
    mutable std::mutex mutex;
};

// Test cases for C++23 features
TEST(Cpp23FeaturesTest, ExpectedWorks) {
    auto result1 = divide(10, 2);
    ASSERT_TRUE(result1.has_value());
    EXPECT_EQ(*result1, 5);
    
    auto result2 = divide(5, 0);
    ASSERT_FALSE(result2.has_value());
    EXPECT_EQ(result2.error(), "Division by zero");
}

TEST(Cpp23FeaturesTest, FormatWorks) {
    std::string formatted = format_person("Alice", 30);
    EXPECT_EQ(formatted, "Person: Alice (age 30)");
}

TEST(Cpp23FeaturesTest, DeducingThisWorks) {
    Counter c(5);
    EXPECT_EQ(c.get_count(), 5);
    
    c.increment().increment();
    EXPECT_EQ(c.get_count(), 7);
    
    c.decrement();
    EXPECT_EQ(c.get_count(), 6);
}

TEST(Cpp23FeaturesTest, IfConstevalWorks) {
    constexpr int compile_result = maybe_constexpr(10);
    EXPECT_EQ(compile_result, 20); // Compile-time path
    
    int runtime_arg = 10;
    int runtime_result = maybe_constexpr(runtime_arg);
    EXPECT_EQ(runtime_result, 30); // Runtime path
}

TEST(Cpp23FeaturesTest, ThreadingWorks) {
    ThreadSafeCounter counter;
    std::vector<std::thread> threads;
    
    for (int i = 0; i < 10; ++i) {
        threads.emplace_back([&counter]() {
            for (int j = 0; j < 100; ++j) {
                counter.increment();
            }
        });
    }
    
    for (auto& t : threads) {
        t.join();
    }
    
    EXPECT_EQ(counter.get(), 1000);
}

// Run all tests
int main(int argc, char** argv) {
    std::cout << "Running C++23 feature tests...\n";
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
EOL

echo -e "${YELLOW}Building test with Clang 19 (C++23 support)...${NC}"

# Compile with C++23 support
"$CLANG_PATH" -std=c++23 -o "$BINARY_FILE" "$SOURCE_FILE" -lgtest -lgtest_main -pthread

# Check if compilation was successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build successful!${NC}"
    
    # Run the tests
    echo -e "${YELLOW}Running tests...${NC}"
    "$BINARY_FILE"
    
    # Check test execution result
    TEST_RESULT=$?
    if [ $TEST_RESULT -eq 0 ]; then
        echo -e "${GREEN}All tests PASSED!${NC}"
    else
        echo -e "${RED}Some tests FAILED!${NC}"
    fi
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

# Clean up
# Uncomment to clean up after tests
# rm -f "$SOURCE_FILE" "$BINARY_FILE"

echo -e "${YELLOW}================================${NC}"
echo -e "${YELLOW}C++23 Test Execution Complete${NC}"
echo -e "${YELLOW}================================${NC}"

exit $TEST_RESULT
