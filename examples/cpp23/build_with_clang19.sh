#!/bin/zsh
set -e  # Exit on error

echo "Building C++23 examples with clang-19"

# Create build directory
mkdir -p build_clang19
cd build_clang19

# Set environment variables for clang-19
export CC=clang-19
export CXX=clang++-19

# Configure with CMake
cmake .. \
  -DCMAKE_CXX_COMPILER=clang++-19 \
  -DCMAKE_C_COMPILER=clang-19 \
  -DCMAKE_CXX_FLAGS="-stdlib=libc++ -std=c++2b -Wall -Wextra -pedantic" \
  -DCMAKE_EXE_LINKER_FLAGS="-stdlib=libc++" \
  -DCMAKE_BUILD_TYPE=Debug

# Build the project
cmake --build . -j$(nproc)

echo "Build complete. The following executables were created:"
ls -l cpp23_features cpp23_tests

# Run the examples if desired
echo "Running cpp23_features:"
./cpp23_features

echo "Running tests (if GoogleTest is available):"
if [ -f "./cpp23_tests" ]; then
  ./cpp23_tests
else
  echo "Test executable not built - GoogleTest may not be installed"
fi

cd ..
