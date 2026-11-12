import Foundation

/// A track's lyrics (GET /tracks/:id/lyrics): synced ones have a time per line.
public struct Lyrics: Decodable, Equatable, Sendable {
    public struct Line: Decodable, Equatable, Sendable {
        /// Seconds from the start; nil for plain lyrics.
        public let time: Double?
        public let text: String

        public init(time: Double?, text: String) {
            self.time = time
            self.text = text
        }
    }

    public let synced: Bool
    public let lines: [Line]
    public let instrumental: Bool
    /// "file", "tags" or "lrclib"; nil when none were found.
    public let source: String?

    public init(synced: Bool, lines: [Line], instrumental: Bool = false, source: String? = nil) {
        self.synced = synced
        self.lines = lines
        self.instrumental = instrumental
        self.source = source
    }

    /// No words to show (none found, or an instrumental).
    public var isEmpty: Bool { lines.allSatisfy(\.text.isEmpty) }

    /// The line being sung at `position`: the last one started, nil before the first or unsynced.
    public func currentLine(at position: Double) -> Int? {
        guard synced else { return nil }
        // Lines are sorted by time: find the first one still to come.
        var low = 0, high = lines.count
        while low < high {
            let mid = (low + high) / 2
            if (lines[mid].time ?? 0) <= position { low = mid + 1 } else { high = mid }
        }
        return low == 0 ? nil : low - 1
    }
}
