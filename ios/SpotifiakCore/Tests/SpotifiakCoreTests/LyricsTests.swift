import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import SpotifiakCore

private let synced = Lyrics(synced: true, lines: [
    .init(time: 1, text: "Un"),
    .init(time: 5, text: "Deux"),
    .init(time: 5, text: "Deux bis"),
    .init(time: 9.5, text: "Trois"),
])

@Test func currentLineIsTheLastOneStarted() {
    #expect(synced.currentLine(at: 0) == nil)
    #expect(synced.currentLine(at: 1) == 0)
    #expect(synced.currentLine(at: 4.9) == 0)
    // Two lines at the same time: the later one.
    #expect(synced.currentLine(at: 5) == 2)
    #expect(synced.currentLine(at: 300) == 3)
}

@Test func plainLyricsHaveNoCurrentLine() {
    let plain = Lyrics(synced: false, lines: [.init(time: nil, text: "Un")])
    #expect(plain.currentLine(at: 10) == nil)
    #expect(!plain.isEmpty)
    #expect(Lyrics(synced: false, lines: [.init(time: nil, text: "")]).isEmpty)
}

@Test func lyricsDecodeFromTheAPI() async throws {
    let transport = FakeTransport()
    transport.respond(
        "https://h/api/tracks/t1/lyrics",
        #"{"synced":true,"lines":[{"time":1.5,"text":"Un"},{"time":3,"text":""}],"instrumental":false,"source":"lrclib"}"#
    )
    let client = APIClient(base: URL(string: "https://h/api")!, transport: transport, onUnauthorized: {})
    let lyrics = try await client.lyrics("t1")
    #expect(lyrics == Lyrics(synced: true, lines: [.init(time: 1.5, text: "Un"), .init(time: 3, text: "")], source: "lrclib"))

    transport.respond("https://h/api/tracks/t2/lyrics", #"{"synced":false,"lines":[],"instrumental":true,"source":"lrclib"}"#)
    let none = try await client.lyrics("t2")
    #expect(none.isEmpty && none.instrumental)
}

@Test func mixesDecodeFromTheAPI() async throws {
    let transport = FakeTransport()
    transport.respond(
        "https://h/api/me/mixes",
        #"[{"id":"daily-1","kind":"daily","title":"Daily Mix 1","description":"Avec A, B et C","friend":null,"trackCount":50,"covers":[{"trackId":"t1","coverUrl":null}]},{"id":"blend-u2","kind":"blend","title":"Toi et Léa","description":"Vos goûts réunis","friend":{"id":"u2","username":"lea","displayName":"Léa","avatarUpdatedAt":null},"trackCount":30,"covers":[]}]"#
    )
    let client = APIClient(base: URL(string: "https://h/api")!, transport: transport, onUnauthorized: {})
    let mixes = try await client.mixes()
    #expect(mixes.map(\.id) == ["daily-1", "blend-u2"])
    #expect(mixes[0].kind == .daily && mixes[0].friend == nil)
    #expect(mixes[1].kind == .blend && mixes[1].friend?.displayName == "Léa")
}

@Test func blendTracksCarryWhoseTasteTheyComeFrom() async throws {
    let transport = FakeTransport()
    let track = #"{"id":"t1","title":"T","artistName":"A","artistId":"a","album":null,"durationSec":200,"trackNumber":1,"discNumber":1,"addedAt":"2026-01-01T00:00:00.000Z","format":"mp3""#
    transport.respond(
        "https://h/api/me/mixes/blend-u2",
        #"{"id":"blend-u2","kind":"blend","title":"Toi et Léa","description":"d","friend":{"id":"u2","username":"lea","displayName":"Léa","avatarUpdatedAt":null},"trackCount":2,"covers":[],"tracks":["# + track + #","from":"both"},"# + track.replacingOccurrences(of: "t1", with: "t2") + #","from":"friend"}]}"#
    )
    let client = APIClient(base: URL(string: "https://h/api")!, transport: transport, onUnauthorized: {})
    let mix = try await client.mix("blend-u2")
    #expect(mix.tracks.map(\.id) == ["t1", "t2"])
    #expect(mix.sources == [.both, .friend])
    #expect(mix.source(at: 5) == nil)
}
