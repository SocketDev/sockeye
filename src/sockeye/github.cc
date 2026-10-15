#include "sockeye/github.h"

#include <cerrno>
#include <chrono>
#include <cstring>
#include <string_view>
#include <string>
#include <vector>

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

namespace sockeye {
namespace {

#if defined(SOCKEYE_TESTING)
GitHubCommandForTesting g_github_command_for_testing = nullptr;
#endif

constexpr auto kCommandTimeout = std::chrono::seconds(10);
constexpr std::size_t kMaximumOutput = SecretBuffer::kCapacity;

bool IsTokenEnvironment(std::string_view name) {
  return name == "GH_TOKEN" || name == "GH_ENTERPRISE_TOKEN" ||
         name == "GITHUB_TOKEN" || name == "GITHUB_ENTERPRISE_TOKEN";
}

bool IsHostOverride(std::string_view name) {
  return name == "GH_HOST" || name == "GH_ENTERPRISE_HOST";
}

bool IsPassedEnvironment(std::string_view name) {
  constexpr std::string_view allowed[] = {
      "HOME",          "PATH",          "TMPDIR",       "LANG",
      "LC_ALL",        "XDG_CONFIG_HOME", "GH_CONFIG_DIR", "GH_BROWSER",
      "HTTPS_PROXY",   "HTTP_PROXY",    "ALL_PROXY",    "NO_PROXY",
      "SSL_CERT_FILE", "SSL_CERT_DIR",  "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"};
  for (const std::string_view candidate : allowed) {
    if (candidate == name) return true;
  }
  return false;
}

std::vector<std::string> ChildEnvironment(const SecretBuffer* token) {
  std::vector<std::string> entries;
  for (char** entry = environ; entry != nullptr && *entry != nullptr; ++entry) {
    const std::string_view value(*entry);
    const std::size_t separator = value.find('=');
    if (separator == std::string_view::npos) {
      continue;
    }
    const std::string_view name = value.substr(0, separator);
    if (IsTokenEnvironment(name) || IsHostOverride(name) ||
        name == "GH_PROMPT_DISABLED" || !IsPassedEnvironment(name)) {
      continue;
    }
    entries.emplace_back(value);
  }
  if (token != nullptr) {
    std::string entry = "GH_TOKEN=";
    entry.append(reinterpret_cast<const char*>(token->Data()), token->Size());
    entries.push_back(std::move(entry));
  }
  entries.emplace_back("GH_HOST=github.com");
  entries.emplace_back("GH_PROMPT_DISABLED=1");
  return entries;
}

void ClearTokenEnvironment(std::vector<std::string>& entries,
                           const SecretBuffer* token) {
  if (token == nullptr) {
    return;
  }
  for (std::string& entry : entries) {
    if (entry.starts_with("GH_TOKEN=")) {
      SecureClearString(entry);
    }
  }
}

bool RunGitHubCommand(const std::vector<std::string>& arguments,
                      const SecretBuffer* token, SecretBuffer* output,
                      std::string& error) {
#if defined(SOCKEYE_TESTING)
  if (g_github_command_for_testing != nullptr) {
    return g_github_command_for_testing(arguments, token, output, error);
  }
#endif
  int pipe_descriptors[2] = {-1, -1};
  if (output != nullptr && pipe(pipe_descriptors) != 0) {
    error = "GitHub credential import failed: private output pipe is unavailable.";
    return false;
  }
  if (output != nullptr) {
    const int flags = fcntl(pipe_descriptors[0], F_GETFL);
    if (flags < 0 || fcntl(pipe_descriptors[0], F_SETFL, flags | O_NONBLOCK) != 0) {
      close(pipe_descriptors[0]);
      close(pipe_descriptors[1]);
      error = "GitHub credential import failed: private output pipe setup failed.";
      return false;
    }
  }

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    if (pipe_descriptors[0] >= 0) close(pipe_descriptors[0]);
    if (pipe_descriptors[1] >= 0) close(pipe_descriptors[1]);
    error = "GitHub credential import failed: process actions are unavailable.";
    return false;
  }
  if (output != nullptr &&
      (posix_spawn_file_actions_adddup2(&actions, pipe_descriptors[1],
                                        STDOUT_FILENO) != 0 ||
       posix_spawn_file_actions_addclose(&actions, pipe_descriptors[0]) != 0 ||
       posix_spawn_file_actions_addclose(&actions, pipe_descriptors[1]) != 0)) {
    posix_spawn_file_actions_destroy(&actions);
    close(pipe_descriptors[0]);
    close(pipe_descriptors[1]);
    error = "GitHub credential import failed: private output pipe setup failed.";
    return false;
  }
  if (posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null",
                                       O_WRONLY, 0) != 0 ||
      (output == nullptr &&
       posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null",
                                        O_WRONLY, 0) != 0)) {
    posix_spawn_file_actions_destroy(&actions);
    if (pipe_descriptors[0] >= 0) close(pipe_descriptors[0]);
    if (pipe_descriptors[1] >= 0) close(pipe_descriptors[1]);
    error = "GitHub credential import failed: output suppression setup failed.";
    return false;
  }

  std::vector<std::string> child_arguments;
  child_arguments.reserve(arguments.size() + 1);
  child_arguments.emplace_back("gh");
  child_arguments.insert(child_arguments.end(), arguments.begin(),
                         arguments.end());
  std::vector<char*> argument_pointers;
  argument_pointers.reserve(child_arguments.size() + 1);
  for (std::string& argument : child_arguments) {
    argument_pointers.push_back(argument.data());
  }
  argument_pointers.push_back(nullptr);
  std::vector<std::string> environment = ChildEnvironment(token);
  std::vector<char*> environment_pointers;
  environment_pointers.reserve(environment.size() + 1);
  for (std::string& entry : environment) {
    environment_pointers.push_back(entry.data());
  }
  environment_pointers.push_back(nullptr);

  pid_t child = 0;
  const int spawn_status = posix_spawnp(
      &child, "gh", &actions, nullptr, argument_pointers.data(),
      environment_pointers.data());
  posix_spawn_file_actions_destroy(&actions);
  if (pipe_descriptors[1] >= 0) close(pipe_descriptors[1]);
  if (spawn_status != 0) {
    if (pipe_descriptors[0] >= 0) close(pipe_descriptors[0]);
    ClearTokenEnvironment(environment, token);
    error = "GitHub credential import failed: could not start the GitHub CLI.";
    return false;
  }

  bool read_ok = true;
  std::size_t total = 0;
  bool pipe_open = output != nullptr;
  const auto deadline = std::chrono::steady_clock::now() + kCommandTimeout;
  int child_status = 0;
  bool child_finished = false;
  while (!child_finished || pipe_open) {
    if (std::chrono::steady_clock::now() >= deadline) {
      kill(child, SIGKILL);
      read_ok = false;
      error = "GitHub credential import failed: the GitHub CLI timed out.";
      break;
    }
    if (pipe_open) {
      struct pollfd descriptor = {pipe_descriptors[0], POLLIN | POLLHUP, 0};
      const int poll_status = poll(&descriptor, 1, 100);
      if (poll_status < 0 && errno != EINTR) {
        read_ok = false;
        error = "GitHub credential import failed: private output read failed.";
        break;
      }
      if (poll_status > 0) {
        while (true) {
          unsigned char overflow = 0;
          unsigned char* destination =
              total < kMaximumOutput ? output->Data() + total : &overflow;
          const std::size_t capacity =
              total < kMaximumOutput ? kMaximumOutput - total : 1;
          const ssize_t bytes = read(pipe_descriptors[0], destination, capacity);
          if (bytes == 0) {
            pipe_open = false;
            close(pipe_descriptors[0]);
            pipe_descriptors[0] = -1;
            if (total == kMaximumOutput) {
              read_ok = false;
              error = "GitHub credential import refused: CLI output is too large.";
            }
            break;
          }
          if (bytes < 0) {
            if (errno == EINTR) continue;
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            read_ok = false;
            error = "GitHub credential import failed: private output read failed.";
            break;
          }
          if (total == kMaximumOutput) {
            read_ok = false;
            error = "GitHub credential import refused: CLI output is too large.";
            break;
          }
          total += static_cast<std::size_t>(bytes);
        }
      }
    } else {
      poll(nullptr, 0, 100);
    }
    const pid_t wait_status = waitpid(child, &child_status, WNOHANG);
    if (wait_status == child) {
      child_finished = true;
    } else if (wait_status < 0 && errno != EINTR) {
      read_ok = false;
      error = "GitHub credential import failed: child status is unavailable.";
      break;
    }
    if (!read_ok) break;
  }
  if (!child_finished) {
    kill(child, SIGKILL);
    while (waitpid(child, &child_status, 0) < 0 && errno == EINTR) {}
  }
  if (pipe_descriptors[0] >= 0) close(pipe_descriptors[0]);
  ClearTokenEnvironment(environment, token);
  SecureClearString(child_arguments.front());
  if (!read_ok) {
    if (output != nullptr) output->Clear();
    return false;
  }
  if (!WIFEXITED(child_status) || WEXITSTATUS(child_status) != 0) {
    if (output != nullptr) output->Clear();
    error = "GitHub credential import failed: the GitHub CLI rejected the request.";
    return false;
  }
  if (output != nullptr) {
    while (total > 0 &&
           (output->Data()[total - 1] == '\n' ||
            output->Data()[total - 1] == '\r')) {
      --total;
    }
    bool visible = total > 0;
    for (std::size_t index = 0; index < total; ++index) {
      visible = visible && output->Data()[index] >= 0x21 &&
                output->Data()[index] <= 0x7e;
    }
    if (!visible || !output->CommitWrittenBytes(total)) {
      output->Clear();
      error = "GitHub credential import refused: CLI returned an invalid credential value.";
      return false;
    }
  }
  return true;
}

} // namespace

bool ReadNativeGitHubToken(SecretBuffer& output, std::string& error) {
  return RunGitHubCommand({"auth", "token", "--hostname", "github.com"},
                          nullptr, &output, error);
}

bool ValidateGitHubToken(const SecretBuffer& token, std::string& error) {
  if (!token.IsLocked() || token.Size() == 0 ||
      std::memchr(token.Data(), '\0', token.Size()) != nullptr) {
    error = "GitHub credential import refused: candidate value is invalid.";
    return false;
  }
  return RunGitHubCommand(
      {"api", "--hostname", "github.com", "--silent", "user"}, &token,
      nullptr, error);
}

#if defined(SOCKEYE_TESTING)
void SetGitHubCommandForTesting(GitHubCommandForTesting command) {
  g_github_command_for_testing = command;
}
#endif

} // namespace sockeye
