import Foundation
import SpotifiakCore
import Testing
@testable import Spotifiak

private let user = #"{ "id": "u1", "username": "astria", "displayName": "Astria", "role": "admin" }"#

@MainActor
private func makeSession() -> (Session, FakeTransport, UserDefaults) {
    let defaults = UserDefaults(suiteName: "SessionTests-\(UUID().uuidString)")!
    let transport = FakeTransport()
    return (Session(defaults: defaults, transport: transport), transport, defaults)
}

@MainActor @Test func restoreWithoutUserStaysLoggedOut() async {
    let (session, transport, defaults) = makeSession()
    defaults.set("https://h/api", forKey: "apiBase")
    defaults.set("h", forKey: "serverInput")
    transport.respond("https://h/api/auth/status", #"{ "user": null, "needsSetup": false, "signupOpen": true }"#)

    await session.restore()

    guard case .loggedOut(let input, let status) = session.state else {
        Issue.record("expected loggedOut, got \(session.state)")
        return
    }
    #expect(input == "h")
    #expect(status?.signupOpen == true)
    #expect(!session.isRestoring)
}

@MainActor @Test func connectThenLogin() async throws {
    let (session, transport, defaults) = makeSession()
    transport.respond("https://h/api/health", #"{ "ok": true }"#)
    transport.respond("https://h/api/auth/status", #"{ "user": null, "needsSetup": false, "signupOpen": false }"#)
    transport.respond("https://h/api/auth/login", #"{ "user": \#(user) }"#)

    try await session.connect(serverInput: "h")
    try await session.login(username: "astria", password: "secret")

    guard case .loggedIn(let loggedIn) = session.state else {
        Issue.record("expected loggedIn, got \(session.state)")
        return
    }
    #expect(loggedIn.username == "astria")
    #expect(defaults.string(forKey: "apiBase") == "https://h/api")
    #expect(defaults.string(forKey: "serverInput") == "h")
}

@MainActor @Test func unauthorizedReturnsToLoginWithServerPrefilled() async throws {
    let (session, transport, _) = makeSession()
    transport.respond("https://h/api/health", #"{ "ok": true }"#)
    transport.respond("https://h/api/auth/status", #"{ "user": \#(user), "needsSetup": false, "signupOpen": false }"#)
    transport.respond("https://h/api/albums?limit=200", status: 401, #"{ "error": "Non connecté" }"#)

    try await session.connect(serverInput: "h")
    guard case .loggedIn = session.state else {
        Issue.record("expected loggedIn, got \(session.state)")
        return
    }
    _ = try? await session.api?.albums()

    // onUnauthorized hops to the main actor; give it a few turns.
    for _ in 0..<100 where session.state != .loggedOut(serverInput: "h", status: nil) {
        await Task.yield()
    }
    #expect(session.state == .loggedOut(serverInput: "h", status: nil))
}
