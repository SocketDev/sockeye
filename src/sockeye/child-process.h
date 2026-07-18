#ifndef SOCKEYE_CHILD_PROCESS_H
#define SOCKEYE_CHILD_PROCESS_H

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <sys/types.h>

#include "sockeye/secret-buffer.h"

namespace sockeye {

struct FileIdentity {
  std::string canonical_path;
  std::array<unsigned char, 32> digest{};
  std::uint64_t device = 0;
  std::uint64_t inode = 0;
  std::uint64_t modified_nanoseconds = 0;
  std::uint64_t size = 0;
};

struct DirectoryIdentity {
  std::string canonical_path;
  std::uint64_t device = 0;
  std::uint64_t inode = 0;
};

struct CredentialValue {
  std::string identifier;
  SecretBuffer *value = nullptr;
};

bool InspectExecutable(std::string_view path, FileIdentity &identity,
                       std::string &error);
bool InspectRegularFile(std::string_view path, FileIdentity &identity,
                        std::string &error);
bool InspectDirectory(std::string_view path, DirectoryIdentity &identity,
                      std::string &error);
bool SameIdentity(const FileIdentity &left, const FileIdentity &right);
std::string DigestHex(const FileIdentity &identity);
std::string DigestText(std::string_view value);

int LaunchChild(const FileIdentity &executable,
                const std::vector<FileIdentity> &bound_files,
                const std::vector<std::string> &arguments,
                const std::vector<std::string> &passed_environment,
                const std::vector<CredentialValue> &credentials,
                const DirectoryIdentity &working_directory, std::string &error);

#if defined(SOCKEYE_TESTING)
// Test-only seams prove that replacement before the final identity check and
// child-wait failures both stop the operation. The shipping binary excludes
// this API entirely.
using BeforeLaunchCheckForTesting = void (*)();
using WaitForChildForTesting = pid_t (*)(pid_t, int *, int);

void SetBeforeLaunchCheckForTesting(BeforeLaunchCheckForTesting hook);
void SetWaitForChildForTesting(WaitForChildForTesting hook);
#endif

} // namespace sockeye

#endif
