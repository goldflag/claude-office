import AppKit

/// Where things are. The server and the 3D models ship inside the app, so it
/// runs without this repo.
enum Config {
    /// OFFICE_PORT moves the office off 4821 when something else uses it.
    static let port = Int(ProcessInfo.processInfo.environment["OFFICE_PORT"] ?? "") ?? 4821
    static let base = URL(string: "http://localhost:\(port)")!
    static let socket = URL(string: "ws://localhost:\(port)/ws")!

    static let resources = Bundle.main.resourceURL!
    static let serverBinary = resources.appendingPathComponent("office-server")
    static let publicDir = resources.appendingPathComponent("public")

    static let log = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Claude Office.log")

    /// Apps opened from Finder get a bare PATH, but the server shells out to
    /// `orca` and `ps`. This asks the login shell for the real one, falling back
    /// to the PATH recorded at build time.
    static let path: String = {
        let built = Bundle.main.infoDictionary?["OfficePath"] as? String ?? ""
        let defaults = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        let parts = [loginShellPath() ?? "", built, defaults]
            .flatMap { $0.split(separator: ":").map(String.init) }
        var seen = Set<String>()
        return parts.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
    }()

    private static func loginShellPath() -> String? {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: shell)
        // Interactive too, since tools like nvm often set PATH only in .zshrc.
        p.arguments = ["-l", "-i", "-c", "printf '\\n__OFFICE_PATH__%s\\n' \"$PATH\""]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        // A shell config that waits on something must not hold up the office.
        let deadline = Date().addingTimeInterval(4)
        while p.isRunning && Date() < deadline { usleep(20_000) }
        if p.isRunning { p.terminate(); return nil }
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        guard let line = text.split(separator: "\n").last(where: { $0.hasPrefix("__OFFICE_PATH__") }) else { return nil }
        return String(line.dropFirst("__OFFICE_PATH__".count))
    }
}

/// Preferences, kept in UserDefaults.
enum Settings {
    private static let store = UserDefaults.standard

    static func flag(_ key: String, default value: Bool) -> Bool {
        store.object(forKey: key) == nil ? value : store.bool(forKey: key)
    }

    static var notifyNeedsYou: Bool {
        get { flag("notifyNeedsYou", default: true) }
        set { store.set(newValue, forKey: "notifyNeedsYou") }
    }
    static var notifyFinished: Bool {
        get { flag("notifyFinished", default: true) }
        set { store.set(newValue, forKey: "notifyFinished") }
    }
    static var sounds: Bool {
        get { flag("sounds", default: true) }
        set { store.set(newValue, forKey: "sounds") }
    }
    static var iconActivity: Bool {
        get { flag("iconActivity", default: true) }
        set { store.set(newValue, forKey: "iconActivity") }
    }
    static var hotKey: Bool {
        get { flag("hotKey", default: true) }
        set { store.set(newValue, forKey: "hotKey") }
    }
    static var popoverSize: PopoverSize {
        get { PopoverSize(rawValue: store.string(forKey: "popoverSize") ?? "") ?? .small }
        set { store.set(newValue.rawValue, forKey: "popoverSize") }
    }
}

/// Popover sizes. They are square; a size taller than the screen is shrunk to fit.
enum PopoverSize: String, CaseIterable {
    case small, medium, large

    var title: String { rawValue.capitalized }

    var size: NSSize {
        switch self {
        case .small: NSSize(width: 640, height: 640)
        case .medium: NSSize(width: 860, height: 860)
        case .large: NSSize(width: 1180, height: 1180)
        }
    }
}
