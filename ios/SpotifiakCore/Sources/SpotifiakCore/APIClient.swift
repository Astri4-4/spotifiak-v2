import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Sends requests; URLSession in the app, a fake in tests.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// An error answered by the API, with its message (user-facing, in French).
public struct APIError: Error, Equatable, Sendable {
    public let message: String
    public let status: Int

    public init(message: String, status: Int) {
        self.message = message
        self.status = status
    }
}

/// The Spotifiak API at `base`. The session is the server's cookie, which the
/// transport's cookie storage keeps.
public final class APIClient: Sendable {
    public let base: URL
    private let transport: HTTPTransport
    private let onUnauthorized: @Sendable () -> Void

    /// Formats every Apple player reads; the API converts the others (?compat=1).
    static let playableFormats: Set<String> = ["mp3", "m4a", "aac", "flac"]

    public init(base: URL, transport: HTTPTransport, onUnauthorized: @escaping @Sendable () -> Void) {
        self.base = base
        self.transport = transport
        self.onUnauthorized = onUnauthorized
    }

    /// The API base for what the user typed: the first candidate whose /health answers.
    public static func discover(_ input: String, transport: HTTPTransport) async throws -> URL {
        struct Health: Decodable { let ok: Bool }
        for candidate in candidateAPIBases(input) {
            var request = URLRequest(url: candidate.appendingPathComponent("health"))
            request.timeoutInterval = 10
            guard let (data, response) = try? await transport.send(request), response.statusCode == 200,
                  let health = try? JSONDecoder().decode(Health.self, from: data), health.ok
            else { continue }
            return candidate
        }
        throw APIError(message: "Serveur Spotifiak introuvable à cette adresse", status: 0)
    }

    // MARK: - Auth

    private struct UserResponse: Decodable { let user: User }

    public func authStatus() async throws -> AuthStatus {
        try await get("/auth/status")
    }

    public func login(username: String, password: String) async throws -> User {
        let response: UserResponse = try await send("POST", "/auth/login", body: ["username": username, "password": password])
        return response.user
    }

    public func register(username: String, password: String, displayName: String?) async throws -> User {
        var body = ["username": username, "password": password]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        let response: UserResponse = try await send("POST", "/auth/register", body: body)
        return response.user
    }

    /// Expires the session (onUnauthorized) when the server no longer knows our cookie. For
    /// requests that don't go through this client, like streams played by AVFoundation.
    public func checkSession() async {
        guard let status = try? await authStatus(), status.user == nil else { return }
        onUnauthorized()
    }

    public func logout() async throws {
        _ = try await data("POST", "/auth/logout", body: nil as [String: String]?)
    }

    // MARK: - Library

    public func albums() async throws -> [Album] {
        let page: Page<Album> = try await get("/albums", query: ["limit": "200"])
        return page.items
    }

    public func album(_ id: String) async throws -> AlbumDetail {
        try await get("/albums/\(id)")
    }

    public func artists() async throws -> [Artist] {
        let page: Page<Artist> = try await get("/artists", query: ["limit": "200"])
        return page.items
    }

    public func artist(_ id: String) async throws -> ArtistDetail {
        try await get("/artists/\(id)")
    }

    public func search(_ query: String) async throws -> SearchResults {
        try await get("/search", query: ["q": query])
    }

    // MARK: - Media URLs

    public func streamURL(for track: Track) -> URL {
        let needsCompat = track.format.map { !Self.playableFormats.contains($0) } ?? false
        return url("/tracks/\(track.id)/stream", query: needsCompat ? ["compat": "1"] : [:])
    }

    /// Same rules as the web app: the Deezer image first, else the art in the files.
    public func coverURL(track: Track) -> URL? {
        track.album?.coverUrl ?? fileCover(track.id)
    }

    public func coverURL(album: Album) -> URL? {
        album.coverUrl ?? album.coverTrackId.map(fileCover)
    }

    public func coverURL(album: AlbumDetail) -> URL? {
        album.coverUrl ?? album.coverTrackId.map(fileCover)
    }

    public func pictureURL(artist: Artist) -> URL? {
        artist.pictureUrl ?? artist.coverTrackId.map(fileCover)
    }

    public func pictureURL(artist: ArtistDetail) -> URL? {
        artist.pictureUrl ?? artist.coverTrackId.map(fileCover)
    }

    private func fileCover(_ trackId: String) -> URL {
        url("/tracks/\(trackId)/cover")
    }

    // MARK: - Requests

    private struct ErrorBody: Decodable { let error: String }

    func url(_ path: String, query: [String: String] = [:]) -> URL {
        var components = URLComponents(url: base.appendingPathComponent(String(path.dropFirst())), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try JSONDecoder.spotifiak.decode(T.self, from: await data("GET", path, query: query, body: nil as [String: String]?))
    }

    func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B?) async throws -> T {
        try JSONDecoder.spotifiak.decode(T.self, from: await data(method, path, body: body))
    }

    @discardableResult
    func data<B: Encodable>(_ method: String, _ path: String, query: [String: String] = [:], body: B?) async throws -> Data {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder.spotifiak.encode(body)
        }
        let (data, response) = try await transport.send(request)
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401 && !path.hasPrefix("/auth/") { onUnauthorized() }
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Une erreur est survenue"
            throw APIError(message: message, status: response.statusCode)
        }
        return data
    }
}
