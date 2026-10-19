#ifndef SOCKEYE_CHILD_PROCESS_H
#define SOCKEYE_CHILD_PROCESS_H

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include <sys/types.h>

#include "sockeye/secret-buffer.h"
#include "sockeye/file-identity.h"

namespace sockeye {

struct CredentialValue {
  std::string identifier;
  SecretBuffer *value = nullptr;
};

int LaunchChild(const FileIdentity &executable,
                const std::vector<FileIdentity> &bound_files,
                const std::vector<std::string> &arguments,
                const std::vector<std::string> &passed_environment,
                const std::vector<CredentialValue> &credentials,
                const DirectoryIdentity &working_directory, std::string &error);

#if defined(SOCKEYE_TESTING)
using BeforeLaunchCheckForTesting = void (*)();
using WaitForChildForTesting = pid_t (*)(pid_t, int *, int);

void SetBeforeLaunchCheckForTesting(BeforeLaunchCheckForTesting hook);
void SetWaitForChildForTesting(WaitForChildForTesting hook);
#endif

} // namespace sockeye

#endif
