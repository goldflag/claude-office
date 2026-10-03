// Claude Office in the macOS menu bar: a Clawd icon that turns yellow when an
// agent needs you, and a popover with the office in it that can also open, or be
// dragged off, into a regular window. The app runs the Bun server itself unless
// one is already listening, so `bun run dev` keeps working.

import AppKit
import ServiceManagement
import WebKit

/// Values the build script bakes into Info.plist, since apps opened from Finder
/// do not inherit the shell's PATH and cannot find the repo on their own.
enum Config {
    static let info = Bundle.main.infoDictionary ?? [:]
    static let repo = info["OfficeRepo"] as? String ?? ""
    static let bun = info["OfficeBun"] as? String ?? "bun"
    static let path = info["OfficePath"] as? String ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    static let port = 4821
    static let base = URL(string: "http://localhost:\(port)")!
    static let log = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Claude Office.log")
}

// MARK: - Server

/// Starts `bun server/index.ts` when nothing is listening, and restarts it if it dies.
final class Server {
    private var process: Process?
    private var quitting = false
    private var restarts = 0

    var owned: Bool { process?.isRunning == true }

    func ensureRunning() {
        Task {
            if await Server.isUp() { return }
            await MainActor.run { self.launch() }
        }
    }

    static func isUp() async -> Bool {
        var req = URLRequest(url: Config.base.appendingPathComponent("api/snapshot"), timeoutInterval: 1.5)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (_, res) = try? await URLSession.shared.data(for: req) else { return false }
        return (res as? HTTPURLResponse)?.statusCode == 200
    }

    private func launch() {
        guard process?.isRunning != true else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: Config.bun)
        p.arguments = ["server/index.ts"]
        p.currentDirectoryURL = URL(fileURLWithPath: Config.repo)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Config.path
        env["NODE_ENV"] = "production"
        env["PORT"] = String(Config.port)
        p.environment = env

        FileManager.default.createFile(atPath: Config.log.path, contents: nil)
        if let out = try? FileHandle(forWritingTo: Config.log) {
            out.seekToEndOfFile()
            p.standardOutput = out
            p.standardError = out
        }

        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.exited() }
        }
        do {
            try p.run()
            process = p
        } catch {
            NSLog("Claude Office: could not start the server: \(error)")
        }
    }

    private func exited() {
        process = nil
        guard !quitting else { return }
        // Back off so a server that crashes on start does not spin.
        restarts += 1
        let delay = min(30.0, Double(restarts) * 2)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.ensureRunning() }
    }

    func restart() {
        restarts = 0
        if let p = process, p.isRunning {
            p.terminate() // the termination handler starts it again
        } else {
            ensureRunning()
        }
    }

    func stop() {
        quitting = true
        guard let p = process, p.isRunning else { return }
        p.terminate()
        p.waitUntilExit()
    }

    func resetBackoff() { restarts = 0 }
}

// MARK: - Snapshot

/// The few fields of the server's snapshot that the icon needs.
struct Snapshot: Decodable {
    struct Agent: Decodable {
        let name: String
        let activity: String
    }
    let agents: [Agent]

    var needsYou: [Agent] { agents.filter { $0.activity == "waiting" } }
    var working: Int {
        let resting: Set = ["waiting", "done", "idle", "sleeping", "away"]
        return agents.filter { !resting.contains($0.activity) }.count
    }
}

// MARK: - Icon

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

// MARK: - App

/// Popover sizes. Below 820 points wide the office stacks the board under the
/// scene; Large is wide enough for the desktop layout.
enum PopoverSize: String, CaseIterable {
    case small, medium, large

    var title: String { rawValue.capitalized }

    var size: NSSize {
        switch self {
        case .small: NSSize(width: 460, height: 680)
        case .medium: NSSize(width: 640, height: 860)
        case .large: NSSize(width: 1100, height: 760)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, NSWindowDelegate {
    private let server = Server()
    private var item: NSStatusItem!
    private let popover = NSPopover()
    /// One web view moves between the popover and the window, so the office keeps its state.
    private var web: WKWebView!
    private var window: NSWindow?
    private var poll: Timer?
    private var lastNeeds = -1
    private var online = false

    private var popoverSize: PopoverSize {
        get { PopoverSize(rawValue: UserDefaults.standard.string(forKey: "popoverSize") ?? "") ?? .small }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "popoverSize") }
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        guard FileManager.default.fileExists(atPath: Config.repo + "/server/index.ts") else {
            let alert = NSAlert()
            alert.messageText = "Claude Office can't find its project folder"
            alert.informativeText = "It was built for \(Config.repo). If you moved the repo, run `bun run menubar` again from its new location."
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        NSApp.mainMenu = mainMenu()

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = Icon.normal
        item.button?.imagePosition = .imageLeading
        item.button?.appearsDisabled = true
        item.button?.toolTip = "Claude Office: starting"
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: NSRect(origin: .zero, size: popoverSize.size), configuration: config)
        web.autoresizingMask = [.width, .height]
        let host = NSViewController()
        host.view = NSView(frame: web.frame)
        host.view.addSubview(web)
        popover.contentViewController = host
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self

        server.ensureRunning()
        poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refresh() }
        refresh()
    }

    /// Opening the app again from Spotlight or Finder while it runs opens the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        openWindow()
        return false
    }

    func applicationWillTerminate(_ note: Notification) {
        server.stop()
    }

    // MARK: Status

    private func refresh() {
        Task {
            let snapshot = await Self.fetch()
            await MainActor.run { self.show(snapshot) }
        }
    }

    private static func fetch() async -> Snapshot? {
        var req = URLRequest(url: Config.base.appendingPathComponent("api/snapshot"), timeoutInterval: 1.5)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    private func show(_ snapshot: Snapshot?) {
        guard let button = item.button else { return }
        guard let snapshot else {
            if online { server.ensureRunning() }
            online = false
            lastNeeds = -1
            button.image = Icon.normal
            button.title = ""
            button.appearsDisabled = true
            button.toolTip = "Claude Office: the server is not running"
            return
        }
        if !online {
            // Loading now means the popover opens on a ready office. WebKit pauses
            // the scene's rendering while the popover is closed.
            online = true
            server.resetBackoff()
            load()
        }
        button.appearsDisabled = false

        let needs = snapshot.needsYou
        if needs.count != lastNeeds {
            lastNeeds = needs.count
            button.image = needs.isEmpty ? Icon.normal : Icon.needsYou
            button.title = needs.isEmpty ? "" : " \(needs.count)"
        }
        if !needs.isEmpty {
            let names = needs.map(\.name).joined(separator: ", ")
            button.toolTip = needs.count == 1 ? "\(names) needs you" : "\(names) need you"
        } else if snapshot.working > 0 {
            button.toolTip = "\(snapshot.working) working"
        } else {
            button.toolTip = snapshot.agents.isEmpty ? "No agents running" : "All quiet"
        }
    }

    private func load() {
        var url = URLComponents(url: Config.base, resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "menubar", value: nil)]
        web.load(URLRequest(url: url.url!))
    }

    // MARK: Popover

    @objc private func clicked() {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else if window?.isVisible == true {
            // The office is in the window, so bring that forward instead.
            openWindow()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        if web.url == nil { load() }
        popover.contentSize = fittedPopoverSize(for: button)
        // Activating lets the message box take keystrokes.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    /// The chosen size, shrunk to leave a margin on the screen the menu bar is on.
    private func fittedPopoverSize(for button: NSView) -> NSSize {
        let want = popoverSize.size
        guard let screen = button.window?.screen ?? NSScreen.main else { return want }
        let room = screen.visibleFrame.size
        return NSSize(width: min(want.width, room.width - 24), height: min(want.height, room.height - 24))
    }

    func popoverShouldDetach(_ popover: NSPopover) -> Bool { true }

    /// Dragging the popover off the menu bar turns it into the office window.
    func detachableWindow(for popover: NSPopover) -> NSWindow? {
        let window = officeWindow()
        window.setContentSize(popover.contentSize)
        move(into: window.contentView!)
        showInDock(true)
        return window
    }

    // MARK: Window

    @objc private func openWindow() {
        let window = officeWindow()
        if web.superview !== window.contentView {
            popover.performClose(nil)
            move(into: window.contentView!)
        }
        showInDock(true)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func officeWindow() -> NSWindow {
        if let window { return window }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = "Claude Office"
        w.isReleasedWhenClosed = false
        w.minSize = NSSize(width: 420, height: 480)
        // Opening from the menu bar brings the window to the desktop you are on.
        w.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary]
        w.contentView = NSView()
        w.delegate = self
        w.center()
        // Restores the size and place it had last time, if any.
        w.setFrameAutosaveName("Office")
        window = w
        return w
    }

    func windowWillClose(_ note: Notification) {
        move(into: popover.contentViewController!.view)
        showInDock(false)
    }

    private func move(into container: NSView) {
        guard web.superview !== container else { return }
        web.removeFromSuperview()
        web.frame = container.bounds
        container.addSubview(web)
    }

    /// The app lives in the menu bar, and joins the Dock and ⌘-Tab only while its window is open.
    private func showInDock(_ shown: Bool) {
        NSApp.setActivationPolicy(shown ? .regular : .accessory)
        if shown { NSApp.applicationIconImage = Icon.app(side: 512) }
    }

    // MARK: Menus

    private func showMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "Open Window", action: #selector(openWindow), keyEquivalent: "n").target = self

        let sizes = NSMenu()
        for size in PopoverSize.allCases {
            let entry = sizes.addItem(withTitle: size.title, action: #selector(pickSize(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = size.rawValue
            entry.state = size == popoverSize ? .on : .off
        }
        menu.addItem(withTitle: "Popover Size", action: nil, keyEquivalent: "").submenu = sizes
        menu.addItem(withTitle: "Reload Office", action: #selector(reload), keyEquivalent: "r").target = self
        menu.addItem(.separator())
        let restart = menu.addItem(withTitle: "Restart Server", action: #selector(restartServer), keyEquivalent: "")
        restart.target = self
        if !server.owned && online {
            restart.title = "Server Started Elsewhere"
            restart.action = nil
        }
        menu.addItem(withTitle: "Show Server Log", action: #selector(showLog), keyEquivalent: "").target = self
        menu.addItem(.separator())
        let login = menu.addItem(withTitle: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Claude Office", action: #selector(quit), keyEquivalent: "q").target = self

        // Attaching the menu only for this click keeps left-click free for the popover.
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    /// The app's own menus. They are what make ⌘C, ⌘V, ⌘W and the rest work,
    /// in the popover as well as the window.
    private func mainMenu() -> NSMenu {
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            main.addItem(withTitle: title, action: nil, keyEquivalent: "").submenu = menu
        }
        func entry(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command,
                   target: AnyObject? = nil) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = mods
            item.target = target
            return item
        }
        submenu("Claude Office", [
            entry("Open Window", #selector(openWindow), "n", target: self),
            .separator(),
            entry("Hide Claude Office", #selector(NSApplication.hide(_:)), "h"),
            entry("Quit Claude Office", #selector(quit), "q", target: self),
        ])
        submenu("Edit", [
            entry("Undo", Selector(("undo:")), "z"),
            entry("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            entry("Cut", #selector(NSText.cut(_:)), "x"),
            entry("Copy", #selector(NSText.copy(_:)), "c"),
            entry("Paste", #selector(NSText.paste(_:)), "v"),
            entry("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        submenu("View", [
            entry("Reload Office", #selector(reload), "r", target: self),
            entry("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        submenu("Window", [
            entry("Close", #selector(NSWindow.performClose(_:)), "w"),
            entry("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        return main
    }

    @objc private func pickSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let size = PopoverSize(rawValue: raw) else { return }
        popoverSize = size
        if popover.isShown, let button = item.button {
            popover.contentSize = fittedPopoverSize(for: button)
        }
    }

    @objc private func reload() {
        load()
    }

    @objc private func restartServer() {
        server.restart()
    }

    @objc private func showLog() {
        NSWorkspace.shared.open(Config.log)
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "Couldn't change Open at Login"
            alert.runModal()
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

// The build script runs the binary once with --iconset to draw the app icon.
if let flag = CommandLine.arguments.firstIndex(of: "--iconset"), flag + 1 < CommandLine.arguments.count {
    do {
        try Icon.writeIconset(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
        exit(0)
    } catch {
        FileHandle.standardError.write("could not write the icon: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
