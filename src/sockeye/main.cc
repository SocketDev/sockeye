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

#ifndef SOCKEYE_VERSION
#define SOCKEYE_VERSION "0.0.0"
#endif

namespace sockeye {
namespace {

constexpr int kUsageExit = 2;
constexpr int kNotFoundExit = 3;
constexpr int kDeniedExit = 4;
constexpr int kSystemExit = 5;
constexpr std::size_t kMaxArgumentBytes = 4'096;
constexpr std::size_t kMaxManifestBytes = 65'535;

struct RunOptions {
  std::vector<FileIdentity> bound_files;
  std::vector<std::string> child_arguments;
  std::vector<std::string> credential_names;
  FileIdentity executable;
  std::vector<std::string> passed_environment;
  DirectoryIdentity working_directory;
};

void PrintUsage(FILE *stream) {
  std::fprintf(
      stream, "usage:\n"
              "  sockeye set <CREDENTIAL_NAME>\n"
              "  sockeye import-1password <CREDENTIAL_NAME> <OP_REFERENCE>\n"
              "  sockeye delete <CREDENTIAL_NAME>\n"
              "  sockeye run --credential <NAME> [--credential <NAME> ...]\n"
              "    [--pass-env <NAME> ...] [--bind-file <ABSOLUTE_PATH> ...]\n"
              "    --cwd <ABSOLUTE_PATH> -- <ABSOLUTE_EXECUTABLE> [ARG ...]\n\n"
              "Sockeye has no command that returns credential plaintext. The "
              "run command\n"
              "authenticates one exact child manifest and passes credentials "
              "only to it.\n");
}

bool InsertUnique(std::set<std::string> &seen, const std::string &value,
                  std::string_view option, std::string &error) {
  if (!seen.insert(value).second) {
    error = "Manifest rejected: duplicate " + std::string(option) +
            " value is not allowed.";
    return false;
  }
  return true;
}

bool ParseRunOptions(int argc, char **argv, RunOptions &options,
                     std::string &error) {
  std::set<std::string> bound_paths;
  std::set<std::string> credentials;
  std::set<std::string> environment;
  std::string requested_working_directory;
  int index = 2;
  for (; index < argc; ++index) {
    const std::string option = argv[index];
    if (option == "--") {
      ++index;
      break;
    }
    if (option != "--bind-file" && option != "--credential" &&
        option != "--cwd" && option != "--pass-env") {
      error = "Manifest rejected: unknown run option before --.";
      return false;
    }
    if (++index >= argc) {
      error = "Manifest rejected: run option is missing its value.";
      return false;
    }
    const std::string value = argv[index];
    if (option == "--credential") {
      if (!IsEnvironmentName(value) ||
          !InsertUnique(credentials, value, option, error)) {
        if (error.empty()) {
          error = "Manifest rejected: credential names must match "
                  "[A-Z_][A-Z0-9_]{0,126}.";
        }
        return false;
      }
      options.credential_names.push_back(value);
    } else if (option == "--pass-env") {
      if (!IsEnvironmentName(value) ||
          !InsertUnique(environment, value, option, error)) {
        if (error.empty()) {
          error = "Manifest rejected: pass-through environment names must "
                  "match [A-Z_][A-Z0-9_]{0,126}.";
        }
        return false;
      }
      options.passed_environment.push_back(value);
    } else if (option == "--bind-file") {
      FileIdentity identity;
      if (!InspectRegularFile(value, identity, error) ||
          HasDisplayControl(identity.canonical_path) ||
          !InsertUnique(bound_paths, identity.canonical_path, option, error)) {
        if (error.empty()) {
          error = "Manifest rejected: bound file is not safe to display and "
                  "approve.";
        }
        return false;
      }
      options.bound_files.push_back(std::move(identity));
    } else {
      if (!requested_working_directory.empty()) {
        error = "Manifest rejected: --cwd may appear exactly once.";
        return false;
      }
      requested_working_directory = value;
    }
  }

  if (options.credential_names.empty() || requested_working_directory.empty() ||
      index >= argc) {
    error = "Manifest rejected: at least one credential, one --cwd, and a "
            "child after -- are required.";
    return false;
  }
  for (const std::string &name : options.credential_names) {
    if (environment.contains(name)) {
      error = "Manifest rejected: a credential name cannot also be passed from "
              "the parent environment.";
      return false;
    }
  }
  if (HasDisplayControl(requested_working_directory) ||
      !InspectDirectory(requested_working_directory, options.working_directory,
                        error) ||
      !InspectExecutable(argv[index], options.executable, error) ||
      HasDisplayControl(options.executable.canonical_path)) {
    if (error.empty()) {
      error = "Manifest rejected: executable path is not safe to display and "
              "approve.";
    }
    return false;
  }
  ++index;

  std::size_t manifest_bytes = options.working_directory.canonical_path.size() +
                               options.executable.canonical_path.size();
  for (; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument.size() > kMaxArgumentBytes) {
      error = "Manifest rejected: one child argument exceeds 4096 bytes.";
      return false;
    }
    manifest_bytes += argument.size();
    if (manifest_bytes > kMaxManifestBytes) {
      error = "Manifest rejected: child manifest exceeds 65535 bytes.";
      return false;
    }
    options.child_arguments.push_back(argument);
  }
  return true;
}

std::string CanonicalManifest(const RunOptions &options) {
  std::string manifest = "sockeye-manifest-v1\n";
  AppendCanonicalField(manifest, "cwd",
                       options.working_directory.canonical_path);
  AppendCanonicalField(manifest, "exec", options.executable.canonical_path);
  AppendCanonicalField(manifest, "exec-sha256", DigestHex(options.executable));

  std::vector<std::string> credential_names = options.credential_names;
  std::ranges::sort(credential_names);
  for (const std::string &name : credential_names) {
    AppendCanonicalField(manifest, "credential", name);
  }
  std::vector<std::string> passed_environment = options.passed_environment;
  std::ranges::sort(passed_environment);
  for (const std::string &name : passed_environment) {
    AppendCanonicalField(manifest, "pass-env", name);
  }
  std::vector<FileIdentity> bound_files = options.bound_files;
  std::ranges::sort(bound_files, {}, &FileIdentity::canonical_path);
  for (const FileIdentity &file : bound_files) {
    AppendCanonicalField(manifest, "bind-file", file.canonical_path);
    AppendCanonicalField(manifest, "bind-sha256", DigestHex(file));
  }
  for (const std::string &argument : options.child_arguments) {
    AppendCanonicalField(manifest, "arg", argument);
  }
  return manifest;
}

void PrintApproval(const RunOptions &options, std::string_view digest) {
  std::fprintf(stderr, "Sockeye approval request\n");
  std::fprintf(stderr, "  manifest: sha256:%.*s\n", 16, digest.data());
  std::fprintf(stderr, "  working directory: %s\n",
               options.working_directory.canonical_path.c_str());
  std::fprintf(stderr, "  executable: %s\n",
               options.executable.canonical_path.c_str());
  std::fprintf(stderr, "  executable sha256: %s\n",
               DigestHex(options.executable).c_str());
  for (const FileIdentity &file : options.bound_files) {
    std::fprintf(stderr, "  bound file: %s\n", file.canonical_path.c_str());
    std::fprintf(stderr, "    sha256: %s\n", DigestHex(file).c_str());
  }
  for (const std::string &name : options.credential_names) {
    std::fprintf(stderr, "  credential: %s\n", name.c_str());
  }
  for (const std::string &name : options.passed_environment) {
    std::fprintf(stderr, "  pass parent env: %s\n", name.c_str());
  }
  for (std::size_t index = 0; index < options.child_arguments.size(); ++index) {
    const std::string visible = VisibleArgument(options.child_arguments[index]);
    std::fprintf(stderr, "  arg[%zu]: %s\n", index, visible.c_str());
  }
  std::fflush(stderr);
}

int ExitForKeychain(const KeychainError &error) {
  switch (error.status) {
  case KeychainStatus::kNotFound:
    return kNotFoundExit;
  case KeychainStatus::kDenied:
    return kDeniedExit;
  case KeychainStatus::kSuccess:
    return 0;
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

int RunApprovedChild(int argc, char **argv) {
  RunOptions options;
  std::string parse_error;
  if (!ParseRunOptions(argc, argv, options, parse_error)) {
    std::fprintf(stderr, "%s\n", parse_error.c_str());
    return kUsageExit;
  }

  const std::string manifest = CanonicalManifest(options);
  const std::string manifest_digest = DigestText(manifest);
  PrintApproval(options, manifest_digest);

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
    std::fputs("Sockeye startup refused: core dumps could not be disabled.\n",
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
  if (argc >= 3 && std::strcmp(argv[1], "run") == 0) {
    return sockeye::RunApprovedChild(argc, argv);
  }
  sockeye::PrintUsage(stderr);
  return sockeye::kUsageExit;
}
