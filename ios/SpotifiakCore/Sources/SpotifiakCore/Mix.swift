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

public struct MixDetail: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let kind: MixSummary.Kind
    public let title: String
    public let description: String
    public let friend: Person?
    public let covers: [MosaicCover]
    public let tracks: [Track]
}
