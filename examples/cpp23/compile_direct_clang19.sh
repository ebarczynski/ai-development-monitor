#!/bin/zsh
set -e  # Exit on error

echo "Directly compiling C++23 features with clang-19"

# Create output directory
cd /home/luxoft/snake_cpp/agent/examples/cpp23
mkdir -p direct_build
cd direct_build

# Compile the standalone example
echo "Compiling cpp23_features_standalone.cpp..."
clang++-19 -v -std=c++2b -stdlib=libc++ -O2 -Wall -Wextra -pedantic \
  -o cpp23_features \
  ../cpp23_features_standalone.cpp

echo "Build complete!"
ls -la cpp23_features

# Run the example
echo "Running the example:"
./cpp23_features
