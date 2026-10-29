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
#include "sockeye/readiness.h"
#include "sockeye/run-request.h"
#include "sockeye/secret-buffer.h"
#include "sockeye/terminal.h"

#ifndef SOCKEYE_VERSION
#define SOCKEYE_VERSION "0.0.0"
#endif

namespace sockeye {
namespace {

constexpr int kUsageExit = 2;
constexpr int kNotFoundExit = 3;
constexpr int kDeniedExit = 4;
constexpr int kSystemExit = 5;
void PrintUsage(FILE* stream) {
  std::fprintf(
      stream,
      "usage:\n"
      "  sockeye set <CREDENTIAL_NAME> --binding <BINDING_ID>\n"
      "  sockeye import-1password <CREDENTIAL_NAME> <OP_REFERENCE> --binding "
      "<BINDING_ID>\n"
      "  sockeye delete <CREDENTIAL_NAME> --binding <BINDING_ID>\n"
      "  sockeye verify <CREDENTIAL_NAME> --binding <BINDING_ID>\n"
      "  sockeye run --credential <NAME> --binding <BINDING_ID> [... ]\n"
      "    [--pass-env <NAME> ...] [--bind-file <ABSOLUTE_PATH> ...]\n"
      "    --cwd <ABSOLUTE_PATH> -- <ABSOLUTE_EXECUTABLE> [ARG ...]\n\n"
      "  sockeye doctor [--credential <NAME> --binding <BINDING_ID>] [--fix]\n"
      "  sockeye capabilities\n"
      "  sockeye explain <same options as run>\n\n"
      "Sockeye has no command that returns credential plaintext. The "
      "run command\n"
      "authenticates one exact child manifest and passes credentials "
      "only to it.\n");
}

void PrintCapabilities(FILE* stream) {
  std::fputs("sockeye-capabilities-v1\n"
             "credential-bindings: sha256-64-lowercase-hex\n"
             "credential-verify: attended-protected-readback-v1\n"
             "credential-storage: keychain-biometry-current-set-device-only\n",
             stream);
}

int ExitForKeychain(const KeychainError& error) {
  switch (error.status) {
  case KeychainStatus::kNotFound:
    return kNotFoundExit;
  case KeychainStatus::kDenied:
    return kDeniedExit;
  default:
    return kSystemExit;
  }
}

void PrintKeychainError(const KeychainError& error) {
  std::fprintf(stderr, "%s", error.detail.c_str());
  if (error.os_status != 0) {
    std::fprintf(stderr, " (OS status %d)", error.os_status);
  }
  std::fputc('\n', stderr);
}

bool CredentialValuesMatch(const SecretBuffer& left,
                           const SecretBuffer& right) {
  if (left.Size() != right.Size())
    return false;
  unsigned char difference = 0;
  for (std::size_t index = 0; index < left.Size(); ++index) {
    difference |=
        static_cast<unsigned char>(left.Data()[index] ^ right.Data()[index]);
  }
  return difference == 0;
}

int StoreAndVerifyCredential(AuthorizationContext& context,
                             std::string_view binding_id,
                             const SecretBuffer& value, KeychainError& error) {
  SecretBuffer existing;
  const KeychainStatus existing_status =
      ReadCredential(context, binding_id, existing, error);
  if (existing_status == KeychainStatus::kSuccess) {
    const bool matches = CredentialValuesMatch(existing, value);
    existing.Clear();
    if (matches)
      return 0;
    error = {KeychainStatus::kConflict, 0,
             "Credential store refused: the selected binding already holds a "
             "different value. Use an approved rotation operation."};
    PrintKeychainError(error);
    return kSystemExit;
  }
  existing.Clear();
  if (existing_status != KeychainStatus::kNotFound) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  const KeychainStatus store_status =
      StoreCredential(context, binding_id, value, error);
  if (store_status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  SecretBuffer verified;
  const KeychainStatus verify_status =
      ReadCredential(context, binding_id, verified, error);
  const bool matches = verify_status == KeychainStatus::kSuccess &&
                       CredentialValuesMatch(verified, value);
  verified.Clear();
  if (!matches) {
    if (verify_status == KeychainStatus::kSuccess) {
      error = {KeychainStatus::kIo, 0,
               "Credential store verification failed: protected readback "
               "differs from the imported value."};
    }
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return 0;
}

int VerifyStoredCredentialPolicy(std::string_view binding_id,
                                 KeychainError& error) {
  if (InspectCredentialPolicy(binding_id, error) == KeychainStatus::kSuccess) {
    return 0;
  }
  PrintKeychainError(error);
  return error.status == KeychainStatus::kDenied ? kDeniedExit : kSystemExit;
}

int RunSet(std::string_view identifier, std::string_view binding_id) {
  if (!IsEnvironmentName(identifier) || !IsCredentialBindingId(binding_id)) {
    std::fputs("Credential store rejected: name or binding is invalid.\n",
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
  const std::string reason = "Store Sockeye credential " +
                             std::string(identifier) + " binding " +
                             std::string(binding_id);
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  const int result =
      StoreAndVerifyCredential(context, binding_id, value, error);
  context.Invalidate();
  value.Clear();
  return result == 0 ? VerifyStoredCredentialPolicy(binding_id, error) : result;
}

int RunOnePasswordImport(std::string_view identifier,
                         std::string_view reference,
                         std::string_view binding_id) {
  if (!IsEnvironmentName(identifier) || !IsCredentialBindingId(binding_id)) {
    std::fputs("Credential store rejected: name or binding is invalid.\n",
               stderr);
    return kUsageExit;
  }
  if (!IsOnePasswordReference(reference)) {
    std::fputs("1Password import rejected: reference must be a printable op:// "
               "reference.\n",
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
  const std::string reason = "Import Sockeye credential " +
                             std::string(identifier) + " binding " +
                             std::string(binding_id) + " from 1Password";
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
  const int result =
      StoreAndVerifyCredential(context, binding_id, value, error);
  context.Invalidate();
  value.Clear();
  return result == 0 ? VerifyStoredCredentialPolicy(binding_id, error) : result;
}

int RunDelete(std::string_view identifier, std::string_view binding_id) {
  if (!IsEnvironmentName(identifier) || !IsCredentialBindingId(binding_id)) {
    std::fputs("Credential delete rejected: name or binding is invalid.\n",
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
  const std::string reason = "Delete Sockeye credential " +
                             std::string(identifier) + " binding " +
                             std::string(binding_id);
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  const KeychainStatus status = DeleteCredential(context, binding_id, error);
  context.Invalidate();
  if (status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return 0;
}

int RunVerify(std::string_view identifier, std::string_view binding_id) {
  if (!IsEnvironmentName(identifier) || !IsCredentialBindingId(binding_id)) {
    std::fputs("Credential verify rejected: name or binding is invalid.\n",
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
  const std::string reason = "Verify Sockeye credential " +
                             std::string(identifier) + " binding " +
                             std::string(binding_id);
  if (!context.Authenticate(reason, error)) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  SecretBuffer value;
  const KeychainStatus status = ReadCredential(context, binding_id, value, error);
  value.Clear();
  context.Invalidate();
  if (status != KeychainStatus::kSuccess) {
    PrintKeychainError(error);
    return ExitForKeychain(error);
  }
  return VerifyStoredCredentialPolicy(binding_id, error);
}

int ExplainRunRequest(int argc, char** argv) {
  RunOptions options;
  std::string error;
  if (!PrepareRunRequest(argc, argv, options, error)) {
    std::fprintf(stderr, "%s\n", error.c_str());
    return kUsageExit;
  }
  RenderRunRequest(stdout, options, DigestText(CanonicalRunManifest(options)),
                   true);
  return 0;
}

int RunApprovedChild(int argc, char** argv) {
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
  std::string credential_names;
  for (const CredentialRequest& credential : options.credentials) {
    if (!credential_names.empty()) {
      credential_names += ", ";
    }
    credential_names += credential.identifier;
  }
  const std::string reason =
      "Allow " + child_name + " to use " + credential_names + "?";
  if (!context.Authenticate(reason, keychain_error)) {
    PrintKeychainError(keychain_error);
    return ExitForKeychain(keychain_error);
  }

  std::vector<std::unique_ptr<SecretBuffer>> values;
  std::vector<CredentialValue> credentials;
  values.reserve(options.credentials.size());
  credentials.reserve(options.credentials.size());
  for (const CredentialRequest& credential : options.credentials) {
    auto value = std::make_unique<SecretBuffer>();
    const KeychainStatus status =
        ReadCredential(context, credential.binding_id, *value, keychain_error);
    if (status != KeychainStatus::kSuccess) {
      context.Invalidate();
      PrintKeychainError(keychain_error);
      return ExitForKeychain(keychain_error);
    }
    credentials.push_back({credential.identifier, value.get()});
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
  if (setrlimit(RLIMIT_CORE, &no_core) != 0 ||
      signal(SIGPIPE, SIG_IGN) == SIG_ERR) {
    return false;
  }
  umask(0077);
  return true;
}

} // namespace
} // namespace sockeye

int main(int argc, char** argv) {
  if (!sockeye::InitializeProcessSecurity()) {
    std::fputs("Sockeye startup refused: process protections could not be "
               "initialized.\n",
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
  if (argc == 2 && std::strcmp(argv[1], "capabilities") == 0) {
    sockeye::PrintCapabilities(stdout);
    return 0;
  }
  if (argc == 5 && std::strcmp(argv[1], "set") == 0 &&
      std::strcmp(argv[3], "--binding") == 0) {
    return sockeye::RunSet(argv[2], argv[4]);
  }
  if (argc == 6 && std::strcmp(argv[1], "import-1password") == 0 &&
      std::strcmp(argv[4], "--binding") == 0) {
    return sockeye::RunOnePasswordImport(argv[2], argv[3], argv[5]);
  }
  if (argc == 5 && std::strcmp(argv[1], "delete") == 0 &&
      std::strcmp(argv[3], "--binding") == 0) {
    return sockeye::RunDelete(argv[2], argv[4]);
  }
  if (argc == 5 && std::strcmp(argv[1], "verify") == 0 &&
      std::strcmp(argv[3], "--binding") == 0) {
    return sockeye::RunVerify(argv[2], argv[4]);
  }
  if (argc >= 2 && std::strcmp(argv[1], "doctor") == 0) {
    return sockeye::RunDoctorCommand(argc, argv, SOCKEYE_VERSION,
                                     sockeye::RunSet);
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
