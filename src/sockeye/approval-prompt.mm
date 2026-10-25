#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include "sockeye/approval-prompt.h"

#include <string>

@interface SockeyeRequestIdCopier : NSObject {
  std::string request_id_;
}
- (instancetype)initWithRequestId:(std::string_view)request_id;
- (void)copyRequestId:(id)sender;
@end

@implementation SockeyeRequestIdCopier
- (instancetype)initWithRequestId:(std::string_view)request_id {
  self = [super init];
  if (self != nil) {
    request_id_ = std::string(request_id);
  }
  return self;
}

- (void)copyRequestId:(id)sender {
  (void)sender;
  NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  NSString* value = [[NSString alloc] initWithBytes:request_id_.data()
                                            length:request_id_.size()
                                          encoding:NSUTF8StringEncoding];
  if (value != nil) {
    if (!std::string_view(request_id_).starts_with("sha256:")) {
      value = [@"sha256:" stringByAppendingString:value];
    }
    [pasteboard setString:value forType:NSPasteboardTypeString];
  }
}
@end

namespace sockeye {
namespace {

NSString* MakeString(std::string_view value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}

NSString* CredentialSummary(const RunOptions& options) {
  NSMutableArray<NSString*>* names = [NSMutableArray array];
  for (const CredentialRequest& credential : options.credentials) {
    NSString* name = MakeString(credential.identifier);
    if (name != nil) {
      [names addObject:name];
    }
  }
  return [names componentsJoinedByString:@", "];
}

void ShowDetails(const RunOptions& options, std::string_view request_id) {
  NSAlert* details = [[NSAlert alloc] init];
  details.messageText = @"Request details";
  const std::string information = FormatRunRequest(options, request_id, true);
  details.informativeText = MakeString(information);
  [details addButtonWithTitle:@"Back"];
  [details runModal];
}

} // namespace

bool ShowApprovalPrompt(const RunOptions& options,
                        std::string_view request_id) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSAlert* alert = [[NSAlert alloc] init];
    NSString* credentials = CredentialSummary(options);
    NSString* executable = MakeString(options.executable.canonical_path);
    NSString* child = executable.lastPathComponent;
    alert.messageText = [NSString stringWithFormat:@"Allow %@ to use %@?",
                                                   child, credentials];
    alert.informativeText = @"Check the request details.";
    [alert addButtonWithTitle:@"Approve with Touch ID"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert addButtonWithTitle:@"Details"];

    NSView* accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 620, 52)];
    NSTextField* request_label = [[NSTextField alloc]
        initWithFrame:NSMakeRect(0, 27, 620, 22)];
    request_label.stringValue = [NSString stringWithFormat:@"requestId: sha256:%.*s",
                                                               static_cast<int>(request_id.size()),
                                                               request_id.data()];
    request_label.editable = NO;
    request_label.selectable = YES;
    request_label.bezeled = NO;
    request_label.drawsBackground = NO;
    request_label.font = [NSFont monospacedSystemFontOfSize:12
                                                     weight:NSFontWeightRegular];
    [accessory addSubview:request_label];

    NSButton* copy_button = [NSButton buttonWithTitle:@"Copy requestId"
                                                target:nil
                                                action:nil];
    copy_button.frame = NSMakeRect(0, 0, 130, 24);
    SockeyeRequestIdCopier* copier =
        [[SockeyeRequestIdCopier alloc] initWithRequestId:request_id];
    copy_button.target = copier;
    copy_button.action = @selector(copyRequestId:);
    [accessory addSubview:copy_button];
    [alert setAccessoryView:accessory];

    [NSApp activateIgnoringOtherApps:YES];
    for (;;) {
      const NSModalResponse response = [alert runModal];
      if (response == NSAlertThirdButtonReturn) {
        ShowDetails(options, request_id);
        continue;
      }
      if (response != NSAlertFirstButtonReturn) {
        return false;
      }
      return true;
    }
  }
}

} // namespace sockeye
