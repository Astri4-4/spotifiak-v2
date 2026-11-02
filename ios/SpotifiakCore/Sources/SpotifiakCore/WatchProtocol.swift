import Foundation

// What the iPhone app and the Apple Watch app say to each other over WatchConnectivity.
// The watch has no session of its own: the iPhone plays, answers requests with its API
// session, and pushes what's playing. Payloads travel as JSON in a property-list
// dictionary under one key (see WatchMessage).

/// What plays on the iPhone, pushed whenever it changes.
public struct WatchNowPlaying: Codable, Sendable, Equatable {
    public var trackId: String
    public var title: String
    public var artist: String
    /// A small cover (about 120 px) to keep messages light.
    public var cover: Data?
    public var isPlaying: Bool
    /// nil for podcast episodes, which can't be liked.
    public var liked: Bool?
    public var shuffle: Bool
    /// "off", "all" or "one".
    public var repeatMode: String
    /// Position when this was sent; the watch moves it on while playing.
    public var position: Double
    public var duration: Double?
    public var sentAt: Date
    /// In a Jam: the host's name and how many people are in it.
    public var jamHost: String?
    public var jamPeople: Int

    public init(trackId: String, title: String, artist: String, cover: Data?, isPlaying: Bool, liked: Bool?,
                shuffle: Bool, repeatMode: String, position: Double, duration: Double?, sentAt: Date,
                jamHost: String?, jamPeople: Int) {
        self.trackId = trackId
        self.title = title
        self.artist = artist
        self.cover = cover
        self.isPlaying = isPlaying
        self.liked = liked
        self.shuffle = shuffle
        self.repeatMode = repeatMode
        self.position = position
        self.duration = duration
        self.sentAt = sentAt
        self.jamHost = jamHost
        self.jamPeople = jamPeople
    }

    /// Where playback is at `date`, counting time since it was sent while playing.
    public func position(at date: Date) -> Double {
        let moved = isPlaying ? position + date.timeIntervalSince(sentAt) : position
        return duration.map { min(moved, $0) } ?? moved
    }
}

/// Something the watch can start on the iPhone.
public struct WatchItem: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable { case liked, playlist, album, track }

    public var kind: Kind
    /// The playlist, album or track id (empty for the liked tracks).
    public var itemId: String
    public var title: String
    public var subtitle: String?
    public var thumbnail: Data?

    public var id: String { "\(kind.rawValue):\(itemId)" }

    public init(kind: Kind, itemId: String, title: String, subtitle: String?, thumbnail: Data? = nil) {
        self.kind = kind
        self.itemId = itemId
        self.title = title
        self.subtitle = subtitle
        self.thumbnail = thumbnail
    }
}

public struct WatchFriendActivity: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var track: WatchItem
    public var listening: Bool
    public var playedAt: Date

    public init(id: String, name: String, track: WatchItem, listening: Bool, playedAt: Date) {
        self.id = id
        self.name = name
        self.track = track
        self.listening = listening
        self.playedAt = playedAt
    }
}

/// The "Amis" page: friends' activity, tracks they shared, and what's unread.
public struct WatchFriends: Codable, Sendable, Equatable {
    public var activity: [WatchFriendActivity]
    /// Shared tracks, newest first; subtitle says who sent them.
    public var shared: [WatchItem]
    public var unread: Int

    public init(activity: [WatchFriendActivity], shared: [WatchItem], unread: Int) {
        self.activity = activity
        self.shared = shared
        self.unread = unread
    }
}

public enum WatchCommand: Codable, Sendable, Equatable {
    case togglePlay, next, previous, toggleLike, toggleShuffle, cycleRepeat
    case play(WatchItem)
}

/// A message from the watch; library and friends get an answer, commands an acknowledgement.
public enum WatchRequest: Codable, Sendable, Equatable {
    case command(WatchCommand)
    case library
    case friends
}

public enum WatchReply: Codable, Sendable, Equatable {
    case done
    case library([WatchItem])
    case friends(WatchFriends)
    /// A message to show (the iPhone isn't logged in, the server failed…).
    case failed(String)
}

/// Packs payloads into the property-list dictionaries WatchConnectivity carries.
public enum WatchMessage {
    public static let key = "spotifiak"

    public static func pack(_ value: some Encodable) throws -> [String: Any] {
        [key: try JSONEncoder.spotifiak.encode(value)]
    }

    public static func unpack<T: Decodable>(_ type: T.Type, from message: [String: Any]) throws -> T {
        guard let data = message[key] as? Data else { throw DecodingError.valueNotFound(T.self, .init(codingPath: [], debugDescription: "No \(key) payload")) }
        return try JSONDecoder.spotifiak.decode(T.self, from: data)
    }
}
