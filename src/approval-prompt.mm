#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <LocalAuthenticationEmbeddedUI/LocalAuthenticationEmbeddedUI.h>
#import <QuartzCore/QuartzCore.h>
#include "fingerprint-atlas.generated.h"
#include "detail-copy-icons.generated.h"

#include "approval-prompt.h"
#include "input-policy.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

constexpr CGFloat kFingerprintClipBottomInset = 18;
constexpr CGFloat kExpandedFooterHeight = 112;
constexpr CGFloat kExpandedRowsFooterGap = 16;
constexpr CGFloat kExpandedRowsHeadingGap = 16;
constexpr CGFloat kExpandedHeadingHeight = 40;
constexpr CGFloat kExpandedTopInset = 18;
constexpr CFTimeInterval kTextShimmerLeadIn = 0.8;
constexpr CFTimeInterval kTextShimmerSweep = 1.8;
constexpr CFTimeInterval kTextShimmerRest = 5.2;
constexpr CFTimeInterval kTextShimmerCycle =
    kTextShimmerSweep + kTextShimmerRest;

NSColor* SocketBrandColor() {
  static NSColor* color;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    color = [NSColor colorWithName:nil dynamicProvider:^NSColor*(NSAppearance* appearance) {
      NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
      if ([match isEqualToString:NSAppearanceNameDarkAqua]) {
        return [NSColor colorWithSRGBRed:198.0 / 255 green:168.0 / 255
            blue:255.0 / 255 alpha:1];
      }
      return [NSColor colorWithSRGBRed:112.0 / 255 green:74.0 / 255
          blue:174.0 / 255 alpha:1];
    }];
  });
  return color;
}

NSColor* SocketCopyIconColor() {
  return SocketBrandColor();
}

NSColor* SocketBrandDarkColor() {
  static NSColor* color;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    color = [NSColor colorWithName:nil dynamicProvider:^NSColor*(NSAppearance* appearance) {
      NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
      if ([match isEqualToString:NSAppearanceNameDarkAqua]) {
        return [NSColor colorWithSRGBRed:242.0 / 255 green:238.0 / 255
            blue:249.0 / 255 alpha:1];
      }
      return [NSColor colorWithSRGBRed:43.0 / 255 green:39.0 / 255
          blue:49.0 / 255 alpha:1];
    }];
  });
  return color;
}

NSColor* SocketShimmerHighlightColor() {
  static NSColor* color;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    color = [NSColor colorWithName:nil dynamicProvider:^NSColor*(NSAppearance* appearance) {
      NSAppearanceName match = [appearance bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameAqua, NSAppearanceNameDarkAqua]];
      return [match isEqualToString:NSAppearanceNameDarkAqua]
          ? [NSColor colorWithSRGBRed:244.0 / 255 green:237.0 / 255
                blue:255.0 / 255 alpha:1]
          : [NSColor colorWithSRGBRed:255.0 / 255 green:0
                blue:149.0 / 255 alpha:1]; // Depscan hot pink.
    }];
  });
  return color;
}

NSAppearance* AppearanceForView(NSView* view) {
  return view.effectiveAppearance != nil
      ? view.effectiveAppearance : NSApp.effectiveAppearance;
}

NSColor* ColorForAppearance(NSColor* color, NSAppearance* appearance) {
  __block NSColor* resolved = nil;
  [appearance performAsCurrentDrawingAppearance:^{
    resolved = [color colorUsingColorSpace:[NSColorSpace sRGBColorSpace]];
  }];
  return resolved != nil ? resolved : color;
}

void DrawSocketFocusRing(NSView* view) {
  if (view.window == nil || view.window.firstResponder != view) return;
  const NSRect ringFrame = NSInsetRect(view.bounds, 3, 3);
  if (NSWidth(ringFrame) <= 0 || NSHeight(ringFrame) <= 0) return;
  NSBezierPath* ring = [NSBezierPath bezierPathWithRoundedRect:ringFrame
                                                       xRadius:7
                                                       yRadius:7];
  ring.lineWidth = 1.25;
  [ColorForAppearance(SocketShimmerHighlightColor(),
                      AppearanceForView(view)) setStroke];
  [ring stroke];
}

CGImageRef RecolorFingerprintFrame(CGImageRef source, BOOL initialFrame) {
  const size_t width = CGImageGetWidth(source);
  const size_t height = CGImageGetHeight(source);
  const size_t bytesPerRow = width * 4;
  std::vector<uint8_t> pixels(bytesPerRow * height);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(
      pixels.data(), width, height, 8, bytesPerRow, colorSpace,
      static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) |
          static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Big));
  CGColorSpaceRelease(colorSpace);
  if (context == nullptr) return nullptr;
  CGContextDrawImage(context,
                     CGRectMake(0, 0, static_cast<CGFloat>(width),
                                static_cast<CGFloat>(height)),
                     source);
  for (size_t offset = 0; offset < pixels.size(); offset += 4) {
    const CGFloat alpha = pixels[offset + 3] / 255.0;
    if (alpha == 0) continue;
    const CGFloat red = pixels[offset] / (255.0 * alpha);
    const CGFloat green = pixels[offset + 1] / (255.0 * alpha);
    const CGFloat blue = pixels[offset + 2] / (255.0 * alpha);
    // Only RGB changes below. Keep the source alpha mask, including every
    // antialiased edge pixel, intact so recoloring cannot alter the shape.
    if (!initialFrame && red > green * 1.15 && red > blue * 1.15) {
      pixels[offset] = static_cast<uint8_t>(std::lround(128 * alpha));
      pixels[offset + 1] = static_cast<uint8_t>(std::lround(90 * alpha));
      pixels[offset + 2] = static_cast<uint8_t>(std::lround(213 * alpha));
    } else {
      constexpr CGFloat kPurpleGrayRed = 0.71;
      constexpr CGFloat kPurpleGrayGreen = 0.69;
      constexpr CGFloat kPurpleGrayBlue = 0.77;
      pixels[offset] = static_cast<uint8_t>(
          std::lround(255 * kPurpleGrayRed * alpha));
      pixels[offset + 1] = static_cast<uint8_t>(
          std::lround(255 * kPurpleGrayGreen * alpha));
      pixels[offset + 2] = static_cast<uint8_t>(
          std::lround(255 * kPurpleGrayBlue * alpha));
    }
  }
  CGContextFlush(context);
  CGImageRef result = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  return result;
}

@interface SockeyeDetailCopyButton : NSButton
@property(copy) NSString* payload;
@property(copy) NSString* detailName;
@property(strong) NSTimer* resetTimer;
- (void)copyDetail:(id)sender;
- (void)setCopied:(BOOL)copied;
@end

@interface SockeyePanelButton : NSButton
@property NSModalResponse response;
@property(nonatomic) BOOL showsLinkCursor;
@property(copy) void (^actionHandler)(void);
- (void)setEnabled:(BOOL)enabled;
- (void)setShowsLinkCursor:(BOOL)showsLinkCursor;
- (void)finishModal:(id)sender;
@end

@implementation SockeyePanelButton
- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  DrawSocketFocusRing(self);
}
- (BOOL)becomeFirstResponder {
  const BOOL becameFirstResponder = [super becomeFirstResponder];
  [self setNeedsDisplay:YES];
  return becameFirstResponder;
}
- (BOOL)resignFirstResponder {
  const BOOL resignedFirstResponder = [super resignFirstResponder];
  [self setNeedsDisplay:YES];
  return resignedFirstResponder;
}
- (void)setEnabled:(BOOL)enabled {
  [super setEnabled:enabled];
  if (self.window != nil) [self.window invalidateCursorRectsForView:self];
}
- (void)setShowsLinkCursor:(BOOL)showsLinkCursor {
  _showsLinkCursor = showsLinkCursor;
  if (self.window != nil) [self.window invalidateCursorRectsForView:self];
}
- (void)resetCursorRects {
  [super resetCursorRects];
  if (self.showsLinkCursor && self.enabled && !self.hidden) {
    [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor];
  }
}
- (void)finishModal:(id)sender {
  (void)sender;
  if (self.actionHandler != nil) {
    self.actionHandler();
    return;
  }
  [NSApp stopModalWithCode:self.response];
}
@end

@interface SockeyeInstructionLabel : NSTextField
@property(copy) void (^actionHandler)(void);
@end

@implementation SockeyeInstructionLabel
- (void)mouseDown:(NSEvent*)event {
  (void)event;
  if (self.actionHandler != nil) self.actionHandler();
}
@end

@implementation SockeyeDetailCopyButton
- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  DrawSocketFocusRing(self);
}
- (BOOL)becomeFirstResponder {
  const BOOL becameFirstResponder = [super becomeFirstResponder];
  [self setNeedsDisplay:YES];
  return becameFirstResponder;
}
- (BOOL)resignFirstResponder {
  const BOOL resignedFirstResponder = [super resignFirstResponder];
  [self setNeedsDisplay:YES];
  return resignedFirstResponder;
}
- (void)setCopied:(BOOL)copied {
  NSString* title = copied ? @"\u2009Copied" : [@"\u2009" stringByAppendingString:self.detailName];
  self.attributedTitle = [[NSAttributedString alloc] initWithString:title attributes:@{
      NSFontAttributeName: self.font,
      NSForegroundColorAttributeName: SocketBrandColor(),
  }];
  const unsigned char* bytes = copied ? kDetailCheckIconSvg : kDetailCopyIconSvg;
  const NSUInteger length = copied ? sizeof(kDetailCheckIconSvg) : sizeof(kDetailCopyIconSvg);
  NSImage* icon = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
  [icon setTemplate:YES];
  self.image = icon;
  self.contentTintColor = SocketCopyIconColor();
  self.toolTip = copied ? [@"Copied " stringByAppendingString:self.detailName]
                        : [@"Copy " stringByAppendingString:self.detailName];
  self.accessibilityLabel = self.toolTip;
}
- (void)copyDetail:(id)sender {
  (void)sender;
  if (self.payload == nil) {
    return;
  }
  NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  if (![pasteboard setString:self.payload forType:NSPasteboardTypeString]) return;
  [self.resetTimer invalidate];
  [self setCopied:YES];
  __weak SockeyeDetailCopyButton* weakSelf = self;
  self.resetTimer = [NSTimer timerWithTimeInterval:1.2 repeats:NO block:^(NSTimer* timer) {
    (void)timer;
    [weakSelf setCopied:NO];
    weakSelf.resetTimer = nil;
  }];
  [[NSRunLoop mainRunLoop] addTimer:self.resetTimer forMode:NSRunLoopCommonModes];
}
@end

@interface SockeyeDetailRowsView : NSView
@end

@interface SockeyeAuthenticationShieldView : NSView
- (void)updateSurfaceColor;
@end

@interface SockeyeFingerprintClipView : NSView
@end

@interface SockeyeTextShimmer : NSObject
@property(nonatomic, weak) NSTextField* label;
@property(nonatomic, strong) NSTimer* timer;
@property(nonatomic, strong) NSColor* baseColor;
@property(nonatomic, strong) NSColor* highlightColor;
@property(nonatomic) CFTimeInterval startTime;
@property(nonatomic) BOOL highlightsVisible;
- (instancetype)initWithLabel:(NSTextField*)label;
- (void)setBaseColor:(NSColor*)baseColor highlightColor:(NSColor*)highlightColor;
- (void)setHighlightsVisible:(BOOL)visible;
- (void)setEnabled:(BOOL)enabled;
- (void)update;
@end

@implementation SockeyeDetailRowsView
- (BOOL)isFlipped { return YES; }
@end

@implementation SockeyeAuthenticationShieldView
- (void)updateSurfaceColor {
  if (self.layer == nil) return;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self updateSurfaceColor];
}
- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
@end

@implementation SockeyeFingerprintClipView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self == nil) return nil;
  self.wantsLayer = YES;
  self.layer.masksToBounds = YES;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [self setFrameSize:frame.size];
  return self;
}
- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  CAShapeLayer* mask = [CAShapeLayer layer];
  mask.frame = self.bounds;
  CGPathRef path = CGPathCreateWithRect(
      CGRectMake(0, kFingerprintClipBottomInset, NSWidth(self.bounds),
                 MAX(0, NSHeight(self.bounds) - kFingerprintClipBottomInset)),
      nullptr);
  mask.path = path;
  CGPathRelease(path);
  self.layer.mask = mask;
}
- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
@end

@implementation SockeyeTextShimmer
- (instancetype)initWithLabel:(NSTextField*)label {
  self = [super init];
  if (self == nil) return nil;
  self.label = label;
  self.baseColor = SocketBrandColor();
  self.highlightColor = SocketShimmerHighlightColor();
  self.highlightsVisible = YES;
  self.label.textColor = self.baseColor;
  return self;
}
- (void)setBaseColor:(NSColor*)baseColor highlightColor:(NSColor*)highlightColor {
  self.baseColor = baseColor;
  self.highlightColor = highlightColor;
  self.label.textColor = ColorForAppearance(baseColor,
                                             AppearanceForView(self.label));
  if (self.timer != nil) [self update];
}
- (void)setHighlightsVisible:(BOOL)visible {
  _highlightsVisible = visible;
  if (self.timer != nil) [self update];
}
- (void)setEnabled:(BOOL)enabled {
  if (!enabled || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    [self.timer invalidate];
    self.timer = nil;
    self.label.textColor = self.baseColor;
    [self.label setStringValue:self.label.stringValue];
    return;
  }
  if (self.timer != nil) {
    [self update];
    return;
  }
  // Keep this timeline alive through compact/details transitions. Re-enabling
  // an existing shimmer refreshes its current frame instead of restarting it.
  self.startTime = CACurrentMediaTime();
  __weak SockeyeTextShimmer* weakSelf = self;
  self.timer = [NSTimer timerWithTimeInterval:1.0 / 30.0 repeats:YES
      block:^(NSTimer* timer) {
        (void)timer;
        [weakSelf update];
      }];
  [[NSRunLoop mainRunLoop] addTimer:self.timer forMode:NSRunLoopCommonModes];
  [self update];
}
- (void)update {
  if (self.label == nil || self.timer == nil) return;
  NSString* value = self.label.stringValue;
  if (value.length == 0) return;
  const CFTimeInterval elapsed = CACurrentMediaTime() - self.startTime;
  NSAppearance* appearance = AppearanceForView(self.label);
  NSColor* baseColor = ColorForAppearance(self.baseColor, appearance);
  NSColor* highlightColor = ColorForAppearance(self.highlightColor, appearance);
  if (!self.highlightsVisible) {
    self.label.textColor = baseColor;
    self.label.stringValue = value;
    return;
  }
  const CFTimeInterval phase = elapsed < kTextShimmerLeadIn
      ? -1
      : fmod(elapsed - kTextShimmerLeadIn, kTextShimmerCycle);
  if (phase < 0 || phase >= kTextShimmerSweep) {
    self.label.textColor = baseColor;
    self.label.stringValue = value;
    return;
  }
  const CGFloat halfWidth = MAX(static_cast<CGFloat>(value.length) * 0.1, 3);
  const CGFloat progress = static_cast<CGFloat>(phase / kTextShimmerSweep);
  const CGFloat center = progress *
      (static_cast<CGFloat>(value.length) + 2 * halfWidth) - halfWidth;
  NSMutableAttributedString* text = [[NSMutableAttributedString alloc]
      initWithString:value attributes:@{NSFontAttributeName: self.label.font}];
  NSUInteger offset = 0;
  while (offset < value.length) {
    const NSRange range = [value rangeOfComposedCharacterSequenceAtIndex:offset];
    const CGFloat distance = fabs(static_cast<CGFloat>(offset) - center);
    const CGFloat ratio = MIN(distance / halfWidth, 1);
    const CGFloat intensity = 0.5 * (1 + std::cos(3.14159265358979323846 * ratio));
    NSColor* color = [baseColor blendedColorWithFraction:intensity
                                                  ofColor:highlightColor];
    [text addAttribute:NSForegroundColorAttributeName value:color range:range];
    offset = NSMaxRange(range);
  }
  NSMutableParagraphStyle* paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = self.label.alignment;
  [text addAttribute:NSParagraphStyleAttributeName value:paragraph
               range:NSMakeRange(0, text.length)];
  self.label.attributedStringValue = text;
}
@end

@interface SockeyeFingerprintView : NSView
@property(nonatomic, strong) NSArray* frames;
@property(nonatomic, strong) NSArray<NSNumber*>* times;
@property(nonatomic, strong) CALayer* imageLayer;
- (void)updateSurfaceColor;
- (void)showUpperHalf;
- (void)animateFullReveal:(NSTimeInterval)duration;
- (void)showFullFingerprint;
- (void)animateNudge;
- (void)animateSuccess;
@end

@implementation SockeyeFingerprintView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self == nil) return nil;
  self.wantsLayer = YES;
  [self updateSurfaceColor];
  self.layer.masksToBounds = YES;
  CALayer* imageLayer = [CALayer layer];
  imageLayer.frame = self.layer.bounds;
  imageLayer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  NSData* data = [NSData dataWithBytes:kFingerprintAtlas length:sizeof(kFingerprintAtlas)];
  NSImage* image = [[NSImage alloc] initWithData:data];
  CGImageRef atlas = [image CGImageForProposedRect:nullptr context:nil hints:nil];
  NSMutableArray* frames = [NSMutableArray arrayWithCapacity:kFingerprintFrameCount];
  NSMutableArray<NSNumber*>* times = [NSMutableArray arrayWithCapacity:kFingerprintFrameCount];
  const CGFloat tile = static_cast<CGFloat>(CGImageGetWidth(atlas)) / 8;
  CGImageRef initialFrame = CGImageCreateWithImageInRect(
      atlas, CGRectMake(0, 0, tile, tile));
  CGImageRef tintedInitialFrame = RecolorFingerprintFrame(initialFrame, YES);
  imageLayer.contents = (__bridge id)(tintedInitialFrame != nullptr
      ? tintedInitialFrame : initialFrame);
  if (tintedInitialFrame != nullptr) CGImageRelease(tintedInitialFrame);
  CGImageRelease(initialFrame);
  const NSUInteger firstFrame = 8;
  for (NSUInteger index = firstFrame; index < kFingerprintFrameCount; ++index) {
    CGRect rect = CGRectMake(static_cast<CGFloat>(index % 8) * tile,
                             static_cast<CGFloat>(index / 8) * tile, tile, tile);
    CGImageRef tileImage = CGImageCreateWithImageInRect(atlas, rect);
    CGImageRef purpleFrame = RecolorFingerprintFrame(tileImage, NO);
    [frames addObject:(__bridge id)(purpleFrame != nullptr ? purpleFrame : tileImage)];
    if (purpleFrame != nullptr) CGImageRelease(purpleFrame);
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
  self.imageLayer = imageLayer;
  [self.layer addSublayer:imageLayer];
  imageLayer.contentsGravity = kCAGravityResizeAspect;
  imageLayer.minificationFilter = kCAFilterTrilinear;
  return self;
}
- (void)updateSurfaceColor {
  if (self.layer == nil) return;
  self.layer.backgroundColor = NSColor.clearColor.CGColor;
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  [self updateSurfaceColor];
}
- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
- (void)showUpperHalf {
  const NSRect imageFrame = NSOffsetRect(self.layer.bounds, 0, -32);
  self.imageLayer.frame = imageFrame;
  CAShapeLayer* mask = [CAShapeLayer layer];
  mask.frame = self.layer.bounds;
  mask.fillColor = NSColor.whiteColor.CGColor;
  CGPathRef halfPath = CGPathCreateWithRect(
      CGRectMake(0, NSHeight(self.bounds) / 2, NSWidth(self.bounds),
                 NSHeight(self.bounds) / 2), nullptr);
  mask.path = halfPath;
  CGPathRelease(halfPath);
  self.imageLayer.mask = mask;
}
- (void)animateFullReveal:(NSTimeInterval)duration {
  CAShapeLayer* mask = (CAShapeLayer*)self.imageLayer.mask;
  if (mask == nil) return;
  const NSPoint startingPosition = self.imageLayer.position;
  const NSRect fullFrame = self.layer.bounds;
  self.imageLayer.frame = fullFrame;
  CABasicAnimation* move = [CABasicAnimation animationWithKeyPath:@"position"];
  move.fromValue = [NSValue valueWithPoint:startingPosition];
  move.toValue = [NSValue valueWithPoint:self.imageLayer.position];
  move.duration = duration;
  move.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  [self.imageLayer addAnimation:move forKey:@"fingerprintPosition"];
  CGPathRef fullPath = CGPathCreateWithRect(
      CGRectMake(0, 0, NSWidth(self.bounds), NSHeight(self.bounds)), nullptr);
  CABasicAnimation* reveal = [CABasicAnimation animationWithKeyPath:@"path"];
  reveal.fromValue = (__bridge id)mask.path;
  reveal.toValue = (__bridge id)fullPath;
  reveal.duration = duration;
  reveal.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  mask.path = fullPath;
  [mask addAnimation:reveal forKey:@"fingerprintReveal"];
  CGPathRelease(fullPath);
}
- (void)showFullFingerprint {
  self.imageLayer.mask = nil;
  self.imageLayer.frame = self.layer.bounds;
}
- (void)animateNudge {
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) return;
  const NSPoint origin = self.imageLayer.position;
  CAKeyframeAnimation* nudge = [CAKeyframeAnimation animationWithKeyPath:@"position"];
  nudge.values = @[
    [NSValue valueWithPoint:origin],
    [NSValue valueWithPoint:NSMakePoint(origin.x, origin.y + 2)],
    [NSValue valueWithPoint:NSMakePoint(origin.x, origin.y - 2)],
    [NSValue valueWithPoint:NSMakePoint(origin.x - 2, origin.y)],
    [NSValue valueWithPoint:NSMakePoint(origin.x + 2, origin.y)],
    [NSValue valueWithPoint:origin],
  ];
  nudge.keyTimes = @[@0, @0.16, @0.32, @0.48, @0.64, @1];
  nudge.duration = 0.36;
  nudge.calculationMode = kCAAnimationLinear;
  nudge.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  [self.imageLayer removeAnimationForKey:@"fingerprintNudge"];
  [self.imageLayer addAnimation:nudge forKey:@"fingerprintNudge"];
}
- (void)animateSuccess {
  const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.imageLayer.contents = self.frames.lastObject;
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
    [self.imageLayer addAnimation:scan forKey:@"fingerprintScan"];
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
  panel.autorecalculatesKeyViewLoop = NO;
  NSTextField* heading = [NSTextField wrappingLabelWithString:title];
  heading.identifier = @"RequestHeading";
  heading.frame = NSMakeRect(20, height - 60, width - 40, 40);
  heading.font = [NSFont boldSystemFontOfSize:14];
  heading.selectable = NO;
  heading.textColor = SocketBrandDarkColor();
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
  button.focusRingType = NSFocusRingTypeNone;
  button.response = response;
  button.target = button;
  button.action = @selector(finishModal:);
  [panel.contentView addSubview:button];
  return button;
}

void StyleBrandButtonTitle(NSButton* button, NSString* title) {
  NSFont* font = button.font != nil ? button.font : [NSFont systemFontOfSize:13];
  button.bordered = NO;
  button.contentTintColor = SocketBrandColor();
  button.attributedTitle = [[NSAttributedString alloc] initWithString:title
      attributes:@{NSFontAttributeName: font,
                   NSForegroundColorAttributeName: SocketBrandColor()}];
}

void StyleApprovalHeading(NSTextField* heading, NSString* title,
                          NSString* credentials) {
  NSMutableAttributedString* text = [[NSMutableAttributedString alloc]
      initWithString:title
          attributes:@{NSFontAttributeName: [NSFont boldSystemFontOfSize:14],
                       NSForegroundColorAttributeName: SocketBrandDarkColor()}];
  NSMutableParagraphStyle* paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = NSTextAlignmentCenter;
  [text addAttribute:NSParagraphStyleAttributeName value:paragraph
               range:NSMakeRange(0, text.length)];
  const NSRange delimiter = [title rangeOfString:@" to use "];
  if (delimiter.location != NSNotFound) {
    NSUInteger offset = NSMaxRange(delimiter);
    NSFont* credentialFont =
        [NSFont monospacedSystemFontOfSize:13 weight:NSFontWeightSemibold];
    for (NSString* name in [credentials componentsSeparatedByString:@", "]) {
      if (name.length == 0 || offset >= title.length) continue;
      const NSRange range = [title rangeOfString:name
                                         options:0
                                           range:NSMakeRange(offset, title.length - offset)];
      if (range.location == NSNotFound) continue;
      [text addAttribute:NSFontAttributeName value:credentialFont range:range];
      offset = NSMaxRange(range);
    }
  }
  heading.attributedStringValue = text;
}

struct PanelSpringPhase {
  CGFloat progress;
  CGFloat displacement;
};

constexpr PanelSpringPhase kPanelSpringPhases[] = {
    {0, 0}, {0.18, 1}, {0.46, -0.5}, {0.74, 1.0 / 6}, {1, 0}};
constexpr CGFloat kPanelControlTravel = 40;
constexpr NSTimeInterval kPanelControlDuration = 0.16;

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

void InvalidateCursorRects(NSArray<NSView*>* views) {
  for (NSView* view in views) {
    if (view.window != nil) {
      [view.window invalidateCursorRectsForView:view];
    }
  }
}

void AnimatePanelFrame(NSPanel* panel, NSRect start, NSRect target,
                       BOOL reduceMotion, NSArray<NSView*>* trackingViews,
                       NSArray<NSValue*>* trackingFrames,
                       NSSize trackingContentSize,
                       void (^completion)(void)) {
  if (reduceMotion) {
    [panel setFrame:target display:YES];
    InvalidateCursorRects(trackingViews);
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
          InvalidateCursorRects(trackingViews);
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

void AnimateViewsAndFingerprint(NSArray<NSView*>* views, CGFloat alpha,
                               SockeyeFingerprintView* fingerprint,
                               NSRect fingerprintFrame,
                               NSTimeInterval duration, BOOL reduceMotion,
                               void (^completion)(void),
                               NSArray<NSView*>* movingViews = nil,
                               NSArray<NSValue*>* movingFrames = nil,
                               NSTimeInterval movingDuration = 0) {
  NSMutableArray<NSNumber*>* startingAlphas = [NSMutableArray arrayWithCapacity:views.count];
  for (NSView* view in views) {
    [startingAlphas addObject:@(view.alphaValue)];
  }
  NSMutableArray<NSValue*>* startingFrames =
      [NSMutableArray arrayWithCapacity:movingViews.count];
  for (NSView* view in movingViews) {
    [startingFrames addObject:[NSValue valueWithRect:view.frame]];
  }
  const NSRect startingFrame = fingerprint.frame;
  const NSTimeInterval effectiveMovingDuration =
      movingDuration > 0 ? movingDuration : duration;
  if (reduceMotion || duration <= 0) {
    for (NSView* view in views) view.alphaValue = alpha;
    for (NSUInteger index = 0; index < movingViews.count; ++index) {
      movingViews[index].frame = movingFrames[index].rectValue;
    }
    fingerprint.frame = fingerprintFrame;
    InvalidateCursorRects(movingViews);
    completion();
    return;
  }
  const CFTimeInterval animationStart = CACurrentMediaTime();
  NSTimer* timer = [NSTimer timerWithTimeInterval:1.0 / 60.0 repeats:YES
      block:^(NSTimer* currentTimer) {
        const NSTimeInterval elapsed = CACurrentMediaTime() - animationStart;
        const CGFloat progress = static_cast<CGFloat>(MIN(1, elapsed / duration));
        const CGFloat eased = (1 - std::cos(3.141592653589793 * progress)) / 2;
        const CGFloat viewProgress = static_cast<CGFloat>(
            MIN(1, elapsed / effectiveMovingDuration));
        const CGFloat viewEased =
            (1 - std::cos(3.141592653589793 * viewProgress)) / 2;
        if (elapsed >= duration) {
          for (NSView* view in views) view.alphaValue = alpha;
          for (NSUInteger index = 0; index < movingViews.count; ++index) {
            movingViews[index].frame = movingFrames[index].rectValue;
          }
          fingerprint.frame = fingerprintFrame;
          [currentTimer invalidate];
          InvalidateCursorRects(movingViews);
          completion();
          return;
        }
        for (NSUInteger index = 0; index < views.count; ++index) {
          const CGFloat startAlpha = startingAlphas[index].doubleValue;
          const BOOL movesWithPanel = [movingViews containsObject:views[index]];
          const NSTimeInterval alphaDuration =
              movesWithPanel ? effectiveMovingDuration : MIN(duration, 0.09);
          const CGFloat alphaProgress =
              static_cast<CGFloat>(MIN(1, elapsed / alphaDuration));
          const CGFloat alphaEased =
              (1 - std::cos(3.141592653589793 * alphaProgress)) / 2;
          views[index].alphaValue =
              startAlpha + (alpha - startAlpha) * alphaEased;
        }
        for (NSUInteger index = 0; index < movingViews.count; ++index) {
          const NSRect startFrame = startingFrames[index].rectValue;
          const NSRect targetFrame = movingFrames[index].rectValue;
          movingViews[index].frame = NSMakeRect(
              startFrame.origin.x +
                  (targetFrame.origin.x - startFrame.origin.x) * viewEased,
              startFrame.origin.y +
                  (targetFrame.origin.y - startFrame.origin.y) * viewEased,
              startFrame.size.width +
                  (targetFrame.size.width - startFrame.size.width) * viewEased,
              startFrame.size.height +
                  (targetFrame.size.height - startFrame.size.height) * viewEased);
        }
        fingerprint.frame = NSMakeRect(
            startingFrame.origin.x +
                (fingerprintFrame.origin.x - startingFrame.origin.x) * eased,
            startingFrame.origin.y +
                (fingerprintFrame.origin.y - startingFrame.origin.y) * eased,
            startingFrame.size.width +
                (fingerprintFrame.size.width - startingFrame.size.width) * eased,
            startingFrame.size.height +
                (fingerprintFrame.size.height - startingFrame.size.height) * eased);
      }];
  [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
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
    const RunOptions& options, std::string_view request_id,
    NSString* operation) {
  NSMutableArray<NSArray<NSString*>*>* rows = [NSMutableArray array];
  if (options.executable.canonical_path.empty() && operation.length > 0) {
    [rows addObject:@[@"operation", operation, operation, @""]];
  }
  NSString* copy_value = nil;
  NSString* request_value = MakeString(request_id);
  NSString* full_request = [@"sha256:" stringByAppendingString:
      request_value != nil ? request_value : @""];
  [rows addObject:@[@"requestId", full_request, full_request]];
  if (!options.working_directory.canonical_path.empty()) {
    NSString* cwd = VisibleString(options.working_directory.canonical_path, &copy_value);
    NSString* cwd_help = MakeString(options.working_directory.canonical_path) == nil
        ? @"Invalid UTF-8 bytes are shown as escaped bytes." : @"";
    [rows addObject:@[@"cwd", cwd, copy_value, cwd_help]];
  }
  if (!options.executable.canonical_path.empty()) {
    NSString* executable = VisibleString(options.executable.canonical_path, &copy_value);
    NSString* executable_help = MakeString(options.executable.canonical_path) == nil
        ? @"Invalid UTF-8 bytes are shown as escaped bytes." : @"";
    [rows addObject:@[@"executable.path", executable, copy_value, executable_help]];
    NSString* executable_digest = MakeString(DigestHex(options.executable));
    [rows addObject:@[@"executable.sha256", executable_digest, executable_digest, @""]];
  }
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
  if (!options.passed_environment.empty()) {
    NSString* environments =
        DetailArray(options.passed_environment, &copy_value, &used_fallback);
    [rows addObject:@[@"envNames", environments, copy_value,
        used_fallback ? @"Invalid UTF-8 entries are shown as escaped bytes." : @""]];
  }
  if (!options.child_arguments.empty()) {
    used_fallback = NO;
    NSString* arguments =
        DetailArray(options.child_arguments, &copy_value, &used_fallback);
    [rows addObject:@[@"arguments", arguments, copy_value,
        used_fallback ? @"Invalid UTF-8 entries are shown as escaped bytes." : @""]];
  }
  return rows;
}

NSScrollView* DetailRowsView(NSArray<NSArray<NSString*>*>* rows) {
  NSScreen* screen = NSApp.mainWindow.screen != nil ? NSApp.mainWindow.screen : NSScreen.mainScreen;
  const CGFloat width = MIN(720, screen.visibleFrame.size.width - 48);
  const CGFloat buttonWidth = 140;
  const CGFloat valueWidth = width - 24 - buttonWidth - 12;
  NSFont* font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
  NSView* document = [[SockeyeDetailRowsView alloc]
      initWithFrame:NSMakeRect(0, 0, width - 24, 0)];
  CGFloat top = 4;
  for (NSArray<NSString*>* row in rows) {
    SockeyeDetailCopyButton* button = [[SockeyeDetailCopyButton alloc]
        initWithFrame:NSMakeRect(0, top + 1, buttonWidth, 24)];
    button.title = [NSString stringWithFormat:@"\u2009%@", row[0]];
    button.imagePosition = NSImageLeft;
    button.imageHugsTitle = NO;
    button.font = [NSFont systemFontOfSize:11];
    button.alignment = NSTextAlignmentLeft;
    button.bezelStyle = NSBezelStyleRounded;
    button.focusRingType = NSFocusRingTypeNone;
    button.payload = row[2];
    button.detailName = row[0];
    [button setCopied:NO];
    button.target = button;
    button.action = @selector(copyDetail:);
    [document addSubview:button];
    NSString* shown = row[1];
    const NSRect measured = [shown boundingRectWithSize:
        NSMakeSize(valueWidth, CGFLOAT_MAX)
        options:NSStringDrawingUsesLineFragmentOrigin |
                NSStringDrawingUsesFontLeading
        attributes:@{NSFontAttributeName: font}];
    const CGFloat estimated = MAX(30, ceil(NSHeight(measured) + 4));
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
    top += estimated + 7;
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

static bool ShowApprovalPromptImpl(const RunOptions& options,
                                   std::string_view request_id,
                                   AuthorizationContext& context,
                                   std::string_view reason,
                                   KeychainError& error) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp finishLaunching];
    NSString* credentials = CredentialSummary(options);
    NSString* executable = MakeString(options.executable.canonical_path);
    NSString* child = executable.lastPathComponent;
    NSString* title = child.length > 0
        ? [NSString stringWithFormat:@"Allow %@ to use %@?", child, credentials]
        : MakeString(reason);
    NSPanel* panel = RequestPanel(360, 256, title);
    SockeyePanelButton* cancel = PanelButton(
        panel, @"Cancel", NSMakeRect(62, 18, 112, 30),
        NSAlertFirstButtonReturn);
    cancel.keyEquivalent = @"\033";
    cancel.showsLinkCursor = YES;
    panel.initialFirstResponder = cancel;
    SockeyePanelButton* details = PanelButton(panel, @"Details",
        NSMakeRect(186, 18, 112, 30), NSAlertSecondButtonReturn);
    details.image = [NSImage imageWithSystemSymbolName:@"chevron.right"
                               accessibilityDescription:@"Expand details"];
    details.imagePosition = NSImageRight;
    details.imageHugsTitle = YES;
    StyleBrandButtonTitle(details, @"Details");
    details.showsLinkCursor = YES;
    details.toolTip = @"Show Touch ID request details";
    details.accessibilityLabel = details.toolTip;
    SockeyeInstructionLabel* instruction = [[SockeyeInstructionLabel alloc]
        initWithFrame:NSZeroRect];
    instruction.stringValue = @"Touch ID to continue";
    instruction.bezeled = NO;
    instruction.drawsBackground = NO;
    instruction.focusRingType = NSFocusRingTypeNone;
    instruction.frame = NSMakeRect(50, 176, 260, 20);
    instruction.alignment = NSTextAlignmentCenter;
    instruction.selectable = NO;
    [panel.contentView addSubview:instruction];
    SockeyeTextShimmer* instructionShimmer =
        [[SockeyeTextShimmer alloc] initWithLabel:instruction];
    NSFont* compactInstructionFont = instruction.font;
    [instructionShimmer setEnabled:YES];
    NSView* authenticationHost = [[NSView alloc]
        initWithFrame:NSMakeRect(132, 72, 96, 96)];
    authenticationHost.wantsLayer = YES;
    authenticationHost.layer.masksToBounds = YES;
    LAAuthenticationView* authenticationView = [[LAAuthenticationView alloc]
        initWithContext:context.NativeContext() controlSize:NSControlSizeRegular];
    authenticationView.frame = authenticationHost.bounds;
    [authenticationHost addSubview:authenticationView];
    [panel.contentView addSubview:authenticationHost];
    SockeyeAuthenticationShieldView* authenticationShield =
        [[SockeyeAuthenticationShieldView alloc]
            initWithFrame:authenticationHost.frame];
    authenticationShield.wantsLayer = YES;
    authenticationShield.layer.masksToBounds = YES;
    [panel.contentView addSubview:authenticationShield];
    [authenticationShield updateSurfaceColor];
    SockeyeFingerprintView* fingerprint = [[SockeyeFingerprintView alloc]
        initWithFrame:authenticationHost.frame];
    fingerprint.accessibilityLabel = @"Touch ID required";
    SockeyeFingerprintClipView* fingerprintClip =
        [[SockeyeFingerprintClipView alloc] initWithFrame:panel.contentView.bounds];
    [fingerprintClip addSubview:fingerprint];
    [panel.contentView addSubview:fingerprintClip];
    [fingerprint updateSurfaceColor];
    [panel center];
    NSRect panelFrame = panel.frame;
    panelFrame.origin.y -= 10;
    [panel setFrame:panelFrame display:NO];
    NSTextField* heading = PanelHeading(panel);
    const NSRect compactFrame = panel.frame;
    const NSRect compactFingerprintFrame = fingerprint.frame;
    NSArray<NSView*>* compactViews = @[heading, cancel, details, instruction];
    NSMutableArray<NSValue*>* compactFrameValues = [NSMutableArray arrayWithCapacity:compactViews.count];
    for (NSView* view in compactViews) {
      [compactFrameValues addObject:[NSValue valueWithRect:view.frame]];
    }
    NSArray<NSValue*>* compactFrames = [compactFrameValues copy];
    const NSSize compactContentSize = panel.contentView.bounds.size;
    StyleApprovalHeading(heading, title, credentials);
    const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    __block NSScrollView* detailRows = nil;
    __block NSArray<NSView*>* expandedViews = nil;
    __block NSArray<NSValue*>* expandedFrames = nil;
    __block NSSize expandedContentSize = NSZeroSize;
    __block BOOL showingDetails = NO;
    __block BOOL transitioningDetails = NO;
    __block BOOL verifying = NO;
    __block BOOL animationStarted = NO;
    __block NSArray<NSView*>* keyboardControls = @[cancel, details];
    __block NSUInteger keyboardFocusIndex = 0;
    void (^focusKeyboardControlAt)(NSUInteger) = ^(NSUInteger index) {
      if (index >= keyboardControls.count) return;
      NSView* control = keyboardControls[index];
      if (control.hidden || ![(NSControl*)control isEnabled]) return;
      keyboardFocusIndex = index;
      [panel makeFirstResponder:control];
      if (detailRows != nil &&
          [control isDescendantOf:detailRows.documentView]) {
        [control scrollRectToVisible:control.bounds];
      }
    };
    void (^moveKeyboardFocus)(NSInteger) = ^(NSInteger direction) {
      const NSUInteger count = keyboardControls.count;
      if (count == 0) return;
      NSResponder* responder = panel.firstResponder;
      NSUInteger current = [responder isKindOfClass:[NSView class]]
          ? [keyboardControls indexOfObject:(NSView*)responder]
          : NSNotFound;
      if (current == NSNotFound) current = keyboardFocusIndex;
      for (NSUInteger step = 1; step <= count; ++step) {
        const NSInteger candidate =
            (static_cast<NSInteger>(current) +
             direction * static_cast<NSInteger>(step) +
             static_cast<NSInteger>(count) * 2) %
            static_cast<NSInteger>(count);
        const NSUInteger index = static_cast<NSUInteger>(candidate);
        NSView* control = keyboardControls[index];
        if (control.hidden || ![(NSControl*)control isEnabled]) continue;
        focusKeyboardControlAt(index);
        return;
      }
    };
    instruction.actionHandler = ^{
      if (!transitioningDetails && !verifying) [fingerprint animateNudge];
    };
    void (^toggleDetails)(BOOL) = ^(BOOL show) {
      if (transitioningDetails || showingDetails == show) return;
      transitioningDetails = YES;
      details.enabled = NO;
      if (show) {
        [instructionShimmer setHighlightsVisible:NO];
        detailRows = DetailRowsView(RequestDetailRows(
            options, request_id, MakeString(reason)));
        const CGFloat width = detailRows.frame.size.width + 40;
        const CGFloat rowsBottom =
            kExpandedFooterHeight + kExpandedRowsFooterGap;
        const CGFloat height = detailRows.frame.size.height + rowsBottom +
            kExpandedRowsHeadingGap + kExpandedHeadingHeight + kExpandedTopInset;
        detailRows.frame = NSMakeRect(20, rowsBottom, detailRows.frame.size.width,
                                      detailRows.frame.size.height);
        detailRows.hidden = YES;
        detailRows.alphaValue = 0;
        [panel.contentView addSubview:detailRows];
        const NSRect hiddenCompactFrame = NSMakeRect(
            compactFingerprintFrame.origin.x, -104,
            compactFingerprintFrame.size.width, compactFingerprintFrame.size.height);
        const NSRect expandedFingerprintFrame = NSMakeRect((width - 96) / 2, 0, 96, 96);
        NSArray<NSValue*>* exitingButtonFrames = @[
          [NSValue valueWithRect:NSOffsetRect(cancel.frame, -kPanelControlTravel, 0)],
          [NSValue valueWithRect:NSOffsetRect(details.frame, kPanelControlTravel, 0)]];
        AnimateViewsAndFingerprint(@[heading, cancel, details, instruction],
            0, fingerprint, hiddenCompactFrame, 0.22, reduceMotion, ^{
          cancel.hidden = YES;
          details.hidden = YES;
          instruction.hidden = YES;
          fingerprint.alphaValue = 0;
          fingerprint.hidden = YES;
          const NSRect expandedFrame = CenteredPanelFrame(compactFrame, width, height);
          AnimatePanelFrame(panel, panel.frame, expandedFrame, reduceMotion,
                            compactViews, compactFrames, compactContentSize, ^{
            authenticationHost.frame = expandedFingerprintFrame;
            authenticationShield.frame = expandedFingerprintFrame;
            heading.stringValue = @"Touch ID request details";
            heading.frame = NSMakeRect(20, height - kExpandedTopInset -
                kExpandedHeadingHeight, width - 40, kExpandedHeadingHeight);
            heading.alignment = NSTextAlignmentCenter;
            detailRows.hidden = NO;
            detailRows.alphaValue = 0;
            details.title = @"";
            StyleBrandButtonTitle(details, @"");
            details.image = [NSImage imageWithSystemSymbolName:@"chevron.left"
                                    accessibilityDescription:@"Back to approval"];
            details.imagePosition = NSImageOnly;
            details.showsLinkCursor = YES;
            [details resetCursorRects];
            const NSRect expandedDetailsFrame =
                NSMakeRect(20, kFingerprintClipBottomInset, 36, 30);
            details.frame = NSOffsetRect(expandedDetailsFrame, -kPanelControlTravel, 0);
            details.toolTip = @"Return to approval";
            details.accessibilityLabel = details.toolTip;
            details.hidden = NO;
            instruction.font = [NSFont systemFontOfSize:14];
            const NSRect expandedInstructionFrame = NSMakeRect(
                width - 220, kFingerprintClipBottomInset - 8, 200, 30);
            instruction.frame = NSOffsetRect(expandedInstructionFrame,
                                             kPanelControlTravel, 0);
            instruction.alignment = NSTextAlignmentRight;
            instruction.hidden = NO;
            [instructionShimmer setHighlightsVisible:YES];
            expandedViews = @[heading, detailRows, details, instruction];
            expandedFrames = @[[NSValue valueWithRect:heading.frame],
                               [NSValue valueWithRect:detailRows.frame],
                               [NSValue valueWithRect:expandedDetailsFrame],
                               [NSValue valueWithRect:expandedInstructionFrame]];
            expandedContentSize = panel.contentView.bounds.size;
            fingerprint.frame = NSOffsetRect(expandedFingerprintFrame, 0, -104);
            [fingerprint showUpperHalf];
            fingerprint.alphaValue = 0;
            fingerprint.hidden = NO;
            AnimateViewsAndFingerprint(@[heading, detailRows, details, instruction,
                                         fingerprint], 1, fingerprint,
                expandedFingerprintFrame, 0.16, reduceMotion, ^{
              [instructionShimmer update];
              showingDetails = YES;
              transitioningDetails = NO;
              details.enabled = YES;
              NSMutableArray<NSView*>* expandedKeyboardControls =
                  [NSMutableArray arrayWithObject:details];
              NSView* firstDetailControl = nil;
              for (NSView* control in detailRows.documentView.subviews) {
                if (![control isKindOfClass:[SockeyeDetailCopyButton class]]) {
                  continue;
                }
                if (firstDetailControl == nil) firstDetailControl = control;
                [expandedKeyboardControls addObject:control];
              }
              keyboardControls = [expandedKeyboardControls copy];
              const NSUInteger firstDetailIndex =
                  firstDetailControl != nil
                      ? [keyboardControls indexOfObject:firstDetailControl]
                      : 0;
              focusKeyboardControlAt(firstDetailIndex);
              if (firstDetailControl == nil) {
                focusKeyboardControlAt(0);
              }
            }, @[details, instruction], @[
                [NSValue valueWithRect:expandedDetailsFrame],
                [NSValue valueWithRect:expandedInstructionFrame]],
                kPanelControlDuration);
          });
        }, @[cancel, details, authenticationHost, authenticationShield], @[
            exitingButtonFrames[0], exitingButtonFrames[1],
            [NSValue valueWithRect:hiddenCompactFrame],
            [NSValue valueWithRect:hiddenCompactFrame]],
            kPanelControlDuration);
        return;
      }
      const NSRect offscreenExpandedFrame =
          NSOffsetRect(fingerprint.frame, 0, -104 - fingerprint.frame.origin.y);
      const NSRect backOffscreenFrame =
          NSOffsetRect(details.frame, -kPanelControlTravel, 0);
      const NSRect instructionOffscreenFrame =
          NSOffsetRect(instruction.frame, kPanelControlTravel, 0);
      AnimateViewsAndFingerprint(@[heading, detailRows, details, instruction],
          0, fingerprint, offscreenExpandedFrame, 0.22, reduceMotion, ^{
        detailRows.hidden = YES;
        details.hidden = YES;
        instruction.hidden = YES;
        fingerprint.alphaValue = 0;
        fingerprint.hidden = YES;
        AnimatePanelFrame(panel, panel.frame, compactFrame, reduceMotion,
                          expandedViews, expandedFrames, expandedContentSize, ^{
          authenticationHost.frame = compactFingerprintFrame;
          authenticationShield.frame = compactFingerprintFrame;
          StyleApprovalHeading(heading, title, credentials);
          heading.alignment = NSTextAlignmentCenter;
          instruction.font = compactInstructionFont;
          instruction.alignment = NSTextAlignmentCenter;
          if (verifying) {
            [fingerprint animateFullReveal:0.16];
          } else {
            [fingerprint showFullFingerprint];
          }
          details.title = @"Details";
          StyleBrandButtonTitle(details, @"Details");
          details.image = [NSImage imageWithSystemSymbolName:@"chevron.right"
                                    accessibilityDescription:@"Expand details"];
          details.imagePosition = NSImageRight;
          details.imageHugsTitle = YES;
          details.showsLinkCursor = YES;
          [details resetCursorRects];
          details.frame = compactFrames[2].rectValue;
          details.toolTip = @"Show Touch ID request details";
          details.accessibilityLabel = details.toolTip;
          for (NSUInteger index = 0; index < compactViews.count; ++index) {
            compactViews[index].frame = compactFrames[index].rectValue;
          }
          fingerprint.frame = NSOffsetRect(compactFingerprintFrame, 0, -104);
          fingerprint.hidden = NO;
          fingerprint.alphaValue = 0;
          cancel.hidden = NO;
          details.hidden = NO;
          instruction.hidden = NO;
          [instructionShimmer setHighlightsVisible:YES];
          if (verifying) {
            cancel.alphaValue = 0;
            details.alphaValue = 0;
            heading.alphaValue = 1;
            [instructionShimmer setBaseColor:SocketBrandColor()
                               highlightColor:SocketShimmerHighlightColor()];
            instruction.stringValue = @"Verifying…";
            [instructionShimmer setEnabled:YES];
            instruction.alphaValue = 1;
            AnimateViewsAndFingerprint(@[fingerprint], 1, fingerprint,
                compactFingerprintFrame, 0.16, reduceMotion, ^{
              [instructionShimmer update];
              showingDetails = NO;
              transitioningDetails = NO;
              details.enabled = YES;
              keyboardControls = @[cancel, details];
              focusKeyboardControlAt(1);
            });
            return;
          }
          cancel.frame = NSOffsetRect(compactFrames[1].rectValue,
                                      -kPanelControlTravel, 0);
          details.frame = NSOffsetRect(compactFrames[2].rectValue,
                                       kPanelControlTravel, 0);
          cancel.alphaValue = 0;
          details.alphaValue = 0;
          AnimateViewsAndFingerprint(@[fingerprint, cancel, details], 1,
              fingerprint, compactFingerprintFrame, kPanelControlDuration,
              reduceMotion, ^{
            AnimateViewsAndFingerprint(@[heading, instruction], 1, fingerprint,
                fingerprint.frame, 0.07, reduceMotion, ^{
              [instructionShimmer update];
              showingDetails = NO;
              transitioningDetails = NO;
              details.enabled = YES;
              keyboardControls = @[cancel, details];
              focusKeyboardControlAt(1);
            });
          }, @[cancel, details], @[
              [NSValue valueWithRect:compactFrames[1].rectValue],
              [NSValue valueWithRect:compactFrames[2].rectValue]],
              kPanelControlDuration);
        });
      }, @[details, instruction, authenticationHost, authenticationShield], @[
          [NSValue valueWithRect:backOffscreenFrame],
          [NSValue valueWithRect:instructionOffscreenFrame],
          [NSValue valueWithRect:offscreenExpandedFrame],
          [NSValue valueWithRect:offscreenExpandedFrame]],
          kPanelControlDuration);
    };
    [NSApp activateIgnoringOtherApps:YES];
    [panel makeKeyAndOrderFront:nil];
    NSModalSession session = [NSApp beginModalSessionForWindow:panel];
    bool cancelled = false;
    details.actionHandler = ^{ toggleDetails(showingDetails == NO); };
    id fingerprintClickMonitor = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
        handler:^NSEvent*(NSEvent*event) {
          if (event.window != panel || transitioningDetails || verifying) {
            return event;
          }
          const NSPoint point = [panel.contentView
              convertPoint:event.locationInWindow fromView:nil];
          const NSRect fingerprintFrame = [fingerprint
              convertRect:fingerprint.bounds toView:panel.contentView];
          if (NSPointInRect(point, fingerprintFrame)) {
            [fingerprint animateNudge];
          }
          return event;
        }];
    id keyboardMonitor = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
        handler:^NSEvent*(NSEvent* event) {
          if (event.window != panel || transitioningDetails || verifying) {
            return event;
          }
          const NSUInteger key = event.keyCode;
          NSResponder* responder = panel.firstResponder;
          const NSUInteger focusedIndex =
              [responder isKindOfClass:[NSView class]]
                  ? [keyboardControls indexOfObject:(NSView*)responder]
                  : NSNotFound;
          if (key == 48 ||
              ((key == 123 || key == 124) && focusedIndex != NSNotFound)) {
            NSInteger direction = key == 123 ? -1 : 1;
            if (key == 48 &&
                (event.modifierFlags & NSEventModifierFlagShift) != 0) {
              direction = -1;
            }
            moveKeyboardFocus(direction);
            return nil;
          }
          if (key == 36 || key == 49) {
            const NSUInteger index =
                [responder isKindOfClass:[NSView class]]
                    ? [keyboardControls indexOfObject:(NSView*)responder]
                    : NSNotFound;
            if (index != NSNotFound &&
                [keyboardControls[index] isKindOfClass:[NSButton class]]) {
              [(NSButton*)keyboardControls[index] performClick:nil];
              return nil;
            }
          }
          return event;
        }];
    const bool authenticated = context.AuthenticateWithEvents(reason, error, [&cancelled, &session, &context] {
      if (cancelled) return;
      const NSModalResponse response = [NSApp runModalSession:session];
      if (response == NSModalResponseContinue) return;
      cancelled = true;
      context.Invalidate();
    });
    if (authenticated && !cancelled) {
      NSDate* scanStartedAt = nil;
      while (transitioningDetails) {
        [[NSRunLoop currentRunLoop]
            runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0 / 60.0]];
      }
      if (showingDetails) {
        verifying = YES;
        fingerprint.accessibilityLabel = @"Verifying";
        [instructionShimmer setBaseColor:SocketBrandColor()
                           highlightColor:SocketShimmerHighlightColor()];
        instruction.stringValue = @"Verifying…";
        [instructionShimmer setEnabled:YES];
        cancel.enabled = NO;
        cancel.keyEquivalent = @"";
        details.enabled = NO;
        scanStartedAt = [NSDate date];
        [fingerprint animateSuccess];
        animationStarted = YES;
        toggleDetails(NO);
        while (transitioningDetails) {
          [[NSRunLoop currentRunLoop]
              runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0 / 60.0]];
        }
      }
      fingerprint.accessibilityLabel = @"Verifying";
      [instructionShimmer setBaseColor:SocketBrandColor()
                         highlightColor:SocketShimmerHighlightColor()];
      instruction.stringValue = @"Verifying…";
      [instructionShimmer setEnabled:YES];
      cancel.enabled = NO;
      cancel.keyEquivalent = @"";
      details.enabled = NO;
      if (!animationStarted) {
        scanStartedAt = [NSDate date];
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
      }
      const NSTimeInterval duration =
          NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion ? 0.18 : kFingerprintDuration;
      const NSTimeInterval verifiedDelay = duration * 0.85;
      NSDate* verifiedAt = [scanStartedAt dateByAddingTimeInterval:verifiedDelay];
      NSDate* deadline = [verifiedAt dateByAddingTimeInterval:0.4];
      bool displayedVerified = false;
      while (deadline.timeIntervalSinceNow > 0) {
        if (!displayedVerified && verifiedAt.timeIntervalSinceNow <= 0) {
          [instructionShimmer setEnabled:NO];
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
    [NSEvent removeMonitor:fingerprintClickMonitor];
    [NSEvent removeMonitor:keyboardMonitor];
    if (cancelled) {
      context.Invalidate();
      error.status = KeychainStatus::kDenied;
      error.detail = "Approval cancelled.";
      return false;
    }
    return authenticated;
  }
}

bool ShowApprovalPrompt(const RunOptions& options,
                        std::string_view request_id,
                        AuthorizationContext& context, std::string_view reason,
                        KeychainError& error) {
  return ShowApprovalPromptImpl(options, request_id, context, reason, error);
}

} // namespace sockeye
