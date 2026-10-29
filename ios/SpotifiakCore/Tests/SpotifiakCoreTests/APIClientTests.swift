import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import SpotifiakCore

private let base = URL(string: "https://h/api")!

private func client(_ transport: FakeTransport, _ unauthorized: Counter = Counter()) -> APIClient {
    APIClient(base: base, transport: transport, onUnauthorized: { unauthorized.increment() })
}

private func track(format: String?) -> Track {
    Track(id: "t1", title: "T", artistName: "A", artistId: "a", format: format)
}

@Test func discoverPicksTheFirstBaseAnsweringHealth() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/health", "<html>web app</html>")
    transport.respond("https://h/api/health", #"{"ok":true}"#)
    #expect(try await APIClient.discover("h", transport: transport) == URL(string: "https://h/api")!)
}

@Test func discoverSkipsNonAPIAnswers() async throws {
    let transport = FakeTransport()
    // An HTML page answering 200 at /api/health is not the API.
    transport.respond("https://h/api/health", "<html>index</html>")
    transport.respond("https://h/health", #"{"ok":true}"#)
    #expect(try await APIClient.discover("h", transport: transport) == URL(string: "https://h")!)
}

@Test func discoverFailsWithAMessage() async {
    await #expect(throws: APIError(message: "Serveur Spotifiak introuvable à cette adresse", status: 0)) {
        try await APIClient.discover("nowhere", transport: FakeTransport())
    }
}

@Test func loginPostsJSONAndReturnsTheUser() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/auth/login", #"{"user":{"id":"u1","username":"a","displayName":"A","role":"user"}}"#)
    let user = try await client(transport).login(username: "a", password: "secretpass")
    #expect(user.id == "u1")
    let request = try #require(transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
    let body = try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: String]
    #expect(body == ["username": "a", "password": "secretpass"])
}

@Test func errorsCarryTheServerMessage() async {
    let transport = FakeTransport()
    transport.respond("https://h/api/auth/login", status: 429, #"{"error":"Trop de tentatives, réessayez dans quelques minutes"}"#)
    await #expect(throws: APIError(message: "Trop de tentatives, réessayez dans quelques minutes", status: 429)) {
        try await client(transport).login(username: "a", password: "b")
    }
}

@Test func errorsWithoutMessageGetAGenericOne() async {
    let transport = FakeTransport()
    transport.respond("https://h/api/albums?limit=200", status: 500, "oops")
    await #expect(throws: APIError(message: "Une erreur est survenue", status: 500)) {
        try await client(transport).albums()
    }
}

@Test func unauthorizedOutsideAuthSignalsTheSession() async {
    let transport = FakeTransport()
    transport.respond("https://h/api/albums?limit=200", status: 401, #"{"error":"Non connecté"}"#)
    transport.respond("https://h/api/auth/login", status: 401, #"{"error":"Nom d'utilisateur ou mot de passe incorrect"}"#)
    let counter = Counter()
    let api = client(transport, counter)
    _ = try? await api.albums()
    #expect(counter.value == 1)
    _ = try? await api.login(username: "a", password: "b")
    #expect(counter.value == 1)
}

@Test func decodesBrowseEndpoints() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/albums/alb1", String(decoding: try fixture("album-detail"), as: UTF8.self))
    transport.respond("https://h/api/search?q=daft%20punk", String(decoding: try fixture("search"), as: UTF8.self))
    let api = client(transport)
    #expect(try await api.album("alb1").tracks.count == 2)
    #expect(try await api.search("daft punk").artists.count == 1)
}

@Test func streamURLAsksForCompatOnlyWhenNeeded() {
    let api = client(FakeTransport())
    #expect(api.streamURL(for: track(format: "ogg")).absoluteString == "https://h/api/tracks/t1/stream?compat=1")
    #expect(api.streamURL(for: track(format: "flac")).absoluteString == "https://h/api/tracks/t1/stream")
    #expect(api.streamURL(for: track(format: nil)).absoluteString == "https://h/api/tracks/t1/stream")
}

@Test func coversPreferExternalThenFileArt() throws {
    let api = client(FakeTransport())
    let albums = try decode(AlbumDetail.self, "album-detail")
    let bare = try decode(Page<Album>.self, "albums-page").items[0]
    let artist = try decode(SearchResults.self, "search").artists[0]
    #expect(api.coverURL(track: albums.tracks[0])?.absoluteString == "https://cdn-images.dzcdn.net/images/cover/abc/500x500.jpg")
    #expect(api.coverURL(track: albums.tracks[1])?.absoluteString == "https://h/api/tracks/trk2/cover")
    #expect(api.coverURL(album: bare) == nil)
    #expect(api.pictureURL(artist: artist)?.absoluteString == "https://h/api/tracks/trk9/cover")
}

@Test func checkSessionExpiresOnlyWhenTheServerForgotUs() async {
    let transport = FakeTransport()
    let counter = Counter()
    let api = APIClient(base: URL(string: "https://h/api")!, transport: transport) { counter.increment() }
    transport.respond("https://h/api/auth/status", #"{ "user": { "id": "u1", "username": "a", "displayName": "A", "role": "user" }, "needsSetup": false, "signupOpen": false }"#)
    await api.checkSession()
    #expect(counter.value == 0)
    transport.respond("https://h/api/auth/status", #"{ "user": null, "needsSetup": false, "signupOpen": false }"#)
    await api.checkSession()
    #expect(counter.value == 1)
}
