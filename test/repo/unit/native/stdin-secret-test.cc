#include "sockeye/stdin-secret.h"

#include <algorithm>
#include <cassert>
#include <cerrno>
#include <cstring>
#include <string>
#include <utility>

namespace {
bool terminal = false;
bool memory_locked = true;
std::string input;
std::size_t input_offset = 0;
bool interrupt_read = false;
bool fail_read = false;

bool ReadFixture(std::string value, sockeye::SecretBuffer& output,
                 std::string& error) {
  input = std::move(value);
  input_offset = 0;
  return sockeye::ReadSecretFromPipe(800, output, error);
}

void CheckRejected(const std::string& secret) {
  sockeye::SecretBuffer output;
  std::string error;
  assert(!ReadFixture(secret, output, error));
  assert(!error.empty());
  assert(output.Size() == 0);
  assert(std::all_of(output.Data(),
                     output.Data() + sockeye::SecretBuffer::kCapacity,
                     [](unsigned char value) { return value == 0; }));
}
} // namespace

extern "C" int SockeyeStdinIsatty(int descriptor) {
  assert(descriptor == 800);
  return terminal ? 1 : 0;
}
extern "C" ssize_t SockeyeStdinRead(int descriptor, void* bytes,
                                    size_t length) {
  assert(descriptor == 800);
  if (interrupt_read) {
    interrupt_read = false;
    errno = EINTR;
    return -1;
  }
  if (fail_read) {
    errno = EIO;
    return -1;
  }
  const std::size_t count = std::min(length, input.size() - input_offset);
  if (count == 0) {
    return 0;
  }
  std::memcpy(bytes, input.data() + input_offset, count);
  input_offset += count;
  return static_cast<ssize_t>(count);
}
extern "C" int SockeyeStdinLock(const void*, size_t) {
  return memory_locked ? 0 : -1;
}
extern "C" int SockeyeStdinUnlock(const void*, size_t) { return 0; }

int main() {
  const std::string secret = "example-fixture-token";
  sockeye::SecretBuffer output;
  std::string error;
  interrupt_read = true;
  assert(ReadFixture(secret, output, error));
  assert(error.empty());
  assert(output.Size() == secret.size());
  assert(std::memcmp(output.Data(), secret.data(), secret.size()) == 0);
  output.Clear();

  CheckRejected("");
  CheckRejected(std::string("safe\0unsafe", 11));
  CheckRejected(std::string(sockeye::SecretBuffer::kCapacity + 1, 'x'));

  assert(ReadFixture(std::string(sockeye::SecretBuffer::kCapacity, 'x'), output,
                     error));
  assert(output.Size() == sockeye::SecretBuffer::kCapacity);
  output.Clear();
  terminal = true;
  assert(!ReadFixture(secret, output, error));
  assert(error.find("pipe is required") != std::string::npos);
  terminal = false;

  memory_locked = false;
  sockeye::SecretBuffer unlocked_output;
  assert(!ReadFixture(secret, unlocked_output, error));
  assert(error.find("locked memory") != std::string::npos);

  memory_locked = true;
  fail_read = true;
  assert(!ReadFixture(secret, output, error));
  assert(error.find("could not be read") != std::string::npos);
}
