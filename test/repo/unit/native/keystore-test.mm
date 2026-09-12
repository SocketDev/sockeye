#include "keychain-fakes.h"
#include "socketsecurity/keystore-infra/keystore.h"
#include <array>
#include <cassert>
#include <cstring>

int main() {
  @autoreleasepool {
    constexpr char service[] = "example-test-service";
    constexpr char account[] = "example-test-account";
    constexpr char value[] = "example-fixture-value";
    std::array<char, 128> output{};
    ResetKeychainFake();
    keychain_state.query_result = [NSData dataWithBytes:value length:sizeof(value) - 1];
    assert(keystore_get(service, account, output.data(), output.size()) == KEYSTORE_OK);
    assert(std::strcmp(output.data(), value) == 0);
    ResetKeychainFake();
    keychain_state.query_result = [NSData dataWithBytes:value length:sizeof(value) - 1];
    assert(keystore_get_silent(service, account, output.data(), output.size()) == KEYSTORE_OK);
    assert(keychain_state.last_query[(__bridge id)kSecUseAuthenticationUI] != nil);
    ResetKeychainFake();
    keychain_state.query_result = [NSData dataWithBytes:value length:sizeof(value) - 1];
    assert(keystore_get(service, account, output.data(), 1) == KEYSTORE_ERR_IO);
    for (OSStatus status : {errSecItemNotFound, errSecAuthFailed, errSecUserCanceled, errSecInteractionNotAllowed, errSecParam, errSecSuccess}) {
      ResetKeychainFake(); keychain_state.query_statuses = {status};
      const int expected = status == errSecItemNotFound ? KEYSTORE_ERR_NOT_FOUND :
          (status == errSecAuthFailed || status == errSecUserCanceled || status == errSecInteractionNotAllowed) ? KEYSTORE_ERR_DENIED : KEYSTORE_ERR_IO;
      assert(keystore_get(service, account, output.data(), output.size()) == expected);
    }
    ResetKeychainFake();
    assert(keystore_put(service, account, value) == KEYSTORE_OK);
    assert(keychain_state.deletions == 1 && keychain_state.additions == 1);
    assert([keychain_state.last_item[(__bridge id)kSecAttrAccessControl] isEqual:KeychainPolicyFixture()]);
    assert(keychain_state.last_item[(__bridge id)kSecAttrAccessible] == nil);
    ResetKeychainFake();
    assert(keystore_put_silent(service, account, value) == KEYSTORE_OK);
    assert(keychain_state.last_item[(__bridge id)kSecAttrAccessControl] == nil);
    assert([keychain_state.last_item[(__bridge id)kSecAttrAccessible] isEqual:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly]);
    keychain_state.add_status = errSecParam;
    assert(keystore_put(service, account, value) == KEYSTORE_ERR_IO);
    for (bool with_error : {false, true}) {
      ResetKeychainFake(); keychain_state.policy_failure = true; keychain_state.policy_error_object = with_error;
      assert(keystore_put(service, account, value) == KEYSTORE_ERR_IO);
      assert(keychain_state.additions == 0);
    }
    for (OSStatus status : {errSecSuccess, errSecItemNotFound, errSecParam}) {
      ResetKeychainFake(); keychain_state.delete_status = status;
      assert(keystore_delete(service, account) == (status == errSecParam ? KEYSTORE_ERR_IO : KEYSTORE_OK));
    }
  }
  return 0;
}
