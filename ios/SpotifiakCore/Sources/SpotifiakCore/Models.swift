import Foundation

// Mirrors the API's JSON (see frontend/src/api.ts): same field names, optionals where
// the API sends null.

public enum Role: String, Codable, Sendable, Hashable {
    case admin, user
}

public struct User: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let username: String
    public let displayName: String
    public let role: Role
}

public struct AuthStatus: Codable, Sendable, Hashable {
    public let user: User?
    public let needsSetup: Bool
    public let signupOpen: Bool
}

public struct TrackAlbum: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let coverUrl: URL?
}

public struct Track: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let artistName: String
    public let artistId: String
    public let album: TrackAlbum?
    public let durationSec: Double?
    public let trackNumber: Int?
    public let discNumber: Int?
    public let addedAt: Date
    /// File extension ("flac"); absent on podcast episodes.
    public let format: String?

    public init(
        id: String, title: String, artistName: String, artistId: String, album: TrackAlbum? = nil,
        durationSec: Double? = nil, trackNumber: Int? = nil, discNumber: Int? = nil,
        addedAt: Date = Date(timeIntervalSince1970: 0), format: String? = nil
    ) {
        self.id = id
        self.title = title
        self.artistName = artistName
        self.artistId = artistId
        self.album = album
        self.durationSec = durationSec
        self.trackNumber = trackNumber
        self.discNumber = discNumber
        self.addedAt = addedAt
        self.format = format
    }
}

public struct AlbumArtist: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let pictureUrl: URL?
}

public struct Album: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let year: Int?
    public let createdAt: Date
    /// From Deezer; nil when not matched (then the file art is used).
    public let coverUrl: URL?
    public let artist: AlbumArtist
    public let coverTrackId: String?
    public let trackCount: Int
}

public struct AlbumDetail: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let year: Int?
    public let createdAt: Date
    public let coverUrl: URL?
    public let artist: AlbumArtist
    public let coverTrackId: String?
    public let trackCount: Int
    public let tracks: [Track]
}

public struct Artist: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    /// From Deezer (or one of the artist's album covers); nil when not matched.
    public let pictureUrl: URL?
    public let coverTrackId: String?
}

public struct ArtistDetail: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let pictureUrl: URL?
    public let coverTrackId: String?
    public let albums: [Album]
    public let tracks: [Track]
}

public struct SearchResults: Codable, Sendable, Hashable {
    public let tracks: [Track]
    public let albums: [Album]
    public let artists: [Artist]
}

public struct Page<T: Codable & Sendable & Hashable>: Codable, Sendable, Hashable {
    public let items: [T]
}

extension JSONDecoder {
    /// Decodes the API's ISO 8601 dates, with or without fractional seconds.
    public static var spotifiak: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true))
                ?? Date(text, strategy: .iso8601) {
                return date
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid date: \(text)"))
        }
        return decoder
    }
}

extension JSONEncoder {
    /// Encodes dates the way JSONDecoder.spotifiak reads them.
    public static var spotifiak: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true)))
        }
        return encoder
    }
}
