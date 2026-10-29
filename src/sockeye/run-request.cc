#include "sockeye/run-request.h"
#include "sockeye/input-policy.h"

#include <algorithm>
#include <set>
#include <utility>

namespace sockeye {
namespace {

constexpr std::size_t kMaxArgumentBytes = 4'096;
constexpr std::size_t kMaxManifestBytes = 65'535;

bool InsertUnique(std::set<std::string>& seen, const std::string& value,
                  std::string_view option, std::string& error) {
  if (!seen.insert(value).second) {
    error = "Manifest rejected: duplicate " + std::string(option) +
            " value is not allowed.";
    return false;
  }
  return true;
}

} // namespace

bool PrepareRunRequest(int argc, char** argv, RunOptions& options,
                       std::string& error) {
  std::set<std::string> bound_paths;
  std::set<std::string> credential_identifiers;
  std::set<std::string> credential_bindings;
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
          !InsertUnique(credential_identifiers, value, option, error)) {
        if (error.empty()) {
          error = "Manifest rejected: credential names must match "
                  "[A-Z_][A-Z0-9_]{0,126}.";
        }
        return false;
      }
      if (++index >= argc || std::string_view(argv[index]) != "--binding" ||
          ++index >= argc) {
        error =
            "Manifest rejected: every credential requires one --binding value.";
        return false;
      }
      const std::string binding_id = argv[index];
      if (!IsCredentialBindingId(binding_id) ||
          !InsertUnique(credential_bindings, binding_id, "--binding", error)) {
        if (error.empty()) {
          error = "Manifest rejected: credential bindings must be 64 lowercase "
                  "hexadecimal bytes.";
        }
        return false;
      }
      options.credentials.push_back({binding_id, value});
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

  if (options.credentials.empty() || requested_working_directory.empty() ||
      index >= argc) {
    error = "Manifest rejected: at least one credential, one --cwd, and a "
            "child after -- are required.";
    return false;
  }
  for (const CredentialRequest& credential : options.credentials) {
    if (environment.contains(credential.identifier)) {
      error = "Manifest rejected: a credential name cannot also be passed from "
              "the parent environment.";
      return false;
    }
  }
  if (HasDisplayControl(requested_working_directory) ||
      !InspectDirectory(requested_working_directory, options.working_directory,
                        error) ||
      HasDisplayControl(options.working_directory.canonical_path) ||
      !InspectExecutable(argv[index], options.executable, error) ||
      HasDisplayControl(options.executable.canonical_path)) {
    if (error.empty()) {
      error = "Manifest rejected: executable or working directory path is not "
              "safe to display and "
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

std::string CanonicalRunManifest(const RunOptions& options) {
  std::string manifest = "sockeye-manifest-v1\n";
  AppendCanonicalField(manifest, "cwd",
                       options.working_directory.canonical_path);
  AppendCanonicalField(manifest, "exec", options.executable.canonical_path);
  AppendCanonicalField(manifest, "exec-sha256", DigestHex(options.executable));

  std::vector<CredentialRequest> credentials = options.credentials;
  std::ranges::sort(credentials, {}, &CredentialRequest::identifier);
  for (const CredentialRequest& credential : credentials) {
    AppendCanonicalField(manifest, "credential", credential.identifier);
    AppendCanonicalField(manifest, "binding", credential.binding_id);
  }
  std::vector<std::string> passed_environment = options.passed_environment;
  std::ranges::sort(passed_environment);
  for (const std::string& name : passed_environment) {
    AppendCanonicalField(manifest, "pass-env", name);
  }
  std::vector<FileIdentity> bound_files = options.bound_files;
  std::ranges::sort(bound_files, {}, &FileIdentity::canonical_path);
  for (const FileIdentity& file : bound_files) {
    AppendCanonicalField(manifest, "bind-file", file.canonical_path);
    AppendCanonicalField(manifest, "bind-sha256", DigestHex(file));
  }
  for (const std::string& argument : options.child_arguments) {
    AppendCanonicalField(manifest, "arg", argument);
  }
  return manifest;
}

void RenderRunRequest(FILE* stream, const RunOptions& options,
                      std::string_view digest, bool preview) {
  std::fprintf(stream, "%s\n",
               preview ? "Request preview (no authorization)"
                       : "Approval request");
  std::fprintf(stream, "  request ID: sha256:%.*s\n",
               static_cast<int>(preview ? digest.size() : 16), digest.data());
  std::fprintf(stream, "  working directory: %s\n",
               options.working_directory.canonical_path.c_str());
  std::fprintf(stream, "  executable: %s\n",
               options.executable.canonical_path.c_str());
  for (const FileIdentity& file : options.bound_files) {
    std::fprintf(stream, "  bound file: %s\n", file.canonical_path.c_str());
    if (preview) {
      std::fprintf(stream, "    sha256: %s\n", DigestHex(file).c_str());
    }
  }
  for (const CredentialRequest& credential : options.credentials) {
    std::fprintf(stream, "  credential: %s\n", credential.identifier.c_str());
    if (preview) {
      std::fprintf(stream, "    binding: %s\n", credential.binding_id.c_str());
    }
  }
  for (const std::string& name : options.passed_environment) {
    std::fprintf(stream, "  pass parent env: %s\n", name.c_str());
  }
  for (std::size_t index = 0; index < options.child_arguments.size(); ++index) {
    const std::string visible = VisibleArgument(options.child_arguments[index]);
    std::fprintf(stream, "  arg[%zu]: %s\n", index, visible.c_str());
  }
  if (preview) {
    std::fputs(
        "  Parent environment values are neither displayed nor bound.\n"
        "  A run prepares this request again and requires fresh Touch ID.\n",
        stream);
  }
  std::fflush(stream);
}

} // namespace sockeye
