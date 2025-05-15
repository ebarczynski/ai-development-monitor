# Toolchain file for clang-19
set(CMAKE_C_COMPILER clang-19)
set(CMAKE_CXX_COMPILER clang++-19)
set(CMAKE_CXX_FLAGS "-std=c++2b -stdlib=libc++ ${CMAKE_CXX_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "-stdlib=libc++ ${CMAKE_EXE_LINKER_FLAGS}")
set(CMAKE_SHARED_LINKER_FLAGS "-stdlib=libc++ ${CMAKE_SHARED_LINKER_FLAGS}")

# Set the target system
set(CMAKE_SYSTEM_NAME Linux)

# Ensure we use libc++ instead of libstdc++
set(CMAKE_CXX_FLAGS "-stdlib=libc++ ${CMAKE_CXX_FLAGS}")

# Use ccache if available for faster rebuilds
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
endif()
