#include "child-process.h"

#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>

#include <fcntl.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

namespace sockeye {
namespace {

constexpr int kEnvryptCredentialDescriptor = 3;
constexpr char kEnvryptCredentialName[] = "ENVRYPT_PRIVATE_KEY";
constexpr char kEnvryptCredentialProtocol[] = "envrypt-v1";

#if defined(SOCKEYE_TESTING)
BeforeLaunchCheckForTesting g_before_launch_check = nullptr;
WaitForChildForTesting g_wait_for_child = ::waitpid;
#endif

void ClearSensitiveEnvironment(std::vector<std::string>& environment,
                               const std::vector<std::size_t>& indexes) {
  for (const std::size_t index : indexes) {
    SecureClearString(environment[index]);
  }
}

bool IsEnvryptCredential(const CredentialValue& credential) {
  return credential.identifier == kEnvryptCredentialName;
}

bool MakeCredentialPipe(int (&descriptors)[2], std::string& error) {
  if (pipe(descriptors) != 0 ||
      fcntl(descriptors[0], F_SETFD, FD_CLOEXEC) != 0 ||
      fcntl(descriptors[1], F_SETFD, FD_CLOEXEC) != 0) {
    if (descriptors[0] >= 0) {
      close(descriptors[0]);
    }
    if (descriptors[1] >= 0) {
      close(descriptors[1]);
    }
    descriptors[0] = -1;
    descriptors[1] = -1;
    error = "Child launch failed: could not create a private credential pipe.";
    return false;
  }
  return true;
}

bool WriteAll(int descriptor, const void* source, std::size_t length) {
  const auto* bytes = static_cast<const unsigned char*>(source);
  while (length > 0) {
    const ssize_t written = write(descriptor, bytes, length);
    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    if (written == 0) {
      return false;
    }
    bytes += written;
    length -= static_cast<std::size_t>(written);
  }
  return true;
}

bool WriteEnvryptCredential(int descriptor, const CredentialValue& credential) {
  if (credential.value == nullptr || credential.value->Size() == 0 ||
      credential.value->Size() > 65'535) {
    return false;
  }
  const std::uint16_t name_length =
      static_cast<std::uint16_t>(credential.identifier.size());
  const std::uint16_t value_length =
      static_cast<std::uint16_t>(credential.value->Size());
  const unsigned char header[] = {
      'E',
      'V',
      '1',
      1,
      static_cast<unsigned char>(name_length >> 8),
      static_cast<unsigned char>(name_length & 0xff),
      static_cast<unsigned char>(value_length >> 8),
      static_cast<unsigned char>(value_length & 0xff),
  };
  return WriteAll(descriptor, header, sizeof(header)) &&
         WriteAll(descriptor, credential.identifier.data(),
                  credential.identifier.size()) &&
         WriteAll(descriptor, credential.value->Data(),
                  credential.value->Size());
}

int OpenApprovedDirectory(const DirectoryIdentity& approved,
                          std::string& error) {
  char resolved[PATH_MAX] = {};
  if (realpath(approved.canonical_path.c_str(), resolved) == nullptr ||
      approved.canonical_path != resolved) {
    error =
        "Child launch refused: working directory path changed after approval.";
    return -1;
  }
  const int descriptor =
      open(resolved, O_RDONLY | O_CLOEXEC | O_DIRECTORY | O_NOFOLLOW);
  if (descriptor < 0) {
    error =
        "Child launch refused: approved working directory could not be opened.";
    return -1;
  }
  struct stat metadata = {};
  if (fstat(descriptor, &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
      !((metadata.st_uid == 0 || metadata.st_uid == geteuid()) &&
        (metadata.st_mode & (S_IWGRP | S_IWOTH)) == 0) ||
      static_cast<std::uint64_t>(metadata.st_dev) != approved.device ||
      static_cast<std::uint64_t>(metadata.st_ino) != approved.inode) {
    close(descriptor);
    error = "Child launch refused: working directory identity changed after "
            "approval.";
    return -1;
  }
  return descriptor;
}

} // namespace

int LaunchChild(const FileIdentity& executable,
                const std::vector<FileIdentity>& bound_files,
                const std::vector<std::string>& arguments,
                const std::vector<std::string>& passed_environment,
                const std::vector<CredentialValue>& credentials,
                const DirectoryIdentity& working_directory,
                std::string& error) {
#if defined(SOCKEYE_TESTING)
  if (g_before_launch_check != nullptr) {
    g_before_launch_check();
  }
#endif
  FileIdentity current_executable;
  if (!InspectExecutable(executable.canonical_path, current_executable,
                         error) ||
      !SameIdentity(executable, current_executable)) {
    if (error.empty()) {
      error =
          "Child launch refused: executable identity changed after approval.";
    }
    return 6;
  }
  for (const FileIdentity& approved_file : bound_files) {
    FileIdentity current_file;
    if (!InspectRegularFile(approved_file.canonical_path, current_file,
                            error) ||
        !SameIdentity(approved_file, current_file)) {
      if (error.empty()) {
        error = "Child launch refused: a bound-file identity changed after "
                "approval.";
      }
      return 6;
    }
  }

  const int working_directory_descriptor =
      OpenApprovedDirectory(working_directory, error);
  if (working_directory_descriptor < 0) {
    return 6;
  }

  std::vector<std::string> environment;
  const CredentialValue* envrypt_credential = nullptr;
  environment.reserve(passed_environment.size() + credentials.size() + 2);
  for (const std::string& name : passed_environment) {
    const char* value = std::getenv(name.c_str());
    if (value == nullptr) {
      close(working_directory_descriptor);
      error = "Child launch refused: an approved pass-through environment "
              "variable is unset.";
      return 6;
    }
    environment.push_back(name + "=" + value);
  }

  std::vector<std::size_t> sensitive_indexes;
  sensitive_indexes.reserve(credentials.size());
  for (const CredentialValue& credential : credentials) {
    if (IsEnvryptCredential(credential)) {
      if (envrypt_credential != nullptr) {
        ClearSensitiveEnvironment(environment, sensitive_indexes);
        close(working_directory_descriptor);
        error = "Child launch refused: envrypt-v1 accepts one private key.";
        return 6;
      }
      envrypt_credential = &credential;
      continue;
    }
    if (credential.value == nullptr || credential.value->Size() == 0 ||
        std::memchr(credential.value->Data(), '\0', credential.value->Size()) !=
            nullptr) {
      ClearSensitiveEnvironment(environment, sensitive_indexes);
      close(working_directory_descriptor);
      error = "Child launch refused: a credential cannot be represented as an "
              "environment value.";
      return 6;
    }
    std::string entry = credential.identifier + "=";
    entry.append(reinterpret_cast<const char*>(credential.value->Data()),
                 credential.value->Size());
    sensitive_indexes.push_back(environment.size());
    environment.push_back(std::move(entry));
  }
  if (envrypt_credential != nullptr) {
    environment.emplace_back(std::string("SOCKEYE_CREDENTIAL_PROTOCOL=") +
                             kEnvryptCredentialProtocol);
    environment.emplace_back("SOCKEYE_CREDENTIAL_FD=3");
  }

  std::vector<char*> environment_pointers;
  environment_pointers.reserve(environment.size() + 1);
  for (std::string& entry : environment) {
    environment_pointers.push_back(entry.data());
  }
  environment_pointers.push_back(nullptr);

  std::vector<std::string> child_arguments;
  child_arguments.reserve(arguments.size() + 1);
  child_arguments.push_back(executable.canonical_path);
  child_arguments.insert(child_arguments.end(), arguments.begin(),
                         arguments.end());
  std::vector<char*> argument_pointers;
  argument_pointers.reserve(child_arguments.size() + 1);
  for (std::string& argument : child_arguments) {
    argument_pointers.push_back(argument.data());
  }
  argument_pointers.push_back(nullptr);

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) {
    ClearSensitiveEnvironment(environment, sensitive_indexes);
    close(working_directory_descriptor);
    error = "Child launch failed: could not initialize spawn actions.";
    return 6;
  }
#if defined(__MAC_26_0) && __MAC_OS_X_VERSION_MAX_ALLOWED >= __MAC_26_0 &&     \
    __MAC_OS_X_VERSION_MIN_REQUIRED >= __MAC_26_0
  const int chdir_status = posix_spawn_file_actions_addfchdir(
      &actions, working_directory_descriptor);
#else
  const int chdir_status = posix_spawn_file_actions_addfchdir_np(
      &actions, working_directory_descriptor);
#endif
  if (chdir_status != 0) {
    posix_spawn_file_actions_destroy(&actions);
    ClearSensitiveEnvironment(environment, sensitive_indexes);
    close(working_directory_descriptor);
    error =
        "Child launch failed: could not bind the approved working directory.";
    return 6;
  }

  int credential_pipe[2] = {-1, -1};
  if (envrypt_credential != nullptr &&
      !MakeCredentialPipe(credential_pipe, error)) {
    posix_spawn_file_actions_destroy(&actions);
    ClearSensitiveEnvironment(environment, sensitive_indexes);
    close(working_directory_descriptor);
    return 6;
  }
  if (envrypt_credential != nullptr) {
    if (posix_spawn_file_actions_adddup2(&actions, credential_pipe[0],
                                         kEnvryptCredentialDescriptor) != 0 ||
        posix_spawn_file_actions_addclose(&actions, credential_pipe[1]) != 0 ||
        (credential_pipe[0] != kEnvryptCredentialDescriptor &&
         posix_spawn_file_actions_addclose(&actions, credential_pipe[0]) !=
             0)) {
      posix_spawn_file_actions_destroy(&actions);
      close(credential_pipe[0]);
      close(credential_pipe[1]);
      ClearSensitiveEnvironment(environment, sensitive_indexes);
      close(working_directory_descriptor);
      error =
          "Child launch failed: could not bind the envrypt-v1 credential pipe.";
      return 6;
    }
  }

  pid_t child = 0;
  const int spawn_status =
      posix_spawn(&child, executable.canonical_path.c_str(), &actions, nullptr,
                  argument_pointers.data(), environment_pointers.data());
  posix_spawn_file_actions_destroy(&actions);
  close(working_directory_descriptor);
  if (envrypt_credential != nullptr) {
    close(credential_pipe[0]);
  }
  const bool credential_written =
      envrypt_credential == nullptr ||
      (spawn_status == 0 &&
       WriteEnvryptCredential(credential_pipe[1], *envrypt_credential));
  if (envrypt_credential != nullptr) {
    close(credential_pipe[1]);
  }
  ClearSensitiveEnvironment(environment, sensitive_indexes);
  for (const CredentialValue& credential : credentials) {
    if (credential.value != nullptr) {
      credential.value->Clear();
    }
  }
  if (spawn_status != 0) {
    error =
        "Child launch failed: posix_spawn returned an operating-system error.";
    return 6;
  }
  if (!credential_written) {
    error = "Child launch failed: could not deliver the envrypt-v1 credential.";
  }

  int child_status = 0;
  for (;;) {
#if defined(SOCKEYE_TESTING)
    const pid_t wait_result = g_wait_for_child(child, &child_status, 0);
#else
    const pid_t wait_result = waitpid(child, &child_status, 0);
#endif
    if (wait_result >= 0) {
      break;
    }
    if (errno == EINTR) {
      continue;
    }
    error =
        "Child wait failed: the approved child status could not be collected.";
    return 6;
  }
  if (WIFEXITED(child_status)) {
    return credential_written ? WEXITSTATUS(child_status) : 6;
  }
  if (WIFSIGNALED(child_status)) {
    return credential_written ? 128 + WTERMSIG(child_status) : 6;
  }
  error = "Child wait failed: child ended in an unsupported state.";
  return 6;
}

#if defined(SOCKEYE_TESTING)
void SetBeforeLaunchCheckForTesting(BeforeLaunchCheckForTesting hook) {
  g_before_launch_check = hook;
}

void SetWaitForChildForTesting(WaitForChildForTesting hook) {
  g_wait_for_child = hook == nullptr ? ::waitpid : hook;
}
#endif

} // namespace sockeye
