#include "input-policy.h"

#include <cassert>
#include <string>

int main() {
  using sockeye::AppendCanonicalField;
  using sockeye::HasDisplayControl;
  using sockeye::IsCompleteSecretInput;
  using sockeye::IsCredentialBindingId;
  using sockeye::IsEnvironmentName;
  using sockeye::IsOnePasswordReference;
  using sockeye::VisibleArgument;

  assert(IsEnvironmentName("SOCKET_RELEASE_CLIENT_ID"));
  assert(!IsEnvironmentName("socket-release-client-id"));
  assert(!IsEnvironmentName(std::string(128, 'A')));
  assert(IsCredentialBindingId(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"));
  assert(!IsCredentialBindingId(
      "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"));
  assert(IsOnePasswordReference("op://Personal/release-key/password"));
  assert(!IsOnePasswordReference("https://Personal/release-key/password"));
  assert(!IsOnePasswordReference("op://Personal/release\nkey/password"));
  assert(!IsOnePasswordReference("op://"));

  const std::string malformed_utf8("\xc3\x28", 2);
  assert(!HasDisplayControl(malformed_utf8));
  assert(VisibleArgument(malformed_utf8) == "\\xc3(");
  assert(VisibleArgument("a\\b\n") == "a\\\\b\\x0a");

  std::string manifest;
  AppendCanonicalField(manifest, "arg", std::string("a\0b", 3));
  assert(manifest.size() == 10);
  assert(manifest.substr(0, 6) == "arg:3:");

  [[maybe_unused]] const unsigned char valid[] = {'s', 'e', 'c', 'r', 'e', 't'};
  [[maybe_unused]] const unsigned char with_nul[] = {'s', 'e', '\0',
                                                     'r', 'e', 't'};
  assert(IsCompleteSecretInput(valid, sizeof(valid), true, false));
  assert(!IsCompleteSecretInput(valid, sizeof(valid), false, false));
  assert(!IsCompleteSecretInput(valid, sizeof(valid), true, true));
  assert(!IsCompleteSecretInput(with_nul, sizeof(with_nul), true, false));
  assert(!IsCompleteSecretInput(valid, 0, true, false));
  return 0;
}
