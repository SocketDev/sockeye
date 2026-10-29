#include "sockeye/terminal.h"

#include <algorithm>
#include <cassert>
#include <cerrno>
#include <cstring>
#include <string>

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

namespace {
struct Scenario {
  std::string input = std::string("example-fixture-value") + '\x04';
  std::string written;
  std::size_t used = 0;
  int open_error = 0;
  int read_error = 0;
  int write_error_at = 0;
  int attributes_error_at = 0;
  bool tty = true;
  bool foreground = true;
  bool settings_readable = true;
  bool locked = true;
  bool read_interrupted = false;
  bool write_interrupted = false;
  bool partial_write = false;
  bool split_terminator = false;
  bool terminator_interrupted = false;
  int reads = 0;
  int writes = 0;
  int settings = 0;
  int closes = 0;
} scenario;
constexpr tcflag_t kOriginalFlags = ECHO | ECHONL | ICANON;
void CheckInput(bool expected, std::size_t expected_size = 21) {
  sockeye::SecretBuffer output;
  std::string error;
  assert(sockeye::ReadSecretFromTerminal("SOCKET_TEST_TOKEN", output, error) ==
         expected);
  if (expected) {
    assert(error.empty());
    assert(output.Size() == expected_size);
    assert(std::memcmp(output.Data(), scenario.input.data(), expected_size) ==
           0);
  } else {
    assert(!error.empty());
    assert(output.Size() == 0);
    assert(std::all_of(output.Data(),
                       output.Data() + sockeye::SecretBuffer::kCapacity,
                       [](unsigned char value) { return value == 0; }));
  }
  assert(scenario.written.find("example-fixture-value") == std::string::npos);
}
} // namespace

extern "C" int SockeyeTestOpen(const char* file, int flags, ...) {
  assert(std::string(file) == "/dev/tty");
  assert((flags & (O_RDWR | O_CLOEXEC | O_NOFOLLOW)) ==
         (O_RDWR | O_CLOEXEC | O_NOFOLLOW));
  if (scenario.open_error != 0) {
    errno = scenario.open_error;
    return -1;
  }
  return 800;
}
extern "C" int SockeyeTestClose(int descriptor) {
  assert(descriptor == 800);
  ++scenario.closes;
  return 0;
}
extern "C" int SockeyeTestIsatty(int descriptor) {
  assert(descriptor == 800);
  return scenario.tty ? 1 : 0;
}
extern "C" pid_t SockeyeTestForegroundGroup(int descriptor) {
  assert(descriptor == 800);
  return scenario.foreground ? getpgrp() : getpgrp() + 1;
}
extern "C" int SockeyeTestGetAttributes(int descriptor,
                                        struct termios* settings) {
  assert(descriptor == 800);
  if (!scenario.settings_readable) {
    errno = EIO;
    return -1;
  }
  *settings = {};
  settings->c_lflag = kOriginalFlags;
  return 0;
}
extern "C" int SockeyeTestSetAttributes(int descriptor, int action,
                                        const struct termios* settings) {
  assert(descriptor == 800 && action == TCSAFLUSH);
  ++scenario.settings;
  if (scenario.settings == 1) {
    assert((settings->c_lflag & kOriginalFlags) == 0);
    assert(settings->c_cc[VMIN] == 1 && settings->c_cc[VTIME] == 0);
  } else {
    assert(settings->c_lflag == kOriginalFlags);
  }
  if (scenario.attributes_error_at == scenario.settings) {
    errno = EIO;
    return -1;
  }
  return 0;
}
extern "C" ssize_t SockeyeTestWrite(int descriptor, const void* bytes,
                                    size_t length) {
  assert(descriptor == 800);
  ++scenario.writes;
  if (scenario.write_interrupted && scenario.writes == 1) {
    errno = EINTR;
    return -1;
  }
  if (scenario.write_error_at == scenario.writes) {
    errno = EIO;
    return -1;
  }
  const std::size_t count =
      scenario.partial_write ? std::min(length, std::size_t{7}) : length;
  scenario.written.append(static_cast<const char*>(bytes), count);
  return static_cast<ssize_t>(count);
}
extern "C" ssize_t SockeyeTestRead(int descriptor, void* bytes, size_t length) {
  assert(descriptor == 800);
  ++scenario.reads;
  if (scenario.read_interrupted && scenario.reads == 1) {
    errno = EINTR;
    return -1;
  }
  if (scenario.read_error != 0) {
    errno = scenario.read_error;
    return -1;
  }
  if (scenario.terminator_interrupted && length == 1) {
    scenario.terminator_interrupted = false;
    errno = EINTR;
    return -1;
  }
  std::size_t count = std::min(length, scenario.input.size() - scenario.used);
  if (scenario.split_terminator &&
      scenario.used < sockeye::SecretBuffer::kCapacity) {
    count = std::min(count, sockeye::SecretBuffer::kCapacity - scenario.used);
  }
  std::memcpy(bytes, scenario.input.data() + scenario.used, count);
  scenario.used += count;
  return static_cast<ssize_t>(count);
}
extern "C" int SockeyeTestLock(const void*, size_t) {
  return scenario.locked ? 0 : -1;
}
extern "C" int SockeyeTestUnlock(const void*, size_t) { return 0; }

int main() {
  std::string error;
  assert(sockeye::HasForegroundTerminal(error));
  assert(scenario.closes == 1);
  scenario = {};
  scenario.open_error = ENXIO;
  assert(!sockeye::HasForegroundTerminal(error));
  assert(scenario.closes == 0);
  scenario = {};
  scenario.tty = false;
  assert(!sockeye::HasForegroundTerminal(error));
  assert(scenario.closes == 1);
  scenario = {};
  scenario.foreground = false;
  assert(!sockeye::HasForegroundTerminal(error));
  assert(scenario.closes == 1);
  scenario = {};
  CheckInput(true);
  assert(scenario.settings == 2 && scenario.closes == 1);
  scenario = {};
  scenario.locked = false;
  CheckInput(false);
  assert(scenario.closes == 0);
  scenario = {};
  scenario.open_error = ENXIO;
  CheckInput(false);
  scenario = {};
  scenario.settings_readable = false;
  CheckInput(false);
  assert(scenario.closes == 1);
  scenario = {};
  scenario.write_error_at = 1;
  CheckInput(false);
  assert(scenario.settings == 0 && scenario.closes == 1);
  scenario = {};
  scenario.attributes_error_at = 1;
  CheckInput(false);
  assert(scenario.closes == 1);
  scenario = {};
  scenario.read_error = EIO;
  CheckInput(false);
  assert(scenario.settings == 2 && scenario.closes == 1);
  scenario = {};
  scenario.attributes_error_at = 2;
  CheckInput(false);
  scenario = {};
  scenario.write_error_at = 2;
  CheckInput(false);
  scenario = {};
  scenario.read_interrupted = true;
  CheckInput(true);
  scenario = {};
  scenario.write_interrupted = true;
  CheckInput(true);
  scenario = {};
  scenario.partial_write = true;
  CheckInput(true);
  scenario = {};
  scenario.input.clear();
  CheckInput(false);
  scenario = {};
  scenario.input = "example-fixture-value";
  CheckInput(true);
  scenario = {};
  scenario.input = std::string("example\0value", 13) + '\x04';
  CheckInput(false);
  scenario = {};
  scenario.input += "unexpected";
  CheckInput(false);
  scenario = {};
  scenario.input.assign(sockeye::SecretBuffer::kCapacity + 1, 'x');
  CheckInput(false);
  scenario = {};
  scenario.input.assign(sockeye::SecretBuffer::kCapacity, 'x');
  scenario.input += '\x04';
  scenario.split_terminator = true;
  scenario.terminator_interrupted = true;
  CheckInput(true, sockeye::SecretBuffer::kCapacity);
  scenario = {};
  scenario.input.assign(sockeye::SecretBuffer::kCapacity, 'x');
  scenario.split_terminator = true;
  CheckInput(false);
  return 0;
}
