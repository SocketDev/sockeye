#ifndef SOCKEYE_KEYCHAIN_H
#define SOCKEYE_KEYCHAIN_H

#include <memory>
#include <string>
#include <string_view>

#include "sockeye/secret-buffer.h"

namespace sockeye {

enum class KeychainStatus {
  kSuccess,
  kDenied,
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

class AuthorizationContext final {
public:
  AuthorizationContext();
  ~AuthorizationContext();

  AuthorizationContext(const AuthorizationContext &) = delete;
  AuthorizationContext &operator=(const AuthorizationContext &) = delete;
  AuthorizationContext(AuthorizationContext &&) = delete;
  AuthorizationContext &operator=(AuthorizationContext &&) = delete;

  bool Authenticate(std::string_view reason, KeychainError &error);
  void Invalidate();

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;

  friend KeychainStatus DeleteCredential(AuthorizationContext &context,
                                         std::string_view identifier,
                                         KeychainError &error);
  friend KeychainStatus ReadCredential(AuthorizationContext &context,
                                       std::string_view identifier,
                                       SecretBuffer &output,
                                       KeychainError &error);
  friend KeychainStatus StoreCredential(AuthorizationContext &context,
                                        std::string_view identifier,
                                        const SecretBuffer &value,
                                        KeychainError &error);
};

KeychainStatus DeleteCredential(AuthorizationContext &context,
                                std::string_view identifier,
                                KeychainError &error);
KeychainStatus ReadCredential(AuthorizationContext &context,
                              std::string_view identifier, SecretBuffer &output,
                              KeychainError &error);
KeychainStatus StoreCredential(AuthorizationContext &context,
                               std::string_view identifier,
                               const SecretBuffer &value, KeychainError &error);

} // namespace sockeye

#endif
