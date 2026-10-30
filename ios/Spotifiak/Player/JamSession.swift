import Foundation
import Observation
import SpotifiakCore

/// Follows the Jam this account is in: its state arrives over Server-Sent Events and the
/// player plays along (PlayerEngine.applyJam). Commands go to the server, which sends the
/// new state to every participant, this one included. Same behavior as the web JamProvider.
@MainActor @Observable
final class JamSession {
    var jam: JamState? { player.jam }

    private let player: PlayerEngine
    private let api: () -> APIClient?
    private var events: Task<Void, Never>?
    /// Set while this account leaves or ends the Jam itself: no "you were removed" toast then.
    private var leaving = false

    init(player: PlayerEngine, api: @escaping () -> APIClient?) {
        self.player = player
        self.api = api
        player.jamCommand = { [weak self] command in self?.send(command) }
    }

    /// Back in the Jam after a relaunch.
    func restore() async {
        guard let api = api(), let jam = try? await api.currentJam() else { return }
        apply(jam)
    }

    /// Starts a Jam with what plays here.
    func start() async throws {
        guard let api = api() else { return }
        apply(try await api.startJam(player.jamStart()))
        player.showToast("Jam démarrée : invitez vos amis avec le lien")
    }

    /// Joins from a code ("K7Q2XP") or an invitation link (…/jam/K7Q2XP).
    func join(_ input: String) async throws {
        guard let api = api() else { return }
        let code = input.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "/").last.map(String.init) ?? ""
        guard !code.isEmpty else { return }
        let jam = try await api.joinJam(code)
        apply(jam)
        player.showToast("Vous avez rejoint la Jam de \(jam.host.displayName)")
    }

    /// Leaves the Jam; the host leaving ends it for everyone.
    func leave() async {
        guard let id = jam?.id else { return }
        leaving = true
        apply(nil)
        try? await api()?.leaveJam(id)
    }

    func remove(_ person: JamPerson) async {
        guard let id = jam?.id else { return }
        do { try await api()?.removeFromJam(id, userId: person.id) } catch { report(error) }
    }

    func send(_ command: JamCommand) {
        guard let id = jam?.id, let api = api() else { return }
        Task { do { try await api.jamCommand(id, command) } catch { report(error) } }
    }

    /// Logged out: drop the Jam here without telling the server.
    func reset() {
        apply(nil)
    }

    // MARK: - Internals

    private func apply(_ state: JamState?) {
        let previousId = jam?.id
        player.applyJam(state)
        if state?.id != previousId { listen(to: state?.id) }
    }

    private func listen(to id: String?) {
        events?.cancel()
        events = nil
        guard let id else { return }
        leaving = false
        events = Task { [weak self] in
            while !Task.isCancelled {
                await self?.readEvents(of: id)
                guard !Task.isCancelled, let self else { return }
                // The stream dropped (network, background): still in the Jam?
                guard let api = self.api() else { return }
                do {
                    let jam = try await api.currentJam()
                    guard !Task.isCancelled else { return }
                    if jam?.id != id {
                        self.apply(jam)
                        if jam == nil { self.player.showToast("La Jam est terminée") }
                        return
                    }
                    self.player.applyJam(jam)
                } catch {
                    try? await Task.sleep(for: .seconds(3))
                }
            }
        }
    }

    private func readEvents(of id: String) async {
        guard let api = api() else { return }
        var request = URLRequest(url: api.jamEventsURL(id))
        request.timeoutInterval = 120
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            var parser = ServerSentEvents()
            for try await line in bytes.lines {
                guard let (event, data) = parser.feed(line) else { continue }
                switch event {
                case "state":
                    if let state = try? JSONDecoder.spotifiak.decode(JamState.self, from: Data(data.utf8)) {
                        player.applyJam(state)
                    }
                case "end":
                    struct End: Decodable { let reason: String }
                    let reason = (try? JSONDecoder().decode(End.self, from: Data(data.utf8)))?.reason
                    let wasLeaving = leaving
                    events?.cancel()
                    events = nil
                    player.applyJam(nil)
                    if !wasLeaving {
                        player.showToast(reason == "removed" ? "Vous avez été retiré de la Jam" : "L'hôte a mis fin à la Jam")
                    }
                    return
                default: break
                }
            }
        } catch {
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func report(_ error: Error) {
        player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
    }
}
