import Foundation

/// Runs the bundled server when nothing is listening, and restarts it if it
/// dies. A server you started yourself with `bun run dev` is left alone.
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
        p.executableURL = Config.serverBinary
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Config.path
        env["NODE_ENV"] = "production"
        env["PORT"] = String(Config.port)
        env["OFFICE_PUBLIC_DIR"] = Config.publicDir.path
        p.environment = env
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        if !FileManager.default.fileExists(atPath: Config.log.path) {
            FileManager.default.createFile(atPath: Config.log.path, contents: nil)
        }
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

    /// Runs the bundled `hooks.ts install` and returns what it printed.
    static func installHooks() async -> (ok: Bool, output: String) {
        await withCheckedContinuation { done in
            let p = Process()
            p.executableURL = Config.serverBinary
            p.arguments = ["install"]
            p.environment = ProcessInfo.processInfo.environment.merging(["OFFICE_TASK": "hooks"]) { _, new in new }
            let out = Pipe()
            p.standardOutput = out
            p.standardError = out
            p.terminationHandler = { p in
                let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                done.resume(returning: (p.terminationStatus == 0, text.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
            do {
                try p.run()
            } catch {
                done.resume(returning: (false, error.localizedDescription))
            }
        }
    }
}
