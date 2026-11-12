import Foundation

/// This week's taste duel with a friend: their pick for me, mine for them, and the score (all weeks).
public struct Duel: Codable, Sendable, Hashable, Identifiable {
    public struct ForMe: Codable, Sendable, Hashable {
        public let track: Track
        public let myVote: Bool?
    }

    public struct FromMe: Codable, Sendable, Hashable {
        public let track: Track
        public let theirVote: Bool?
    }

    public struct Score: Codable, Sendable, Hashable {
        public let me: Int
        public let friend: Int
    }

    public let friend: Person
    public let week: String
    public let forMe: ForMe?
    public let fromMe: FromMe?
    public let score: Score

    public var id: String { friend.id }
}

/// Me and my friends, and how close each pair's tastes are (0–1).
public struct TasteMap: Codable, Sendable, Hashable {
    public struct Link: Codable, Sendable, Hashable {
        public let a: String
        public let b: String
        public let similarity: Double
        public let artists: [String]
    }

    public let people: [Person]
    public let links: [Link]
}

/// What to download next: albums the library only has part of, friends' artists' top tracks.
public struct Suggestions: Decodable, Sendable, Hashable {
    public struct AlbumToFinish: Codable, Sendable, Hashable, Identifiable {
        public let album: Album
        public let have: Int
        public let total: Int
        public let link: String
        public var id: String { album.id }
    }

    /// A Deezer track and the friends who love its artist.
    public struct FriendsTrack: Decodable, Sendable, Hashable, Identifiable {
        public let track: DeezerTrack
        public let fans: [String]
        public var id: Int { track.id }

        private struct Fans: Decodable { let fans: [String] }

        public init(from decoder: Decoder) throws {
            track = try DeezerTrack(from: decoder)
            fans = try Fans(from: decoder).fans
        }
    }

    public let albums: [AlbumToFinish]
    public let tracks: [FriendsTrack]
}

/// Where a track plays, rounded to a ~500 m cell: the only position the server ever gets.
public enum PlaceCell {
    static let step = 0.005

    /// "48.855_2.350"
    public static func cell(latitude: Double, longitude: Double) -> String {
        let round = { (value: Double) in String(format: "%.3f", (value / step).rounded() * step) }
        return "\(round(latitude))_\(round(longitude))"
    }

    /// The "Ici" mix of a cell.
    public static func mixId(_ cell: String) -> String { "place-\(cell)" }
}

extension APIClient {
    /// A track skipped in its first seconds; twice and it leaves the user's mixes and radios.
    public func skip(_ trackId: String) async throws {
        try await data("POST", "/me/skips", body: ["trackId": trackId])
    }

    /// Takes a skipped track back into mixes and radios.
    public func unskip(_ trackId: String) async throws {
        try await data("DELETE", "/me/skips/\(trackId)", body: nil as [String: String]?)
    }

    public func duels() async throws -> [Duel] {
        try await get("/me/duels")
    }

    public func voteDuel(friendId: String, liked: Bool) async throws {
        try await data("PUT", "/me/duels/\(friendId)", body: ["liked": liked])
    }

    public func tasteMap() async throws -> TasteMap {
        try await get("/me/taste-map")
    }

    public func suggestions() async throws -> Suggestions {
        try await get("/me/suggestions")
    }
}
