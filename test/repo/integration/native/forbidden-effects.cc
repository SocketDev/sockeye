#include "child-process.h"
#include "keychain.h"
#include "one-password.h"
#include "terminal.h"

#include <cstdlib>

namespace sockeye {

struct AuthorizationContext::Impl {};

[[noreturn]] void RejectForbiddenEffect() { std::exit(90); }

KeychainStatus InspectBiometricReadiness(KeychainError&) {
  RejectForbiddenEffect();
}
KeychainStatus InspectCredentialPolicy(std::string_view, KeychainError&) {
  RejectForbiddenEffect();
}

AuthorizationContext::AuthorizationContext() { RejectForbiddenEffect(); }
AuthorizationContext::~AuthorizationContext() = default;
bool AuthorizationContext::Authenticate(std::string_view, KeychainError&) {
  RejectForbiddenEffect();
}
void AuthorizationContext::Invalidate() { RejectForbiddenEffect(); }
KeychainStatus DeleteCredential(AuthorizationContext&, std::string_view,
                                KeychainError&) {
  RejectForbiddenEffect();
}
KeychainStatus ReadCredential(AuthorizationContext&, std::string_view,
                              SecretBuffer&, KeychainError&) {
  RejectForbiddenEffect();
}
KeychainStatus StoreCredential(AuthorizationContext&, std::string_view,
                               const SecretBuffer&, KeychainError&) {
  RejectForbiddenEffect();
}
KeychainStatus ReplaceCredential(AuthorizationContext&, std::string_view,
                                 const SecretBuffer&, KeychainError&) {
  RejectForbiddenEffect();
}
bool ReadOnePasswordReference(std::string_view, SecretBuffer&, std::string&) {
  RejectForbiddenEffect();
}
bool HasForegroundTerminal(std::string&) { RejectForbiddenEffect(); }
bool ReadSecretFromTerminal(std::string_view, SecretBuffer&, std::string&) {
  RejectForbiddenEffect();
}
bool ReadSecretFromPipe(int, SecretBuffer&, std::string&) {
  RejectForbiddenEffect();
}
int LaunchChild(const FileIdentity&, const std::vector<FileIdentity>&,
                const std::vector<std::string>&,
                const std::vector<std::string>&,
                const std::vector<CredentialValue>&, const DirectoryIdentity&,
                std::string&) {
  RejectForbiddenEffect();
}

} // namespace sockeye
