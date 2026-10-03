import AppKit
import ServiceManagement
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, NSWindowDelegate,
    WKScriptMessageHandler, WKNavigationDelegate
{
    private let server = Server()
    private let live = Live()
    private let notifier = Notifier()
    private lazy var hotKey = HotKey { [weak self] in self?.toggleOffice() }
    private var item: NSStatusItem!
    private let popover = NSPopover()
    /// One web view moves between the popover and the window, so the office keeps its state.
    private var web: WKWebView!
    private var window: NSWindow?
    private var snapshot: Snapshot?
    /// Until when the icon shows the check mark for a finished agent.
    private var finishedUntil = Date.distantPast
    private var pageReady = false
    private var pendingSelect: String?

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.mainMenu = mainMenu()

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeading
        item.button?.setAccessibilityLabel("Claude Office")
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "office")
        web = WKWebView(frame: NSRect(origin: .zero, size: Settings.popoverSize.size), configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        let host = NSViewController()
        host.view = NSView(frame: web.frame)
        host.view.addSubview(web)
        popover.contentViewController = host
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self

        notifier.onOpen = { [weak self] in self?.openOffice(on: $0) }
        notifier.officeVisible = { [weak self] in self?.officeVisible ?? false }
        notifier.start()
        if Settings.hotKey { hotKey.register() }

        live.onSnapshot = { [weak self] in self?.receive($0) }
        live.start()
        // Finding the login shell's PATH takes a moment, so it runs off the main thread.
        DispatchQueue.global().async {
            _ = Config.path
            DispatchQueue.main.async { self.server.ensureRunning() }
        }
        render()
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

    private func receive(_ next: Snapshot?) {
        let wasOnline = snapshot != nil
        snapshot = next
        if notifier.update(next) {
            finishedUntil = Date().addingTimeInterval(6)
            DispatchQueue.main.asyncAfter(deadline: .now() + 6.1) { [weak self] in self?.render() }
        }
        if next == nil, wasOnline {
            server.ensureRunning()
        } else if next != nil, !wasOnline {
            // Loading now means the popover opens on a ready office. WebKit pauses
            // the scene's rendering while the popover is closed.
            server.resetBackoff()
            load()
        }
        render()
    }

    private func render() {
        guard let button = item.button else { return }
        guard let snapshot else {
            set(button, Icon.normal, title: "")
            button.appearsDisabled = true
            button.toolTip = "Claude Office: the server is not running"
            return
        }
        button.appearsDisabled = false

        let needs = snapshot.agents.filter { $0.group == .needs }
        let working = snapshot.agents.filter { $0.group == .working }.count
        if !needs.isEmpty {
            set(button, Icon.needsYou, title: " \(needs.count)")
        } else if Settings.iconActivity, Date() < finishedUntil {
            set(button, Icon.done, title: "")
        } else if Settings.iconActivity, working > 0 {
            set(button, Icon.working, title: "")
        } else {
            set(button, Icon.normal, title: "")
        }

        if !needs.isEmpty {
            let names = needs.map(\.name).joined(separator: ", ")
            button.toolTip = needs.count == 1 ? "\(names) needs you" : "\(names) need you"
        } else if working > 0 {
            button.toolTip = "\(working) working"
        } else {
            button.toolTip = snapshot.agents.isEmpty ? "No agents running" : "All quiet"
        }
    }

    private func set(_ button: NSStatusBarButton, _ image: NSImage, title: String) {
        if button.image !== image { button.image = image }
        if button.title != title { button.title = title }
    }

    private var officeVisible: Bool {
        NSApp.isActive && (popover.isShown || window?.isKeyWindow == true)
    }

    // MARK: Page

    private func load() {
        var url = URLComponents(url: Config.base, resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "menubar", value: nil)]
        pageReady = false
        web.load(URLRequest(url: url.url!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        flushSelect()
    }

    /// Selects an agent in the office once the page can take it.
    private func select(_ agent: String) {
        pendingSelect = agent
        flushSelect()
    }

    private func flushSelect(attempt: Int = 0) {
        guard pageReady, let agent = pendingSelect,
              let id = try? String(decoding: JSONEncoder().encode(agent), as: UTF8.self) else { return }
        web.evaluateJavaScript("window.claudeOffice ? (window.claudeOffice.select(\(id)), true) : false") { [weak self] result, _ in
            guard let self, self.pendingSelect == agent else { return }
            if result as? Bool == true {
                self.pendingSelect = nil
            } else if attempt < 20 {
                // React has not mounted yet.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.flushSelect(attempt: attempt + 1) }
            }
        }
    }

    /// Messages from the page: Esc with nothing selected closes the popover.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.body as? String == "close", popover.isShown { popover.performClose(nil) }
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

    /// The global shortcut: shows the office wherever it lives, or hides it if it is in front.
    private func toggleOffice() {
        if let window, window.isVisible {
            if NSApp.isActive, window.isKeyWindow { NSApp.hide(nil) } else { openWindow() }
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        if popover.isShown {
            popover.performClose(nil)
        } else {
            showPopover()
        }
    }

    private func showPopover() {
        guard let button = item.button else { return }
        if web.url == nil { load() }
        popover.contentSize = fittedPopoverSize(for: button)
        // Activating lets the message box take keystrokes.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    /// Shows the office, in the window if it is open, focused on one agent.
    private func openOffice(on agent: String) {
        if window?.isVisible == true {
            openWindow()
        } else if !popover.isShown {
            showPopover()
        }
        select(agent)
    }

    /// The chosen size, shrunk to leave a margin on the screen the menu bar is on.
    private func fittedPopoverSize(for button: NSView) -> NSSize {
        let want = Settings.popoverSize.size
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

    // MARK: Status menu

    private func showMenu() {
        let menu = NSMenu()
        if let snapshot {
            agentItems(snapshot).forEach(menu.addItem)
        } else {
            menu.addItem(disabled("The office server is starting…"))
        }
        menu.addItem(.separator())

        menu.addItem(withTitle: "Open Window", action: #selector(openWindow), keyEquivalent: "n").target = self
        let sizes = NSMenu()
        for size in PopoverSize.allCases {
            let entry = sizes.addItem(withTitle: size.title, action: #selector(pickSize(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = size.rawValue
            entry.state = size == Settings.popoverSize ? .on : .off
        }
        menu.addItem(withTitle: "Popover Size", action: nil, keyEquivalent: "").submenu = sizes
        menu.addItem(withTitle: "Reload Office", action: #selector(reload), keyEquivalent: "r").target = self
        menu.addItem(.separator())

        if snapshot?.hooksInstalled == false {
            menu.addItem(withTitle: "Detect Permission Prompts Exactly…", action: #selector(installHooks), keyEquivalent: "")
                .target = self
        }
        let restart = menu.addItem(withTitle: "Restart Server", action: #selector(restartServer), keyEquivalent: "")
        restart.target = self
        if !server.owned && snapshot != nil {
            restart.title = "Server Started Elsewhere"
            restart.action = nil
        }
        menu.addItem(withTitle: "Show Server Log", action: #selector(showLog), keyEquivalent: "").target = self
        menu.addItem(.separator())

        let settings = NSMenu()
        settings.addItem(toggle("Notify When an Agent Needs You", Settings.notifyNeedsYou, #selector(toggleNotifyNeedsYou)))
        settings.addItem(toggle("Notify When an Agent Finishes", Settings.notifyFinished, #selector(toggleNotifyFinished)))
        settings.addItem(toggle("Play Notification Sounds", Settings.sounds, #selector(toggleSounds)))
        settings.addItem(.separator())
        settings.addItem(toggle("Show Activity in Icon", Settings.iconActivity, #selector(toggleIconActivity)))
        settings.addItem(toggle("Global Shortcut \(HotKey.label)", Settings.hotKey, #selector(toggleHotKey)))
        settings.addItem(toggle("Open at Login", SMAppService.mainApp.status == .enabled, #selector(toggleLogin)))
        menu.addItem(withTitle: "Settings", action: nil, keyEquivalent: "").submenu = settings
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Claude Office", action: #selector(quit), keyEquivalent: "q").target = self

        // Attaching the menu only for this click keeps left-click free for the popover.
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    /// The board in miniature. Clicking an agent opens the office on it; holding
    /// Option turns agents that Orca launched into Open in Orca.
    private func agentItems(_ snapshot: Snapshot) -> [NSMenuItem] {
        guard !snapshot.agents.isEmpty else {
            return [disabled("No Claude Code sessions are running")]
        }
        let sorted = snapshot.agents.sorted { ($0.group, -$0.lastActivityAt) < ($1.group, -$1.lastActivityAt) }
        var items: [NSMenuItem] = []
        let shown = 8
        for group in [Group.needs, .working, .done, .idle] {
            let members = sorted.filter { $0.group == group }
            guard !members.isEmpty else { continue }
            items.append(.sectionHeader(title: group.label))
            for agent in members.prefix(shown) {
                items.append(agentItem(agent))
                if agent.orca != nil { items.append(orcaItem(agent)) }
            }
            if members.count > shown { items.append(disabled("and \(members.count - shown) more")) }
        }
        let resting = [Group.asleep, .away].compactMap { group -> String? in
            let n = sorted.filter { $0.group == group }.count
            return n == 0 ? nil : "\(n) \(group == .asleep ? "asleep" : "gone home")"
        }
        if !resting.isEmpty {
            if !items.isEmpty { items.append(.separator()) }
            items.append(disabled(resting.joined(separator: ", ")))
        }
        return items
    }

    private func agentItem(_ agent: Agent) -> NSMenuItem {
        let item = NSMenuItem(title: agent.name, action: #selector(openAgent(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = agent.id
        item.image = Icon.dot(agent.group)
        let title = NSMutableAttributedString(string: agent.name, attributes: [.font: NSFont.menuFont(ofSize: 0)])
        let quiet: [NSAttributedString.Key: Any] = [
            .font: NSFont.menuFont(ofSize: NSFont.smallSystemFontSize),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        title.append(NSAttributedString(string: "  \(agent.project)\n", attributes: quiet))
        title.append(NSAttributedString(string: clip(agent.summary, 60), attributes: quiet))
        item.attributedTitle = title
        return item
    }

    private func orcaItem(_ agent: Agent) -> NSMenuItem {
        let item = NSMenuItem(title: "Open \(agent.name) in Orca", action: #selector(focusAgent(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = agent.id
        item.image = Icon.dot(agent.group)
        item.isAlternate = true
        item.keyEquivalentModifierMask = .option
        return item
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func toggle(_ title: String, _ on: Bool, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        item.state = on ? .on : .off
        return item
    }

    private func clip(_ text: String, _ length: Int) -> String {
        text.count > length ? text.prefix(length - 1) + "…" : text
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

    // MARK: Actions

    @objc private func openAgent(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        openOffice(on: id)
    }

    @objc private func focusAgent(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Task {
            do {
                try await Actions.focus(id)
            } catch {
                await MainActor.run { self.alert("Couldn't open it in Orca", error.localizedDescription) }
            }
        }
    }

    @objc private func pickSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let size = PopoverSize(rawValue: raw) else { return }
        Settings.popoverSize = size
        if popover.isShown, let button = item.button {
            popover.contentSize = fittedPopoverSize(for: button)
        }
    }

    @objc private func installHooks() {
        NSApp.activate(ignoringOtherApps: true)
        let confirm = NSAlert()
        confirm.messageText = "Detect permission prompts exactly?"
        confirm.informativeText = """
            Without hooks, the office guesses when an agent is waiting for permission. This adds small hooks \
            to ~/.claude/settings.json that tell it for certain. Each one is a quiet curl to this Mac that \
            does nothing when the office is closed. Your settings are backed up first.

            Sessions that are already running pick the hooks up after a restart.
            """
        confirm.addButton(withTitle: "Install Hooks")
        confirm.addButton(withTitle: "Cancel")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        Task {
            let result = await Server.installHooks()
            await MainActor.run {
                self.alert(result.ok ? "Hooks installed" : "Couldn't install the hooks", result.output)
            }
        }
    }

    private func alert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }

    @objc private func toggleNotifyNeedsYou() { Settings.notifyNeedsYou.toggle() }
    @objc private func toggleNotifyFinished() { Settings.notifyFinished.toggle() }
    @objc private func toggleSounds() { Settings.sounds.toggle() }

    @objc private func toggleIconActivity() {
        Settings.iconActivity.toggle()
        render()
    }

    @objc private func toggleHotKey() {
        Settings.hotKey.toggle()
        if Settings.hotKey { hotKey.register() } else { hotKey.unregister() }
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
            alert("Couldn't change Open at Login", error.localizedDescription)
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
