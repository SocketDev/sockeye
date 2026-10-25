#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

bool ForegroundTerminal() {
  const int terminal = open("/dev/tty", O_RDWR | O_CLOEXEC);
  if (terminal < 0) return false;
  const bool foreground = isatty(terminal) && tcgetpgrp(terminal) == getpgrp();
  close(terminal);
  return foreground;
}

int main(int argc, char **argv) {
  if (argc != 2 || std::strcmp(argv[1], "create-disposable-mismatch") != 0) return 2;
  if (!ForegroundTerminal()) return 2;
  @autoreleasepool {
    LAContext *context = [[LAContext alloc] init];
    context.touchIDAuthenticationAllowableReuseDuration = 0;
    context.localizedFallbackTitle = @"";
    NSError *error = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) return 4;
    dispatch_semaphore_t completed = dispatch_semaphore_create(0);
    __block BOOL approved = NO;
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
            localizedReason:@"Create disposable SOCKEYE_TEST_LIFECYCLE_TOKEN policy mismatch fixture"
                      reply:^(BOOL success, NSError *) {
                        approved = success;
                        dispatch_semaphore_signal(completed);
                      }];
    dispatch_semaphore_wait(completed, DISPATCH_TIME_FOREVER);
    if (!approved || !ForegroundTerminal()) {
      [context invalidate];
      return 4;
    }
    NSDictionary *item = @{
      (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrService: @"dev.socket.sockeye.credentials",
      (__bridge id)kSecAttrAccount: @"SOCKEYE_TEST_LIFECYCLE_TOKEN",
      (__bridge id)kSecAttrSynchronizable: @NO,
      (__bridge id)kSecUseDataProtectionKeychain: @YES,
      (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      (__bridge id)kSecAttrGeneric: [@"sockeye:v1:biometry-current-set" dataUsingEncoding:NSUTF8StringEncoding],
      (__bridge id)kSecValueData: [@"SOCKEYE_FAKE_LIFECYCLE_INITIAL" dataUsingEncoding:NSUTF8StringEncoding],
    };
    const OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, nullptr);
    [context invalidate];
    std::printf("fixture-status:%d\n", static_cast<int>(status));
    return status == errSecSuccess ? 0 : 5;
  }
}
