#include "sockeye/run-request.h"
#include "sockeye/input-policy.h"

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

namespace {
void RejectRequest(std::vector<std::string> arguments) {
  std::vector<char *> pointers;
  for (std::string &argument : arguments) pointers.push_back(argument.data());
  sockeye::RunOptions request;
  std::string error;
  assert(!sockeye::PrepareRunRequest(static_cast<int>(pointers.size()), pointers.data(), request, error));
  assert(!error.empty());
}
void CheckRejectedRequests() {
  const std::vector<std::vector<std::string>> invalid = {
    {"sockeye", "run", "--credential"},
    {"sockeye", "run", "--pass-env", "invalid-name"},
    {"sockeye", "run", "--pass-env", "EXAMPLE", "--pass-env", "EXAMPLE"},
    {"sockeye", "run", "--cwd", "/", "--cwd", "/"},
    {"sockeye", "run", "--bind-file", "/usr/bin/true", "--bind-file", "/usr/bin/true"},
    {"sockeye", "run", "--credential", "SOCKET_TEST_TOKEN", "--pass-env", "SOCKET_TEST_TOKEN", "--cwd", "/", "--", "/usr/bin/true"},
    {"sockeye", "run", "--credential", "SOCKET_TEST_TOKEN", "--cwd", "/", "--", "/usr/bin/true", std::string(4097, 'x')},
  };
  for (const auto &arguments : invalid) RejectRequest(arguments);
  std::vector<std::string> excessive = {"sockeye", "run", "--credential", "SOCKET_TEST_TOKEN", "--cwd", "/", "--", "/usr/bin/true"};
  excessive.insert(excessive.end(), 17, std::string(4096, 'x'));
  RejectRequest(excessive);
}
} // namespace

int main() {
  CheckRejectedRequests();
  sockeye::RunOptions request;
  request.working_directory.canonical_path = "/example";
  request.executable.canonical_path = "/example/tool";
  request.credential_names = {"Z_TOKEN", "A_TOKEN"};
  request.passed_environment = {"Z_CONFIG", "A_CONFIG"};
  request.child_arguments = {"first\nline", "second\\value"};
  const std::string zero_digest(64, '0');
  const std::string expected =
      "sockeye-manifest-v1\ncwd:8:/example\nexec:13:/example/tool\n"
      "exec-sha256:64:" + zero_digest +
      "\ncredential:7:A_TOKEN\ncredential:7:Z_TOKEN\n"
      "pass-env:8:A_CONFIG\npass-env:8:Z_CONFIG\n"
      "arg:10:first\nline\narg:12:second\\value\n";
  assert(sockeye::CanonicalRunManifest(request) == expected);
  assert(sockeye::VisibleArgument(request.child_arguments[0]) == "first\\x0aline");
  std::swap(request.credential_names[0], request.credential_names[1]);
  std::swap(request.passed_environment[0], request.passed_environment[1]);
  assert(sockeye::CanonicalRunManifest(request) == expected);
  std::swap(request.child_arguments[0], request.child_arguments[1]);
  assert(sockeye::CanonicalRunManifest(request) != expected);
  sockeye::FileIdentity later;
  later.canonical_path = "/example/z-config";
  sockeye::FileIdentity earlier;
  earlier.canonical_path = "/example/a-config";
  request.bound_files = {later, earlier};
  const std::string bound_manifest = sockeye::CanonicalRunManifest(request);
  assert(bound_manifest.find("/example/a-config") < bound_manifest.find("/example/z-config"));
  std::swap(request.bound_files[0], request.bound_files[1]);
  assert(sockeye::CanonicalRunManifest(request) == bound_manifest);
  return 0;
}
