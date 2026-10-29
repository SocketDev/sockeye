#ifndef SOCKEYE_KEYCHAIN_TEST_FAKES_H
#define SOCKEYE_KEYCHAIN_TEST_FAKES_H
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include <vector>

struct KeychainFakeState {
  bool context_initialization_failure = false;
  bool available = true;
  bool approved = true;
  bool policy_failure = false;
  bool policy_error_object = false;
  bool require_access_control_query = false;
  LABiometryType biometry = LABiometryTypeTouchID;
  NSInteger error_code = LAErrorBiometryNotAvailable;
  NSString* error_domain = LAErrorDomain;
  std::vector<OSStatus> query_statuses = {errSecSuccess};
  std::size_t query_index = 0;
  id query_result = nil;
  id query_failure_result = nil;
  OSStatus add_status = errSecSuccess;
  OSStatus update_status = errSecSuccess;
  OSStatus delete_status = errSecSuccess;
  int evaluations = 0;
  int invalidations = 0;
  int additions = 0;
  int updates = 0;
  int deletions = 0;
  NSDictionary* last_query = nil;
  NSDictionary* last_item = nil;
};
extern KeychainFakeState keychain_state;
NSData* KeychainPolicyFixture();
NSData* KeychainReturnedPolicyFixture();
void ResetKeychainFake();

@interface SockeyeTestLAContext : NSObject
@property NSTimeInterval touchIDAuthenticationAllowableReuseDuration;
@property(copy) NSString* localizedCancelTitle;
@property(copy) NSString* localizedFallbackTitle;
@property BOOL interactionNotAllowed;
@property(readonly) LABiometryType biometryType;
- (BOOL)canEvaluatePolicy:(LAPolicy)policy error:(NSError**)error;
- (void)evaluatePolicy:(LAPolicy)policy
       localizedReason:(NSString*)reason
                 reply:(void (^)(BOOL, NSError*))reply;
- (void)invalidate;
@end

OSStatus SockeyeTestCopyMatching(CFDictionaryRef query, CFTypeRef* result);
OSStatus SockeyeTestAdd(CFDictionaryRef item, CFTypeRef* result);
OSStatus SockeyeTestUpdate(CFDictionaryRef query, CFDictionaryRef updates);
OSStatus SockeyeTestDelete(CFDictionaryRef query);
SecAccessControlRef SockeyeTestCreateAccess(CFAllocatorRef allocator,
                                            CFTypeRef protection,
                                            SecAccessControlCreateFlags flags,
                                            CFErrorRef* error);
CFTypeID SockeyeTestAccessType();

#define LAContext SockeyeTestLAContext
#define SecItemCopyMatching SockeyeTestCopyMatching
#define SecItemAdd SockeyeTestAdd
#define SecItemUpdate SockeyeTestUpdate
#define SecItemDelete SockeyeTestDelete
#define SecAccessControlCreateWithFlags SockeyeTestCreateAccess
#define SecAccessControlGetTypeID SockeyeTestAccessType
#endif
