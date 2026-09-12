#include "keychain-fakes.h"
#include <cassert>
#include <cstring>

KeychainFakeState keychain_state;
NSData *KeychainPolicyFixture() { return [@"example-current-biometry-policy" dataUsingEncoding:NSUTF8StringEncoding]; }
void ResetKeychainFake() { keychain_state = {}; }

@implementation SockeyeTestLAContext
- (LABiometryType)biometryType { return keychain_state.biometry; }
- (BOOL)canEvaluatePolicy:(LAPolicy)policy error:(NSError **)error {
  assert(policy == LAPolicyDeviceOwnerAuthenticationWithBiometrics);
  if (!keychain_state.available && error != nullptr) {
    *error = [NSError errorWithDomain:keychain_state.error_domain code:keychain_state.error_code userInfo:nil];
  }
  return keychain_state.available;
}
- (void)evaluatePolicy:(LAPolicy)policy localizedReason:(NSString *)reason reply:(void (^)(BOOL, NSError *))reply {
  assert(policy == LAPolicyDeviceOwnerAuthenticationWithBiometrics);
  assert(reason.length > 0);
  assert(self.touchIDAuthenticationAllowableReuseDuration == 0.0);
  assert([self.localizedFallbackTitle isEqualToString:@""]);
  ++keychain_state.evaluations;
  NSError *error = keychain_state.approved ? nil : [NSError errorWithDomain:LAErrorDomain code:LAErrorUserCancel userInfo:nil];
  reply(keychain_state.approved, error);
}
- (void)invalidate { ++keychain_state.invalidations; }
@end

OSStatus SockeyeTestCopyMatching(CFDictionaryRef query, CFTypeRef *result) {
  keychain_state.last_query = [(__bridge NSDictionary *)query copy];
  assert(keychain_state.query_index < keychain_state.query_statuses.size());
  const OSStatus status = keychain_state.query_statuses[keychain_state.query_index++];
  id item = status == errSecSuccess ? keychain_state.query_result : keychain_state.query_failure_result;
  if (result != nullptr) *result = item == nil ? nullptr : CFBridgingRetain(item);
  return status;
}
OSStatus SockeyeTestAdd(CFDictionaryRef item, CFTypeRef *) {
  ++keychain_state.additions;
  keychain_state.last_item = [(__bridge NSDictionary *)item copy];
  return keychain_state.add_status;
}
OSStatus SockeyeTestUpdate(CFDictionaryRef query, CFDictionaryRef updates) {
  ++keychain_state.updates;
  keychain_state.last_query = [(__bridge NSDictionary *)query copy];
  keychain_state.last_item = [(__bridge NSDictionary *)updates copy];
  return keychain_state.update_status;
}
OSStatus SockeyeTestDelete(CFDictionaryRef query) {
  ++keychain_state.deletions;
  keychain_state.last_query = [(__bridge NSDictionary *)query copy];
  return keychain_state.delete_status;
}
SecAccessControlRef SockeyeTestCreateAccess(CFAllocatorRef, CFTypeRef protection, SecAccessControlCreateFlags flags, CFErrorRef *error) {
  assert(CFEqual(protection, kSecAttrAccessibleWhenUnlockedThisDeviceOnly));
  assert(flags == kSecAccessControlBiometryCurrentSet);
  if (keychain_state.policy_failure) {
    if (keychain_state.policy_error_object && error != nullptr) *error = CFErrorCreate(kCFAllocatorDefault, kCFErrorDomainPOSIX, 5, nullptr);
    return nullptr;
  }
  return reinterpret_cast<SecAccessControlRef>(const_cast<void *>(CFBridgingRetain(KeychainPolicyFixture())));
}
CFTypeID SockeyeTestAccessType() { return CFDataGetTypeID(); }
