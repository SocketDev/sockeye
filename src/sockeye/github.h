#ifndef SOCKEYE_GITHUB_H
#define SOCKEYE_GITHUB_H

#include <string>
#include <vector>

#include "sockeye/secret-buffer.h"

namespace sockeye {

bool ReadNativeGitHubToken(SecretBuffer& output, std::string& error);
bool ValidateGitHubToken(const SecretBuffer& token, std::string& error);

#if defined(SOCKEYE_TESTING)
using GitHubCommandForTesting = bool (*)(
    const std::vector<std::string>& arguments, const SecretBuffer* token,
    SecretBuffer* output, std::string& error);
void SetGitHubCommandForTesting(GitHubCommandForTesting command);
#endif

} // namespace sockeye

#endif
