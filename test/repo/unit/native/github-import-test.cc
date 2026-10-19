#include "sockeye/github.h"

#include <cassert>
#include <cstring>
#include <string>
#include <vector>

namespace {

std::vector<std::string> captured_arguments;
std::string captured_test_value = "test-secret-placeholder-value";
bool saw_validation_token = false;

bool RunGitHubFixture(const std::vector<std::string>& arguments,
                      const sockeye::SecretBuffer* token,
                      sockeye::SecretBuffer* output, std::string& error) {
  captured_arguments = arguments;
  if (arguments.front() == "auth") {
    assert(token == nullptr);
    assert(output != nullptr);
    const std::string value = captured_test_value;
    assert(output->Assign(value.data(), value.size()));
    return true;
  }
  assert(arguments.front() == "api");
  assert(token != nullptr);
  assert(output == nullptr);
  saw_validation_token =
      token->Size() == captured_test_value.size() &&
      std::memcmp(token->Data(), captured_test_value.data(), token->Size()) == 0;
  if (!saw_validation_token) {
    error = "test GitHub credential did not match";
  }
  return saw_validation_token;
}

} // namespace

int main() {
  sockeye::SetGitHubCommandForTesting(RunGitHubFixture);
  sockeye::SecretBuffer token;
  std::string error;
  assert(sockeye::ReadNativeGitHubToken(token, error));
  assert(error.empty());
  assert(token.Size() == captured_test_value.size());
  assert(std::memcmp(token.Data(), captured_test_value.data(), token.Size()) ==
         0);
  assert((captured_arguments == std::vector<std::string>{
                                    "auth", "token", "--hostname",
                                    "github.com"}));
  assert(sockeye::ValidateGitHubToken(token, error));
  assert(error.empty());
  assert(saw_validation_token);
  assert((captured_arguments == std::vector<std::string>{
                                    "api", "--hostname", "github.com",
                                    "--silent", "user"}));
  token.Clear();
  sockeye::SetGitHubCommandForTesting(nullptr);
  return 0;
}
