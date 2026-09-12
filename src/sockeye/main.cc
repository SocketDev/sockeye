#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <memory>
#include <set>
#include <signal.h>
#include <string>
#include <string_view>
#include <vector>

#include <limits.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#include "sockeye/child-process.h"
#include "sockeye/input-policy.h"
#include "sockeye/keychain.h"
#include "sockeye/one-password.h"
#include "sockeye/secret-buffer.h"
#include "sockeye/terminal.h"
#include "sockeye/run-request.h"
#include "sockeye/readiness.h"

#ifndef SOCKEYE_VERSION
#define SOCKEYE_VERSION "0.0.0"
#endif

namespace sockeye {
namespace {

constexpr int kUsageExit = 2;
constexpr int kNotFoundExit = 3;
constexpr int kDeniedExit = 4;
constexpr int kSystemExit = 5;
void PrintUsage(FILE *stream) {
  std::fprintf(
      stream, "usage:\n"
              "  sockeye set <CREDENTIAL_NAME>\n"
              "  sockeye import-1password <CREDENTIAL_NAME> <OP_REFERENCE>\n"
              "  sockeye delete <CREDENTIAL_NAME>\n"
              "  sockeye run --credential <NAME> [--credential <NAME> ...]\n"
              "    [--pass-env <NAME> ...] [--bind-file <ABSOLUTE_PATH> ...]\n"
              "    --cwd <ABSOLUTE_PATH> -- <ABSOLUTE_EXECUTABLE> [ARG ...]\n\n"
              "  sockeye doctor [--credential <NAME>] [--fix]\n"
              "  sockeye explain <same options as run>\n\n"
              "Sockeye has no command that returns credential plaintext. The "
              "run command\n"
              "authenticates one exact child manifest and passes credentials "
              "only to it.\n");
}

int ExitForKeychain(const KeychainError &error) {
  switch (error.status) {
  case KeychainStatus::kNotFound:
    return kNotFoundExit;
  case KeychainStatus::kDenied:
    return kDeniedExit;
  default:
    return kSystemExit;
  }
}

void PrintKeychainError(const KeychainError &error) {
  std::fprintf(stderr, "%s", error.detail.c_str());
  if (error.os_status != 0) {
    std::fprintf(stderr, " (OS status %d)", error.os_status);
  }
  std::fputc('\n', stderr);
}

int RunSet(std::string_view identifier) {
  if (!IsEnvironmentName(identifier)) {
    std::fputs(
        "Credential store rejected: name must match [A-Z_][A-Z0-9_]{0,126}.\n",
        stderr);
    return kUsageExit;
  }
  SecretBuffer value;
  std::string input_error;
  if (!ReadSecretFromTerminal(identifier, value, input_error)) {
    std::fprintf(stderr, "%s\n", input_error.c_str());
    return kUsageExit;
  }

  AuthorizationContext context;
  KeychainError error;
  const std::string reason =
      "Store Sockeye credential " + std::string(identifier);
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  const KeychainStatus status =
      StoreCredential(context, identifier, value, error);
  context.Invalidate();
  value.Clear();
  if (status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return 0;
}

int RunOnePasswordImport(std::string_view identifier, std::string_view reference) {
  if (!IsEnvironmentName(identifier)) {
    std::fputs(
        "Credential store rejected: name must match [A-Z_][A-Z0-9_]{0,126}.\n",
        stderr);
    return kUsageExit;
  }
  if (!IsOnePasswordReference(reference)) {
    std::fputs("1Password import rejected: reference must be a printable op:// reference.\n",
               stderr);
    return kUsageExit;
  }
  std::string terminal_error;
  if (!HasForegroundTerminal(terminal_error)) {
    std::fprintf(stderr, "%s\n", terminal_error.c_str());
    return kDeniedExit;
  }

  AuthorizationContext context;
  KeychainError error;
  const std::string reason =
      "Import Sockeye credential " + std::string(identifier) + " from 1Password";
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  SecretBuffer value;
  std::string import_error;
  if (!ReadOnePasswordReference(reference, value, import_error)) {
    context.Invalidate();
    std::fprintf(stderr, "%s\n", import_error.c_str());
    return kSystemExit;
  }
  const KeychainStatus status =
      StoreCredential(context, identifier, value, error);
  context.Invalidate();
  value.Clear();
  if (status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return 0;
}

int RunDelete(std::string_view identifier) {
  if (!IsEnvironmentName(identifier)) {
    std::fputs(
        "Credential delete rejected: name must match [A-Z_][A-Z0-9_]{0,126}.\n",
        stderr);
    return kUsageExit;
  }
  std::string terminal_error;
  if (!HasForegroundTerminal(terminal_error)) {
    std::fprintf(stderr, "%s\n", terminal_error.c_str());
    return kDeniedExit;
  }
  AuthorizationContext context;
  KeychainError error;
  const std::string reason =
      "Delete Sockeye credential " + std::string(identifier);
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  const KeychainStatus status = DeleteCredential(context, identifier, error);
  context.Invalidate();
  if (status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return 0;
}

int ExplainRunRequest(int argc, char **argv) {
  RunOptions options;
  std::string error;
  if (!PrepareRunRequest(argc, argv, options, error)) {
    std::fprintf(stderr, "%s\n", error.c_str());
    return kUsageExit;
  }
  RenderRunRequest(stdout, options, DigestText(CanonicalRunManifest(options)), true);
  return 0;
}

int RunApprovedChild(int argc, char **argv) {
  RunOptions options;
  std::string parse_error;
  if (!PrepareRunRequest(argc, argv, options, parse_error)) {
    std::fprintf(stderr, "%s\n", parse_error.c_str());
    return kUsageExit;
  }

  const std::string manifest = CanonicalRunManifest(options);
  const std::string manifest_digest = DigestText(manifest);
  RenderRunRequest(stderr, options, manifest_digest, false);

  AuthorizationContext context;
  KeychainError keychain_error;
  const std::string child_name = options.executable.canonical_path.substr(
      options.executable.canonical_path.find_last_of('/') + 1);
  const std::string reason = "Sockeye " + manifest_digest.substr(0, 16) +
                             ": run " + child_name + " with " +
                             std::to_string(options.credential_names.size()) +
                             " credential(s)";
  if (!context.Authenticate(reason, keychain_error)) {
    PrintKeychainError(keychain_error);
    return ExitForKeychain(keychain_error);
  }

  std::vector<std::unique_ptr<SecretBuffer>> values;
  std::vector<CredentialValue> credentials;
  values.reserve(options.credential_names.size());
  credentials.reserve(options.credential_names.size());
  for (const std::string &identifier : options.credential_names) {
    auto value = std::make_unique<SecretBuffer>();
    const KeychainStatus status =
        ReadCredential(context, identifier, *value, keychain_error);
    if (status != KeychainStatus::kSuccess) {
      context.Invalidate();
      PrintKeychainError(keychain_error);
      return ExitForKeychain(keychain_error);
    }
    credentials.push_back({identifier, value.get()});
    values.push_back(std::move(value));
  }
  context.Invalidate();

  std::string launch_error;
  const int child_status =
      LaunchChild(options.executable, options.bound_files,
                  options.child_arguments, options.passed_environment,
                  credentials, options.working_directory, launch_error);
  if (!launch_error.empty()) {
    std::fprintf(stderr, "%s\n", launch_error.c_str());
  }
  return child_status;
}

bool InitializeProcessSecurity() {
  const struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) != 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR) {
    return false;
  }
  umask(0077);
  return true;
}

} // namespace
} // namespace sockeye

int main(int argc, char **argv) {
  if (!sockeye::InitializeProcessSecurity()) {
    std::fputs("Sockeye startup refused: process protections could not be initialized.\n",
               stderr);
    return 5;
  }
  if (argc == 2 && std::strcmp(argv[1], "--version") == 0) {
    std::printf("sockeye %s\n", SOCKEYE_VERSION);
    return 0;
  }
  if (argc == 2 && (std::strcmp(argv[1], "--help") == 0 ||
                    std::strcmp(argv[1], "-h") == 0)) {
    sockeye::PrintUsage(stdout);
    return 0;
  }
  if (argc == 3 && std::strcmp(argv[1], "set") == 0) {
    return sockeye::RunSet(argv[2]);
  }
  if (argc == 4 && std::strcmp(argv[1], "import-1password") == 0) {
    return sockeye::RunOnePasswordImport(argv[2], argv[3]);
  }
  if (argc == 3 && std::strcmp(argv[1], "delete") == 0) {
    return sockeye::RunDelete(argv[2]);
  }
  if (argc >= 2 && std::strcmp(argv[1], "doctor") == 0) {
    return sockeye::RunDoctorCommand(argc, argv, SOCKEYE_VERSION, sockeye::RunSet);
  }
  if (argc >= 2 && std::strcmp(argv[1], "explain") == 0) {
    return sockeye::ExplainRunRequest(argc, argv);
  }
  if (argc >= 3 && std::strcmp(argv[1], "run") == 0) {
    return sockeye::RunApprovedChild(argc, argv);
  }
  sockeye::PrintUsage(stderr);
  return sockeye::kUsageExit;
}
