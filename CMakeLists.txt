cmake_minimum_required(VERSION 3.25)

if(NOT APPLE)
  message(FATAL_ERROR "Sockeye currently requires macOS because its release contract requires Touch ID")
endif()

project(sockeye VERSION 0.0.0 LANGUAGES CXX OBJCXX)

set(SOCKEYE_VERSION "${PROJECT_VERSION}" CACHE STRING "Sockeye release version")
set(SOCKEYE_SANITIZER "none" CACHE STRING "Native sanitizer: none, address, or undefined")
set_property(CACHE SOCKEYE_SANITIZER PROPERTY STRINGS none address undefined)

set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)

add_executable(sockeye
  src/sockeye/child-process.cc
  src/sockeye/input-policy.cc
  src/sockeye/keychain-macos.mm
  src/sockeye/main.cc
  src/sockeye/one-password.cc
  src/sockeye/secret-buffer.cc
  src/sockeye/terminal.cc
)

add_executable(sockeye-input-policy-test
  src/sockeye/input-policy.cc
  test/repo/unit/native/input-policy-test.cc
)

target_include_directories(sockeye-input-policy-test PRIVATE src)

add_executable(sockeye-child-process-test
  src/sockeye/child-process.cc
  src/sockeye/secret-buffer.cc
  test/repo/unit/native/child-process-test.cc
)
target_include_directories(sockeye-child-process-test PRIVATE src)
target_compile_definitions(sockeye-child-process-test PRIVATE SOCKEYE_TESTING=1)

if(SOCKEYE_SANITIZER STREQUAL "address")
  target_compile_options(sockeye PRIVATE -fsanitize=address -fno-omit-frame-pointer)
  target_link_options(sockeye PRIVATE -fsanitize=address)
  target_compile_options(sockeye-input-policy-test PRIVATE -fsanitize=address -fno-omit-frame-pointer)
  target_link_options(sockeye-input-policy-test PRIVATE -fsanitize=address)
elseif(SOCKEYE_SANITIZER STREQUAL "undefined")
  target_compile_options(sockeye PRIVATE -fsanitize=undefined -fno-omit-frame-pointer)
  target_link_options(sockeye PRIVATE -fsanitize=undefined)
  target_compile_options(sockeye-input-policy-test PRIVATE -fsanitize=undefined -fno-omit-frame-pointer)
  target_link_options(sockeye-input-policy-test PRIVATE -fsanitize=undefined)
elseif(NOT SOCKEYE_SANITIZER STREQUAL "none")
  message(FATAL_ERROR "SOCKEYE_SANITIZER must be none, address, or undefined")
endif()

target_compile_options(sockeye-input-policy-test PRIVATE
  -Wall
  -Wconversion
  -Werror
  -Wextra
  -Wpedantic
  -Wshadow
  -fstack-protector-strong
)
target_compile_options(sockeye-child-process-test PRIVATE
  -Wall
  -Wconversion
  -Werror
  -Wextra
  -Wpedantic
  -Wshadow
  -fstack-protector-strong
)

add_executable(sockeye-input-policy-fuzz EXCLUDE_FROM_ALL
  src/sockeye/input-policy.cc
  test/repo/fuzz/native/input-policy-fuzz.cc
)
target_include_directories(sockeye-input-policy-fuzz PRIVATE src)
target_compile_options(sockeye-input-policy-fuzz PRIVATE
  -Wall
  -Wconversion
  -Werror
  -Wextra
  -Wpedantic
  -Wshadow
  -fsanitize=fuzzer,address,undefined
  -fno-omit-frame-pointer
)
target_link_options(sockeye-input-policy-fuzz PRIVATE
  -fsanitize=fuzzer,address,undefined
)

target_include_directories(sockeye PRIVATE src)
target_compile_definitions(sockeye PRIVATE SOCKEYE_VERSION="${SOCKEYE_VERSION}")
target_compile_options(sockeye PRIVATE
  -Wall
  -Wconversion
  -Werror
  -Wextra
  -Wpedantic
  -Wshadow
  -fstack-protector-strong
)
target_compile_options(sockeye PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
target_link_options(sockeye PRIVATE -Wl,-dead_strip)

find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
find_library(LOCAL_AUTHENTICATION_FRAMEWORK LocalAuthentication REQUIRED)
find_library(SECURITY_FRAMEWORK Security REQUIRED)
target_link_libraries(sockeye PRIVATE
  ${FOUNDATION_FRAMEWORK}
  ${LOCAL_AUTHENTICATION_FRAMEWORK}
  ${SECURITY_FRAMEWORK}
)
target_link_libraries(sockeye-child-process-test PRIVATE ${FOUNDATION_FRAMEWORK})

add_custom_command(TARGET sockeye POST_BUILD
  COMMAND /usr/bin/codesign --force --identifier dev.socket.sockeye --sign - $<TARGET_FILE:sockeye>
  COMMENT "Applying an ad-hoc signature for local Keychain testing"
)
