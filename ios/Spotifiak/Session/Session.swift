import Foundation
import Observation
import SpotifiakCore

/// The server the app talks to and who is logged in. Any 401 returns to Login with
/// the server address prefilled.
@MainActor @Observable
final class Session {
    enum State: Equatable {
        case loggedOut(serverInput: String, status: AuthStatus?)
        case loggedIn(User)
    }

    var state: State
    private(set) var api: APIClient?
    /// True until `restore` has run at launch.
    private(set) var isRestoring = true

    private let defaults: UserDefaults
    private let transport: HTTPTransport

    init(defaults: UserDefaults = .standard, transport: HTTPTransport = URLSessionTransport()) {
        self.defaults = defaults
        self.transport = transport
        state = .loggedOut(serverInput: defaults.string(forKey: "serverInput") ?? "", status: nil)
    }

    private var serverInput: String { defaults.string(forKey: "serverInput") ?? "" }

    /// At launch: the stored server, logged in if its cookie is still valid.
    func restore() async {
        defer { isRestoring = false }
        guard let base = defaults.string(forKey: "apiBase").flatMap(URL.init(string:)) else { return }
        let api = makeClient(base)
        self.api = api
        let status = try? await api.authStatus()
        state = status?.user.map(State.loggedIn) ?? .loggedOut(serverInput: serverInput, status: status)
    }

    /// Finds the API behind what the user typed and loads its auth status.
    func connect(serverInput: String) async throws {
        let base = try await APIClient.discover(serverInput, transport: transport)
        defaults.set(base.absoluteString, forKey: "apiBase")
        defaults.set(serverInput, forKey: "serverInput")
        let api = makeClient(base)
        self.api = api
        let status = try await api.authStatus()
        state = status.user.map(State.loggedIn) ?? .loggedOut(serverInput: serverInput, status: status)
    }

    func login(username: String, password: String) async throws {
        guard let api else { return }
        state = .loggedIn(try await api.login(username: username, password: password))
    }

    func register(username: String, password: String, displayName: String) async throws {
        guard let api else { return }
        state = .loggedIn(try await api.register(username: username, password: password, displayName: displayName))
    }

    func logout() async {
        try? await api?.logout()
        clearCookies()
        state = .loggedOut(serverInput: serverInput, status: try? await api?.authStatus())
    }

    private func makeClient(_ base: URL) -> APIClient {
        APIClient(base: base, transport: transport) { [weak self] in
            Task { @MainActor in self?.expire() }
        }
    }

    private func expire() {
        guard case .loggedIn = state else { return }
        clearCookies()
        state = .loggedOut(serverInput: serverInput, status: nil)
    }

    private func clearCookies() {
        guard let base = api?.base else { return }
        for cookie in HTTPCookieStorage.shared.cookies(for: base) ?? [] {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }
}
