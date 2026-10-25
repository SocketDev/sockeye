#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include "keychain.h"
#include "input-policy.h"

#include <dispatch/dispatch.h>

namespace sockeye {
namespace {

NSString *const kService = @"dev.socket.sockeye.credentials";
NSString *const kPolicyMarker = @"sockeye:v1:biometry-current-set";
NSString *const kBindingAccountPrefix = @"binding:v1:";

void SetError(KeychainError &error, KeychainStatus status, int os_status,
              std::string detail) {
  error.status = status;
  error.os_status = os_status;
  error.detail = std::move(detail);
}

NSString *MakeString(std::string_view value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}

NSData *PolicyMarkerData() {
  return [kPolicyMarker dataUsingEncoding:NSUTF8StringEncoding];
}

NSMutableDictionary *BaseQuery(std::string_view binding_id) {
  if (!IsCredentialBindingId(binding_id)) {
    return nil;
  }
  NSString *binding = MakeString(binding_id);
  if (binding == nil) return nil;
  NSString *account = [kBindingAccountPrefix stringByAppendingString:binding];
  NSMutableDictionary *query = [NSMutableDictionary dictionary];
  query[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
  query[(__bridge id)kSecAttrService] = kService;
  query[(__bridge id)kSecAttrAccount] = account;
  query[(__bridge id)kSecAttrSynchronizable] = @NO;
  query[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
  return query;
}

SecAccessControlRef CreateRequiredAccessControl(KeychainError &error) {
  CFErrorRef access_error = nullptr;
  SecAccessControlRef access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAccessControlBiometryCurrentSet, &access_error);
  if (access == nullptr) {
    if (access_error != nullptr) {
      CFRelease(access_error);
    }
    SetError(
        error, KeychainStatus::kIo, 0,
        "macOS could not create Sockeye's current-biometry access policy.");
  }
  return access;
}

KeychainStatus StatusForOsStatus(OSStatus status) {
  switch (status) {
  case errSecItemNotFound:
    return KeychainStatus::kNotFound;
  case errSecAuthFailed:
  case errSecInteractionNotAllowed:
  case errSecUserCanceled:
    return KeychainStatus::kDenied;
  case errSecNotAvailable:
    return KeychainStatus::kUnavailable;
  default:
    return KeychainStatus::kIo;
  }
}

void SetOsError(KeychainError &error, OSStatus status,
                std::string_view operation) {
  const KeychainStatus mapped = StatusForOsStatus(status);
  if (status == errSecMissingEntitlement) {
    SetError(error, mapped, static_cast<int>(status),
             std::string(operation) +
                 " failed because the signed application, embedded profile, "
                 "and Keychain access group do not match. Install the complete "
                 "notarized Sockeye application bundle.");
    return;
  }
  SetError(error, mapped, static_cast<int>(status),
           std::string(operation) + " failed in macOS Keychain.");
}

} // namespace

KeychainStatus InspectBiometricReadiness(KeychainError &error) {
  @autoreleasepool {
    LAContext *context = [[LAContext alloc] init];
    context.interactionNotAllowed = YES;
    NSError *failure = nil;
    const BOOL available = [context
        canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                    error:&failure];
    const bool touch_id = context.biometryType == LABiometryTypeTouchID;
    [context invalidate];
    if (available && touch_id) {
      error = {};
      return error.status;
    }
    const int code = static_cast<int>(failure.code);
    if (available || ([failure.domain isEqualToString:LAErrorDomain] &&
        (code == LAErrorBiometryNotAvailable ||
         code == LAErrorBiometryNotEnrolled || code == LAErrorBiometryLockout))) {
      SetError(error, KeychainStatus::kUnavailable, code,
               "Use a Mac with Touch ID, enroll a fingerprint, and unlock the device before retrying.");
    } else {
      SetError(error, KeychainStatus::kIo, code,
               "macOS could not determine biometric readiness; retry from the unlocked local session.");
    }
    return error.status;
  }
}

KeychainStatus InspectCredentialPolicy(std::string_view binding_id,
                                      KeychainError &error) {
  @autoreleasepool {
    if (!IsCredentialBindingId(binding_id)) {
      SetError(error, KeychainStatus::kIo, 0, "Credential binding is invalid.");
      return error.status;
    }
    NSMutableDictionary *query = BaseQuery(binding_id);
    LAContext *context = [[LAContext alloc] init];
    if (query == nil || context == nil) {
      SetError(error, KeychainStatus::kIo, 0,
               "Credential metadata context is unavailable; retry locally.");
      return error.status;
    }
    KeychainError policy_error;
    SecAccessControlRef required = CreateRequiredAccessControl(policy_error);
    if (required == nullptr) {
      SetError(error, KeychainStatus::kIo, policy_error.os_status,
               "Credential metadata lacks a verifiable access policy; inspect it manually.");
      return error.status;
    }
    context.interactionNotAllowed = YES;
    query[(__bridge id)kSecUseAuthenticationContext] = context;
    query[(__bridge id)kSecAttrAccessControl] = (__bridge id)required;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecReturnData] = @NO;
    CFTypeRef result = nullptr;
    const OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    CFRelease(required);
    if (status == errSecItemNotFound) {
      NSMutableDictionary *different_policy_query = BaseQuery(binding_id);
      different_policy_query[(__bridge id)kSecUseAuthenticationContext] = context;
      different_policy_query[(__bridge id)kSecMatchLimit] =
          (__bridge id)kSecMatchLimitOne;
      different_policy_query[(__bridge id)kSecReturnAttributes] = @YES;
      different_policy_query[(__bridge id)kSecReturnData] = @NO;
      CFTypeRef different_policy_result = nullptr;
      const OSStatus different_policy_status = SecItemCopyMatching(
          (__bridge CFDictionaryRef)different_policy_query,
          &different_policy_result);
      if (different_policy_result != nullptr) {
        CFRelease(different_policy_result);
      }
      if (different_policy_status == errSecSuccess) {
        [context invalidate];
        SetError(error, KeychainStatus::kInvalidPolicy, 0,
                 "Credential policy differs from the required current-biometry device-only policy.");
        return error.status;
      }
    }
    [context invalidate];
    if (status != errSecSuccess || result == nullptr ||
        CFGetTypeID(result) != CFDictionaryGetTypeID()) {
      if (result != nullptr) CFRelease(result);
      if (status == errSecMissingEntitlement) {
        SetOsError(error, status, "Credential metadata inspection");
      } else if (status != errSecSuccess) {
        SetError(error,
                 status == errSecItemNotFound ? KeychainStatus::kNotFound
                                              : KeychainStatus::kIo,
                 static_cast<int>(status),
                 "Credential metadata could not be verified without authentication.");
      } else {
        SetError(error, KeychainStatus::kIo, static_cast<int>(status),
                 "Credential metadata could not be verified without authentication.");
      }
      return error.status;
    }
    CFDictionaryRef item = static_cast<CFDictionaryRef>(result);
    CFTypeRef access = CFDictionaryGetValue(item, kSecAttrAccessControl);
    CFTypeRef marker = CFDictionaryGetValue(item, kSecAttrGeneric);
    if (access == nullptr ||
        CFGetTypeID(access) != SecAccessControlGetTypeID()) {
      SetError(error, KeychainStatus::kIo, policy_error.os_status,
               "Credential metadata lacks a verifiable access policy; inspect it manually.");
    } else if (marker == nullptr ||
               !CFEqual(marker, (__bridge CFDataRef)PolicyMarkerData())) {
      SetError(error, KeychainStatus::kInvalidPolicy, 0,
               "Credential policy differs from the required current-biometry device-only policy.");
    } else {
      error = {};
    }
    CFRelease(result);
    return error.status;
  }
}

struct AuthorizationContext::Impl {
  LAContext *context = [[LAContext alloc] init];
  bool authenticated = false;
};

AuthorizationContext::AuthorizationContext() : impl_(std::make_unique<Impl>()) {
  impl_->context.touchIDAuthenticationAllowableReuseDuration = 0.0;
  impl_->context.localizedCancelTitle = @"Cancel";
  impl_->context.localizedFallbackTitle = @"";
}

AuthorizationContext::~AuthorizationContext() { Invalidate(); }

bool AuthorizationContext::Authenticate(std::string_view reason,
                                        KeychainError &error) {
  return AuthenticateWithEvents(reason, error, {});
}

LAContext* AuthorizationContext::NativeContext() { return impl_->context; }

bool AuthorizationContext::AuthenticateWithEvents(
    std::string_view reason, KeychainError &error,
    const std::function<void()>& process_events) {
  if (impl_->authenticated) {
    SetError(error, KeychainStatus::kDenied, 0,
             "Authentication refused: this context has already been used.");
    return false;
  }
  NSString *localized_reason = MakeString(reason);
  if (localized_reason == nil || localized_reason.length == 0) {
    SetError(error, KeychainStatus::kIo, 0,
             "Authentication failed: approval reason is not valid UTF-8.");
    return false;
  }

  NSError *capability_error = nil;
  if (![impl_->context
          canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                      error:&capability_error]) {
    const int code = static_cast<int>(capability_error.code);
    SetError(error, KeychainStatus::kUnavailable, code,
             "Authentication unavailable: Touch ID with enrolled biometry is "
             "required.");
    return false;
  }

  dispatch_semaphore_t completed = dispatch_semaphore_create(0);
  __block BOOL approved = NO;
  __block NSError *reply_error = nil;
  [impl_->context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                 localizedReason:localized_reason
                           reply:^(BOOL success, NSError *returned_error) {
                             approved = success;
                             reply_error = returned_error;
                             dispatch_semaphore_signal(completed);
                           }];
  if (process_events) {
    while (dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_MSEC)) != 0) {
      process_events();
    }
  } else {
    dispatch_semaphore_wait(completed, DISPATCH_TIME_FOREVER);
  }
  if (!approved) {
    const int code = static_cast<int>(reply_error.code);
    SetError(error, KeychainStatus::kDenied, code,
             "Authentication denied: Touch ID did not approve this Sockeye "
             "manifest.");
    return false;
  }
  impl_->authenticated = true;
  error = {};
  return true;
}

void AuthorizationContext::Invalidate() {
  if (impl_ != nullptr && impl_->context != nil) {
    [impl_->context invalidate];
    impl_->authenticated = false;
  }
}

KeychainStatus ReadCredential(AuthorizationContext &context,
                              std::string_view binding_id, SecretBuffer &output,
                              KeychainError &error) {
  @autoreleasepool {
    if (!context.impl_->authenticated || !output.IsLocked()) {
      SetError(error, KeychainStatus::kDenied, 0,
               "Credential read refused: an authenticated locked-memory "
               "context is required.");
      return error.status;
    }
    NSMutableDictionary *query = BaseQuery(binding_id);
    if (query == nil) {
      SetError(error, KeychainStatus::kIo, 0,
               "Credential read failed: binding is invalid.");
      return error.status;
    }
    query[(__bridge id)kSecAttrGeneric] = PolicyMarkerData();
    KeychainError policy_error;
    SecAccessControlRef required_access =
        CreateRequiredAccessControl(policy_error);
    if (required_access == nullptr) {
      SetError(error, KeychainStatus::kIo, policy_error.os_status,
               "Credential read failed: required access policy is unavailable.");
      return error.status;
    }
    query[(__bridge id)kSecAttrAccessControl] = (__bridge id)required_access;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecUseAuthenticationContext] = context.impl_->context;

    CFTypeRef result = nullptr;
    const OSStatus status =
        SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    CFRelease(required_access);
    if (status == errSecItemNotFound) {
      NSMutableDictionary *legacy_query = BaseQuery(binding_id);
      legacy_query[(__bridge id)kSecMatchLimit] =
          (__bridge id)kSecMatchLimitOne;
      legacy_query[(__bridge id)kSecReturnAttributes] = @YES;
      CFTypeRef legacy_result = nullptr;
      const OSStatus legacy_status = SecItemCopyMatching(
          (__bridge CFDictionaryRef)legacy_query, &legacy_result);
      if (legacy_result != nullptr) {
        CFRelease(legacy_result);
      }
      if (legacy_status == errSecSuccess) {
        SetError(error, KeychainStatus::kInvalidPolicy,
                 static_cast<int>(legacy_status),
                 "Credential read refused: item does not carry Sockeye's "
                 "biometric policy marker; store it again with Sockeye.");
        return error.status;
      }
    }
    if (status != errSecSuccess || result == nullptr) {
      if (result != nullptr) {
        CFRelease(result);
      }
      if (status == errSecSuccess) {
        output.Clear();
        SetError(error, KeychainStatus::kIo, 0,
                 "Credential read failed: macOS returned no Keychain result.");
      } else {
        SetOsError(error, status, "Credential read");
      }
      return error.status;
    }

    if (CFGetTypeID(result) != CFDictionaryGetTypeID()) {
      CFRelease(result);
      SetError(error, KeychainStatus::kIo, 0,
               "Credential read failed: macOS returned an unexpected Keychain "
               "result type.");
      return error.status;
    }
    CFDictionaryRef item = static_cast<CFDictionaryRef>(result);
    CFTypeRef returned_access =
        CFDictionaryGetValue(item, kSecAttrAccessControl);
    const bool policy_matches =
        returned_access != nullptr &&
        CFGetTypeID(returned_access) == SecAccessControlGetTypeID();
    if (!policy_matches) {
      CFRelease(result);
      SetError(error, KeychainStatus::kInvalidPolicy, 0,
               "Credential read refused: item does not have Sockeye's exact "
               "current-biometry, device-only access policy; store it again "
               "with Sockeye.");
      return error.status;
    }

    CFTypeRef returned_data = CFDictionaryGetValue(item, kSecValueData);
    if (returned_data == nullptr ||
        CFGetTypeID(returned_data) != CFDataGetTypeID()) {
      CFRelease(result);
      SetError(error, KeychainStatus::kIo, 0,
               "Credential read failed: macOS returned no credential data.");
      return error.status;
    }
    CFDataRef data = static_cast<CFDataRef>(returned_data);
    const CFIndex length = CFDataGetLength(data);
    const UInt8 *bytes = CFDataGetBytePtr(data);
    const bool assigned =
        length > 0 &&
        static_cast<std::uint64_t>(length) <=
            static_cast<std::uint64_t>(SecretBuffer::kCapacity) &&
        output.Assign(bytes, static_cast<std::size_t>(length));
    CFRelease(result);
    if (!assigned) {
      output.Clear();
      SetError(error, KeychainStatus::kIo, 0,
               "Credential read failed: value is empty, oversized, or locked "
               "memory is unavailable.");
      return error.status;
    }
    error = {};
    return KeychainStatus::kSuccess;
  }
}

KeychainStatus StoreCredential(AuthorizationContext &context,
                               std::string_view binding_id,
                               const SecretBuffer &value,
                               KeychainError &error) {
  @autoreleasepool {
    if (!context.impl_->authenticated || !value.IsLocked() ||
        value.Size() == 0) {
      SetError(error, KeychainStatus::kDenied, 0,
               "Credential store refused: an authenticated non-empty "
               "locked-memory value is required.");
      return error.status;
    }
    if (BaseQuery(binding_id) == nil) {
      SetError(error, KeychainStatus::kIo, 0,
               "Credential store failed: binding is invalid.");
      return error.status;
    }

    SecAccessControlRef access = CreateRequiredAccessControl(error);
    if (access == nullptr) {
      return error.status;
    }

    NSData *secret =
        [NSData dataWithBytesNoCopy:const_cast<unsigned char *>(value.Data())
                             length:value.Size()
                       freeWhenDone:NO];
    NSMutableDictionary *item = BaseQuery(binding_id);
    item[(__bridge id)kSecAttrAccessControl] = (__bridge id)access;
    item[(__bridge id)kSecAttrGeneric] = PolicyMarkerData();
    item[(__bridge id)kSecUseAuthenticationContext] = context.impl_->context;
    item[(__bridge id)kSecValueData] = secret;
    const OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, nullptr);
    CFRelease(access);
    if (status == errSecDuplicateItem) {
      SetError(error, KeychainStatus::kConflict, static_cast<int>(status),
               "Credential store refused: the selected protected binding already exists.");
      return error.status;
    }
    if (status != errSecSuccess) {
      SetOsError(error, status, "Credential store");
      return error.status;
    }
    error = {};
    return KeychainStatus::kSuccess;
  }
}

KeychainStatus ReplaceCredential(AuthorizationContext &context,
                                 std::string_view binding_id,
                                 const SecretBuffer &value,
                                 KeychainError &error) {
  @autoreleasepool {
    if (!context.impl_->authenticated || !value.IsLocked() ||
        value.Size() == 0) {
      SetError(error, KeychainStatus::kDenied, 0,
               "Credential replacement refused: an authenticated non-empty "
               "locked-memory value is required.");
      return error.status;
    }
    NSMutableDictionary *query = BaseQuery(binding_id);
    if (query == nil) {
      SetError(error, KeychainStatus::kIo, 0,
               "Credential replacement failed: binding is invalid.");
      return error.status;
    }
    query[(__bridge id)kSecAttrGeneric] = PolicyMarkerData();
    KeychainError policy_error;
    SecAccessControlRef required_access =
        CreateRequiredAccessControl(policy_error);
    if (required_access == nullptr) {
      SetError(error, KeychainStatus::kIo, policy_error.os_status,
               "Credential replacement failed: required access policy is unavailable.");
      return error.status;
    }
    query[(__bridge id)kSecAttrAccessControl] = (__bridge id)required_access;
    query[(__bridge id)kSecUseAuthenticationContext] =
        context.impl_->context;
    NSData *secret =
        [NSData dataWithBytesNoCopy:const_cast<unsigned char *>(value.Data())
                             length:value.Size()
                       freeWhenDone:NO];
    NSDictionary *updates = @{(__bridge id)kSecValueData : secret};
    const OSStatus status =
        SecItemUpdate((__bridge CFDictionaryRef)query,
                      (__bridge CFDictionaryRef)updates);
    CFRelease(required_access);
    if (status != errSecSuccess) {
      SetOsError(error, status, "Credential replacement");
      return error.status;
    }
    error = {};
    return KeychainStatus::kSuccess;
  }
}

KeychainStatus DeleteCredential(AuthorizationContext &context,
                                std::string_view binding_id,
                                KeychainError &error) {
  @autoreleasepool {
    if (!context.impl_->authenticated) {
      SetError(
          error, KeychainStatus::kDenied, 0,
          "Credential delete refused: an authenticated context is required.");
      return error.status;
    }
    NSMutableDictionary *query = BaseQuery(binding_id);
    if (query == nil) {
      SetError(error, KeychainStatus::kIo, 0,
               "Credential delete failed: binding is invalid.");
      return error.status;
    }
    query[(__bridge id)kSecAttrGeneric] = PolicyMarkerData();
    query[(__bridge id)kSecUseAuthenticationContext] = context.impl_->context;
    const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
      SetOsError(error, status, "Credential delete");
      return error.status;
    }
    error = {};
    return KeychainStatus::kSuccess;
  }
}

} // namespace sockeye
