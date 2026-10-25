/*
 * keystore_macos.mm — the macOS Keychain backend with a Secure-Enclave-enforced
 * biometric ACL.
 *
 * Secrets are stored as generic-password keychain items. On write we attach an
 * access-control object created with kSecAccessControlBiometryCurrentSet, so the
 * Secure Enclave only releases the value after a successful Touch ID match
 * against the currently-enrolled fingerprints (re-enrolling invalidates the
 * ACL, which is the point — a stolen-then-re-enrolled device can't read it).
 * The biometric prompt is raised automatically by the OS when SecItemCopyMatching
 * touches a biometric-gated item; the daemon never sees or handles the
 * fingerprint.
 *
 * Compiled with -fobjc-arc, so NS objects are ARC-managed; the CoreFoundation
 * handles SecItem* hands back (CFTypeRef, SecAccessControlRef) are NOT, and are
 * released explicitly.
 */

#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include "socketsecurity/keystore-infra/keystore.h"

#include <string.h>

namespace {

// Build the base query dictionary shared by get/put/delete: a generic-password
// item keyed by (service, account), scoped to this device.
NSMutableDictionary* baseQuery(const char* service, const char* account) {
  NSMutableDictionary* q = [NSMutableDictionary dictionary];
  q[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
  q[(__bridge id)kSecAttrService] = [NSString stringWithUTF8String:service];
  q[(__bridge id)kSecAttrAccount] = [NSString stringWithUTF8String:account];
  return q;
}

}  // namespace

static int getImpl(const char* service, const char* account, char* out,
                   size_t out_len, bool silent) {
  @autoreleasepool {
    NSMutableDictionary* q = baseQuery(service, account);
    q[(__bridge id)kSecReturnData] = @YES;
    q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    // The OS raises its default Touch ID sheet for the biometric-gated item. A
    // caller-supplied prompt string (via an LAContext localizedReason on
    // kSecUseAuthenticationContext) is a later refinement when the full auth
    // flow lands; the modern API replaced the now-deprecated
    // kSecUseOperationPrompt.
    if (silent) {
      // Fail closed instead of prompting: a biometric-gated item returns
      // errSecInteractionNotAllowed, a silent item releases its data directly.
      // kSecUseAuthenticationUIFail is deprecated but still honored; the
      // LAContext replacement would force every keystore consumer to link
      // LocalAuthentication, so suppress the deprecation for this one line.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
      q[(__bridge id)kSecUseAuthenticationUI] =
          (__bridge id)kSecUseAuthenticationUIFail;
#pragma clang diagnostic pop
    }

    CFTypeRef result = NULL;
    OSStatus status =
        SecItemCopyMatching((__bridge CFDictionaryRef)q, &result);

    if (status == errSecItemNotFound) {
      return KEYSTORE_ERR_NOT_FOUND;
    }
    // The user cancelled the sheet, biometry failed / isn't available, or a
    // silent read hit a biometric-gated item (interaction not allowed).
    if (status == errSecUserCanceled || status == errSecAuthFailed ||
        status == errSecInteractionNotAllowed) {
      return KEYSTORE_ERR_DENIED;
    }
    if (status != errSecSuccess || result == NULL) {
      return KEYSTORE_ERR_IO;
    }

    // SecItemCopyMatching follows the CF Create Rule (+1 retained), and this
    // file is compiled without ARC, so __bridge_transfer would be a no-op and
    // leak the plaintext secret. Use a non-owning __bridge cast and CFRelease
    // the result explicitly on every return path.
    NSData* data = (__bridge NSData*)result;
    if (data.length + 1 > out_len) {
      CFRelease(result);
      return KEYSTORE_ERR_IO;
    }
    memcpy(out, data.bytes, data.length);
    out[data.length] = '\0';
    CFRelease(result);
    return KEYSTORE_OK;
  }
}

int keystore_get(const char* service, const char* account, char* out,
                 size_t out_len) {
  return getImpl(service, account, out, out_len, /*silent=*/false);
}

int keystore_get_silent(const char* service, const char* account, char* out,
                        size_t out_len) {
  return getImpl(service, account, out, out_len, /*silent=*/true);
}

static int putImpl(const char* service, const char* account, const char* value,
                   bool silent) {
  @autoreleasepool {
    // Replace-on-write: drop any existing value first so SecItemAdd can't
    // collide with errSecDuplicateItem.
    keystore_delete(service, account);

    NSMutableDictionary* item = baseQuery(service, account);
    item[(__bridge id)kSecValueData] =
        [NSData dataWithBytes:value length:strlen(value)];

    SecAccessControlRef access = NULL;
    if (silent) {
      // No access-control object: the item is readable whenever the keychain is
      // unlocked, on this device, with NO biometric prompt. kSecAttrAccessible
      // and kSecAttrAccessControl are mutually exclusive, so set the plain
      // accessibility class here.
      item[(__bridge id)kSecAttrAccessible] =
          (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
    } else {
      CFErrorRef aclError = NULL;
      access = SecAccessControlCreateWithFlags(
          kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          kSecAccessControlBiometryCurrentSet, &aclError);
      if (access == NULL) {
        if (aclError) {
          CFRelease(aclError);
        }
        return KEYSTORE_ERR_IO;
      }
      // kSecAttrAccessControl and kSecAttrAccessible are mutually exclusive; the
      // ACL supplies the accessibility class, so we set only the control.
      item[(__bridge id)kSecAttrAccessControl] = (__bridge id)access;
    }

    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
    if (access != NULL) {
      CFRelease(access);
    }

    return status == errSecSuccess ? KEYSTORE_OK : KEYSTORE_ERR_IO;
  }
}

int keystore_put(const char* service, const char* account, const char* value) {
  return putImpl(service, account, value, /*silent=*/false);
}

int keystore_put_silent(const char* service, const char* account,
                        const char* value) {
  return putImpl(service, account, value, /*silent=*/true);
}

int keystore_delete(const char* service, const char* account) {
  @autoreleasepool {
    NSMutableDictionary* q = baseQuery(service, account);
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)q);
    if (status == errSecSuccess || status == errSecItemNotFound) {
      return KEYSTORE_OK;
    }
    return KEYSTORE_ERR_IO;
  }
}
