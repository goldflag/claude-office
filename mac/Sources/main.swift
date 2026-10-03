// Claude Office in the macOS menu bar: a Clawd icon that shows when agents are
// working, finished or need you, with notifications, a list of agents, and the
// office itself in a popover or a regular window. The server ships inside the
// app; one you started yourself with `bun run dev` is used instead.

import AppKit

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
