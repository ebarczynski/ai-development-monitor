cmake_minimum_required(VERSION 3.20)
project(Cpp23Example VERSION 1.0.0 LANGUAGES CXX)

# Set C++23 as the standard
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Find GoogleTest package
find_package(GTest REQUIRED)

# Add example executable
add_executable(cpp23_features cpp23_features.cpp)
target_compile_features(cpp23_features PRIVATE cxx_std_23)

# Add test executable
add_executable(cpp23_tests cpp23_test_example.cpp)
target_link_libraries(cpp23_tests PRIVATE GTest::GTest GTest::Main)
target_compile_features(cpp23_tests PRIVATE cxx_std_23)

# Enable testing
enable_testing()
add_test(NAME Cpp23Tests COMMAND cpp23_tests)

# Compiler-specific flags for C++23 support
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    # GCC flags
    add_compile_options(-Wall -Wextra -pedantic -fconcepts-diagnostics-depth=10)
    message(STATUS "Using GCC compiler with C++23")
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    # Clang flags
    add_compile_options(-Wall -Wextra -pedantic -stdlib=libc++)
    message(STATUS "Using Clang compiler with C++23")
elseif(CMAKE_CXX_COMPILER_ID STREQUAL "MSVC")
    # MSVC flags
    add_compile_options(/W4 /permissive- /Zc:__cplusplus /Zc:preprocessor)
    message(STATUS "Using MSVC compiler with C++23")
endif()

# Print compiler information
message(STATUS "C++ Standard: C++23")
message(STATUS "Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
