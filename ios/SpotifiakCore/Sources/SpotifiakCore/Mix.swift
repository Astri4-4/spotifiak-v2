import Foundation

/// A mix the server makes from what people listen to: Daily Mix N, or "Entre amis" with a friend.
public struct MixSummary: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case daily, blend
    }

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
