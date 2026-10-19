#include "sockeye/child-process.h"
#include "sockeye/keychain.h"
#include "sockeye/one-password.h"
#include "sockeye/terminal.h"

#include <cassert>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/resource.h>
#include <sys/stat.h>

namespace {
constexpr char kValue[] = "example-placeholder";
constexpr char kSetBinding[] =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
constexpr char kImportBinding[] =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
std::string Scenario() {
  const char* value = std::getenv("SOCKEYE_TEST_SCENARIO");
  return value == nullptr ? "success" : value;
}
bool authorized = false;
int approvals = 0;
std::vector<std::string> reads;
int protected_reads = 0;
void Event(const char* name) { std::fprintf(stderr, "effect:%s\n", name); }
sockeye::KeychainStatus Result(sockeye::KeychainError& error) {
  using sockeye::KeychainStatus;
  const std::string scenario = Scenario();
  error = {};
  if (scenario == "missing")
    error.status = KeychainStatus::kNotFound;
  else if (scenario == "io")
    error.status = KeychainStatus::kIo;
  else if (scenario == "unavailable")
    error.status = KeychainStatus::kUnavailable;
  else if (scenario == "operation-denied")
    error.status = KeychainStatus::kDenied;
  if (error.status != KeychainStatus::kSuccess) {
    error.detail = "example operation failed";
    error.os_status = -1;
  }
  return error.status;
}
} // namespace
extern "C" int SockeyeMainSetrlimit(int resource, const struct rlimit* limit) {
  assert(resource == RLIMIT_CORE);
  assert(limit != nullptr && limit->rlim_cur == 0 && limit->rlim_max == 0);
  std::fputs("startup:core\n", stderr);
  if (Scenario() == "core-limit-failed") {
    errno = EPERM;
    return -1;
  }
  return 0;
}
extern "C" void (*SockeyeMainSignal(int number, void (*handler)(int)))(int) {
  assert(number == SIGPIPE && handler == SIG_IGN);
  std::fputs("startup:signal\n", stderr);
  if (Scenario() == "signal-failed") {
    errno = EINVAL;
    return SIG_ERR;
  }
  return SIG_DFL;
}
extern "C" mode_t SockeyeMainUmask(mode_t mask) {
  assert(mask == 0077);
  std::fputs("startup:umask\n", stderr);
  return 0022;
}
namespace sockeye {
struct AuthorizationContext::Impl {};
AuthorizationContext::AuthorizationContext()
    : impl_(std::make_unique<Impl>()) {}
AuthorizationContext::~AuthorizationContext() = default;
bool AuthorizationContext::Authenticate(std::string_view reason,
                                        KeychainError& error) {
  Event("approve");
  assert(++approvals == 1);
  assert(!reason.empty());
  std::fprintf(stderr, "reason:%.*s\n", static_cast<int>(reason.size()),
               reason.data());
  if (Scenario() == "denied") {
    error.status = KeychainStatus::kDenied;
    return false;
  }
  authorized = true;
  return true;
}
void AuthorizationContext::Invalidate() {
  Event("invalidate");
  authorized = false;
}
KeychainStatus InspectBiometricReadiness(KeychainError&) { std::abort(); }
KeychainStatus InspectCredentialPolicy(std::string_view, KeychainError& error) {
  Event("policy");
  return Result(error);
}
KeychainStatus DeleteCredential(AuthorizationContext&, std::string_view name,
                                KeychainError& error) {
  assert(
      authorized &&
      name ==
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
  Event("delete");
  return Result(error);
}
KeychainStatus StoreCredential(AuthorizationContext&, std::string_view name,
                               const SecretBuffer& value,
                               KeychainError& error) {
  assert(authorized && (name == kSetBinding || name == kImportBinding));
  assert(value.Size() == sizeof(kValue) - 1 &&
         std::memcmp(value.Data(), kValue, value.Size()) == 0);
  Event("store");
  return Result(error);
}
KeychainStatus ReplaceCredential(AuthorizationContext&, std::string_view name,
                                 const SecretBuffer& value,
                                 KeychainError& error) {
  assert(authorized && (name == kSetBinding || name == kImportBinding));
  assert(value.Size() == sizeof(kValue) - 1 &&
         std::memcmp(value.Data(), kValue, value.Size()) == 0);
  Event("replace");
  return Result(error);
}
KeychainStatus ReadCredential(AuthorizationContext&, std::string_view name,
                              SecretBuffer& value, KeychainError& error) {
  assert(authorized);
  Event("read");
  reads.emplace_back(name);
  if (name == kSetBinding || name == kImportBinding) {
    if (protected_reads++ == 0) {
      error.status = KeychainStatus::kNotFound;
      return error.status;
    }
  }
  if (Result(error) != KeychainStatus::kSuccess)
    return error.status;
  assert(value.Assign(kValue, sizeof(kValue) - 1));
  return KeychainStatus::kSuccess;
}
bool HasForegroundTerminal(std::string& error) {
  Event("terminal");
  error = "example terminal unavailable";
  return Scenario() != "no-terminal";
}
bool ReadSecretFromTerminal(std::string_view, SecretBuffer& output,
                            std::string& error) {
  Event("input");
  error = "example input failed";
  return Scenario() != "input-failed" &&
         output.Assign(kValue, sizeof(kValue) - 1);
}
bool ReadOnePasswordReference(std::string_view reference, SecretBuffer& output,
                              std::string& error) {
  assert(authorized && reference == "op://example-vault/example-item/password");
  Event("provider");
  error = "example provider failed";
  return Scenario() != "provider-failed" &&
         output.Assign(kValue, sizeof(kValue) - 1);
}
int LaunchChild(const FileIdentity& executable,
                const std::vector<FileIdentity>&,
                const std::vector<std::string>& arguments,
                const std::vector<std::string>&,
                const std::vector<CredentialValue>& credentials,
                const DirectoryIdentity& directory, std::string& error) {
  Event("launch");
  assert(!authorized && approvals == 1 && !executable.canonical_path.empty() &&
         !directory.canonical_path.empty());
  assert(!arguments.empty() && credentials.size() == reads.size());
  for (std::size_t index = 0; index < credentials.size(); ++index) {
    assert(credentials[index].value->Size() == sizeof(kValue) - 1);
    assert(std::memcmp(credentials[index].value->Data(), kValue,
                       sizeof(kValue) - 1) == 0);
  }
  if (Scenario() == "launch-failed") {
    error = "example launch failed";
    return 5;
  }
  return 23;
}
} // namespace sockeye
