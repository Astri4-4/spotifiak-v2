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
    /// Friends see what this user listens to; nil from servers before friends existed.
    public let shareActivity: Bool?
    /// When the profile picture last changed; nil without one.
    public let avatarUpdatedAt: Date?
}

/// Anyone shown with a profile picture (or their initial without one).
public protocol HasAvatar {
    var id: String { get }
    var displayName: String { get }
    var avatarUpdatedAt: Date? { get }
}

extension User: HasAvatar {}

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
    /// Set when this is a podcast episode played as a track (see APIClient.track(episode:)).
    public let episode: TrackEpisode?

    public init(
        id: String, title: String, artistName: String, artistId: String, album: TrackAlbum? = nil,
        durationSec: Double? = nil, trackNumber: Int? = nil, discNumber: Int? = nil,
        addedAt: Date = Date(timeIntervalSince1970: 0), format: String? = nil, episode: TrackEpisode? = nil
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
        self.episode = episode
    }
}

extension Track {
    /// Its title, artist or album contains every word of `query`, ignoring case and accents
    /// (the in-playlist filter, same rule as the web app).
    public func matches(_ query: String) -> Bool {
        let haystack = [title, artistName, album?.title ?? ""].joined(separator: " ")
        return query.split(whereSeparator: \.isWhitespace).allSatisfy {
            haystack.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
    }
}

public struct TrackEpisode: Codable, Sendable, Hashable {
    public let podcastId: String
    public let audioUrl: URL
    /// Where playback resumes, in seconds.
    public let startAt: Double

    public init(podcastId: String, audioUrl: URL, startAt: Double) {
        self.podcastId = podcastId
        self.audioUrl = audioUrl
        self.startAt = startAt
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
    /// The user's own playlists and everyone's public ones (empty from servers before them).
    public let playlists: [PublicPlaylist]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tracks = try c.decode([Track].self, forKey: .tracks)
        albums = try c.decode([Album].self, forKey: .albums)
        artists = try c.decode([Artist].self, forKey: .artists)
        playlists = try c.decodeIfPresent([PublicPlaylist].self, forKey: .playlists) ?? []
    }
}

/// One of the up-to-four covers of a playlist's mosaic.
public struct MosaicCover: Codable, Sendable, Hashable {
    public let trackId: String
    public let coverUrl: URL?
}

public struct PlaylistSummary: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let description: String?
    public let trackCount: Int
    public let covers: [MosaicCover]
}

public struct PlaylistOwner: Codable, Sendable, Hashable {
    public let displayName: String
}

public struct PlaylistEntry: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    /// addedAt is when the entry was added to the playlist.
    public let track: Track
}

public struct PlaylistDetail: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let description: String?
    /// Listed for, and playable by, every account.
    public let isPublic: Bool
    /// Only the owner edits it.
    public let owned: Bool
    public let owner: PlaylistOwner
    public let covers: [MosaicCover]
    public let entries: [PlaylistEntry]

    enum CodingKeys: String, CodingKey {
        case id, name, description, isPublic = "public", owned, owner, covers, entries
    }
}

public struct PlaylistRef: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
}

// MARK: - Podcasts

public struct PodcastSummary: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let author: String?
    public let hasImage: Bool
}

public struct EpisodeProgress: Codable, Sendable, Hashable {
    public let positionSec: Double
    public let completed: Bool

    public init(positionSec: Double, completed: Bool) {
        self.positionSec = positionSec
        self.completed = completed
    }
}

public struct EpisodePodcast: Codable, Sendable, Hashable {
    public let id: String
    public let title: String
}

public struct Episode: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    /// Plain text, shortened.
    public let description: String?
    public let durationSec: Double?
    public let publishedAt: Date
    /// nil for a YouTube video of a created podcast: the API serves its audio.
    public let audioUrl: URL?
    /// "ready", or "queued" / "downloading" / "failed" for videos of created podcasts.
    public let status: String
    public let error: String?
    public let hasImage: Bool
    public let podcast: EpisodePodcast
    public let progress: EpisodeProgress?
}

public struct PodcastDetail: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let author: String?
    public let hasImage: Bool
    public let description: String?
    /// Created by this account: it adds videos, edits and deletes it.
    public let owned: Bool
    public let subscribed: Bool
    public let episodeCount: Int
    /// Most recent first, at most 300.
    public let episodes: [Episode]
}

/// From the podcast directory; podcastId is set when the server already knows the feed.
public struct PodcastSearchResult: Codable, Sendable, Hashable {
    public let feedUrl: String
    public let title: String
    public let author: String?
    public let imageUrl: URL?
    public let podcastId: String?
}

// MARK: - Jam

public struct JamPerson: Codable, Sendable, Hashable, Identifiable, HasAvatar {
    public let id: String
    public let displayName: String
    public let avatarUpdatedAt: Date?
}

public struct JamEntry: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let track: Track
    public let addedBy: JamPerson
}

/// A shared listening session; position is in seconds when the server sent it.
public struct JamState: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let host: JamPerson
    public let participants: [JamPerson]
    /// Played tracks, the current one (at index), then the tracks added to the queue.
    public let queue: [JamEntry]
    public let index: Int
    /// The rest of what was launched: plays once the queue is empty.
    public let fallback: [JamEntry]
    public let fallbackName: String?
    public let playing: Bool
    public let position: Double

    public var current: JamEntry? { queue.indices.contains(index) ? queue[index] : nil }
    /// What plays after the current entry: the added tracks, then the fallback.
    public var upNext: [JamEntry] { Array(queue.dropFirst(index + 1)) + fallback }
}

/// What a Jam starts with: the tracks after `index` become its fallback.
public struct JamStart: Codable, Sendable, Hashable {
    public let trackIds: [String]
    public let index: Int
    public let position: Double
    public let playing: Bool

    public init(trackIds: [String], index: Int, position: Double, playing: Bool) {
        self.trackIds = trackIds
        self.index = index
        self.position = position
        self.playing = playing
    }
}

public struct JamInvite: Codable, Sendable, Hashable {
    public let id: String
    public let host: JamPerson
    public let participants: [JamPerson]
    public let joined: Bool
}

/// The commands of POST /jam/:id/commands.
public enum JamCommand: Encodable, Sendable, Equatable {
    case play(position: Double?)
    case pause(position: Double?)
    case seek(position: Double)
    case next, prev
    case ended(entryId: String), jump(entryId: String), remove(entryId: String)
    case add(trackIds: [String])
    case playTracks(trackIds: [String], index: Int)
    /// Within the queue or within the fallback: before another entry, or at the end (nil).
    case move(entryId: String, beforeEntryId: String?)

    private enum Keys: String, CodingKey { case type, position, entryId, beforeEntryId, trackIds, index }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .play(let position):
            try c.encode("play", forKey: .type)
            try c.encodeIfPresent(position, forKey: .position)
        case .pause(let position):
            try c.encode("pause", forKey: .type)
            try c.encodeIfPresent(position, forKey: .position)
        case .seek(let position):
            try c.encode("seek", forKey: .type)
            try c.encode(position, forKey: .position)
        case .next: try c.encode("next", forKey: .type)
        case .prev: try c.encode("prev", forKey: .type)
        case .ended(let id), .jump(let id), .remove(let id):
            let type = switch self { case .ended: "ended"; case .jump: "jump"; default: "remove" }
            try c.encode(type, forKey: .type)
            try c.encode(id, forKey: .entryId)
        case .add(let ids):
            try c.encode("add", forKey: .type)
            try c.encode(ids, forKey: .trackIds)
        case .move(let id, let before):
            try c.encode("move", forKey: .type)
            try c.encode(id, forKey: .entryId)
            // beforeEntryId is required, null meaning "to the end".
            if let before { try c.encode(before, forKey: .beforeEntryId) } else { try c.encodeNil(forKey: .beforeEntryId) }
        case .playTracks(let ids, let index):
            try c.encode("playTracks", forKey: .type)
            try c.encode(ids, forKey: .trackIds)
            try c.encode(index, forKey: .index)
        }
    }
}

/// Reads a Server-Sent Events stream line by line. The Jam sends one-line JSON data,
/// so each `data:` line completes an event (blank separator lines may be skipped by the reader).
public struct ServerSentEvents: Sendable {
    private var event = "message"

    public init() {}

    public mutating func feed(_ line: String) -> (event: String, data: String)? {
        if line.hasPrefix("event:") {
            event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            defer { event = "message" }
            return (event, String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
        }
        return nil
    }
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
            if let date = (try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
                ?? (try? Date(text, strategy: .iso8601)) {
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

// MARK: - Deezer

/// A track found on Deezer, downloadable through deemix (`link`).
public struct DeezerTrack: Codable, Sendable, Hashable, Identifiable {
    public struct Artist: Codable, Sendable, Hashable { public let name: String }
    public struct Album: Codable, Sendable, Hashable {
        public let title: String
        public let cover_medium: URL?
    }

    public let id: Int
    public let title: String
    public let duration: Double
    public let link: String
    public let artist: Artist
    public let album: Album
}

// MARK: - Library scan

public struct ScanCounts: Codable, Sendable, Hashable {
    public let done: Int
    public let total: Int
    public let matched: Int
}

public struct ScanStatus: Codable, Sendable, Hashable {
    public struct Progress: Codable, Sendable, Hashable {
        public let done: Int
        public let total: Int
        public let startedAt: Date
    }

    public struct Result: Codable, Sendable, Hashable {
        public let added: Int, updated: Int, removed: Int, failed: Int, files: Int, checked: Int
    }

    public struct Enrichment: Codable, Sendable, Hashable {
        public let enabled: Bool
        public let running: Bool
        public let albums: ScanCounts
        public let artists: ScanCounts
        public let lastFinishedAt: Date?
        public let lastFailed: Int
    }

    public let running: Bool
    /// "quick" or "full".
    public let mode: String?
    /// "listing", "indexing" or "cleanup" while running.
    public let phase: String?
    public let dirsListed: Int
    public let progress: Progress?
    public let lastStartedAt: Date?
    public let lastFinishedAt: Date?
    public let lastDurationMs: Double?
    public let lastMode: String?
    public let lastResult: Result?
    public let lastError: String?
    public let enrichment: Enrichment
}

public struct DuplicateCopy: Codable, Sendable, Hashable, Identifiable {
    public struct AlbumRef: Codable, Sendable, Hashable { public let title: String }

    public let id: String
    public let title: String
    public let artistName: String
    public let album: AlbumRef?
    public let durationSec: Double?
    public let path: String
    public let fileSize: Int
    public let format: String
    public let bitrateKbps: Int?
}

/// Copies of the same track, best one first.
public struct DuplicateGroup: Codable, Sendable, Hashable {
    public let tracks: [DuplicateCopy]
}

public struct DuplicateResolution: Codable, Sendable, Hashable {
    public let keepId: String
    public let removeIds: [String]

    public init(keepId: String, removeIds: [String]) {
        self.keepId = keepId
        self.removeIds = removeIds
    }
}

public struct DuplicateRemoval: Codable, Sendable, Hashable {
    public struct Failure: Codable, Sendable, Hashable { public let path: String, error: String }
    public let removed: Int
    public let failed: [Failure]
}

// MARK: - Spotify import

public struct SpotifyStatus: Codable, Sendable, Hashable {
    public struct Account: Codable, Sendable, Hashable {
        public let displayName: String?
        public let spotifyUserId: String
    }

    public let configured: Bool
    /// Only sent to admins, to register it in the Spotify app.
    public let redirectUri: String?
    public let account: Account?
}

public struct SpotifyPlaylist: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let owner: String
    public let total: Int
    public let image: URL?
    /// Spotify only exposes the tracks of playlists the user owns or collaborates on.
    public let importable: Bool
    public let importedPlaylistId: String?
}

public struct SpotifyPlaylists: Codable, Sendable, Hashable {
    public let likedTotal: Int
    public let playlists: [SpotifyPlaylist]
}

public struct SpotifyImport: Codable, Sendable, Hashable, Identifiable {
    public struct Counts: Codable, Sendable, Hashable {
        public let pending: Int, matched: Int, queued: Int, not_found: Int
    }

    public let id: String
    public let name: String
    public let liked: Bool
    /// "running", "waiting", "done" or "failed".
    public let status: String
    public let error: String?
    public let playlistId: String?
    public let createdAt: Date
    public let total: Int
    public let counts: Counts
}

public struct MissingTrack: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let artist: String
    public let album: String?
    /// "queued" (downloading) or "not_found".
    public let status: String
}

// MARK: - Accounts

public struct ManagedUser: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let username: String
    public let displayName: String
    public let role: Role
    public let createdAt: Date
    public let lastSeenAt: Date?
}

/// Another account's public playlist.
public struct PublicPlaylist: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let trackCount: Int
    public let covers: [MosaicCover]
    public let owner: PlaylistOwner
}

// MARK: - Friends

/// Where the current user stands with someone: friends, request sent, request received, or none.
public enum Relation: String, Codable, Sendable, Hashable {
    case friend, sent, received
}

public struct Person: Codable, Sendable, Hashable, Identifiable, HasAvatar {
    public let id: String
    public let username: String
    public let displayName: String
    public let avatarUpdatedAt: Date?
}

public struct PersonResult: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let username: String
    public let displayName: String
    public let avatarUpdatedAt: Date?
    public let relation: Relation?

    public var person: Person { Person(id: id, username: username, displayName: displayName, avatarUpdatedAt: avatarUpdatedAt) }
}

public struct Friends: Codable, Sendable, Hashable {
    public struct Entry: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public let username: String
        public let displayName: String
        public let avatarUpdatedAt: Date?
        public var person: Person { Person(id: id, username: username, displayName: displayName, avatarUpdatedAt: avatarUpdatedAt) }
    }

    public let friends: [Entry]
    /// Requests waiting for this user's answer.
    public let incoming: [Entry]
    public let outgoing: [Entry]
}

public struct FriendPlay: Codable, Sendable, Hashable {
    public let track: Track
    public let playedAt: Date
    /// Still within the track's length since it started.
    public let listening: Bool
}

public struct FriendActivity: Codable, Sendable, Hashable, Identifiable {
    public let user: Person
    public let track: Track
    public let playedAt: Date
    public let listening: Bool

    public var id: String { user.id }
}

public struct Profile: Codable, Sendable, Hashable {
    public let user: Person
    public let relation: Relation?
    /// A friend who doesn't share their activity.
    public let activityHidden: Bool
    public let recentPlays: [FriendPlay]
    public let playlists: [PublicPlaylist]
}

/// A track a friend shared ("share"), or an invitation to their Jam ("jam", good while jamActive).
public struct AppNotification: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: String
    public let from: Person
    public let track: Track?
    public let jamId: String?
    public let jamActive: Bool
    public let message: String?
    public let createdAt: Date
    public let read: Bool
}

public struct NotificationCounts: Codable, Sendable, Hashable {
    public let unread: Int
    public let friendRequests: Int

    public init(unread: Int, friendRequests: Int) {
        self.unread = unread
        self.friendRequests = friendRequests
    }
}
