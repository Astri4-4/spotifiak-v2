import Foundation

// MARK: - Blind test (see backend/src/quiz.ts)

public struct QuizPlayer: Codable, Sendable, Hashable, Identifiable, HasAvatar {
    public let id: String
    public let displayName: String
    public let avatarUpdatedAt: Date?
    public let score: Int
}

public struct QuizChoice: Codable, Sendable, Hashable {
    public let title: String
    public let artist: String
}

public struct QuizResult: Codable, Sendable, Hashable {
    public let userId: String
    public let choice: Int
    public let ms: Int
    public let points: Int
}

public struct QuizRound: Codable, Sendable, Hashable {
    public let choices: [QuizChoice]
    /// Where the clip starts in the track, in seconds.
    public let clipStart: Double
    public let format: String?
    /// Who answered (never what) until the reveal.
    public let answered: [String]
    public let mine: Int?
    /// Set once revealed.
    public let answer: Int?
    public let track: Track?
    public let results: [QuizResult]
}

public struct QuizState: Codable, Sendable, Hashable, Identifiable {
    public enum Phase: String, Codable, Sendable {
        case lobby, countdown, question, reveal, over
    }

    public let id: String
    public let host: JamPerson
    public let players: [QuizPlayer]
    public let phase: Phase
    public let roundCount: Int
    public let index: Int
    /// Left in this phase when the server sent it.
    public let remainingMs: Double
    public let round: QuizRound?

    /// Best score first.
    public var ranking: [QuizPlayer] { players.sorted { $0.score > $1.score } }
}

/// A game code from what the user typed: the code itself or an invitation link (…/quiz/K7Q2XP).
public func quizCode(_ input: String) -> String? {
    let code = input.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "/").last.map { $0.uppercased() } ?? ""
    return code.isEmpty ? nil : code
}

extension APIClient {
    public func createQuiz() async throws -> QuizState {
        try await send("POST", "/quiz", body: nil as [String: String]?)
    }

    public func joinQuiz(_ id: String) async throws -> QuizState {
        try await send("POST", "/quiz/\(id)/join", body: nil as [String: String]?)
    }

    public func startQuiz(_ id: String) async throws {
        try await data("POST", "/quiz/\(id)/start", body: nil as [String: String]?)
    }

    public func answerQuiz(_ id: String, index: Int, choice: Int) async throws {
        try await data("POST", "/quiz/\(id)/answer", body: ["index": index, "choice": choice])
    }

    public func inviteToQuiz(_ id: String, userIds: [String]) async throws {
        try await data("POST", "/quiz/\(id)/invite", body: ["userIds": userIds])
    }

    public func leaveQuiz(_ id: String) async throws {
        try await data("POST", "/quiz/\(id)/leave", body: nil as [String: String]?)
    }

    public func quizEventsURL(_ id: String) -> URL {
        url("/quiz/\(id)/events")
    }

    /// The round's clip; formats AVPlayer can't read come converted, as for tracks.
    public func quizClipURL(_ id: String, index: Int, format: String?) -> URL {
        let needsCompat = format.map { !Self.playableFormats.contains($0) } ?? false
        return url("/quiz/\(id)/clip/\(index)", query: needsCompat ? ["compat": "1"] : [:])
    }

    /// The link friends open on the web app.
    public func quizInviteURL(_ id: String) -> URL {
        let web = base.lastPathComponent == "api" ? base.deletingLastPathComponent() : base
        return web.appendingPathComponent("quiz").appendingPathComponent(id)
    }
}
