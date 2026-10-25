#include "sockeye/child-process.h"
#include "sockeye/keychain.h"
#include "sockeye/one-password.h"
#include "sockeye/terminal.h"

#include <cstdio>
#include <cstdlib>
#include <string_view>

namespace {
const char* scenario_value = std::getenv("SOCKEYE_TEST_SCENARIO");
const std::string_view scenario =
    scenario_value == nullptr ? "ready" : scenario_value;
int approvals = 0;
int inputs = 0;
int writes = 0;
int metadata = 0;
bool repaired = false;
struct DoctorEffectsReport {
  ~DoctorEffectsReport() {
    std::fprintf(stderr,
                 "effects: metadata=%d approvals=%d inputs=%d writes=%d\n",
                 metadata, approvals, inputs, writes);
  }
};
DoctorEffectsReport effects_report;
[[noreturn]] void ForbiddenDoctorEffect() { std::exit(90); }
} // namespace

namespace sockeye {
struct AuthorizationContext::Impl {};
AuthorizationContext::AuthorizationContext()
    : impl_(std::make_unique<Impl>()) {}
AuthorizationContext::~AuthorizationContext() = default;
bool AuthorizationContext::Authenticate(std::string_view,
                                        KeychainError& error) {
  ++approvals;
  if (scenario == "denied") {
    error.status = KeychainStatus::kDenied;
    return false;
  }
  return true;
}
void AuthorizationContext::Invalidate() {}
KeychainStatus InspectBiometricReadiness(KeychainError& error) {
  error.status = scenario == "unavailable" ? KeychainStatus::kUnavailable
                                           : KeychainStatus::kSuccess;
  return error.status;
}
KeychainStatus InspectCredentialPolicy(std::string_view, KeychainError& error) {
  ++metadata;
  if (repaired || scenario == "ready")
    error.status = KeychainStatus::kSuccess;
  else if (scenario == "unknown")
    error.status = KeychainStatus::kIo;
  else if (scenario == "mismatch")
    error.status = KeychainStatus::kInvalidPolicy;
  else
    error.status = KeychainStatus::kNotFound;
  return error.status;
}
KeychainStatus DeleteCredential(AuthorizationContext&, std::string_view,
                                KeychainError&) {
  ForbiddenDoctorEffect();
}
KeychainStatus ReadCredential(AuthorizationContext&, std::string_view,
                              SecretBuffer& value, KeychainError& error) {
  if (writes == 0) {
    error.status = KeychainStatus::kNotFound;
    return error.status;
  }
  constexpr unsigned char stored[] = "example-placeholder";
  if (!value.Assign(stored, sizeof(stored) - 1))
    ForbiddenDoctorEffect();
  error = {};
  return error.status;
}
KeychainStatus StoreCredential(AuthorizationContext&, std::string_view,
                               const SecretBuffer&, KeychainError& error) {
  ++writes;
  if (approvals != 1 || inputs != 1)
    ForbiddenDoctorEffect();
  if (scenario == "write-failed") {
    error.status = KeychainStatus::kIo;
    return error.status;
  }
  repaired = scenario != "postcheck-failed";
  return KeychainStatus::kSuccess;
}
bool ReadOnePasswordReference(std::string_view, SecretBuffer&, std::string&) {
  ForbiddenDoctorEffect();
}
bool HasForegroundTerminal(std::string&) { return scenario != "no-terminal"; }
bool ReadSecretFromTerminal(std::string_view, SecretBuffer& output,
                            std::string&) {
  ++inputs;
  constexpr unsigned char value[] = "example-placeholder";
  return output.Assign(value, sizeof(value) - 1);
}
int LaunchChild(const FileIdentity&, const std::vector<FileIdentity>&,
                const std::vector<std::string>&,
                const std::vector<std::string>&,
                const std::vector<CredentialValue>&, const DirectoryIdentity&,
                std::string&) {
  ForbiddenDoctorEffect();
}
} // namespace sockeye
