import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outputPath = CommandLine.arguments.dropFirst().first ?? "build/icon-1024.png"
let size = 1024
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!

context.translateBy(x: 0, y: CGFloat(size))
context.scaleBy(x: 1, y: -1)

let panel = CGPath(
    roundedRect: CGRect(x: 42, y: 42, width: 940, height: 940),
    cornerWidth: 224,
    cornerHeight: 224,
    transform: nil
)
context.addPath(panel)
context.clip()
let panelGradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        CGColor(red: 0.14, green: 0.16, blue: 0.13, alpha: 1),
        CGColor(red: 0.07, green: 0.08, blue: 0.06, alpha: 1)
    ] as CFArray,
    locations: [0, 1]
)!
context.drawLinearGradient(
    panelGradient,
    start: CGPoint(x: 120, y: 100),
    end: CGPoint(x: 920, y: 930),
    options: []
)
context.resetClip()
context.addPath(panel)
context.setStrokeColor(CGColor(red: 0.23, green: 0.25, blue: 0.21, alpha: 1))
context.setLineWidth(14)
context.strokePath()

let mark = CGMutablePath()
mark.move(to: CGPoint(x: 246, y: 240))
mark.addLine(to: CGPoint(x: 800, y: 240))
mark.addLine(to: CGPoint(x: 800, y: 342))
mark.addLine(to: CGPoint(x: 468, y: 684))
mark.addLine(to: CGPoint(x: 800, y: 684))
mark.addLine(to: CGPoint(x: 800, y: 800))
mark.addLine(to: CGPoint(x: 224, y: 800))
mark.addLine(to: CGPoint(x: 224, y: 696))
mark.addLine(to: CGPoint(x: 557, y: 356))
mark.addLine(to: CGPoint(x: 246, y: 356))
mark.closeSubpath()

context.saveGState()
context.setShadow(
    offset: CGSize(width: 0, height: 28),
    blur: 56,
    color: CGColor(gray: 0, alpha: 0.45)
)
context.addPath(mark)
context.clip()
let markGradient = CGGradient(
    colorsSpace: colorSpace,
    colors: [
        CGColor(red: 0.79, green: 1, blue: 0.24, alpha: 1),
        CGColor(red: 0.56, green: 0.92, blue: 0.08, alpha: 1)
    ] as CFArray,
    locations: [0, 1]
)!
context.drawLinearGradient(
    markGradient,
    start: CGPoint(x: 260, y: 250),
    end: CGPoint(x: 760, y: 780),
    options: []
)
context.restoreGState()

let notch = CGMutablePath()
notch.move(to: CGPoint(x: 417, y: 604))
notch.addLine(to: CGPoint(x: 502, y: 689))
notch.addLine(to: CGPoint(x: 417, y: 774))
notch.addLine(to: CGPoint(x: 332, y: 689))
notch.closeSubpath()
context.addPath(notch)
context.setFillColor(CGColor(red: 0.09, green: 0.10, blue: 0.08, alpha: 1))
context.fillPath()

guard
    let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: outputPath) as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    )
else {
    fatalError("Unable to create icon image")
}

CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Unable to save icon image")
}
