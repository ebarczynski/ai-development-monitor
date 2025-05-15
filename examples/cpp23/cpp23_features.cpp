#include <expected>  // C++23
#include <format>    // C++23
#include <print>     // C++23
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

// Example function using std::print
void log_message(std::string_view message) {
    std::print("LOG: {}\n", message);
}

// Example function using std::format
std::string create_greeting(std::string_view name, int age) {
    return std::format("Hello, {}! You are {} years old.", name, age);
}

// Example of C++23 auto(x) lambda shorthand
auto multiply_by = [](int factor) {
    return auto(x) { return x * factor; };
};

// Function using if consteval for compile-time behavior
constexpr int calculate_value(int input) {
    if consteval {
        // This code runs at compile-time
        return input * 2;
    } else {
        // This code runs at runtime
        return input * 3;
    }
}

// Example of a class with spaceship operator (<=>) for comparisons
class Person {
public:
    Person(std::string_view name, int age) : name_(name), age_(age) {}

    // Spaceship operator provides all six comparison operators
    auto operator<=>(const Person& other) const = default;

private:
    std::string name_;
    int age_;
};

int main() {
    // Using std::expected
    auto result = divide(10, 2);
    if (result) {
        std::print("Division result: {}\n", *result);
    }
    
    auto error_result = divide(10, 0);
    if (!error_result) {
        std::print("Error occurred: {}\n", 
            static_cast<int>(error_result.error()));
    }
    
    // Using std::format and std::print
    std::string greeting = create_greeting("Alice", 30);
    std::print("{}\n", greeting);
    
    // Using auto(x) lambda shorthand
    auto double_it = multiply_by(2);
    std::print("5 doubled: {}\n", double_it(5));
    
    // Using consteval function
    constexpr int compile_time_value = calculate_value(5);
    int runtime_value = calculate_value(5);
    std::print("Compile-time value: {}\n", compile_time_value);
    std::print("Runtime value: {}\n", runtime_value);
    
    // Using spaceship operator
    Person p1{"Alice", 30};
    Person p2{"Bob", 25};
    
    if (p1 > p2) {
        std::print("Alice is greater than Bob\n");
    } else {
        std::print("Alice is not greater than Bob\n");
    }
    
    return 0;
}
