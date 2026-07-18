#include "sockeye/child-process.h"
#include "sockeye/secret-buffer.h"

#include <array>
#include <cassert>
#include <cerrno>
#include <cstdio>
#include <string>

#include <fcntl.h>
#include <limits.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

namespace {

std::string g_replacement_path;

void ReplaceApprovedExecutable() {
  const int descriptor = open(g_replacement_path.c_str(), O_WRONLY | O_TRUNC);
  assert(descriptor >= 0);
  constexpr char kReplacement[] = "#!/bin/sh\nexit 1\n";
  [[maybe_unused]] const ssize_t written =
      write(descriptor, kReplacement, sizeof(kReplacement) - 1);
  assert(written == static_cast<ssize_t>(sizeof(kReplacement) - 1));
  assert(fsync(descriptor) == 0);
  assert(close(descriptor) == 0);
}

pid_t ReapThenFailWait(pid_t child, int *status, int options) {
  [[maybe_unused]] const pid_t result = waitpid(child, status, options);
  assert(result == child);
  errno = EIO;
  return -1;
}

std::string MakeExecutable() {
  char path[] = "/private/tmp/sockeye-child-process-test.XXXXXX";
  const int descriptor = mkstemp(path);
  assert(descriptor >= 0);
  constexpr char kInitial[] = "#!/bin/sh\nexit 0\n";
  [[maybe_unused]] const ssize_t written =
      write(descriptor, kInitial, sizeof(kInitial) - 1);
  assert(written == static_cast<ssize_t>(sizeof(kInitial) - 1));
  assert(fsync(descriptor) == 0);
  assert(close(descriptor) == 0);
  assert(chmod(path, S_IRWXU) == 0);
  return path;
}

int ReadEnvryptCredential() {
  const char *protocol = std::getenv("SOCKEYE_CREDENTIAL_PROTOCOL");
  const char *descriptor = std::getenv("SOCKEYE_CREDENTIAL_FD");
  if (protocol == nullptr || descriptor == nullptr ||
      std::string(protocol) != "envrypt-v1" || std::string(descriptor) != "3") {
    return 1;
  }
  std::array<unsigned char, 91> record = {};
  std::size_t used = 0;
  while (used < record.size()) {
    const ssize_t read_count = read(3, record.data() + used, record.size() - used);
    if (read_count <= 0) {
      return 1;
    }
    used += static_cast<std::size_t>(read_count);
  }
  unsigned char extra = 0;
  if (read(3, &extra, 1) != 0) {
    return 1;
  }
  constexpr char kExpectedName[] = "ENVRYPT_PRIVATE_KEY";
  constexpr char kExpectedValue[] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return record[0] == 'E' && record[1] == 'V' && record[2] == '1' &&
                 record[3] == 1 && record[4] == 0 && record[5] == 19 &&
                 record[6] == 0 && record[7] == 64 &&
                 std::memcmp(record.data() + 8, kExpectedName, 19) == 0 &&
                 std::memcmp(record.data() + 27, kExpectedValue, 64) == 0
             ? 0
             : 1;
}

} // namespace

int main(int argc, char **argv) {
  if (argc == 2 && std::string(argv[1]) == "--read-envrypt-v1") {
    return ReadEnvryptCredential();
  }
  using sockeye::DirectoryIdentity;
  using sockeye::FileIdentity;

  const std::string executable_path = MakeExecutable();
  FileIdentity executable;
  std::string error;
  assert(sockeye::InspectExecutable(executable_path, executable, error));

  [[maybe_unused]] char current_directory[PATH_MAX] = {};
  assert(getcwd(current_directory, sizeof(current_directory)) != nullptr);
  DirectoryIdentity working_directory;
  assert(sockeye::InspectDirectory(current_directory, working_directory, error));

  g_replacement_path = executable_path;
  sockeye::SetBeforeLaunchCheckForTesting(ReplaceApprovedExecutable);
  [[maybe_unused]] const int replacement_status = sockeye::LaunchChild(
      executable, {}, {}, {}, {}, working_directory, error);
  sockeye::SetBeforeLaunchCheckForTesting(nullptr);
  assert(replacement_status == 6);
  assert(error.find("identity changed after approval") != std::string::npos);

  error.clear();
  FileIdentity true_executable;
  assert(sockeye::InspectExecutable("/usr/bin/true", true_executable, error));
  sockeye::SetWaitForChildForTesting(ReapThenFailWait);
  [[maybe_unused]] const int wait_status = sockeye::LaunchChild(
      true_executable, {}, {}, {}, {}, working_directory, error);
  sockeye::SetWaitForChildForTesting(nullptr);
  assert(wait_status == 6);
  assert(error.find("status could not be collected") != std::string::npos);

  [[maybe_unused]] char self_path[PATH_MAX] = {};
  assert(realpath(argv[0], self_path) != nullptr);
  FileIdentity self;
  assert(sockeye::InspectExecutable(self_path, self, error));
  sockeye::SecretBuffer secret;
  [[maybe_unused]] constexpr char kPrivateKey[] =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  assert(secret.Assign(kPrivateKey, sizeof(kPrivateKey) - 1));
  const sockeye::CredentialValue credential{"ENVRYPT_PRIVATE_KEY", &secret};
  error.clear();
  [[maybe_unused]] const int credential_status = sockeye::LaunchChild(
      self, {}, {"--read-envrypt-v1"}, {}, {credential}, working_directory, error);
  assert(credential_status == 0);
  assert(error.empty());

  assert(unlink(executable_path.c_str()) == 0);
  return 0;
}
