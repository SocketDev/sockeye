#include "keychain-fakes.h"
#include "sockeye/keychain.h"
#include <cassert>
#include <cstring>
#include <string>

namespace {
constexpr char kIdentifier[] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
constexpr char kValue[] = "example-fixture-value";
const std::string invalid_utf8(1, static_cast<char>(0xff));
NSMutableDictionary *ValidItem() {
  return [@{(__bridge id)kSecAttrAccessControl: KeychainReturnedPolicyFixture(),
            (__bridge id)kSecAttrGeneric: [@"sockeye:v1:biometry-current-set" dataUsingEncoding:NSUTF8StringEncoding],
            (__bridge id)kSecValueData: [NSData dataWithBytes:kValue length:sizeof(kValue) - 1]} mutableCopy];
}
void Authenticate(sockeye::AuthorizationContext &context) {
  sockeye::KeychainError error;
  assert(context.Authenticate("example test approval", error));
  assert(error.status == sockeye::KeychainStatus::kSuccess);
}
void CheckRead(NSDictionary *item, sockeye::KeychainStatus expected) {
  ResetKeychainFake();
  keychain_state.require_access_control_query = true;
  keychain_state.query_result = item;
  sockeye::AuthorizationContext context;
  Authenticate(context);
  sockeye::SecretBuffer output;
  sockeye::KeychainError error;
  assert(sockeye::ReadCredential(context, kIdentifier, output, error) == expected);
  if (expected == sockeye::KeychainStatus::kSuccess) {
    assert(output.Size() == sizeof(kValue) - 1);
    assert(std::memcmp(output.Data(), kValue, output.Size()) == 0);
  } else assert(output.Size() == 0);
}
void CheckAuthentication() {
  using sockeye::KeychainStatus;
  ResetKeychainFake();
  sockeye::AuthorizationContext context;
  sockeye::KeychainError error;
  assert(!context.Authenticate("", error));
  assert(error.status == KeychainStatus::kIo);
  assert(!context.Authenticate(invalid_utf8, error));
  keychain_state.available = false;
  assert(!context.Authenticate("example test approval", error));
  assert(error.status == KeychainStatus::kUnavailable);
  keychain_state.available = true;
  keychain_state.approved = false;
  assert(!context.Authenticate("example test approval", error));
  assert(error.status == KeychainStatus::kDenied);
  keychain_state.approved = true;
  Authenticate(context);
  assert(!context.Authenticate("example repeated approval", error));
  assert(error.status == KeychainStatus::kDenied);
  context.Invalidate();
  sockeye::SecretBuffer value;
  assert(sockeye::ReadCredential(context, kIdentifier, value, error) == KeychainStatus::kDenied);
  assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kDenied);
  assert(sockeye::DeleteCredential(context, kIdentifier, error) == KeychainStatus::kDenied);
}
void CheckReadiness() {
  using sockeye::KeychainStatus;
  sockeye::KeychainError error;
  ResetKeychainFake();
  assert(sockeye::InspectBiometricReadiness(error) == KeychainStatus::kSuccess);
  keychain_state.biometry = LABiometryTypeNone;
  assert(sockeye::InspectBiometricReadiness(error) == KeychainStatus::kUnavailable);
  keychain_state.available = false;
  for (NSInteger code : {LAErrorBiometryNotAvailable, LAErrorBiometryNotEnrolled, LAErrorBiometryLockout}) {
    keychain_state.error_code = code;
    assert(sockeye::InspectBiometricReadiness(error) == KeychainStatus::kUnavailable);
  }
  keychain_state.error_code = LAErrorUserCancel;
  assert(sockeye::InspectBiometricReadiness(error) == KeychainStatus::kIo);
  keychain_state.error_domain = @"example.error";
  assert(sockeye::InspectBiometricReadiness(error) == KeychainStatus::kIo);
  ResetKeychainFake();
  keychain_state.context_initialization_failure = true;
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kIo);
  assert(keychain_state.query_index == 0);
  assert(keychain_state.evaluations == 0);
  assert(keychain_state.additions == 0 && keychain_state.updates == 0 && keychain_state.deletions == 0);
  ResetKeychainFake();
  keychain_state.query_result = ValidItem();
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kSuccess);
  assert([keychain_state.last_query[(__bridge id)kSecReturnData] isEqual:@NO]);
  SockeyeTestLAContext *query_context = keychain_state.last_query[(__bridge id)kSecUseAuthenticationContext];
  assert(query_context.interactionNotAllowed);
  assert(sockeye::InspectCredentialPolicy(invalid_utf8, error) == KeychainStatus::kIo);
  for (OSStatus status : {errSecItemNotFound, errSecAuthFailed}) {
    ResetKeychainFake();
    keychain_state.query_statuses = status == errSecItemNotFound
        ? std::vector<OSStatus>{status, status}
        : std::vector<OSStatus>{status};
    assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == (status == errSecItemNotFound ? KeychainStatus::kNotFound : KeychainStatus::kIo));
  }
  ResetKeychainFake(); keychain_state.query_statuses = {errSecMissingEntitlement};
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kIo);
  assert(error.os_status == errSecMissingEntitlement);
  assert(error.detail.find("signed application") != std::string::npos);
  ResetKeychainFake(); keychain_state.query_result = @"invalid item";
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kIo);
  ResetKeychainFake(); keychain_state.query_result = @{};
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kIo);
  ResetKeychainFake();
  keychain_state.query_statuses = {errSecItemNotFound, errSecSuccess};
  keychain_state.query_result = ValidItem();
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kInvalidPolicy);
  assert(keychain_state.query_index == 2);
  ResetKeychainFake();
  NSMutableDictionary *item = ValidItem(); item[(__bridge id)kSecAttrGeneric] = @"wrong marker";
  keychain_state.query_result = item;
  assert(sockeye::InspectCredentialPolicy(kIdentifier, error) == KeychainStatus::kInvalidPolicy);
}
void CheckCredentialReads() {
  using sockeye::KeychainStatus;
  CheckRead(ValidItem(), KeychainStatus::kSuccess);
  CheckRead(nil, KeychainStatus::kIo);
  for (id access : @[@"wrong type", [@"wrong policy" dataUsingEncoding:NSUTF8StringEncoding]]) {
    NSMutableDictionary *item = ValidItem(); item[(__bridge id)kSecAttrAccessControl] = access;
    CheckRead(item, KeychainStatus::kInvalidPolicy);
  }
  NSMutableDictionary *item = ValidItem(); [item removeObjectForKey:(__bridge id)kSecAttrAccessControl];
  CheckRead(item, KeychainStatus::kInvalidPolicy);
  for (id data : @[@"wrong type", [NSData data], [NSMutableData dataWithLength:sockeye::SecretBuffer::kCapacity + 1]]) {
    item = ValidItem(); item[(__bridge id)kSecValueData] = data;
    CheckRead(item, KeychainStatus::kIo);
  }
  item = ValidItem(); [item removeObjectForKey:(__bridge id)kSecValueData]; CheckRead(item, KeychainStatus::kIo);
  for (OSStatus status : {errSecAuthFailed, errSecInteractionNotAllowed, errSecUserCanceled, errSecNotAvailable, errSecParam, errSecMissingEntitlement}) {
    ResetKeychainFake(); keychain_state.query_statuses = {status};
    sockeye::AuthorizationContext context; Authenticate(context);
    sockeye::SecretBuffer output; sockeye::KeychainError error;
    const auto expected = status == errSecNotAvailable ? KeychainStatus::kUnavailable : (status == errSecParam || status == errSecMissingEntitlement) ? KeychainStatus::kIo : KeychainStatus::kDenied;
    assert(sockeye::ReadCredential(context, kIdentifier, output, error) == expected);
    if (status == errSecMissingEntitlement) {
      assert(error.os_status == errSecMissingEntitlement);
      assert(error.detail.find("signed application") != std::string::npos);
    }
  }
  for (OSStatus legacy : {errSecSuccess, errSecItemNotFound}) {
    ResetKeychainFake(); keychain_state.query_statuses = {errSecItemNotFound, legacy}; keychain_state.query_result = ValidItem();
    sockeye::AuthorizationContext context; Authenticate(context);
    sockeye::SecretBuffer output; sockeye::KeychainError error;
    assert(sockeye::ReadCredential(context, kIdentifier, output, error) == (legacy == errSecSuccess ? KeychainStatus::kInvalidPolicy : KeychainStatus::kNotFound));
  }
  ResetKeychainFake(); keychain_state.query_result = @"not a dictionary";
  sockeye::AuthorizationContext context; Authenticate(context);
  sockeye::SecretBuffer output; sockeye::KeychainError error;
  assert(sockeye::ReadCredential(context, kIdentifier, output, error) == KeychainStatus::kIo);
  assert(sockeye::ReadCredential(context, invalid_utf8, output, error) == KeychainStatus::kIo);
}
void CheckUnexpectedFailureResultCleanup() {
  __weak NSObject *returned_object = nil;
  @autoreleasepool {
    ResetKeychainFake();
    keychain_state.query_statuses = {errSecAuthFailed};
    keychain_state.query_failure_result = [[NSObject alloc] init];
    returned_object = keychain_state.query_failure_result;
    sockeye::AuthorizationContext context; Authenticate(context);
    sockeye::SecretBuffer output; sockeye::KeychainError error;
    assert(sockeye::ReadCredential(context, kIdentifier, output, error) == sockeye::KeychainStatus::kDenied);
    assert(output.Size() == 0);
    ResetKeychainFake();
  }
  assert(returned_object == nil);
}
void CheckCredentialWrites() {
  using sockeye::KeychainStatus;
  ResetKeychainFake();
  sockeye::AuthorizationContext context; Authenticate(context);
  sockeye::SecretBuffer value; sockeye::KeychainError error;
  assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kDenied);
  assert(value.Assign(kValue, sizeof(kValue) - 1));
  assert(sockeye::StoreCredential(context, invalid_utf8, value, error) == KeychainStatus::kIo);
  assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kSuccess);
  assert(keychain_state.updates == 0 && keychain_state.additions == 1);
  assert([keychain_state.last_item[(__bridge id)kSecAttrAccessControl] isEqual:KeychainPolicyFixture()]);
  assert([keychain_state.last_item[(__bridge id)kSecValueData] length] == sizeof(kValue) - 1);
  assert([keychain_state.last_item[(__bridge id)kSecAttrAccount] isEqual:@"binding:v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]);
  keychain_state.add_status = errSecDuplicateItem;
  assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kConflict);
  keychain_state.add_status = errSecAuthFailed;
  assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kDenied);
  keychain_state.update_status = errSecSuccess;
  assert(sockeye::ReplaceCredential(context, kIdentifier, value, error) == KeychainStatus::kSuccess);
  assert(keychain_state.updates == 1 && keychain_state.additions == 3);
  assert([keychain_state.last_query[(__bridge id)kSecAttrAccount]
      isEqual:@"binding:v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]);
  assert(keychain_state.last_query[(__bridge id)kSecUseAuthenticationContext] != nil);
  assert([keychain_state.last_item[(__bridge id)kSecValueData] length] ==
         sizeof(kValue) - 1);
  assert(keychain_state.last_item[(__bridge id)kSecAttrAccessControl] == nil);
  keychain_state.update_status = errSecItemNotFound;
  assert(sockeye::ReplaceCredential(context, kIdentifier, value, error) == KeychainStatus::kNotFound);
  keychain_state.update_status = errSecAuthFailed;
  assert(sockeye::ReplaceCredential(context, kIdentifier, value, error) == KeychainStatus::kDenied);
  keychain_state.policy_failure = true;
  for (bool with_error : {false, true}) {
    keychain_state.policy_error_object = with_error;
    assert(sockeye::StoreCredential(context, kIdentifier, value, error) == KeychainStatus::kIo);
  }
  assert(sockeye::DeleteCredential(context, invalid_utf8, error) == KeychainStatus::kIo);
  assert(sockeye::DeleteCredential(context, kIdentifier, error) == KeychainStatus::kSuccess);
  keychain_state.delete_status = errSecItemNotFound;
  assert(sockeye::DeleteCredential(context, kIdentifier, error) == KeychainStatus::kSuccess);
  keychain_state.delete_status = errSecAuthFailed;
  assert(sockeye::DeleteCredential(context, kIdentifier, error) == KeychainStatus::kDenied);
}
} // namespace
int main() {
  @autoreleasepool {
    CheckAuthentication(); CheckReadiness(); CheckCredentialReads(); CheckUnexpectedFailureResultCleanup(); CheckCredentialWrites();
  }
  return 0;
}
