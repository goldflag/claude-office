import AppKit

enum Icon {
    /// The Clawd from the favicon. With no eye color the eyes are cut out, so the
    /// menu bar shows through them.
    private static func clawd(in rect: NSRect, color: NSColor, eyes: NSColor? = nil) {
        let s = rect.width / 32
        let oy = rect.minY + (rect.height - 19 * s) / 2
        func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSBezierPath {
            // SVG coordinates are top-down; AppKit's are bottom-up.
            NSBezierPath(roundedRect: NSRect(x: rect.minX + x * s, y: oy + (26 - y - h) * s, width: w * s, height: h * s),
                         xRadius: r * s, yRadius: r * s)
        }
        // labelColor is translucent, which would darken where the parts overlap.
        color.withAlphaComponent(1).setFill()
        for part in [box(4, 7, 24, 15, 4), box(1, 12, 5, 5, 2), box(26, 12, 5, 5, 2),
                     box(7, 20, 4, 6, 1.5), box(21, 20, 4, 6, 1.5)] {
            part.fill()
        }
        if let eyes {
            eyes.setFill()
        } else {
            NSGraphicsContext.current?.compositingOperation = .destinationOut
        }
        box(11, 11, 2.6, 5.5, 1.2).fill()
        box(18.4, 11, 2.6, 5.5, 1.2).fill()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
    }

    static let normal: NSImage = {
        let image = NSImage(size: NSSize(width: 22, height: 18), flipped: false) { rect in
            clawd(in: rect.insetBy(dx: 1, dy: 0), color: .black)
            return true
        }
        image.isTemplate = true
        return image
    }()

    /// A small ring: agents are working. Template, so it reads as part of the Clawd.
    static let working: NSImage = badged { rect in
        let ring = NSBezierPath(ovalIn: NSRect(x: rect.maxX - 6.5, y: rect.maxY - 7, width: 5.5, height: 5.5))
        ring.lineWidth = 1.5
        NSColor.black.setStroke()
        ring.stroke()
    }

    /// A check mark, shown for a few seconds after an agent finishes.
    static let done: NSImage = badged { rect in
        let check = NSBezierPath()
        check.move(to: NSPoint(x: rect.maxX - 7, y: rect.maxY - 4.5))
        check.line(to: NSPoint(x: rect.maxX - 4.8, y: rect.maxY - 6.8))
        check.line(to: NSPoint(x: rect.maxX - 0.8, y: rect.maxY - 1.5))
        check.lineWidth = 1.6
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        NSColor.black.setStroke()
        check.stroke()
    }

    private static func badged(_ badge: @escaping (NSRect) -> Void) -> NSImage {
        let image = NSImage(size: NSSize(width: 24, height: 18), flipped: false) { rect in
            clawd(in: NSRect(x: 1, y: 0, width: 20, height: 18), color: .black)
            badge(rect)
            return true
        }
        image.isTemplate = true
        return image
    }

    /// Drawn at display time so the Clawd matches a light or dark menu bar while the dot stays yellow.
    static let needsYou: NSImage = {
        NSImage(size: NSSize(width: 24, height: 18), flipped: false) { rect in
            clawd(in: NSRect(x: 1, y: 0, width: 20, height: 18), color: .labelColor)
            let dot = NSBezierPath(ovalIn: NSRect(x: rect.maxX - 6, y: rect.maxY - 6.5, width: 6, height: 6))
            NSColor(srgbRed: 0.95, green: 0.69, blue: 0, alpha: 1).setFill()
            dot.fill()
            return true
        }
    }()

    /// The status dot beside an agent in the menu, in the board's colors.
    static func dot(_ group: Group) -> NSImage {
        let hex: UInt32 = switch group {
        case .needs: 0xF2B100
        case .working: 0x2B9A66
        case .done: 0x3A7FC2
        case .idle, .away: 0x8794A7
        case .asleep: 0xA48CCB
        }
        return NSImage(size: NSSize(width: 10, height: 10), flipped: false) { rect in
            NSColor(srgbRed: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255,
                    blue: CGFloat(hex & 0xFF) / 255, alpha: 1).setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
            return true
        }
    }

    /// The Dock and Finder icon: an orange Clawd on the office's sky blue.
    static func app(side: CGFloat) -> NSImage {
        NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            // Apple's grid leaves a 100/1024 margin around the tile.
            let tile = rect.insetBy(dx: side * 100 / 1024, dy: side * 100 / 1024)
            let shape = NSBezierPath(roundedRect: tile, xRadius: tile.width * 0.225, yRadius: tile.width * 0.225)
            NSGradient(starting: NSColor(srgbRed: 0.80, green: 0.88, blue: 0.96, alpha: 1),
                       ending: NSColor(srgbRed: 0.62, green: 0.76, blue: 0.91, alpha: 1))!.draw(in: shape, angle: -90)
            clawd(in: tile.insetBy(dx: tile.width * 0.13, dy: tile.width * 0.13),
                  color: NSColor(srgbRed: 0.85, green: 0.47, blue: 0.34, alpha: 1),
                  eyes: NSColor(srgbRed: 0.11, green: 0.11, blue: 0.10, alpha: 1))
            return true
        }
    }

    /// Writes the PNGs `iconutil` turns into AppIcon.icns. The build script calls this.
    static func writeIconset(to dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for points in [16, 32, 128, 256, 512] {
            for scale in [1, 2] {
                let px = points * scale
                let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                app(side: CGFloat(px)).draw(in: NSRect(x: 0, y: 0, width: px, height: px))
                NSGraphicsContext.restoreGraphicsState()
                let name = scale == 1 ? "icon_\(points)x\(points).png" : "icon_\(points)x\(points)@2x.png"
                try rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent(name))
            }
        }
    }
}
