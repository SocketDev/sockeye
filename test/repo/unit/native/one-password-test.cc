#include "one-password.h"

#include <algorithm>
#include <cassert>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

namespace {
struct Scenario {
  std::string bytes = "example-fixture-value";
  std::size_t used = 0;
  int available_path = 0;
  int pipe_error = 0;
  int spawn_error = 0;
  int read_error = 0;
  int wait_error = 0;
  int child_status = 0;
  bool read_interrupted = false;
  bool wait_interrupted = false;
  int reads = 0;
  int waits = 0;
  int closes = 0;
  bool spawned = false;
} scenario;

void CheckResult(bool expected,
                 const std::string& reference =
                     "op://example-vault/example-item/example-field") {
  sockeye::SecretBuffer output;
  std::string error;
  const bool result =
      sockeye::ReadOnePasswordReference(reference, output, error);
  if (result != expected) {
    std::fprintf(
        stderr,
        "provider scenario wait_error=%d read_error=%d expected=%d actual=%d\n",
        scenario.wait_error, scenario.read_error, expected, result);
  }
  assert(result == expected);
  if (expected) {
    assert(error.empty());
    assert(output.Size() == scenario.bytes.size());
    assert(std::memcmp(output.Data(), scenario.bytes.data(), output.Size()) ==
           0);
  } else {
    assert(!error.empty());
    assert(output.Size() == 0);
  }
}
} // namespace

extern "C" int SockeyeTestAccess(const char* candidate, int mode) {
  assert(mode == X_OK);
  const std::string expected = scenario.available_path == 0
                                   ? "/opt/homebrew/bin/op"
                                   : "/usr/local/bin/op";
  if (scenario.available_path >= 0 && candidate == expected)
    return 0;
  errno = ENOENT;
  return -1;
}
extern "C" int SockeyeTestPipe(int* descriptors) {
  if (scenario.pipe_error != 0) {
    errno = scenario.pipe_error;
    return -1;
  }
  descriptors[0] = 700;
  descriptors[1] = 701;
  return 0;
}
extern "C" int SockeyeTestClose(int descriptor) {
  assert(descriptor == 700 || descriptor == 701);
  ++scenario.closes;
  return 0;
}
extern "C" int SockeyeTestSpawn(pid_t* child, const char* file,
                                const posix_spawn_file_actions_t*,
                                const posix_spawnattr_t*,
                                char* const arguments[], char* const[]) {
  assert(std::string(file) == arguments[0]);
  assert(std::string(arguments[1]) == "read");
  assert(std::string(arguments[2]) == "--no-newline");
  assert(std::string(arguments[3]) ==
         "op://example-vault/example-item/example-field");
  assert(arguments[4] == nullptr);
  scenario.spawned = true;
  *child = 707;
  return scenario.spawn_error;
}
extern "C" ssize_t SockeyeTestRead(int descriptor, void* destination,
                                   size_t capacity) {
  assert(descriptor == 700);
  ++scenario.reads;
  if (scenario.read_interrupted && scenario.reads == 1) {
    errno = EINTR;
    return -1;
  }
  if (scenario.read_error != 0) {
    errno = scenario.read_error;
    return -1;
  }
  const std::size_t count =
      std::min(capacity, scenario.bytes.size() - scenario.used);
  std::memcpy(destination, scenario.bytes.data() + scenario.used, count);
  scenario.used += count;
  return static_cast<ssize_t>(count);
}
extern "C" pid_t SockeyeTestWait(pid_t child, int* status, int options) {
  assert(child == 707 && options == 0);
  ++scenario.waits;
  if (scenario.wait_interrupted && scenario.waits == 1) {
    errno = EINTR;
    return -1;
  }
  if (scenario.wait_error != 0) {
    errno = scenario.wait_error;
    return -1;
  }
  *status = scenario.child_status;
  return child;
}

int main() {
  CheckResult(true);
  assert(scenario.spawned && scenario.closes == 2);
  scenario = {};
  scenario.available_path = 1;
  CheckResult(true);
  scenario = {};
  scenario.available_path = -1;
  CheckResult(false);
  assert(!scenario.spawned);
  scenario = {};
  CheckResult(false, "invalid-reference");
  assert(!scenario.spawned);
  scenario = {};
  scenario.pipe_error = EMFILE;
  CheckResult(false);
  assert(!scenario.spawned);
  scenario = {};
  scenario.spawn_error = ENOENT;
  CheckResult(false);
  assert(scenario.closes == 2);
  scenario = {};
  scenario.bytes.clear();
  CheckResult(false);
  scenario = {};
  scenario.bytes = std::string("example\0value", 13);
  CheckResult(false);
  scenario = {};
  scenario.read_error = EIO;
  CheckResult(false);
  assert(scenario.waits == 1);
  scenario = {};
  scenario.read_interrupted = true;
  CheckResult(true);
  assert(scenario.reads == 3);
  scenario = {};
  scenario.bytes.assign(sockeye::SecretBuffer::kCapacity, 'x');
  CheckResult(true);
  scenario = {};
  scenario.bytes.assign(sockeye::SecretBuffer::kCapacity + 1, 'x');
  CheckResult(false);
  scenario = {};
  scenario.child_status = 3 << 8;
  CheckResult(false);
  scenario = {};
  scenario.child_status = SIGTERM;
  CheckResult(false);
  scenario = {};
  scenario.wait_interrupted = true;
  CheckResult(true);
  assert(scenario.waits == 2);
  scenario = {};
  scenario.wait_error = EIO;
  CheckResult(false);
  return 0;
}
