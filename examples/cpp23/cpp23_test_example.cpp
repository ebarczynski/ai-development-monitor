#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include <expected>
#include <format>
#include <print>
#include <string>
#include <string_view>
#include <vector>
#include <barrier>
#include <thread>
#include <atomic>

// Include our library code
// #include "calculator.h" - Commented out as this is just an example

// Mock class using C++23 features
class MockDatabase {
public:
    MOCK_METHOD(std::expected<std::string, int>, getData, (std::string_view key), ());
    MOCK_METHOD(std::expected<void, int>, setData, (std::string_view key, std::string_view value), ());
};

// Class under test
class Calculator {
public:
    std::expected<int, std::string> divide(int a, int b) {
        if (b == 0) {
            return std::unexpected("Division by zero");
        }
        return a / b;
    }
    
    std::string formatResult(int result) {
        return std::format("Result: {}", result);
    }
};

// Basic test case using C++23 features
TEST(CalculatorTest, DivideReturnsExpectedResult) {
    Calculator calculator;
    
    // Test success case with std::expected
    auto result = calculator.divide(10, 2);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(*result, 5);
    
    // Test error case with std::expected
    auto error_result = calculator.divide(10, 0);
    ASSERT_FALSE(error_result.has_value());
    EXPECT_EQ(error_result.error(), "Division by zero");
    
    // Test formatting with std::format
    EXPECT_EQ(calculator.formatResult(42), "Result: 42");
}

// Test fixture example
class CalculatorFixture : public ::testing::Test {
protected:
    void SetUp() override {
        // Setup code runs before each test
        calculator = std::make_unique<Calculator>();
    }
    
    void TearDown() override {
        // Cleanup code runs after each test
        calculator.reset();
    }
    
    std::unique_ptr<Calculator> calculator;
};

// Using the test fixture
TEST_F(CalculatorFixture, FormatResultWorksCorrectly) {
    EXPECT_EQ(calculator->formatResult(42), "Result: 42");
}

// Parameterized testing with C++23 features
class DivisionTest : public ::testing::TestWithParam<std::tuple<int, int, int>> {};

TEST_P(DivisionTest, DivisionWorks) {
    Calculator calculator;
    auto [a, b, expected] = GetParam();
    
    auto result = calculator.divide(a, b);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(*result, expected);
}

INSTANTIATE_TEST_SUITE_P(
    DivisionCases,
    DivisionTest,
    ::testing::Values(
        std::make_tuple(10, 2, 5),
        std::make_tuple(20, 4, 5),
        std::make_tuple(15, 3, 5)
    )
);

// Mock testing with C++23 features
TEST(DatabaseTest, MockingWithExpected) {
    MockDatabase mock;
    
    EXPECT_CALL(mock, getData("key1"))
        .WillOnce(::testing::Return(std::expected<std::string, int>("value1")));
        
    EXPECT_CALL(mock, getData("missing"))
        .WillOnce(::testing::Return(std::unexpected<int>(404)));
        
    auto result1 = mock.getData("key1");
    ASSERT_TRUE(result1.has_value());
    EXPECT_EQ(*result1, "value1");
    
    auto result2 = mock.getData("missing");
    ASSERT_FALSE(result2.has_value());
    EXPECT_EQ(result2.error(), 404);
}

// Multi-threading test with C++23 features
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
            
            sync_point.arrive_and_wait(); // Wait for all threads
            
            // Phase 2
            EXPECT_EQ(counter.load(), thread_count);
            
            sync_point.arrive_and_wait(); // Wait again
        });
    }
    
    for (auto& t : threads) {
        t.join();
    }
}

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
