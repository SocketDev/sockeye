cmake_minimum_required(VERSION 3.25)

if(NOT APPLE)
  message(FATAL_ERROR "Sockeye currently requires macOS because its release contract requires Touch ID")
endif()

project(sockeye VERSION 0.0.0 LANGUAGES CXX OBJCXX)

set(SOCKEYE_VERSION "${PROJECT_VERSION}" CACHE STRING "Sockeye release version")
set(SOCKEYE_SANITIZER "none" CACHE STRING "Native sanitizer: none, address, or undefined")
set_property(CACHE SOCKEYE_SANITIZER PROPERTY STRINGS none address undefined)

set(SOCKEYE_COVERAGE_PROFILE_FILE "${CMAKE_CURRENT_BINARY_DIR}/profiles/%m-%p.profraw" CACHE STRING "Native coverage profile destination")
option(SOCKEYE_COVERAGE "Instrument native targets with Clang source coverage" OFF)
if(SOCKEYE_COVERAGE AND NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  message(FATAL_ERROR "Sockeye coverage requires Clang")
endif()

include(CTest)

set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)

add_executable(sockeye
  src/sockeye/child-process.cc
  src/sockeye/file-identity.cc
  src/sockeye/input-policy.cc
  src/sockeye/keychain-macos.mm
  src/sockeye/main.cc
  src/sockeye/readiness.cc
  src/sockeye/run-request.cc
  src/sockeye/one-password.cc
  src/sockeye/secret-buffer.cc
  src/sockeye/terminal.cc
)

if(BUILD_TESTING)
  add_executable(sockeye-input-policy-test
  src/sockeye/input-policy.cc
  test/repo/unit/native/input-policy-test.cc
  )

  target_include_directories(sockeye-input-policy-test PRIVATE src)

  add_executable(sockeye-child-process-test
  src/sockeye/child-process.cc
  src/sockeye/file-identity.cc
  src/sockeye/secret-buffer.cc
  test/repo/unit/native/child-process-test.cc
  )
  target_include_directories(sockeye-child-process-test PRIVATE src)
  target_compile_definitions(sockeye-child-process-test PRIVATE SOCKEYE_TESTING=1)

  add_executable(sockeye-portable-core-test
    src/sockeye/child-process.cc
    src/sockeye/file-identity.cc
    src/sockeye/secret-buffer.cc
    test/repo/unit/native/portable-core-test.cc
  )
  target_include_directories(sockeye-portable-core-test PRIVATE src)

  add_executable(sockeye-terminal-test
    src/sockeye/terminal.cc
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/unit/native/terminal-test.cc
  )
  target_include_directories(sockeye-terminal-test PRIVATE src)
  target_compile_definitions(sockeye-terminal-test PRIVATE
    open=SockeyeTestOpen close=SockeyeTestClose read=SockeyeTestRead
    write=SockeyeTestWrite isatty=SockeyeTestIsatty tcgetpgrp=SockeyeTestForegroundGroup
    tcgetattr=SockeyeTestGetAttributes tcsetattr=SockeyeTestSetAttributes
    mlock=SockeyeTestLock munlock=SockeyeTestUnlock
  )
  add_executable(sockeye-one-password-test
    src/sockeye/one-password.cc
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/unit/native/one-password-test.cc
  )
  target_include_directories(sockeye-one-password-test PRIVATE src)
  target_compile_definitions(sockeye-one-password-test PRIVATE
    access=SockeyeTestAccess pipe=SockeyeTestPipe close=SockeyeTestClose
    read=SockeyeTestRead posix_spawn=SockeyeTestSpawn waitpid=SockeyeTestWait
  )

  add_executable(sockeye-keychain-framework-test
    src/sockeye/keychain-macos.mm
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/unit/native/keychain-fakes.mm
    test/repo/unit/native/keychain-test.mm
  )
  add_executable(sockeye-keystore-framework-test
    packages/keystore-infra/src/socketsecurity/keystore-infra/keystore_macos.mm
    test/repo/unit/native/keychain-fakes.mm
    test/repo/unit/native/keystore-test.mm
  )
  foreach(target sockeye-keychain-framework-test sockeye-keystore-framework-test)
    target_include_directories(${target} PRIVATE src packages/keystore-infra/src test/repo/unit/native)
    target_compile_options(${target} PRIVATE
      "$<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>"
      "$<$<COMPILE_LANGUAGE:OBJCXX>:SHELL:-include ${CMAKE_CURRENT_SOURCE_DIR}/test/repo/unit/native/keychain-fakes.h>"
    )
  endforeach()

  add_executable(sockeye-readiness-test
    src/sockeye/readiness.cc
    src/sockeye/input-policy.cc
    test/repo/unit/native/readiness-test.cc
  )
  target_include_directories(sockeye-readiness-test PRIVATE src)

  add_executable(sockeye-run-request-test
    src/sockeye/run-request.cc
    src/sockeye/file-identity.cc
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/unit/native/run-request-test.cc
  )
  target_include_directories(sockeye-run-request-test PRIVATE src)
  add_executable(sockeye-preview-isolation-test
    src/sockeye/main.cc
  src/sockeye/readiness.cc
    src/sockeye/run-request.cc
    src/sockeye/file-identity.cc
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/integration/native/forbidden-effects.cc
  )
  target_include_directories(sockeye-preview-isolation-test PRIVATE src)

  add_executable(sockeye-doctor-test
    src/sockeye/main.cc
  src/sockeye/readiness.cc
    src/sockeye/run-request.cc
    src/sockeye/file-identity.cc
    src/sockeye/input-policy.cc
    src/sockeye/secret-buffer.cc
    test/repo/integration/native/doctor-effects.cc
  )
  target_include_directories(sockeye-doctor-test PRIVATE src)

  add_executable(sockeye-keychain-observer
  test/repo/e2e/fixture/keychain/observer.cc
  )
  add_executable(sockeye-keychain-policy-fixture
  test/repo/e2e/fixture/keychain/policy.mm
  )
  target_compile_options(sockeye-keychain-policy-fixture PRIVATE -fobjc-arc)
endif()

set(SOCKEYE_SECURITY_TARGETS
  sockeye
)
if(BUILD_TESTING)
  list(APPEND SOCKEYE_SECURITY_TARGETS
    sockeye-input-policy-test
    sockeye-portable-core-test
    sockeye-terminal-test
    sockeye-keychain-framework-test
    sockeye-keystore-framework-test
    sockeye-one-password-test
    sockeye-run-request-test
    sockeye-readiness-test
    sockeye-preview-isolation-test
    sockeye-doctor-test
    sockeye-child-process-test
    sockeye-keychain-observer
    sockeye-keychain-policy-fixture
  )
endif()
foreach(target IN LISTS SOCKEYE_SECURITY_TARGETS)
  if(SOCKEYE_COVERAGE)
    target_compile_options(${target} PRIVATE "-fprofile-instr-generate=${SOCKEYE_COVERAGE_PROFILE_FILE}" -fcoverage-mapping)
    target_link_options(${target} PRIVATE "-fprofile-instr-generate=${SOCKEYE_COVERAGE_PROFILE_FILE}")
  endif()
  target_compile_options(${target} PRIVATE -Wall -Wextra -Werror -Wconversion -Wpedantic -Wshadow)
  if(NOT target STREQUAL "sockeye")
    target_compile_options(${target} PRIVATE -UNDEBUG)
  endif()
  if(SOCKEYE_SANITIZER STREQUAL "address" OR SOCKEYE_SANITIZER STREQUAL "undefined")
    target_compile_options(${target} PRIVATE -fsanitize=${SOCKEYE_SANITIZER} -fno-omit-frame-pointer)
    target_link_options(${target} PRIVATE -fsanitize=${SOCKEYE_SANITIZER})
  elseif(NOT SOCKEYE_SANITIZER STREQUAL "none")
    message(FATAL_ERROR "SOCKEYE_SANITIZER must be none, address, or undefined")
  endif()
endforeach()

if(BUILD_TESTING)
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

endif()

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
if(NOT SOCKEYE_COVERAGE)
  target_link_options(sockeye PRIVATE -Wl,-dead_strip)
endif()

find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
find_library(LOCAL_AUTHENTICATION_FRAMEWORK LocalAuthentication REQUIRED)
find_library(SECURITY_FRAMEWORK Security REQUIRED)
target_link_libraries(sockeye PRIVATE
  ${FOUNDATION_FRAMEWORK}
  ${LOCAL_AUTHENTICATION_FRAMEWORK}
  ${SECURITY_FRAMEWORK}
)
if(BUILD_TESTING)
  foreach(target sockeye-keychain-framework-test sockeye-keystore-framework-test)
    target_link_libraries(${target} PRIVATE ${FOUNDATION_FRAMEWORK} ${LOCAL_AUTHENTICATION_FRAMEWORK} ${SECURITY_FRAMEWORK})
  endforeach()
  target_link_libraries(sockeye-child-process-test PRIVATE ${FOUNDATION_FRAMEWORK})
  target_link_libraries(sockeye-keychain-policy-fixture PRIVATE
    ${FOUNDATION_FRAMEWORK} ${LOCAL_AUTHENTICATION_FRAMEWORK} ${SECURITY_FRAMEWORK}
  )
endif()

add_custom_command(TARGET sockeye POST_BUILD
  COMMAND /usr/bin/codesign --force --identifier dev.socket.sockeye --sign - $<TARGET_FILE:sockeye>
  COMMENT "Applying an ad-hoc signature for local Keychain testing"
)
