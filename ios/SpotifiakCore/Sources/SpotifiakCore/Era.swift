import Foundation

// MARK: - Ères musicales (see backend/src/eras.ts)

public struct EraArtist: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let pictureUrl: URL?
    public let coverTrackId: String?
    public let plays: Int

    public var artist: Artist { Artist(id: id, name: name, pictureUrl: pictureUrl, coverTrackId: coverTrackId) }
}

/// A chapter of the listening history, named after the artists that define it.
public struct Era: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let start: Date
    public let end: Date
    public let plays: Int
    /// Still going: the latest chapter, with recent plays.
    public let current: Bool
    public let artists: [EraArtist]
    public let tracks: [Track]

    /// "mars → mai 2026", "juin 2026", "décembre 2025 → février 2026".
    public func span(calendar: Calendar = .current) -> String {
        let fr = Locale(identifier: "fr_FR")
        let monthYear = Date.FormatStyle(locale: fr, calendar: calendar, timeZone: calendar.timeZone).month(.wide).year()
        let monthOnly = Date.FormatStyle(locale: fr, calendar: calendar, timeZone: calendar.timeZone).month(.wide)
        let a = calendar.dateComponents([.year, .month], from: start)
        let b = calendar.dateComponents([.year, .month], from: end)
        if a == b { return start.formatted(monthYear) }
        if a.year == b.year { return "\(start.formatted(monthOnly)) → \(end.formatted(monthYear))" }
        return "\(start.formatted(monthYear)) → \(end.formatted(monthYear))"
    }
}

extension APIClient {
    /// The user's eras, newest first.
    public func eras() async throws -> [Era] {
        try await get("/me/eras")
    }
}
