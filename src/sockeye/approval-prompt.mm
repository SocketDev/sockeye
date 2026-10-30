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
  NSView* accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 520, 300)];
  NSScrollView* scroll =
      [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 36, 520, 264)];
  scroll.hasVerticalScroller = YES;
  scroll.borderType = NSBezelBorder;
  NSTextView* text = [[NSTextView alloc] initWithFrame:scroll.contentView.bounds];
  text.string = MakeString(information);
  text.editable = NO;
  text.selectable = YES;
  text.richText = NO;
  text.font = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];
  text.textContainerInset = NSMakeSize(8, 8);
  text.verticallyResizable = YES;
  text.horizontallyResizable = NO;
  text.autoresizingMask = NSViewWidthSizable;
  text.textContainer.widthTracksTextView = YES;
  scroll.documentView = text;
  [accessory addSubview:scroll];

  SockeyeRequestIdCopier* copier __attribute__((objc_precise_lifetime)) =
      [[SockeyeRequestIdCopier alloc] initWithRequestId:request_id];
  NSButton* copy_button = [NSButton buttonWithTitle:@"Copy requestId"
                                          target:copier
                                          action:@selector(copyRequestId:)];
  [copy_button sizeToFit];
  [accessory addSubview:copy_button];
  details.accessoryView = accessory;
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
    alert.informativeText = @"For this command only.";
    [alert addButtonWithTitle:@"Approve with Touch ID"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert addButtonWithTitle:@"Details"];

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
