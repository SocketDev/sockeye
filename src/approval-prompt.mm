#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <LocalAuthenticationEmbeddedUI/LocalAuthenticationEmbeddedUI.h>
#import <QuartzCore/QuartzCore.h>
#include "fingerprint-atlas.generated.h"

#include "approval-prompt.h"
#include "input-policy.h"

#include <algorithm>
#include <cmath>
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
  CGImageRef initialFrame = CGImageCreateWithImageInRect(
      atlas, CGRectMake(0, 0, tile, tile));
  self.layer.contents = (__bridge id)initialFrame;
  CGImageRelease(initialFrame);
  const NSUInteger firstFrame = 8;
  for (NSUInteger index = firstFrame; index < kFingerprintFrameCount; ++index) {
    CGRect rect = CGRectMake(static_cast<CGFloat>(index % 8) * tile,
                             static_cast<CGFloat>(index / 8) * tile, tile, tile);
    CGImageRef tileImage = CGImageCreateWithImageInRect(atlas, rect);
    [frames addObject:(__bridge id)tileImage];
    const double progress = static_cast<double>(index - firstFrame) /
        static_cast<double>(kFingerprintFrameCount - firstFrame - 1);
    double time = progress;
    if (progress > 0 && progress < 1) {
      double lower = 0;
      double upper = 1;
      for (unsigned step = 0; step < 24; ++step) {
        const double middle = (lower + upper) / 2;
        const double remaining = 1 - middle;
        const double eased = middle < 0.5 ? 4 * middle * middle * middle :
            1 - 4 * remaining * remaining * remaining;
        if (0.45 * middle + 0.55 * eased < progress) lower = middle;
        else upper = middle;
      }
      time = (lower + upper) / 2;
    }
    [times addObject:@(time)];
    CGImageRelease(tileImage);
  }
  self.frames = frames;
  self.times = times;
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
    NSMutableArray* activeFrames = [self.frames mutableCopy];
    [activeFrames removeObjectAtIndex:0];
    [activeFrames addObject:self.frames.lastObject];
    scan.values = activeFrames;
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
  heading.identifier = @"RequestHeading";
  heading.frame = NSMakeRect(20, height - 60, width - 40, 40);
  heading.font = [NSFont boldSystemFontOfSize:14];
  heading.alignment = NSTextAlignmentCenter;
  heading.toolTip = title;
  [panel.contentView addSubview:heading];
  return panel;
}

NSTextField* PanelHeading(NSPanel* panel) {
  for (NSView* view in panel.contentView.subviews) {
    if ([view.identifier isEqualToString:@"RequestHeading"]) {
      return (NSTextField*)view;
    }
  }
  return nil;
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

struct PanelSpringPhase {
  CGFloat progress;
  CGFloat displacement;
};

constexpr PanelSpringPhase kPanelSpringPhases[] = {
    {0, 0}, {0.18, 1}, {0.46, -0.5}, {0.74, 1.0 / 6}, {1, 0}};

NSRect CenteredPanelFrame(NSRect frame, CGFloat width, CGFloat height) {
  const CGFloat centerX = NSMidX(frame);
  const CGFloat centerY = NSMidY(frame);
  return NSMakeRect(centerX - width / 2, centerY - height / 2, width, height);
}

CGFloat PanelSpringDisplacement(CGFloat progress) {
  NSUInteger phaseIndex = 1;
  while (phaseIndex < sizeof(kPanelSpringPhases) / sizeof(kPanelSpringPhases[0]) &&
         progress > kPanelSpringPhases[phaseIndex].progress) {
    ++phaseIndex;
  }
  const PanelSpringPhase start = kPanelSpringPhases[phaseIndex - 1];
  const PanelSpringPhase end = kPanelSpringPhases[phaseIndex];
  const CGFloat local = (progress - start.progress) / (end.progress - start.progress);
  const CGFloat eased = (1 - std::cos(3.141592653589793 * local)) / 2;
  return start.displacement + (end.displacement - start.displacement) * eased;
}

void AnimatePanelFrame(NSPanel* panel, NSRect start, NSRect target,
                       BOOL reduceMotion, NSArray<NSView*>* trackingViews,
                       NSArray<NSValue*>* trackingFrames,
                       NSSize trackingContentSize,
                       void (^completion)(void)) {
  if (reduceMotion) {
    [panel setFrame:target display:YES];
    completion();
    return;
  }
  constexpr NSTimeInterval snapDuration = 0.14;
  constexpr NSTimeInterval settleDuration = 0.18;
  const CGFloat widthDelta = target.size.width - start.size.width;
  const CGFloat heightDelta = target.size.height - start.size.height;
  const CGFloat travel = MAX(500, MAX(std::abs(widthDelta), std::abs(heightDelta)));
  const CGFloat overshoot = travel * 0.018;
  const CGFloat widthDirection = widthDelta < 0 ? -1 : 1;
  const CGFloat heightDirection = heightDelta < 0 ? -1 : 1;
  const CGFloat centerX = NSMidX(start);
  const CGFloat centerY = NSMidY(start);
  const CFTimeInterval animationStart = CACurrentMediaTime();
  NSTimer* timer = [NSTimer timerWithTimeInterval:1.0 / 60.0 repeats:YES
      block:^(NSTimer* currentTimer) {
        const NSTimeInterval elapsed = CACurrentMediaTime() - animationStart;
        if (elapsed >= snapDuration + settleDuration) {
          [panel setFrame:target display:YES];
          [currentTimer invalidate];
          completion();
          return;
        }
        CGFloat width = target.size.width;
        CGFloat height = target.size.height;
        if (elapsed < snapDuration) {
          const CGFloat progress = elapsed / snapDuration;
          const CGFloat eased = 1 - std::pow(1 - progress, 3);
          width = start.size.width + widthDelta * eased;
          height = start.size.height + heightDelta * eased;
        } else {
          const CGFloat progress = (elapsed - snapDuration) / settleDuration;
          const CGFloat displacement = PanelSpringDisplacement(progress);
          width += widthDirection * overshoot * displacement;
          height += heightDirection * overshoot * displacement;
        }
        const NSRect frame = NSMakeRect(centerX - width / 2, centerY - height / 2,
                                        width, height);
        [panel setFrame:frame display:YES];
        const CGFloat xOffset =
            (panel.contentView.bounds.size.width - trackingContentSize.width) / 2;
        const CGFloat yOffset =
            (panel.contentView.bounds.size.height - trackingContentSize.height) / 2;
        for (NSUInteger index = 0; index < trackingViews.count; ++index) {
          NSRect viewFrame = trackingFrames[index].rectValue;
          viewFrame.origin.x += xOffset;
          viewFrame.origin.y += yOffset;
          trackingViews[index].frame = viewFrame;
        }
      }];
  [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
}

void AnimateViewAlpha(NSArray<NSView*>* views, CGFloat alpha, BOOL reduceMotion,
                      void (^completion)(void)) {
  if (reduceMotion) {
    for (NSView* view in views) view.alphaValue = alpha;
    completion();
    return;
  }
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext* animation) {
    animation.duration = 0.09;
    animation.timingFunction =
        [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    for (NSView* view in views) [[view animator] setAlphaValue:alpha];
  } completionHandler:^{
    completion();
  }];
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
    button.title = [NSString stringWithFormat:@"\u2009%@", row[0]];
    button.image = [NSImage imageWithSystemSymbolName:@"doc.on.doc" accessibilityDescription:@"Copy"];
    button.imagePosition = NSImageLeft;
    button.imageHugsTitle = NO;
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
    NSPanel* panel = RequestPanel(360, 256, title);
    NSButton* cancel = PanelButton(panel, @"Cancel", NSMakeRect(62, 18, 112, 30),
                                   NSAlertFirstButtonReturn);
    cancel.keyEquivalent = @"\033";
    NSButton* details = PanelButton(panel, @"Details", NSMakeRect(186, 18, 112, 30),
                                    NSAlertSecondButtonReturn);
    details.image = [NSImage imageWithSystemSymbolName:@"chevron.right"
                               accessibilityDescription:@"Expand details"];
    details.imagePosition = NSImageRight;
    details.imageHugsTitle = YES;
    details.toolTip = @"Show request details";
    details.accessibilityLabel = details.toolTip;
    NSTextField* instruction = [NSTextField labelWithString:@"Touch ID to continue."];
    instruction.frame = NSMakeRect(20, 176, 320, 20);
    instruction.alignment = NSTextAlignmentCenter;
    instruction.textColor = NSColor.secondaryLabelColor;
    [panel.contentView addSubview:instruction];
    LAAuthenticationView* authenticationView = [[LAAuthenticationView alloc]
        initWithContext:context.NativeContext() controlSize:NSControlSizeRegular];
    authenticationView.frame = NSMakeRect(132, 72, 96, 96);
    [panel.contentView addSubview:authenticationView];
    SockeyeFingerprintView* fingerprint = [[SockeyeFingerprintView alloc]
        initWithFrame:authenticationView.frame];
    fingerprint.accessibilityLabel = @"Touch ID required";
    [panel.contentView addSubview:fingerprint positioned:NSWindowAbove relativeTo:authenticationView];
    [panel center];
    NSRect panelFrame = panel.frame;
    panelFrame.origin.y -= 10;
    [panel setFrame:panelFrame display:NO];
    NSTextField* heading = PanelHeading(panel);
    const NSRect compactFrame = panel.frame;
    NSArray<NSView*>* compactViews = @[heading, cancel, details, instruction,
                                      authenticationView, fingerprint];
    NSMutableArray<NSValue*>* compactFrameValues = [NSMutableArray arrayWithCapacity:compactViews.count];
    for (NSView* view in compactViews) {
      [compactFrameValues addObject:[NSValue valueWithRect:view.frame]];
    }
    NSArray<NSValue*>* compactFrames = [compactFrameValues copy];
    const NSSize compactContentSize = panel.contentView.bounds.size;
    const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    __block NSScrollView* detailRows = nil;
    __block NSArray<NSView*>* expandedViews = nil;
    __block NSArray<NSValue*>* expandedFrames = nil;
    __block NSSize expandedContentSize = NSZeroSize;
    __block BOOL showingDetails = NO;
    __block BOOL transitioningDetails = NO;
    void (^toggleDetails)(BOOL) = ^(BOOL show) {
      if (transitioningDetails || showingDetails == show) return;
      transitioningDetails = YES;
      details.enabled = NO;
      if (show) {
        detailRows = DetailRowsView(RequestDetailRows(options, request_id));
        const CGFloat width = detailRows.frame.size.width + 40;
        const CGFloat height = detailRows.frame.size.height + 180;
        detailRows.frame = NSMakeRect(20, 64, detailRows.frame.size.width,
                                      detailRows.frame.size.height);
        detailRows.hidden = YES;
        detailRows.alphaValue = 0;
        [panel.contentView addSubview:detailRows];
        AnimateViewAlpha(@[heading, cancel, details, instruction,
                           authenticationView, fingerprint], 0, reduceMotion, ^{
          cancel.hidden = YES;
          details.hidden = YES;
          instruction.hidden = YES;
          authenticationView.hidden = YES;
          fingerprint.hidden = YES;
        });
        const NSRect expandedFrame = CenteredPanelFrame(compactFrame, width, height);
        AnimatePanelFrame(panel, panel.frame, expandedFrame, reduceMotion,
                          compactViews, compactFrames, compactContentSize, ^{
          heading.stringValue = @"Request details";
          heading.frame = NSMakeRect(20, height - 60, width - 40, 40);
          heading.alignment = NSTextAlignmentCenter;
          detailRows.hidden = NO;
          details.title = @"";
          details.image = [NSImage imageWithSystemSymbolName:@"chevron.left"
                                  accessibilityDescription:@"Back to approval"];
          details.imagePosition = NSImageOnly;
          details.frame = NSMakeRect(20, 18, 36, 30);
          details.toolTip = @"Back to approval";
          details.accessibilityLabel = details.toolTip;
          details.hidden = NO;
          authenticationView.frame = NSMakeRect(width - 116, 18, 96, 96);
          authenticationView.hidden = NO;
          expandedViews = @[heading, detailRows, details, authenticationView];
          expandedFrames = @[[NSValue valueWithRect:heading.frame],
                             [NSValue valueWithRect:detailRows.frame],
                             [NSValue valueWithRect:details.frame],
                             [NSValue valueWithRect:authenticationView.frame]];
          expandedContentSize = panel.contentView.bounds.size;
          AnimateViewAlpha(@[heading, detailRows, details, authenticationView], 1, reduceMotion, ^{
            showingDetails = YES;
            transitioningDetails = NO;
            details.enabled = YES;
          });
        });
        return;
      }
      AnimateViewAlpha(@[heading, detailRows, details, authenticationView], 0, reduceMotion, ^{
        detailRows.hidden = YES;
        details.hidden = YES;
        authenticationView.hidden = YES;
      });
      AnimatePanelFrame(panel, panel.frame, compactFrame, reduceMotion,
                        expandedViews, expandedFrames, expandedContentSize, ^{
        heading.stringValue = title;
        heading.alignment = NSTextAlignmentCenter;
        details.title = @"Details";
        details.image = [NSImage imageWithSystemSymbolName:@"chevron.right"
                                  accessibilityDescription:@"Expand details"];
        details.imagePosition = NSImageRight;
        details.frame = compactFrames[2].rectValue;
        details.toolTip = @"Show request details";
        details.accessibilityLabel = details.toolTip;
        for (NSUInteger index = 0; index < compactViews.count; ++index) {
          compactViews[index].frame = compactFrames[index].rectValue;
        }
        cancel.hidden = NO;
        details.hidden = NO;
        instruction.hidden = NO;
        authenticationView.hidden = NO;
        fingerprint.hidden = NO;
        AnimateViewAlpha(@[heading, cancel, details, instruction,
                           authenticationView, fingerprint], 1, reduceMotion, ^{
          showingDetails = NO;
          transitioningDetails = NO;
          details.enabled = YES;
        });
      });
    };
    [NSApp activateIgnoringOtherApps:YES];
    [panel makeKeyAndOrderFront:nil];
    NSModalSession session = [NSApp beginModalSessionForWindow:panel];
    bool cancelled = false;
    BOOL (^isShowingDetails)(void) = ^BOOL { return showingDetails; };
    const bool authenticated = context.AuthenticateWithEvents(reason, error, [&cancelled, &session, &panel, &context, toggleDetails, isShowingDetails] {
      if (cancelled) return;
      const NSModalResponse response = [NSApp runModalSession:session];
      if (response == NSModalResponseContinue) return;
      if (response == NSAlertSecondButtonReturn) {
        [NSApp endModalSession:session];
        toggleDetails(isShowingDetails() == NO);
        session = [NSApp beginModalSessionForWindow:panel];
        return;
      }
      cancelled = true;
      context.Invalidate();
    });
    if (authenticated && !cancelled) {
      while (transitioningDetails) {
        [[NSRunLoop currentRunLoop]
            runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0 / 60.0]];
      }
      if (showingDetails) {
        toggleDetails(NO);
        while (transitioningDetails) {
          [[NSRunLoop currentRunLoop]
              runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0 / 60.0]];
        }
      }
      fingerprint.accessibilityLabel = @"Verifying";
      instruction.stringValue = @"Verifying…";
      cancel.enabled = NO;
      cancel.keyEquivalent = @"";
      details.enabled = NO;
      [fingerprint animateSuccess];
      if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
        cancel.alphaValue = 0;
        details.alphaValue = 0;
      } else {
        [NSAnimationContext runAnimationGroup:^(NSAnimationContext* animation) {
          animation.duration = 0.45;
          animation.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
          cancel.animator.alphaValue = 0;
          details.animator.alphaValue = 0;
        } completionHandler:nil];
      }
      const NSTimeInterval duration =
          NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion ? 0.18 : kFingerprintDuration;
      const NSTimeInterval verifiedDelay = duration * 0.85;
      NSDate* verifiedAt = [NSDate dateWithTimeIntervalSinceNow:verifiedDelay];
      NSDate* deadline = [verifiedAt dateByAddingTimeInterval:0.4];
      bool displayedVerified = false;
      while (deadline.timeIntervalSinceNow > 0) {
        if (!displayedVerified && verifiedAt.timeIntervalSinceNow <= 0) {
          instruction.stringValue = @"Verified.";
          fingerprint.accessibilityLabel = @"Touch ID verified";
          displayedVerified = true;
        }
        const NSModalResponse response = [NSApp runModalSession:session];
        if (response == NSAlertSecondButtonReturn) {
          [NSApp endModalSession:session];
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
