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

@Test func decodesCollectionEndpoints() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/playlists", #"[{"id":"p1","name":"Route","description":null,"public":false,"updatedAt":"2026-01-02T03:04:05.000Z","trackCount":3,"covers":[{"trackId":"t1","coverUrl":null}]}]"#)
    transport.respond("https://h/api/playlists/p1", #"{"id":"p1","name":"Route","description":"Été","public":false,"owned":true,"updatedAt":"2026-01-02T03:04:05.000Z","owner":{"displayName":"Ana"},"covers":[],"entries":[{"id":"e1","track":{"id":"t1","title":"T","artistName":"A","artistId":"a","album":null,"durationSec":12,"trackNumber":null,"discNumber":null,"addedAt":"2026-01-02T03:04:05Z","format":"mp3"}}]}"#)
    let api = client(transport)
    let playlists = try await api.playlists()
    #expect(playlists.first?.trackCount == 3)
    #expect(api.coverURL(mosaic: playlists[0].covers[0]) == URL(string: "https://h/api/tracks/t1/cover")!)
    let detail = try await api.playlist("p1")
    #expect(detail.owner.displayName == "Ana")
    #expect(detail.entries.map(\.track.id) == ["t1"])
}

@Test func jamCommandsEncodeLikeTheWebApp() throws {
    func json(_ command: JamCommand) throws -> [String: AnyHashable] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as! [String: AnyHashable]
    }
    #expect(try json(.pause(position: 12.5)) == ["type": "pause", "position": 12.5])
    #expect(try json(.play(position: nil)) == ["type": "play"])
    #expect(try json(.ended(entryId: "e1")) == ["type": "ended", "entryId": "e1"])
    #expect(try json(.remove(entryId: "e2")) == ["type": "remove", "entryId": "e2"])
    #expect(try json(.playTracks(trackIds: ["a", "b"], index: 1)) == ["type": "playTracks", "trackIds": ["a", "b"], "index": 1])
}

@Test func serverSentEventsPairEventAndData() {
    var events = ServerSentEvents()
    #expect(events.feed(": ping") == nil)
    #expect(events.feed("event: state") == nil)
    let first = events.feed(#"data: {"a":1}"#)
    #expect(first?.event == "state" && first?.data == #"{"a":1}"#)
    #expect(events.feed("") == nil)
    #expect(events.feed("data: x")?.event == "message")
}

@Test func episodesPlayAsTracksResumingWhereLeft() throws {
    let api = client(FakeTransport())
    let episode = try JSONDecoder.spotifiak.decode(Episode.self, from: Data(#"{"id":"ep1","title":"E","description":null,"durationSec":600,"publishedAt":"2026-01-02T03:04:05.000Z","audioUrl":null,"sourceUrl":null,"status":"ready","error":null,"hasImage":false,"podcast":{"id":"p1","title":"Pod"},"progress":{"positionSec":42,"completed":false}}"#.utf8))
    let track = api.track(episode: episode)
    #expect(track.episode?.startAt == 42)
    #expect(api.streamURL(for: track) == URL(string: "https://h/api/episodes/ep1/audio")!)
    #expect(api.coverURL(track: track) == URL(string: "https://h/api/episodes/ep1/image")!)
    #expect(api.track(episode: episode, progress: EpisodeProgress(positionSec: 500, completed: true)).episode?.startAt == 0)
}

@Test func jamInviteLinksPointToTheWebApp() {
    #expect(client(FakeTransport()).jamInviteURL("ABC") == URL(string: "https://h/jam/ABC")!)
}

@Test func movingToTheEndSendsANullBefore() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/playlists/p1/tracks/e1", "")
    try await client(transport).movePlaylistEntry("p1", entryId: "e1", before: nil)
    let body = try #require(transport.requests.last?.httpBody)
    #expect(String(decoding: body, as: UTF8.self) == #"{"beforeEntryId":null}"#)
}

@Test func jamMovesSendANullToGoLast() throws {
    let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(JamCommand.move(entryId: "e1", beforeEntryId: nil))) as! [String: Any]
    #expect(body["type"] as? String == "move")
    #expect(body["beforeEntryId"] is NSNull)
}

@Test func decodesTheScanStatus() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/library/scan", #"{"running":true,"mode":"quick","phase":"indexing","dirsListed":12,"progress":{"done":5,"total":10,"startedAt":"2026-01-01T00:00:00.000Z"},"lastStartedAt":"2026-01-01T00:00:00.000Z","lastFinishedAt":null,"lastDurationMs":null,"lastMode":null,"lastResult":null,"lastError":null,"enrichment":{"enabled":true,"running":false,"albums":{"done":1,"total":2,"matched":1},"artists":{"done":0,"total":0,"matched":0},"lastFinishedAt":null,"lastFailed":0}}"#)
    let status = try await client(transport).scanStatus()
    #expect(status.progress?.total == 10)
    #expect(status.enrichment.albums.matched == 1)
}

@Test func decodesFriendActivityAndNotifications() async throws {
    let transport = FakeTransport()
    let track = #"{"id":"t1","title":"T","artistName":"A","artistId":"a","album":null,"durationSec":180,"trackNumber":null,"discNumber":null,"addedAt":"2026-01-01T00:00:00Z","format":"mp3"}"#
    let person = #"{"id":"u2","username":"ana","displayName":"Ana"}"#
    transport.respond("https://h/api/friends/activity", #"[{"user":\#(person),"track":\#(track),"playedAt":"2026-01-01T00:00:00.000Z","listening":true}]"#)
    transport.respond("https://h/api/me/notifications", #"[{"id":"n1","type":"jam","from":\#(person),"track":null,"jamId":"ABC","jamActive":false,"message":null,"createdAt":"2026-01-01T00:00:00.000Z","read":false}]"#)
    transport.respond("https://h/api/people?q=an", #"[{"id":"u2","username":"ana","displayName":"Ana","relation":null}]"#)
    let api = client(transport)
    #expect(try await api.friendActivity().first?.listening == true)
    let notification = try #require(try await api.notifications().first)
    #expect(notification.jamId == "ABC" && !notification.jamActive)
    #expect(try await api.people("an").first?.relation == nil)
}

@Test func usersFromOlderServersHaveNoActivitySetting() throws {
    let user = try JSONDecoder().decode(User.self, from: Data(#"{"id":"u","username":"u","displayName":"U","role":"user"}"#.utf8))
    #expect(user.shareActivity == nil)
}

@Test func avatarsUploadAsJPEGAndChangeURLWhenUpdated() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/me/avatar", #"{"avatarUpdatedAt":"2026-01-02T03:04:05.678Z"}"#)
    let api = client(transport)
    let date = try await api.uploadAvatar(jpeg: Data([0xff, 0xd8, 0xff]))
    let request = try #require(transport.requests.last)
    #expect(request.httpMethod == "PUT")
    #expect(request.value(forHTTPHeaderField: "content-type") == "image/jpeg")
    #expect(request.httpBody == Data([0xff, 0xd8, 0xff]))

    let person = Person(id: "u1", username: "a", displayName: "A", avatarUpdatedAt: date)
    let later = Person(id: "u1", username: "a", displayName: "A", avatarUpdatedAt: date.addingTimeInterval(1))
    #expect(api.avatarURL(for: person)?.path == "/api/people/u1/avatar")
    #expect(api.avatarURL(for: person) != api.avatarURL(for: later))
    #expect(api.avatarURL(for: Person(id: "u1", username: "a", displayName: "A", avatarUpdatedAt: nil)) == nil)
}

@Test func decodesTheCalendar() async throws {
    let transport = FakeTransport()
    let artist = #"{"id":"a1","name":"Ana","pictureUrl":null}"#
    transport.respond("https://h/api/me/calendar", #"{"concertsEnabled":true,"loading":1,"releases":[{"id":42,"title":"New","type":"single","date":"2026-10-16","coverUrl":"https://c/42.jpg","link":"https://www.deezer.com/album/42","albumId":null,"artist":\#(artist)}],"concerts":[{"id":"e1","name":"Tour","date":"2027-06-20","time":"20:00","venue":"Arena","city":"Paris","country":"France","url":"https://t/e1","cancelled":false,"artist":\#(artist)}]}"#)
    let calendar = try await client(transport).calendar()
    #expect(calendar.loading == 1)
    #expect(calendar.releases.first?.id == 42)
    #expect(calendar.concerts.first?.venue == "Arena")
}
