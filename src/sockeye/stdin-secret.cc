#include "sockeye/stdin-secret.h"

#include <cerrno>
#include <cstring>

#include <unistd.h>

#include "sockeye/secret-buffer.h"

namespace sockeye {
namespace {

void Reject(SecretBuffer& output, std::string& error, const char* message) {
  output.Clear();
  error = message;
}

} // namespace

bool ReadSecretFromPipe(int descriptor, SecretBuffer& output,
                        std::string& error) {
  if (!output.IsLocked()) {
    Reject(output, error,
           "Credential import refused: locked memory is unavailable.");
    return false;
  }
  if (descriptor < 0 || isatty(descriptor)) {
    Reject(output, error,
           "Credential import refused: a pipe is required for secret input.");
    return false;
  }

  std::size_t used = 0;
  bool finished = false;
  while (!finished && used < SecretBuffer::kCapacity) {
    unsigned char chunk[1'024] = {};
    const std::size_t available = SecretBuffer::kCapacity - used;
    const std::size_t requested =
        available < sizeof(chunk) ? available : sizeof(chunk);
    const ssize_t count = read(descriptor, chunk, requested);
    if (count < 0) {
      SecureZeroBytes(chunk, sizeof(chunk));
      if (errno == EINTR) {
        continue;
      }
      Reject(output, error,
             "Credential import rejected: secret input could not be read.");
      return false;
    }
    if (count == 0) {
      finished = true;
      SecureZeroBytes(chunk, sizeof(chunk));
      break;
    }
    const std::size_t received = static_cast<std::size_t>(count);
    std::memcpy(output.Data() + used, chunk, received);
    used += received;
    SecureZeroBytes(chunk, sizeof(chunk));
  }

  if (!finished && used == SecretBuffer::kCapacity) {
    unsigned char extra = 0;
    ssize_t count = 0;
    do {
      count = read(descriptor, &extra, 1);
    } while (count < 0 && errno == EINTR);
    finished = count == 0;
    SecureZeroBytes(&extra, sizeof(extra));
  }

  if (!finished || used == 0 ||
      std::memchr(output.Data(), '\0', used) != nullptr ||
      !output.CommitWrittenBytes(used)) {
    Reject(output, error,
           "Credential import rejected: pipe input must contain 1..65535 bytes "
           "without NUL.");
    return false;
  }
  return true;
}

} // namespace sockeye
