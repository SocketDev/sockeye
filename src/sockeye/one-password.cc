#include "sockeye/one-password.h"

#include <array>
#include <cerrno>
#include <cstring>
#include <string>

#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include "sockeye/input-policy.h"

extern char** environ;

namespace sockeye {
namespace {

constexpr std::array<const char*, 2> kOnePasswordPaths = {
    "/opt/homebrew/bin/op",
    "/usr/local/bin/op",
};

const char* FindOnePasswordExecutable() {
  for (const char* candidate : kOnePasswordPaths) {
    if (access(candidate, X_OK) == 0) {
      return candidate;
    }
  }
  return nullptr;
}

bool ReadAll(int file_descriptor, SecretBuffer& output, std::string& error) {
  std::size_t total = 0;
  while (true) {
    const ssize_t read_bytes =
        read(file_descriptor, output.Data() + total, output.kCapacity - total);
    if (read_bytes == 0) {
      break;
    }
    if (read_bytes < 0) {
      if (errno == EINTR) {
        continue;
      }
      error = "1Password import failed: could not read the credential value.";
      return false;
    }
    total += static_cast<std::size_t>(read_bytes);
    if (total == output.kCapacity) {
      unsigned char extra = 0;
      const ssize_t extra_bytes = read(file_descriptor, &extra, 1);
      if (extra_bytes != 0) {
        error =
            "1Password import refused: credential value exceeds 65535 bytes.";
        return false;
      }
      break;
    }
  }
  if (!output.CommitWrittenBytes(total) ||
      std::memchr(output.Data(), '\0', total) != nullptr) {
    output.Clear();
    error = "1Password import refused: credential value is empty or contains a "
            "NUL byte.";
    return false;
  }
  return true;
}

} // namespace

bool ReadOnePasswordReference(std::string_view reference, SecretBuffer& output,
                              std::string& error) {
  if (!IsOnePasswordReference(reference)) {
    error = "1Password import rejected: reference must be a printable op:// "
            "reference of at most 2048 bytes.";
    return false;
  }
  const char* op = FindOnePasswordExecutable();
  if (op == nullptr) {
    error = "1Password import unavailable: install the 1Password CLI at "
            "/opt/homebrew/bin/op or /usr/local/bin/op.";
    return false;
  }

  int pipe_fds[2] = {-1, -1};
  if (pipe(pipe_fds) != 0) {
    error =
        "1Password import failed: could not create a private credential pipe.";
    return false;
  }
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipe_fds[1], STDOUT_FILENO);
  posix_spawn_file_actions_addclose(&actions, pipe_fds[0]);
  posix_spawn_file_actions_addclose(&actions, pipe_fds[1]);
  std::string reference_copy(reference);
  char* const arguments[] = {const_cast<char*>(op), const_cast<char*>("read"),
                             const_cast<char*>("--no-newline"),
                             reference_copy.data(), nullptr};
  pid_t child = 0;
  const int spawn_status =
      posix_spawn(&child, op, &actions, nullptr, arguments, environ);
  posix_spawn_file_actions_destroy(&actions);
  close(pipe_fds[1]);
  if (spawn_status != 0) {
    close(pipe_fds[0]);
    SecureClearString(reference_copy);
    error = "1Password import failed: could not start the 1Password CLI.";
    return false;
  }

  const bool read_ok = ReadAll(pipe_fds[0], output, error);
  close(pipe_fds[0]);
  int child_status = 0;
  pid_t waited = -1;
  do {
    waited = waitpid(child, &child_status, 0);
  } while (waited < 0 && errno == EINTR);
  SecureClearString(reference_copy);
  if (waited != child) {
    output.Clear();
    error = "1Password import failed: child status could not be collected.";
    return false;
  }
  if (!read_ok) {
    output.Clear();
    return false;
  }
  if (!WIFEXITED(child_status) || WEXITSTATUS(child_status) != 0) {
    output.Clear();
    error = "1Password import failed: the 1Password CLI did not return a "
            "credential value.";
    return false;
  }
  return true;
}

} // namespace sockeye
