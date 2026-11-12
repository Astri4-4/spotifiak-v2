import Foundation

/// A mix the server makes from what people listen to: Daily Mix N, "Entre amis", Discover Weekly,
/// Release Radar; or, opened by id, a radio (radio-artist-<id>, radio-track-<id>), a genre (genre-<id>)
/// or the history.
public struct MixSummary: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case daily, blend, weekly, radar, radio, genre, history

        /// What the page calls it, above the title.
        public var label: String {
            switch self {
            case .daily, .weekly, .radar: "Mix"
            case .blend: "Entre amis"
            case .radio: "Radio"
            case .genre: "Genre"
            case .history: "Historique"
            }
        }

        /// How often it changes, for the ones that do.
        public var updates: String? {
            switch self {
            case .daily, .blend: "Mis à jour chaque jour"
            case .weekly, .radar: "Mis à jour chaque lundi"
            default: nil
            }
        }
    }

    public static func artistRadio(_ artistId: String) -> String { "radio-artist-\(artistId)" }
    public static func trackRadio(_ trackId: String) -> String { "radio-track-\(trackId)" }
    public static let history = "history"

    public let id: String
    public let kind: Kind
    public let title: String
    public let description: String
    /// The friend of an "Entre amis" mix.
    public let friend: Person?
    public let trackCount: Int
    public let covers: [MosaicCover]
}

public struct MixDetail: Decodable, Sendable, Hashable, Identifiable {
    /// Whose taste an "Entre amis" track comes from.
    public enum Source: String, Decodable, Sendable {
        case both, me, friend
    }

    public let id: String
    public let kind: MixSummary.Kind
    public let title: String
    public let description: String
    public let friend: Person?
    public let covers: [MosaicCover]
    public let tracks: [Track]
    /// One per track, in order; nil in Daily Mixes.
    public let sources: [Source?]

    private enum CodingKeys: String, CodingKey {
        case id, kind, title, description, friend, covers, tracks
    }

    /// Each track's `from`, sent alongside its fields.
    private struct From: Decodable {
        let from: Source?
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(MixSummary.Kind.self, forKey: .kind)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decode(String.self, forKey: .description)
        friend = try container.decodeIfPresent(Person.self, forKey: .friend)
        covers = try container.decode([MosaicCover].self, forKey: .covers)
        tracks = try container.decode([Track].self, forKey: .tracks)
        sources = (try? container.decode([From].self, forKey: .tracks).map(\.from)) ?? []
    }

    public func source(at index: Int) -> Source? {
        sources.indices.contains(index) ? sources[index] : nil
    }
}

public struct Genre: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let trackCount: Int

    /// The genre's page, a mix.
    public var mixId: String { "genre-\(id)" }
}

/// The user's year in Spotifiak, like Spotify Wrapped.
public struct Wrapped: Decodable, Sendable, Hashable {
    public let year: Int
    /// Years with plays, newest first.
    public let years: [Int]
    public let plays: Int
    public let minutes: Int
    public let topTracks: [Track]
    public let topArtists: [Artist]
    /// Plays of each top track and artist, in the same order.
    public let trackPlays: [Int]
    public let artistPlays: [Int]
    public let topGenres: [GenrePlays]

    public struct GenrePlays: Decodable, Sendable, Hashable {
        public let name: String
        public let plays: Int
    }

    private enum CodingKeys: String, CodingKey {
        case year, years, plays, minutes, topTracks, topArtists, topGenres
    }

    /// The play count sent alongside each track's and artist's fields.
    private struct Plays: Decodable {
        let plays: Int
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        year = try container.decode(Int.self, forKey: .year)
        years = try container.decode([Int].self, forKey: .years)
        plays = try container.decode(Int.self, forKey: .plays)
        minutes = try container.decode(Int.self, forKey: .minutes)
        topTracks = try container.decode([Track].self, forKey: .topTracks)
        topArtists = try container.decode([Artist].self, forKey: .topArtists)
        trackPlays = try container.decode([Plays].self, forKey: .topTracks).map(\.plays)
        artistPlays = try container.decode([Plays].self, forKey: .topArtists).map(\.plays)
        topGenres = try container.decode([GenrePlays].self, forKey: .topGenres)
    }
}
