#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <LocalAuthenticationEmbeddedUI/LocalAuthenticationEmbeddedUI.h>
#import <QuartzCore/QuartzCore.h>
#include "fingerprint-atlas.generated.h"

#include "sockeye/approval-prompt.h"
#include "sockeye/input-policy.h"

#include <algorithm>
#include <string>

@interface SockeyeDetailCopyButton : NSButton
@property(copy) NSString* payload;
- (void)copyDetail:(id)sender;
@end

@interface SockeyePanelButton : NSButton
@property NSModalResponse response;
- (void)finishModal:(id)sender;
@end

@implementation SockeyePanelButton
- (void)finishModal:(id)sender {
  (void)sender;
  [NSApp stopModalWithCode:self.response];
}
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

@interface SockeyeFingerprintView : NSView
@property(nonatomic, strong) NSArray* frames;
@property(nonatomic, strong) NSArray<NSNumber*>* times;
- (void)animateSuccess;
@end

@implementation SockeyeFingerprintView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self == nil) return nil;
  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
  NSData* data = [NSData dataWithBytes:kFingerprintAtlas length:sizeof(kFingerprintAtlas)];
  NSImage* image = [[NSImage alloc] initWithData:data];
  CGImageRef atlas = [image CGImageForProposedRect:nullptr context:nil hints:nil];
  NSMutableArray* frames = [NSMutableArray arrayWithCapacity:kFingerprintFrameCount];
  NSMutableArray<NSNumber*>* times = [NSMutableArray arrayWithCapacity:kFingerprintFrameCount];
  const CGFloat tile = static_cast<CGFloat>(CGImageGetWidth(atlas)) / 8;
  for (NSUInteger index = 0; index < kFingerprintFrameCount; ++index) {
    CGRect rect = CGRectMake(static_cast<CGFloat>(index % 8) * tile,
                             static_cast<CGFloat>(index / 8) * tile, tile, tile);
    CGImageRef tileImage = CGImageCreateWithImageInRect(atlas, rect);
    [frames addObject:(__bridge id)tileImage];
    [times addObject:@(static_cast<double>(index) / static_cast<double>(kFingerprintFrameCount))];
    CGImageRelease(tileImage);
  }
  self.frames = frames;
  self.times = times;
  self.layer.contents = frames.firstObject;
  self.layer.contentsGravity = kCAGravityResizeAspect;
  self.layer.minificationFilter = kCAFilterTrilinear;
  return self;
}
- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
- (void)animateSuccess {
  const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.layer.contents = self.frames.lastObject;
  [CATransaction commit];
  if (!reduceMotion) {
    CAKeyframeAnimation* scan = [CAKeyframeAnimation animationWithKeyPath:@"contents"];
    scan.values = self.frames;
    scan.keyTimes = self.times;
    scan.duration = kFingerprintDuration;
    scan.calculationMode = kCAAnimationDiscrete;
    [self.layer addAnimation:scan forKey:@"fingerprintScan"];
  }
}
@end

namespace sockeye {
namespace {

NSPanel* RequestPanel(CGFloat width, CGFloat height, NSString* title) {
  NSPanel* panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  panel.titleVisibility = NSWindowTitleHidden;
  panel.titlebarAppearsTransparent = YES;
  panel.movableByWindowBackground = YES;
  panel.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace;
  NSTextField* heading = [NSTextField wrappingLabelWithString:title];
  heading.frame = NSMakeRect(20, height - 60, width - 40, 40);
  heading.font = [NSFont boldSystemFontOfSize:14];
  heading.alignment = NSTextAlignmentCenter;
  heading.toolTip = title;
  [panel.contentView addSubview:heading];
  return panel;
}

SockeyePanelButton* PanelButton(NSPanel* panel, NSString* title, NSRect frame,
                                NSModalResponse response) {
  SockeyePanelButton* button = [[SockeyePanelButton alloc] initWithFrame:frame];
  button.title = title;
  button.bezelStyle = NSBezelStyleRounded;
  button.response = response;
  button.target = button;
  button.action = @selector(finishModal:);
  [panel.contentView addSubview:button];
  return button;
}

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
  [rows addObject:@[@"executable.path", executable, copy_value, executable_help]];
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
  NSScreen* screen = NSApp.mainWindow.screen != nil ? NSApp.mainWindow.screen : NSScreen.mainScreen;
  const CGFloat width = MIN(720, screen.visibleFrame.size.width - 48);
  const CGFloat buttonWidth = 140;
  const CGFloat valueWidth = width - 24 - buttonWidth - 12;
  NSFont* font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
  NSView* document = [[SockeyeDetailRowsView alloc] initWithFrame:NSMakeRect(0, 0, width - 24, static_cast<CGFloat>(rows.count) * 54 + 8)];
  CGFloat top = 4;
  for (NSArray<NSString*>* row in rows) {
    SockeyeDetailCopyButton* button = [[SockeyeDetailCopyButton alloc]
        initWithFrame:NSMakeRect(0, top + 1, buttonWidth, 24)];
    button.title = row[0];
    button.image = [NSImage imageWithSystemSymbolName:@"doc.on.doc" accessibilityDescription:@"Copy"];
    button.imagePosition = NSImageLeft;
    button.font = [NSFont systemFontOfSize:11];
    button.alignment = NSTextAlignmentLeft;
    button.bezelStyle = NSBezelStyleRounded;
    button.payload = row[2];
    button.target = button;
    button.action = @selector(copyDetail:);
    button.toolTip = [@"Copy " stringByAppendingString:row[0]];
    button.accessibilityLabel = button.toolTip;
    [document addSubview:button];
    NSString* shown = row[1];
    CGFloat estimated = MAX(30, ceil(static_cast<CGFloat>(shown.length) * 6.6 / valueWidth) * 15 + 4);
    NSTextField* value = [NSTextField labelWithString:shown];
    value.frame = NSMakeRect(buttonWidth + 12, top, valueWidth, estimated);
    value.font = font;
    value.selectable = YES;
    value.maximumNumberOfLines = 0;
    value.lineBreakMode = NSLineBreakByCharWrapping;
    value.usesSingleLineMode = NO;
    NSTextFieldCell* valueCell = (NSTextFieldCell*)value.cell;
    valueCell.wraps = YES;
    valueCell.scrollable = NO;
    value.accessibilityLabel = row[0];
    if (row.count > 3 && row[3].length > 0) { value.toolTip = row[3]; value.accessibilityHelp = row[3]; }
    [document addSubview:value];
    top += MAX(30, estimated) + 7;
  }
  document.frame = NSMakeRect(0, 0, width - 24, top + 4);
  const CGFloat height = MIN(top + 4, MAX(180, screen.visibleFrame.size.height - 280));
  NSScrollView* scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
  scroll.wantsLayer = YES;
  scroll.contentView.wantsLayer = YES;
  scroll.contentView.layer.masksToBounds = YES;
  scroll.hasVerticalScroller = YES;
  scroll.hasHorizontalScroller = NO;
  scroll.autohidesScrollers = YES;
  scroll.drawsBackground = NO;
  scroll.documentView = document;
  [scroll.contentView scrollToPoint:NSZeroPoint];
  [scroll reflectScrolledClipView:scroll.contentView];
  return scroll;
}

void ShowDetails(const RunOptions& options, std::string_view request_id) {
  NSScrollView* rows = DetailRowsView(RequestDetailRows(options, request_id));
  const CGFloat width = rows.frame.size.width + 40;
  const CGFloat height = rows.frame.size.height + 120;
  NSPanel* panel = RequestPanel(width, height, @"Request details");
  rows.frame = NSMakeRect(20, 64, rows.frame.size.width, rows.frame.size.height);
  [panel.contentView addSubview:rows];
  NSButton* back = PanelButton(panel, @"« Back", NSMakeRect((width - 100) / 2, 18, 100, 30),
                               NSAlertFirstButtonReturn);
  back.keyEquivalent = @"\r";
  [panel center];
  [NSApp runModalForWindow:panel];
  [panel orderOut:nil];
}

} // namespace

bool ShowApprovalPrompt(const RunOptions& options,
                        std::string_view request_id,
                        AuthorizationContext& context, std::string_view reason,
                        KeychainError& error) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp finishLaunching];
    NSString* credentials = CredentialSummary(options);
    NSString* executable = MakeString(options.executable.canonical_path);
    NSString* child = executable.lastPathComponent;
    NSString* title = [NSString stringWithFormat:@"Allow %@ to use %@?", child, credentials];
    NSPanel* panel = RequestPanel(360, 220, title);
    NSButton* cancel = PanelButton(panel, @"Cancel", NSMakeRect(62, 18, 112, 30),
                                   NSAlertFirstButtonReturn);
    cancel.keyEquivalent = @"\033";
    PanelButton(panel, @"Details", NSMakeRect(186, 18, 112, 30), NSAlertSecondButtonReturn);
    NSTextField* instruction = [NSTextField labelWithString:@"Touch ID to continue."];
    instruction.frame = NSMakeRect(20, 140, 320, 20);
    instruction.alignment = NSTextAlignmentCenter;
    instruction.textColor = NSColor.secondaryLabelColor;
    [panel.contentView addSubview:instruction];
    LAAuthenticationView* authenticationView = [[LAAuthenticationView alloc]
        initWithContext:context.NativeContext() controlSize:NSControlSizeRegular];
    authenticationView.frame = NSMakeRect(148, 68, 64, 64);
    [panel.contentView addSubview:authenticationView];
    SockeyeFingerprintView* fingerprint = [[SockeyeFingerprintView alloc]
        initWithFrame:authenticationView.frame];
    fingerprint.accessibilityLabel = @"Touch ID required";
    [panel.contentView addSubview:fingerprint positioned:NSWindowAbove relativeTo:authenticationView];
    [panel center];
    [NSApp activateIgnoringOtherApps:YES];
    [panel makeKeyAndOrderFront:nil];
    NSModalSession session = [NSApp beginModalSessionForWindow:panel];
    bool cancelled = false;
    const bool authenticated = context.AuthenticateWithEvents(reason, error, [&] {
      if (cancelled) return;
      const NSModalResponse response = [NSApp runModalSession:session];
      if (response == NSModalResponseContinue) return;
      if (response == NSAlertSecondButtonReturn) {
        [NSApp endModalSession:session];
        ShowDetails(options, request_id);
        [panel makeKeyAndOrderFront:nil];
        session = [NSApp beginModalSessionForWindow:panel];
        return;
      }
      cancelled = true;
      context.Invalidate();
    });
    if (authenticated && !cancelled) {
      fingerprint.accessibilityLabel = @"Touch ID verified";
      instruction.stringValue = @"Verified.";
      [fingerprint animateSuccess];
      const NSTimeInterval duration =
          NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion ? 0.18 : kFingerprintDuration + 0.12;
      NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:duration];
      while (deadline.timeIntervalSinceNow > 0) {
        const NSModalResponse response = [NSApp runModalSession:session];
        if (response == NSAlertSecondButtonReturn) {
          [NSApp endModalSession:session];
          ShowDetails(options, request_id);
          [panel makeKeyAndOrderFront:nil];
          session = [NSApp beginModalSessionForWindow:panel];
          continue;
        }
        if (response != NSModalResponseContinue) {
          cancelled = true;
          break;
        }
        [NSRunLoop.currentRunLoop runUntilDate:
            [NSDate dateWithTimeIntervalSinceNow:MIN(0.01, deadline.timeIntervalSinceNow)]];
      }
    }
    [NSApp endModalSession:session];
    [panel orderOut:nil];
    if (cancelled) {
      context.Invalidate();
      error.status = KeychainStatus::kDenied;
      error.detail = "Approval cancelled.";
      return false;
    }
    return authenticated;
  }
}

} // namespace sockeye
