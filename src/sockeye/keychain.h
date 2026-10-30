#ifndef SOCKEYE_KEYCHAIN_H
#define SOCKEYE_KEYCHAIN_H

#include <memory>
#include <functional>
#include <string>
#include <string_view>

#include "sockeye/secret-buffer.h"

#ifdef __OBJC__
@class LAContext;
#endif

namespace sockeye {

enum class KeychainStatus {
  kSuccess,
  kDenied,
  kConflict,
  kInvalidPolicy,
  kIo,
  kNotFound,
  kUnavailable,
};

struct KeychainError {
  KeychainStatus status = KeychainStatus::kSuccess;
  int os_status = 0;
  std::string detail;
};

KeychainStatus InspectBiometricReadiness(KeychainError& error);
KeychainStatus InspectCredentialPolicy(std::string_view binding_id,
                                       KeychainError& error);

class AuthorizationContext final {
public:
  AuthorizationContext();
  ~AuthorizationContext();

  AuthorizationContext(const AuthorizationContext&) = delete;
  AuthorizationContext& operator=(const AuthorizationContext&) = delete;
  AuthorizationContext(AuthorizationContext&&) = delete;
  AuthorizationContext& operator=(AuthorizationContext&&) = delete;

  bool Authenticate(std::string_view reason, KeychainError& error);
  bool AuthenticateWithEvents(std::string_view reason, KeychainError& error,
                              const std::function<void()>& process_events);
#ifdef __OBJC__
  LAContext* NativeContext();
#endif
  void Invalidate();

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;

  friend KeychainStatus DeleteCredential(AuthorizationContext& context,
                                         std::string_view binding_id,
                                         KeychainError& error);
  friend KeychainStatus ReadCredential(AuthorizationContext& context,
                                       std::string_view binding_id,
                                       SecretBuffer& output,
                                       KeychainError& error);
  friend KeychainStatus StoreCredential(AuthorizationContext& context,
                                        std::string_view binding_id,
                                        const SecretBuffer& value,
                                        KeychainError& error);
  friend KeychainStatus ReplaceCredential(AuthorizationContext& context,
                                          std::string_view binding_id,
                                          const SecretBuffer& value,
                                          KeychainError& error);
};

KeychainStatus DeleteCredential(AuthorizationContext& context,
                                std::string_view binding_id,
                                KeychainError& error);
KeychainStatus ReadCredential(AuthorizationContext& context,
                              std::string_view binding_id, SecretBuffer& output,
                              KeychainError& error);
KeychainStatus StoreCredential(AuthorizationContext& context,
                               std::string_view binding_id,
                               const SecretBuffer& value, KeychainError& error);
KeychainStatus ReplaceCredential(AuthorizationContext& context,
                                 std::string_view binding_id,
                                 const SecretBuffer& value,
                                 KeychainError& error);

} // namespace sockeye

#endif
