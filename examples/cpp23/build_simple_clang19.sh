#!/bin/zsh
set -e  # Exit on error

echo "Building C++23 examples with clang-19 (simplified approach)"

# Create build directory
mkdir -p build_clang19_simple
cd build_clang19_simple

# Set environment variables for clang-19
export CC=clang-19
export CXX=clang++-19

# Configure with CMake using the simplified CMakeLists.txt
cmake .. \
  -DCMAKE_CXX_COMPILER=clang++-19 \
  -DCMAKE_C_COMPILER=clang-19 \
  -DCMAKE_CXX_FLAGS="-std=c++2b -stdlib=libc++ -Wall -Wextra -pedantic" \
  -DCMAKE_EXE_LINKER_FLAGS="-stdlib=libc++" \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_VERBOSE_MAKEFILE=ON \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
  -G "Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE=../toolchain_clang19.cmake

# Build the project
cmake --build . -j$(nproc)

echo "Build complete. The following executables were created:"
ls -l

# Run the example
echo "Running cpp23_features:"
./cpp23_features

cd ..
