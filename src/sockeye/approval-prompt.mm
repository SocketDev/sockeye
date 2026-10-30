#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include "sockeye/approval-prompt.h"
#include "sockeye/input-policy.h"

#include <algorithm>
#include <string>

@interface SockeyeDetailCopyButton : NSButton
@property(copy) NSString* payload;
- (void)copyDetail:(id)sender;
@end

@implementation SockeyeDetailCopyButton
- (void)copyDetail:(id)sender {
  (void)sender;
  if (self.payload == nil) {
    return;
  }
  NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  [pasteboard setString:self.payload forType:NSPasteboardTypeString];
}
@end

@interface SockeyeDetailRowsView : NSView
@end

@implementation SockeyeDetailRowsView
- (BOOL)isFlipped { return YES; }
@end

namespace sockeye {
namespace {

NSString* MakeString(std::string_view value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}

NSString* VisibleString(std::string_view value, NSString** copy_value) {
  NSString* original = MakeString(value);
  if (original != nil) {
    *copy_value = original;
    return MakeString(VisibleArgument(value));
  }
  NSString* escaped_value = MakeString(VisibleArgument(value));
  *copy_value = escaped_value;
  return escaped_value;
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

NSString* EscapeJsonNonAscii(NSString* json) {
  NSMutableString* escaped = [NSMutableString stringWithCapacity:json.length];
  for (NSUInteger index = 0; index < json.length; ++index) {
    const unichar character = [json characterAtIndex:index];
    if (character > 0x7f) {
      [escaped appendFormat:@"\\u%04x", character];
    } else {
      [escaped appendFormat:@"%C", character];
    }
  }
  return escaped;
}

NSString* DetailArray(const std::vector<std::string>& values,
                      NSString** copy_value, BOOL* used_fallback) {
  NSMutableArray<NSString*>* items = [NSMutableArray array];
  for (const std::string& value : values) {
    NSString* item = MakeString(value);
    if (item == nil) {
      *used_fallback = YES;
      item = MakeString(VisibleArgument(value));
    }
    [items addObject:item];
  }
  NSData* json = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
  NSString* encoded = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  *copy_value = encoded;
  return EscapeJsonNonAscii(encoded);
}

NSArray<NSArray<NSString*>*>* RequestDetailRows(
    const RunOptions& options, std::string_view request_id) {
  NSMutableArray<NSArray<NSString*>*>* rows = [NSMutableArray array];
  NSString* copy_value = nil;
  NSString* request_value = MakeString(request_id);
  NSString* full_request = [@"sha256:" stringByAppendingString:
      request_value != nil ? request_value : @""];
  [rows addObject:@[@"requestId", full_request, full_request]];
  NSString* cwd = VisibleString(options.working_directory.canonical_path, &copy_value);
  NSString* cwd_help = MakeString(options.working_directory.canonical_path) == nil
      ? @"Invalid UTF-8 bytes are shown as escaped bytes." : @"";
  [rows addObject:@[@"cwd", cwd, copy_value, cwd_help]];
  NSString* executable = VisibleString(options.executable.canonical_path, &copy_value);
  NSString* executable_help = MakeString(options.executable.canonical_path) == nil
      ? @"Invalid UTF-8 bytes are shown as escaped bytes." : @"";
  [rows addObject:@[@"executable", executable, copy_value, executable_help]];
  NSString* executable_digest = MakeString(DigestHex(options.executable));
  [rows addObject:@[@"executable.sha256", executable_digest, executable_digest, @""]];
  for (std::size_t index = 0; index < options.bound_files.size(); ++index) {
    const FileIdentity& file = options.bound_files[index];
    NSString* label = [NSString stringWithFormat:@"file[%zu]", index];
    NSString* path = VisibleString(file.canonical_path, &copy_value);
    NSString* path_help = MakeString(file.canonical_path) == nil
        ? @"Invalid UTF-8 bytes are shown as escaped bytes." : @"";
    [rows addObject:@[label, path, copy_value, path_help]];
    NSString* digest = MakeString(DigestHex(file));
    [rows addObject:@[[label stringByAppendingString:@".sha256"],
                     digest, digest, @""]];
  }
  for (std::size_t index = 0; index < options.credentials.size(); ++index) {
    const CredentialRequest& credential = options.credentials[index];
    NSString* suffix = options.credentials.size() == 1
        ? @"" : [NSString stringWithFormat:@"[%zu]", index];
    [rows addObject:@[[@"credential" stringByAppendingString:suffix],
                     MakeString(credential.identifier), MakeString(credential.identifier), @""]];
    [rows addObject:@[[@"binding" stringByAppendingString:suffix],
                     MakeString(credential.binding_id), MakeString(credential.binding_id), @""]];
  }
  BOOL used_fallback = NO;
  NSString* environments = DetailArray(options.passed_environment, &copy_value, &used_fallback);
  [rows addObject:@[@"envNames", environments, copy_value,
      used_fallback ? @"Invalid UTF-8 entries are shown as escaped bytes." : @""]];
  used_fallback = NO;
  NSString* arguments = DetailArray(options.child_arguments, &copy_value, &used_fallback);
  [rows addObject:@[@"arguments", arguments, copy_value,
      used_fallback ? @"Invalid UTF-8 entries are shown as escaped bytes." : @""]];
  return rows;
}

NSScrollView* DetailRowsView(NSArray<NSArray<NSString*>*>* rows) {
  NSFont* font = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];
  CGFloat button_width = 150;
  for (NSArray<NSString*>* row in rows) {
    button_width = std::max(button_width,
        [([@"Copy " stringByAppendingString:row[0]]) sizeWithAttributes:@{NSFontAttributeName:[NSFont systemFontOfSize:NSFont.systemFontSize]}].width + 24);
  }
  CGFloat value_width = 580;
  for (NSArray<NSString*>* row in rows) {
    value_width = std::max(value_width,
        [row[1] sizeWithAttributes:@{NSFontAttributeName:font}].width + 12);
  }
  const CGFloat row_height = 36;
  const CGFloat height = row_height * static_cast<CGFloat>(rows.count) + 8;
  NSScreen* screen = NSApp.mainWindow.screen;
  if (screen == nil) {
    screen = NSScreen.mainScreen;
  }
  CGFloat available_width = screen.visibleFrame.size.width - 120;
  CGFloat request_width = [@"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      sizeWithAttributes:@{NSFontAttributeName:font}].width;
  CGFloat viewport_width = std::min(available_width,
      std::max(CGFloat(760), button_width + 14 + request_width + 40));
  CGFloat visible_value_width = std::max(CGFloat(160), viewport_width - button_width - 54);
  NSView* document = [[SockeyeDetailRowsView alloc]
      initWithFrame:NSMakeRect(0, 0, button_width + 14 + std::max(value_width, visible_value_width), height)];
  for (NSUInteger index = 0; index < rows.count; ++index) {
    NSArray<NSString*>* row = rows[index];
    const CGFloat top = 4 + row_height * static_cast<CGFloat>(index);
    SockeyeDetailCopyButton* button = [[SockeyeDetailCopyButton alloc]
        initWithFrame:NSMakeRect(0, top, button_width, 28)];
    button.title = [@"Copy " stringByAppendingString:row[0]];
    button.bezelStyle = NSBezelStyleRounded;
    button.payload = row[2];
    button.target = button;
    button.action = @selector(copyDetail:);
    [document addSubview:button];

    NSTextField* value = [NSTextField labelWithString:row[1]];
    value.frame = NSMakeRect(button_width + 14, top + 5, value_width, 22);
    value.font = font;
    value.selectable = YES;
    value.maximumNumberOfLines = 1;
    value.lineBreakMode = NSLineBreakByClipping;
    value.accessibilityLabel = row[0];
    if (row.count > 3 && row[3].length > 0) {
      value.toolTip = row[3];
      value.accessibilityHelp = value.toolTip;
    }
    [document addSubview:value];
  }
  NSScrollView* scroll =
      [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 0, viewport_width,
                                                   std::min(height, CGFloat(360)))];
  scroll.hasVerticalScroller = YES;
  scroll.hasHorizontalScroller = YES;
  scroll.autohidesScrollers = YES;
  scroll.drawsBackground = NO;
  scroll.documentView = document;
  return scroll;
}

void ShowDetails(const RunOptions& options, std::string_view request_id) {
  NSAlert* details = [[NSAlert alloc] init];
  details.messageText = @"Request details";
  details.accessoryView = DetailRowsView(RequestDetailRows(options, request_id));
  [details addButtonWithTitle:@"Back"];
  [details runModal];
}

} // namespace

bool ShowApprovalPrompt(const RunOptions& options,
                        std::string_view request_id) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp finishLaunching];
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

    alert.window.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace;
    [alert.window center];
    [NSApp activateIgnoringOtherApps:YES];
    [alert.window makeKeyAndOrderFront:nil];
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
