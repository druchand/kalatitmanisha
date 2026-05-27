import AppKit
import Foundation

struct Shot {
    let source: String
    let outputName: String
    let title: String
    let subtitle: String
}

struct Layout {
    let width: Int
    let height: Int
    let topInset: CGFloat
    let titleSize: CGFloat
    let subtitleSize: CGFloat
    let imageTop: CGFloat
    let imageHeight: CGFloat
    let cornerRadius: CGFloat
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)

let iphoneShots = [
    Shot(
        source: "assets/marketing/home.jpg",
        outputName: "01-timeless-gita-wisdom.png",
        title: "Timeless Gita Wisdom",
        subtitle: "Daily shlokas, world views, and guided exploration."
    ),
    Shot(
        source: "assets/marketing/dilemma.jpg",
        outputName: "02-guidance-for-dilemmas.png",
        title: "Guidance for Dilemmas",
        subtitle: "Explore anger, confusion, loneliness, and more."
    ),
    Shot(
        source: "assets/marketing/favourites.jpg",
        outputName: "03-save-meaningful-verses.png",
        title: "Save Meaningful Verses",
        subtitle: "Keep favourite shlokas and reflections in one place."
    ),
    Shot(
        source: "assets/marketing/aichat.jpg",
        outputName: "04-ask-and-reflect.png",
        title: "Ask and Reflect",
        subtitle: "Use AI chat for calm, contextual spiritual guidance."
    ),
]

let ipadShots = [
    Shot(
        source: "assets/appstore-preview-drafts/ipad-frames/frame_1.jpg",
        outputName: "01-timeless-gita-wisdom.png",
        title: "Timeless Gita Wisdom",
        subtitle: "A focused Bhagavad Gita companion for study and reflection."
    ),
    Shot(
        source: "assets/appstore-preview-drafts/ipad-frames/frame_3.jpg",
        outputName: "02-guidance-for-dilemmas.png",
        title: "Guidance for Dilemmas",
        subtitle: "Connect life situations with relevant verses."
    ),
    Shot(
        source: "assets/appstore-preview-drafts/ipad-frames/frame_5.jpg",
        outputName: "03-listen-and-recite.png",
        title: "Listen and Recite",
        subtitle: "Practice shlokas with narration and recitation tools."
    ),
    Shot(
        source: "assets/appstore-preview-drafts/ipad-frames/frame_8.jpg",
        outputName: "04-save-and-return.png",
        title: "Save and Return",
        subtitle: "Bookmark verses and pages for repeated study."
    ),
]

let iphoneLayout = Layout(
    width: 1284,
    height: 2778,
    topInset: 88,
    titleSize: 72,
    subtitleSize: 34,
    imageTop: 360,
    imageHeight: 2360,
    cornerRadius: 48
)

let ipadLayout = Layout(
    width: 2048,
    height: 2732,
    topInset: 100,
    titleSize: 90,
    subtitleSize: 42,
    imageTop: 360,
    imageHeight: 2260,
    cornerRadius: 56
)

func color(_ hex: UInt32) -> NSColor {
    let r = CGFloat((hex >> 16) & 0xff) / 255.0
    let g = CGFloat((hex >> 8) & 0xff) / 255.0
    let b = CGFloat(hex & 0xff) / 255.0
    return NSColor(calibratedRed: r, green: g, blue: b, alpha: 1)
}

func drawText(_ text: String, in rect: NSRect, fontSize: CGFloat, weight: NSFont.Weight, color textColor: NSColor) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: fontSize, weight: weight),
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
    ]
    NSString(string: text).draw(in: rect, withAttributes: attrs)
}

func drawRoundedImage(_ image: NSImage, in rect: NSRect, radius: CGFloat) {
    NSGraphicsContext.current?.imageInterpolation = .high

    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.shadowBlurRadius = 26
    shadow.set()

    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    color(0xffffff).setFill()
    path.fill()

    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    image.draw(in: rect, from: NSRect(origin: .zero, size: image.size), operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
}

func render(_ shot: Shot, layout: Layout, outputDir: String) throws {
    let sourceURL = root.appendingPathComponent(shot.source)
    let outputURL = root.appendingPathComponent(outputDir).appendingPathComponent(shot.outputName)
    guard let sourceImage = NSImage(contentsOf: sourceURL) else {
        throw NSError(domain: "ScreenshotComposer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing source image: \(shot.source)"])
    }

    let canvasSize = NSSize(width: layout.width, height: layout.height)
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: layout.width,
        pixelsHigh: layout.height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "ScreenshotComposer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to create bitmap"])
    }

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "ScreenshotComposer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to create graphics context"])
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    defer { NSGraphicsContext.restoreGraphicsState() }

    color(0xf8fafc).setFill()
    NSRect(origin: .zero, size: canvasSize).fill()

    drawText(
        shot.title,
        in: NSRect(x: 72, y: CGFloat(layout.height) - layout.topInset - layout.titleSize - 8, width: CGFloat(layout.width) - 144, height: layout.titleSize + 20),
        fontSize: layout.titleSize,
        weight: .heavy,
        color: color(0x111827)
    )
    drawText(
        shot.subtitle,
        in: NSRect(x: 96, y: CGFloat(layout.height) - layout.topInset - layout.titleSize - layout.subtitleSize - 56, width: CGFloat(layout.width) - 192, height: layout.subtitleSize + 28),
        fontSize: layout.subtitleSize,
        weight: .semibold,
        color: color(0x475569)
    )

    let imageAspect = sourceImage.size.width / sourceImage.size.height
    let imageHeight = layout.imageHeight
    let imageWidth = min(CGFloat(layout.width) - 120, imageHeight * imageAspect)
    let imageX = (CGFloat(layout.width) - imageWidth) / 2
    let imageY = CGFloat(layout.height) - layout.imageTop - imageHeight
    drawRoundedImage(sourceImage, in: NSRect(x: imageX, y: imageY, width: imageWidth, height: imageHeight), radius: layout.cornerRadius)

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ScreenshotComposer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to encode PNG"])
    }
    try data.write(to: outputURL)
    print(outputURL.path)
}

do {
    for shot in iphoneShots {
        try render(shot, layout: iphoneLayout, outputDir: "assets/appstore-review-screenshots/iphone-6.5")
    }
    for shot in ipadShots {
        try render(shot, layout: ipadLayout, outputDir: "assets/appstore-review-screenshots/ipad-12.9")
    }
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
