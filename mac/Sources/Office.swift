import Foundation

// MARK: - Snapshot

/// The parts of the server's snapshot (shared/types.ts) the menu bar uses.
struct Snapshot: Decodable {
    let hooksInstalled: Bool
    let canSend: Bool
    let agents: [Agent]
}

struct Agent: Decodable {
    struct NeedsYou: Decodable {
        let reason: String
        let since: Double
    }
    struct Tool: Decodable {
        let name: String
        let summary: String
    }
    struct Orca: Decodable {
        let writable: Bool
    }
    struct Entry: Decodable {
        let kind: String
        let detail: String
    }
    struct Subagent: Decodable {}

    let id: String
    let name: String
    let project: String
    let activity: String
    let needsYou: NeedsYou?
    let currentTool: Tool?
    let lastPrompt: String?
    let lastActivityAt: Double
    let recent: [Entry]
    let subagents: [Subagent]
    let orca: Orca?

    var group: Group { Group(activity) }

    /// Whether a message typed in the office would reach this agent's terminal.
    func canMessage(in snapshot: Snapshot) -> Bool { snapshot.canSend && orca?.writable == true }

    /// The last thing the agent said, which is the best summary of a finished turn.
    var lastWords: String? { recent.last(where: { $0.kind == "text" })?.detail }

    /// What the agent is doing, as one short line. Mirrors src/describe.ts.
    var summary: String {
        if let needsYou {
            switch needsYou.reason {
            case "question": return "Asked you a question"
            case "plan": return "Plan ready for review"
            default:
                guard let tool = currentTool else { return "Wants permission" }
                return "Wants permission: \(tool.name)" + (tool.summary.isEmpty ? "" : " \(tool.summary)")
            }
        }
        let target = currentTool?.summary ?? ""
        switch activity {
        case "writing": return target.isEmpty ? "Editing" : "Editing \(target)"
        case "terminal": return target.isEmpty ? "Running a command" : target
        case "reading": return target.isEmpty ? "Reading" : "Reading \(target)"
        case "web": return target.isEmpty ? "On the web" : "On the web: \(target)"
        case "delegating":
            let n = subagents.count
            if n > 0 { return "Running \(n) subagent\(n == 1 ? "" : "s")" }
            return target.isEmpty ? "Delegating" : target
        case "tool":
            if !target.isEmpty { return target }
            guard let name = currentTool?.name else { return "Using a tool" }
            return name.replacingOccurrences(of: #"^mcp__(.+?)__"#, with: "$1: ", options: .regularExpression)
        case "thinking": return "Thinking"
        case "waiting": return "Needs you"
        case "done": return "Finished"
        case "idle": return "On a break"
        case "sleeping": return "Asleep"
        case "away": return "Gone home"
        default: return activity
        }
    }
}

/// How much an agent wants your attention, most urgent first. Mirrors src/describe.ts.
enum Group: Int, CaseIterable, Comparable {
    case needs, working, done, idle, asleep, away

    init(_ activity: String) {
        switch activity {
        case "waiting": self = .needs
        case "done": self = .done
        case "idle": self = .idle
        case "sleeping": self = .asleep
        case "away": self = .away
        default: self = .working
        }
    }

    var label: String {
        switch self {
        case .needs: "Needs you"
        case .working: "Working"
        case .done: "Just finished"
        case .idle: "On a break"
        case .asleep: "Asleep"
        case .away: "Gone home"
        }
    }

    static func < (a: Group, b: Group) -> Bool { a.rawValue < b.rawValue }
}

// MARK: - Live connection

/// Follows the server's WebSocket, which pushes a snapshot on every change, so
/// the icon reacts as fast as the office does.
final class Live: NSObject, URLSessionWebSocketDelegate {
    private struct Message: Decodable {
        let type: String
        let data: Snapshot
    }

    /// Called on the main queue with each snapshot, or nil when the server goes away.
    var onSnapshot: (Snapshot?) -> Void = { _ in }

    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var task: URLSessionWebSocketTask?
    private var retry: Timer?

    func start() {
        connect()
        // Reconnects after the server restarts or the Mac wakes.
        retry = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self, self.task == nil else { return }
            self.connect()
        }
    }

    private func connect() {
        let task = session.webSocketTask(with: Config.socket)
        task.maximumMessageSize = 32 << 20
        self.task = task
        task.resume()
        receive(on: task)
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.task === task else { return }
                switch result {
                case .success(let message):
                    let data: Data? = switch message {
                    case .string(let text): text.data(using: .utf8)
                    case .data(let data): data
                    @unknown default: nil
                    }
                    if let data, let decoded = try? JSONDecoder().decode(Message.self, from: data) {
                        self.onSnapshot(decoded.data)
                    }
                    self.receive(on: task)
                case .failure:
                    self.drop(task)
                }
            }
        }
    }

    private func drop(_ task: URLSessionWebSocketTask) {
        guard self.task === task else { return }
        task.cancel()
        self.task = nil
        onSnapshot(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let ws = task as? URLSessionWebSocketTask { drop(ws) }
    }
}

// MARK: - Actions

/// The two things the menu bar can do to an agent, through the same endpoints as the office.
enum Actions {
    struct Failure: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func message(_ agent: String, text: String) async throws {
        try await post("api/agents/\(agent)/message", body: ["text": text])
    }

    static func focus(_ agent: String) async throws {
        try await post("api/agents/\(agent)/focus", body: [:])
    }

    private static func post(_ path: String, body: [String: String]) async throws {
        var req = URLRequest(url: Config.base.appendingPathComponent(path), timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        // The server only lets pages and apps that send this header act on agents.
        req.setValue("1", forHTTPHeaderField: "x-claude-office")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Reply: Decodable { let ok: Bool; let error: String? }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        if reply?.ok != true {
            throw Failure(message: reply?.error ?? "The office server refused the request.")
        }
    }
}
