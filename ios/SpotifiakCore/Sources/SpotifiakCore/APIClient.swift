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

    public func publicPlaylists() async throws -> [PublicPlaylist] {
        try await get("/playlists/public")
    }

    // MARK: - Deezer and the library (scan, duplicates)

    public func searchDeezer(_ query: String) async throws -> [DeezerTrack] {
        try await get("/deezer/search", query: ["q": query])
    }

    /// Queues a Deezer link in deemix; the library rescans afterwards.
    public func download(_ link: String) async throws {
        try await data("POST", "/downloads", body: ["url": link])
    }

    public func scanStatus() async throws -> ScanStatus {
        try await get("/library/scan")
    }

    /// Quick: new and removed files; full: also files modified in place.
    public func startScan(full: Bool) async throws {
        try await data("POST", "/library/scan", query: ["full": String(full)], body: nil as [String: String]?)
    }

    public func duplicates() async throws -> [DuplicateGroup] {
        try await get("/library/duplicates")
    }

    public func removeDuplicates(_ groups: [DuplicateResolution]) async throws -> DuplicateRemoval {
        try await send("POST", "/library/duplicates/resolve", body: ["groups": groups])
    }

    // MARK: - Spotify import

    public func spotifyStatus() async throws -> SpotifyStatus {
        try await get("/spotify/status")
    }

    private struct AuthorizeURL: Decodable { let url: URL }

    /// Spotify's consent page; the server finishes the connection at its callback.
    public func spotifyAuthorizeURL() async throws -> URL {
        let answer: AuthorizeURL = try await get("/spotify/authorize")
        return answer.url
    }

    public func disconnectSpotify() async throws {
        try await data("DELETE", "/spotify/connection", body: nil as [String: String]?)
    }

    public func spotifyPlaylists() async throws -> SpotifyPlaylists {
        try await get("/spotify/playlists")
    }

    private struct ImportStarted: Decodable { let id: String }

    /// Imports a Spotify playlist into a new playlist (`name`), or the liked tracks when nil.
    public func importFromSpotify(playlistId: String?, name: String) async throws {
        if let playlistId {
            let _: ImportStarted = try await send("POST", "/spotify/imports", body: ["playlistId": playlistId, "name": name])
        } else {
            let _: ImportStarted = try await send("POST", "/spotify/imports", body: ["liked": true])
        }
    }

    public func spotifyImports() async throws -> [SpotifyImport] {
        try await get("/spotify/imports")
    }

    public func missingTracks(importId: String) async throws -> [MissingTrack] {
        try await get("/spotify/imports/\(importId)/missing")
    }

    // MARK: - Accounts

    public func updateProfile(displayName: String) async throws -> User {
        let response: UserResponse = try await send("PATCH", "/me", body: ["displayName": displayName])
        return response.user
    }

    /// Whether friends see what this user listens to.
    public func setShareActivity(_ on: Bool) async throws -> User {
        let response: UserResponse = try await send("PATCH", "/me", body: ["shareActivity": on])
        return response.user
    }

    /// Signs out the other devices.
    public func changePassword(current: String, new: String) async throws {
        try await data("POST", "/me/password", body: ["currentPassword": current, "newPassword": new])
    }

    public func users() async throws -> [ManagedUser] {
        try await get("/users")
    }

    public func createUser(username: String, password: String, displayName: String?, role: Role) async throws {
        var body = ["username": username, "password": password, "role": role.rawValue]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        let _: UserResponse = try await send("POST", "/users", body: body)
    }

    /// A new password signs the user out everywhere.
    public func updateUser(_ id: String, role: Role? = nil, password: String? = nil) async throws {
        var body: [String: String] = [:]
        if let role { body["role"] = role.rawValue }
        if let password { body["password"] = password }
        let _: UserResponse = try await send("PATCH", "/users/\(id)", body: body)
    }

    public func deleteUser(_ id: String) async throws {
        try await data("DELETE", "/users/\(id)", body: nil as [String: String]?)
    }

    // MARK: - Friends

    public func people(_ query: String) async throws -> [PersonResult] {
        try await get("/people", query: ["q": query])
    }

    public func profile(_ userId: String) async throws -> Profile {
        try await get("/people/\(userId)")
    }

    public func friends() async throws -> Friends {
        try await get("/friends")
    }

    private struct RelationAnswer: Decodable { let relation: Relation? }

    /// Sends a request, or accepts theirs when they asked first.
    @discardableResult
    public func addFriend(_ userId: String) async throws -> Relation? {
        let answer: RelationAnswer = try await send("POST", "/friends/\(userId)", body: nil as [String: String]?)
        return answer.relation
    }

    public func acceptFriend(_ userId: String) async throws {
        try await data("POST", "/friends/\(userId)/accept", body: nil as [String: String]?)
    }

    /// Declines or cancels a request, or ends a friendship.
    public func removeFriend(_ userId: String) async throws {
        try await data("DELETE", "/friends/\(userId)", body: nil as [String: String]?)
    }

    public func friendActivity() async throws -> [FriendActivity] {
        try await get("/friends/activity")
    }

    /// A track started playing here (friend activity).
    public func recordPlay(_ trackId: String) async throws {
        try await data("POST", "/me/plays", body: ["trackId": trackId])
    }

    private struct Share: Encodable {
        let trackId: String, userIds: [String], message: String?
    }

    public func share(_ trackId: String, with userIds: [String], message: String?) async throws {
        try await data("POST", "/shares", body: Share(trackId: trackId, userIds: userIds, message: message))
    }

    public func inviteToJam(_ jamId: String, userIds: [String]) async throws {
        try await data("POST", "/jam/\(jamId)/invite", body: ["userIds": userIds])
    }

    public func notifications() async throws -> [AppNotification] {
        try await get("/me/notifications")
    }

    public func notificationCounts() async throws -> NotificationCounts {
        try await get("/me/notifications/count")
    }

    public func markNotificationsRead() async throws {
        try await data("POST", "/me/notifications/read", body: nil as [String: String]?)
    }

    public func deleteNotification(_ id: String) async throws {
        try await data("DELETE", "/me/notifications/\(id)", body: nil as [String: String]?)
    }

    // MARK: - Collection

    /// Liked tracks, latest first; addedAt is when each was liked.
    public func likedTracks() async throws -> [Track] {
        try await get("/me/likes")
    }

    public func savedAlbums() async throws -> [Album] {
        try await get("/me/albums")
    }

    public func followedArtists() async throws -> [Artist] {
        try await get("/me/artists")
    }

    public func playlists() async throws -> [PlaylistSummary] {
        try await get("/playlists")
    }

    public func playlist(_ id: String) async throws -> PlaylistDetail {
        try await get("/playlists/\(id)")
    }

    public func likedTrackIds() async throws -> [String] {
        try await get("/me/likes/ids")
    }

    public func setLiked(_ trackId: String, _ liked: Bool) async throws {
        try await data(liked ? "PUT" : "DELETE", "/me/likes/\(trackId)", body: nil as [String: String]?)
    }

    public func setSaved(album id: String, _ saved: Bool) async throws {
        try await data(saved ? "PUT" : "DELETE", "/me/albums/\(id)", body: nil as [String: String]?)
    }

    public func setFollowed(artist id: String, _ followed: Bool) async throws {
        try await data(followed ? "PUT" : "DELETE", "/me/artists/\(id)", body: nil as [String: String]?)
    }

    /// Without a name the server picks "Ma playlist n° N".
    public func createPlaylist(name: String?) async throws -> PlaylistRef {
        try await send("POST", "/playlists", body: name.map { ["name": $0] } ?? [:])
    }

    private struct PlaylistChanges: Encodable {
        let name: String?, description: String?, isPublic: Bool?
        enum CodingKeys: String, CodingKey { case name, description, isPublic = "public" }
    }

    public func updatePlaylist(_ id: String, name: String? = nil, description: String? = nil, isPublic: Bool? = nil) async throws {
        try await data("PATCH", "/playlists/\(id)", body: PlaylistChanges(name: name, description: description, isPublic: isPublic))
    }

    public func deletePlaylist(_ id: String) async throws {
        try await data("DELETE", "/playlists/\(id)", body: nil as [String: String]?)
    }

    private struct Added: Decodable { let added: Int }

    /// The number of tracks added.
    @discardableResult
    public func addToPlaylist(_ id: String, trackIds: [String]) async throws -> Int {
        let added: Added = try await send("POST", "/playlists/\(id)/tracks", body: ["trackIds": trackIds])
        return added.added
    }

    public func removeFromPlaylist(_ id: String, entryId: String) async throws {
        try await data("DELETE", "/playlists/\(id)/tracks/\(entryId)", body: nil as [String: String]?)
    }

    private struct Move: Encodable {
        let beforeEntryId: String?
        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            // beforeEntryId is required, null meaning "to the end".
            try c.encode(["beforeEntryId": beforeEntryId])
        }
    }

    /// Moves an entry before `beforeEntryId`, or to the end when nil.
    public func movePlaylistEntry(_ id: String, entryId: String, before beforeEntryId: String?) async throws {
        try await data("PATCH", "/playlists/\(id)/tracks/\(entryId)", body: Move(beforeEntryId: beforeEntryId))
    }

    // MARK: - Podcasts

    public func searchPodcasts(_ query: String) async throws -> [PodcastSearchResult] {
        try await get("/podcasts/search", query: ["q": query])
    }

    private struct PodcastId: Decodable { let id: String }

    /// The podcast of a feed, read by the server the first time.
    public func openPodcast(feedUrl: String) async throws -> String {
        let opened: PodcastId = try await send("POST", "/podcasts", body: ["feedUrl": feedUrl])
        return opened.id
    }

    public func podcast(_ id: String) async throws -> PodcastDetail {
        try await get("/podcasts/\(id)")
    }

    public func subscriptions() async throws -> [PodcastSummary] {
        try await get("/me/podcasts")
    }

    public func setSubscribed(podcast id: String, _ subscribed: Bool) async throws {
        try await data(subscribed ? "PUT" : "DELETE", "/me/podcasts/\(id)", body: nil as [String: String]?)
    }

    /// Unfinished episodes of the subscribed podcasts, newest first.
    public func newEpisodes() async throws -> [Episode] {
        try await get("/me/podcasts/episodes")
    }

    public func saveProgress(episodeId: String, _ progress: EpisodeProgress) async throws {
        try await data("PUT", "/me/episodes/\(episodeId)/progress", body: progress)
    }

    /// An episode as a track for the player, resuming where it was left.
    public func track(episode: Episode, progress: EpisodeProgress? = nil) -> Track {
        let progress = progress ?? episode.progress
        return Track(
            id: episode.id, title: episode.title, artistName: episode.podcast.title, artistId: "",
            durationSec: episode.durationSec, addedAt: episode.publishedAt,
            episode: TrackEpisode(
                podcastId: episode.podcast.id,
                audioUrl: episode.audioUrl ?? url("/episodes/\(episode.id)/audio"),
                startAt: progress.flatMap { $0.completed ? nil : $0.positionSec } ?? 0
            )
        )
    }

    // MARK: - Created podcasts (YouTube videos)

    private struct Enabled: Decodable { let enabled: Bool }

    /// Off when the server has no PODCAST_DIR.
    public func podcastCreationEnabled() async throws -> Bool {
        let answer: Enabled = try await get("/podcasts/creation")
        return answer.enabled
    }

    /// "Mon podcast n°N", owned and subscribed by this account.
    public func createPodcast() async throws -> String {
        let created: PodcastId = try await send("POST", "/podcasts/created", body: nil as [String: String]?)
        return created.id
    }

    public func updatePodcast(_ id: String, title: String, description: String) async throws {
        try await data("PATCH", "/podcasts/\(id)", body: ["title": title, "description": description])
    }

    public func deletePodcast(_ id: String) async throws {
        try await data("DELETE", "/podcasts/\(id)", body: nil as [String: String]?)
    }

    private struct VideosAdded: Decodable { let added: Int, skipped: Int }

    /// A video or a whole playlist; `skipped` counts its videos already in the podcast.
    public func addVideo(to podcastId: String, url: String) async throws -> (added: Int, skipped: Int) {
        let result: VideosAdded = try await send("POST", "/podcasts/\(podcastId)/episodes", body: ["url": url])
        return (result.added, result.skipped)
    }

    public func retryEpisode(_ episodeId: String, of podcastId: String) async throws {
        try await data("POST", "/podcasts/\(podcastId)/episodes/\(episodeId)/retry", body: nil as [String: String]?)
    }

    public func deleteEpisode(_ episodeId: String, of podcastId: String) async throws {
        try await data("DELETE", "/podcasts/\(podcastId)/episodes/\(episodeId)", body: nil as [String: String]?)
    }

    // MARK: - Jam

    /// The Jam this account is in, if any.
    public func currentJam() async throws -> JamState? {
        try await get("/jam/current")
    }

    public func startJam(_ start: JamStart) async throws -> JamState {
        try await send("POST", "/jam", body: start)
    }

    public func jamInvite(_ id: String) async throws -> JamInvite {
        try await get("/jam/\(id)")
    }

    public func joinJam(_ id: String) async throws -> JamState {
        try await send("POST", "/jam/\(id)/join", body: nil as [String: String]?)
    }

    public func leaveJam(_ id: String) async throws {
        try await data("POST", "/jam/\(id)/leave", body: nil as [String: String]?)
    }

    public func removeFromJam(_ id: String, userId: String) async throws {
        try await data("DELETE", "/jam/\(id)/participants/\(userId)", body: nil as [String: String]?)
    }

    public func jamCommand(_ id: String, _ command: JamCommand) async throws {
        try await data("POST", "/jam/\(id)/commands", body: command)
    }

    /// The Server-Sent Events stream of a Jam ("state" and "end" events).
    public func jamEventsURL(_ id: String) -> URL {
        url("/jam/\(id)/events")
    }

    /// The web app's invitation link: the API's address without its /api suffix.
    public func jamInviteURL(_ id: String) -> URL {
        let web = base.lastPathComponent == "api" ? base.deletingLastPathComponent() : base
        return web.appendingPathComponent("jam").appendingPathComponent(id)
    }

    // MARK: - Media URLs

    public func streamURL(for track: Track) -> URL {
        if let episode = track.episode { return episode.audioUrl }
        let needsCompat = track.format.map { !Self.playableFormats.contains($0) } ?? false
        return url("/tracks/\(track.id)/stream", query: needsCompat ? ["compat": "1"] : [:])
    }

    /// Same rules as the web app: the Deezer image first, else the art in the files.
    public func coverURL(track: Track) -> URL? {
        if track.episode != nil { return url("/episodes/\(track.id)/image") }
        return track.album?.coverUrl ?? fileCover(track.id)
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

    public func coverURL(mosaic cover: MosaicCover) -> URL {
        cover.coverUrl ?? fileCover(cover.trackId)
    }

    /// Podcast artwork goes through the API: publishers' servers are slow or refuse hotlinks.
    public func imageURL(podcast id: String, hasImage: Bool) -> URL? {
        hasImage ? url("/podcasts/\(id)/image") : nil
    }

    /// The episode's own artwork, or its podcast's.
    public func imageURL(episode: Episode) -> URL {
        url("/episodes/\(episode.id)/image")
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
