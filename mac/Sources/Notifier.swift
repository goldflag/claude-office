import Foundation
import UserNotifications

/// Posts a notification when an agent starts needing you or finishes a turn.
/// Agents that Orca launched get Open in Orca, and finished ones get Reply.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    /// Opens the office on an agent, when a notification is clicked.
    var onOpen: (String) -> Void = { _ in }
    /// Whether the office is on screen, so its own changes need no banner.
    var officeVisible: () -> Bool = { false }

    private let center = UNUserNotificationCenter.current()
    private var previous: [String: Agent]?

    func start() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        let orca = UNNotificationAction(identifier: "orca", title: "Open in Orca", options: [])
        let reply = UNTextInputNotificationAction(identifier: "reply", title: "Reply", options: [],
                                                  textInputButtonTitle: "Send", textInputPlaceholder: "Message")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "orca", actions: [orca], intentIdentifiers: []),
            UNNotificationCategory(identifier: "orca-reply", actions: [reply, orca], intentIdentifiers: []),
        ])
    }

    /// Compares with the last snapshot and notifies about what changed. Returns
    /// true when an agent just finished. A nil snapshot means the server went
    /// away, and the next one only sets a new baseline, so a restart is quiet.
    @discardableResult
    func update(_ snapshot: Snapshot?) -> Bool {
        guard let snapshot else {
            previous = nil
            return false
        }
        defer { previous = Dictionary(snapshot.agents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
        guard let previous else { return false }

        var finished = false
        for agent in snapshot.agents {
            let before = previous[agent.id]?.group
            if agent.group == .needs, before != .needs {
                if Settings.notifyNeedsYou { needsYou(agent) }
            } else if agent.group != .needs, before == .needs {
                // Answered, so the banner is stale.
                center.removeDeliveredNotifications(withIdentifiers: ["needs-\(agent.id)"])
            }
            if agent.group == .done, before == .working || before == .needs {
                finished = true
                if Settings.notifyFinished { done(agent, in: snapshot) }
            }
        }
        return finished
    }

    private func needsYou(_ agent: Agent) {
        post(id: "needs-\(agent.id)", agent: agent, title: "\(agent.name) needs you", body: agent.summary,
             category: agent.orca == nil ? nil : "orca")
    }

    private func done(_ agent: Agent, in snapshot: Snapshot) {
        let body = agent.lastWords ?? agent.lastPrompt.map { "Done with “\($0)”" } ?? "Ready for the next task"
        let category = agent.canMessage(in: snapshot) ? "orca-reply" : agent.orca == nil ? nil : "orca"
        post(id: "done-\(agent.id)", agent: agent, title: "\(agent.name) finished", body: body, category: category)
    }

    private func post(id: String, agent: Agent, title: String, body: String, category: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = agent.project
        content.body = body
        content.userInfo = ["agent": agent.id, "name": agent.name]
        content.threadIdentifier = agent.id
        if let category { content.categoryIdentifier = category }
        if Settings.sounds { content.sound = .default }
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    private func failed(_ what: String, _ error: Error) {
        let content = UNMutableNotificationContent()
        content.title = what
        content.body = error.localizedDescription
        center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler show: @escaping (UNNotificationPresentationOptions) -> Void) {
        let visible = Thread.isMainThread ? officeVisible() : DispatchQueue.main.sync { officeVisible() }
        show(visible ? [.list] : [.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler finish: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        guard let agent = info["agent"] as? String else { return finish() }
        let name = info["name"] as? String ?? "the agent"
        switch response.actionIdentifier {
        case "reply":
            let text = (response as? UNTextInputNotificationResponse)?.userText ?? ""
            Task {
                do { try await Actions.message(agent, text: text) } catch { failed("Couldn't send to \(name)", error) }
                finish()
            }
        case "orca":
            Task {
                do { try await Actions.focus(agent) } catch { failed("Couldn't open \(name) in Orca", error) }
                finish()
            }
        case UNNotificationDefaultActionIdentifier:
            DispatchQueue.main.async { self.onOpen(agent) }
            finish()
        default:
            finish()
        }
    }
}
