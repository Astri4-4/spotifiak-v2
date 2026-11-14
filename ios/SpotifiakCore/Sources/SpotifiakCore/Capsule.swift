import Foundation

// MARK: - Time capsules (see backend/src/capsules.ts)

/// Received and still closed: who sealed it and when it opens, never what's inside.
public struct SealedCapsule: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let from: JamPerson
    public let openAt: Date
    public let createdAt: Date
}

public struct OpenedCapsule: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let from: JamPerson
    public let openAt: Date
    public let createdAt: Date
    public let track: Track
    public let message: String?
}

public struct SentCapsule: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let to: JamPerson
    public let openAt: Date
    public let createdAt: Date
    public let track: Track
    public let message: String?
    public let open: Bool
}

public struct Capsules: Codable, Sendable, Hashable {
    public let sealed: [SealedCapsule]
    public let opened: [OpenedCapsule]
    public let sent: [SentCapsule]
}

/// "dans 1 an et 2 mois", "dans 12 jours", then "03:12:45" on the last day. Same as the web app.
public func capsuleCountdown(_ seconds: Double) -> String {
    if seconds <= 0 { return "maintenant" }
    let day = 24.0 * 3600
    if seconds < day {
        let s = Int(seconds)
        return String(format: "%02d:%02d:%02d", s / 3600, s % 3600 / 60, s % 60)
    }
    func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n > 1 ? many : one)" }
    let days = Int(seconds / day)
    if days < 61 { return "dans \(plural(days, "jour", "jours"))" }
    let months = Int(Double(days) / 30.44)
    if months < 12 { return "dans \(months) mois" }
    let years = months / 12, rest = months % 12
    return "dans \(plural(years, "an", "ans"))" + (rest > 0 ? " et \(rest) mois" : "")
}

extension APIClient {
    public func capsules() async throws -> Capsules {
        try await get("/me/capsules")
    }

    private struct NewCapsule: Encodable {
        let trackId: String, toId: String, openAt: Date, message: String?
    }

    /// `toId`: the user's own id for a capsule to oneself.
    public func sealCapsule(trackId: String, to toId: String, openAt: Date, message: String?) async throws {
        try await data("POST", "/capsules", body: NewCapsule(trackId: trackId, toId: toId, openAt: openAt, message: message))
    }

    public func removeCapsule(_ id: String) async throws {
        try await data("DELETE", "/capsules/\(id)", body: nil as [String: String]?)
    }
}
