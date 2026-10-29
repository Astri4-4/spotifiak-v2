import Foundation
import Testing
@testable import SpotifiakCore

func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
    try JSONDecoder.spotifiak.decode(type, from: fixture(name))
}

@Test func decodesAlbumDetailWithNullFields() throws {
    let album = try decode(AlbumDetail.self, "album-detail")
    #expect(album.tracks.count == 2)
    #expect(album.tracks[1].durationSec == nil)
    #expect(album.tracks[1].trackNumber == nil)
    #expect(album.tracks[0].format == "flac")
    #expect(abs(album.tracks[0].addedAt.timeIntervalSince1970 - 1_793_021_518.123) < 0.001)
}

@Test func decodesAlbumWithoutCoverOrYear() throws {
    let page = try decode(Page<Album>.self, "albums-page")
    #expect(page.items[0].year == nil)
    #expect(page.items[0].coverUrl == nil)
    #expect(page.items[0].coverTrackId == nil)
}

@Test func decodesSearchAuthStatusAndArtist() throws {
    #expect(try decode(SearchResults.self, "search").artists[0].pictureUrl == nil)
    #expect(try decode(AuthStatus.self, "auth-status").user?.role == .admin)
    #expect(try decode(ArtistDetail.self, "artist-detail").albums.count == 1)
}

@Test func decodesTrackWithoutFormat() throws {
    // Episodes played as tracks have no format, and dates may lack fractional seconds.
    let json = #"{"id":"e","title":"T","artistName":"A","artistId":"a","album":null,"durationSec":null,"trackNumber":null,"discNumber":null,"addedAt":"2026-10-26T13:31:58Z"}"#
    let track = try JSONDecoder.spotifiak.decode(Track.self, from: Data(json.utf8))
    #expect(track.format == nil)
    #expect(track.album == nil)
    #expect(track.addedAt == Date(timeIntervalSince1970: 1_793_021_518))
}
