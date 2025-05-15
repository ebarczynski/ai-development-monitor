#include <expected>  // C++23
#include <format>    // C++23
#include <iostream>  // For std::cout before C++23's print is widely available
#include <string>
#include <string_view>
#include <vector>

// Error type for std::expected
enum class ErrorCode {
    None,
    InvalidArgument,
    NotFound,
    ServerError
};

// Example function that returns std::expected
std::expected<int, ErrorCode> divide(int a, int b) {
    if (b == 0) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    return a / b;
}

// Example function using std::format instead of std::print (more compatible)
void log_message(std::string_view message) {
    std::cout << std::format("LOG: {}\n", message);
}

// Example function using std::format
std::string create_greeting(std::string_view name, int age) {
    return std::format("Hello, {}! You are {} years old.", name, age);
}

// Example of C++23 auto(x) lambda shorthand
auto multiply = [](auto a, auto b) {
    return a * b;
};

// Class that uses C++23 features
class DataProcessor {
public:
    // Using std::expected for error handling
    std::expected<std::string, ErrorCode> process_data(std::string_view data) {
        if (data.empty()) {
            return std::unexpected(ErrorCode::InvalidArgument);
        }
        
        return std::format("Processed: {}", data);
    }
    
    // Using C++23 deducing this
    auto get_processor_info() const {
        return std::format("DataProcessor version {}", 1.0);
    }
};

int main() {
    // Testing std::expected
    auto result1 = divide(10, 2);
    if (result1) {
        std::cout << std::format("10 / 2 = {}\n", *result1);
    }
    
    auto result2 = divide(10, 0);
    if (!result2) {
        std::cout << "Division by zero detected!\n";
        if (result2.error() == ErrorCode::InvalidArgument) {
            std::cout << "Error: Invalid argument\n";
        }
    }
    
    // Testing std::format
    std::cout << create_greeting("Alice", 30) << "\n";
    
    // Testing log_message with std::format
    log_message("Testing C++23 features");
    
    // Testing auto(x) lambda
    std::cout << std::format("5 * 7 = {}\n", multiply(5, 7));
    
    // Testing DataProcessor class
    DataProcessor processor;
    auto process_result = processor.process_data("test data");
    if (process_result) {
        std::cout << *process_result << "\n";
    }
    
    std::cout << processor.get_processor_info() << "\n";
    
    std::cout << "All C++23 features demonstrated successfully!\n";
    return 0;
}
