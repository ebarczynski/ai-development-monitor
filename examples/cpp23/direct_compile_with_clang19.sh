#!/bin/zsh
set -e  # Exit on error

echo "Directly compiling C++23 examples with clang-19"

# Create output directory
mkdir -p bin
cd bin

# Compile cpp23_features
echo "Compiling cpp23_features.cpp..."
clang++-19 -std=c++2b -stdlib=libc++ -O2 -Wall -Wextra -pedantic \
  -I/usr/local/include \
  -o cpp23_features \
  ../cpp23_features_standalone.cpp

# Compile cpp23_test_example if GTest is available
echo "Compiling cpp23_test_example.cpp..."
if [ -d "/usr/local/include/gtest" ] || [ -d "/usr/include/gtest" ]; then
  clang++-19 -std=c++2b -stdlib=libc++ -O2 -Wall -Wextra -pedantic \
    -I/usr/local/include -I/usr/include \
    -o cpp23_tests \
    ../cpp23_test_example.cpp \
    -lgtest -lgmock -lpthread
  
  echo "Test executable built successfully"
else
  echo "GTest headers not found, skipping test compilation"
fi

echo "Build complete. The following executables were created:"
ls -l

# Run the examples
echo "Running cpp23_features:"
./cpp23_features

# Run tests if built
if [ -f "./cpp23_tests" ]; then
  echo "Running tests:"
  ./cpp23_tests
fi

cd ..
