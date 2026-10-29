#include "sockeye/terminal.h"

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <string>

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#include "sockeye/input-policy.h"

namespace sockeye {
namespace {

constexpr unsigned char kEndOfInput = 0x04;

int OpenForegroundTerminal(std::string& error) {
  const int descriptor = open("/dev/tty", O_RDWR | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0 || !isatty(descriptor) ||
      tcgetpgrp(descriptor) != getpgrp()) {
    if (descriptor >= 0) {
      close(descriptor);
    }
    error = "Operation refused: an attached foreground terminal is required.";
    return -1;
  }
  return descriptor;
}

bool WriteAll(int descriptor, std::string_view value) {
  std::size_t written = 0;
  while (written < value.size()) {
    const ssize_t count =
        write(descriptor, value.data() + written, value.size() - written);
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    written += static_cast<std::size_t>(count);
  }
  return true;
}

} // namespace

bool HasForegroundTerminal(std::string& error) {
  const int descriptor = OpenForegroundTerminal(error);
  if (descriptor < 0) {
    return false;
  }
  close(descriptor);
  return true;
}

bool ReadSecretFromTerminal(std::string_view identifier, SecretBuffer& output,
                            std::string& error) {
  if (!output.IsLocked()) {
    error = "Credential input refused: locked memory is unavailable.";
    return false;
  }
  const int descriptor = OpenForegroundTerminal(error);
  if (descriptor < 0) {
    return false;
  }

  struct termios original = {};
  if (tcgetattr(descriptor, &original) != 0) {
    close(descriptor);
    error = "Credential input refused: terminal settings could not be read.";
    return false;
  }
  struct termios hidden = original;
  hidden.c_lflag &= static_cast<tcflag_t>(~(ECHO | ECHONL | ICANON));
  hidden.c_cc[VMIN] = 1;
  hidden.c_cc[VTIME] = 0;

  const std::string prompt = "Paste the value for " + std::string(identifier) +
                             ", then press Control-D (input is hidden): ";
  if (!WriteAll(descriptor, prompt) ||
      tcsetattr(descriptor, TCSAFLUSH, &hidden) != 0) {
    close(descriptor);
    error = "Credential input refused: hidden terminal input could not start.";
    return false;
  }

  bool complete = false;
  bool malformed = false;
  std::size_t used = 0;
  while (!complete && used < SecretBuffer::kCapacity) {
    unsigned char chunk[1'024] = {};
    const ssize_t count = read(descriptor, chunk, sizeof(chunk));
    if (count < 0) {
      SecureZeroBytes(chunk, sizeof(chunk));
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (count == 0) {
      complete = true;
      SecureZeroBytes(chunk, sizeof(chunk));
      break;
    }
    const unsigned char* begin = chunk;
    const unsigned char* end = chunk + static_cast<std::size_t>(count);
    const unsigned char* terminator = std::find(begin, end, kEndOfInput);
    const std::size_t copied = static_cast<std::size_t>(terminator - begin);
    if (copied > SecretBuffer::kCapacity - used) {
      SecureZeroBytes(chunk, sizeof(chunk));
      break;
    }
    std::memcpy(output.Data() + used, chunk, copied);
    used += copied;
    complete = terminator != end;
    malformed = complete && terminator + 1 != end;
    SecureZeroBytes(chunk, sizeof(chunk));
  }

  if (!complete && used == SecretBuffer::kCapacity) {
    unsigned char terminator = 0;
    ssize_t count = 0;
    do {
      count = read(descriptor, &terminator, 1);
    } while (count < 0 && errno == EINTR);
    complete = count == 1 && terminator == kEndOfInput;
    SecureZeroBytes(&terminator, sizeof(terminator));
  }

  const bool restored = tcsetattr(descriptor, TCSAFLUSH, &original) == 0;
  const bool line_ended = WriteAll(descriptor, "\n");
  close(descriptor);
  if (!restored || !line_ended ||
      !IsCompleteSecretInput(output.Data(), used, complete, malformed) ||
      !output.CommitWrittenBytes(used)) {
    output.Clear();
    error = "Credential input rejected: use a foreground terminal, enter "
            "1..65535 bytes without NUL, and finish with Control-D.";
    return false;
  }
  return true;
}

} // namespace sockeye
