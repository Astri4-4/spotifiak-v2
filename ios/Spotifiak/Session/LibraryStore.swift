import Foundation
import Observation
import SpotifiakCore

/// What the user keeps: liked tracks, saved albums, followed artists, subscribed podcasts
/// and their playlists. Toggles update at once and roll back when the server refuses.
@MainActor @Observable
final class LibraryStore {
    private(set) var likedIds: Set<String> = []
    private(set) var savedAlbumIds: Set<String> = []
    private(set) var followedArtistIds: Set<String> = []
    private(set) var subscribedPodcastIds: Set<String> = []
    private(set) var playlists: [PlaylistSummary] = []
    /// The server can make podcasts of YouTube videos (it has a PODCAST_DIR).
    private(set) var canCreatePodcasts = false
    /// Bumped on every change, so pages listing the library reload.
    private(set) var version = 0

    private let api: () -> APIClient?
    private let toast: (String) -> Void

    init(api: @escaping () -> APIClient?, toast: @escaping (String) -> Void) {
        self.api = api
        self.toast = toast
    }

    func load() async {
        guard let api = api() else { return }
        async let liked = api.likedTrackIds()
        async let albums = api.savedAlbums()
        async let artists = api.followedArtists()
        async let podcasts = api.subscriptions()
        async let playlists = api.playlists()
        async let creation = api.podcastCreationEnabled()
        canCreatePodcasts = (try? await creation) ?? false
        if let liked = try? await liked { likedIds = Set(liked) }
        if let albums = try? await albums { savedAlbumIds = Set(albums.map(\.id)) }
        if let artists = try? await artists { followedArtistIds = Set(artists.map(\.id)) }
        if let podcasts = try? await podcasts { subscribedPodcastIds = Set(podcasts.map(\.id)) }
        if let playlists = try? await playlists { self.playlists = playlists }
    }

    func reset() {
        canCreatePodcasts = false
        likedIds = []
        savedAlbumIds = []
        followedArtistIds = []
        subscribedPodcastIds = []
        playlists = []
    }

    // MARK: - Toggles

    func toggleLike(_ track: Track) {
        let liked = !likedIds.contains(track.id)
        toggle(\.likedIds, track.id, on: liked, done: liked ? "Ajouté aux titres likés" : "Retiré des titres likés") {
            try await $0.setLiked(track.id, liked)
        }
    }

    func toggleSaved(album id: String) {
        let saved = !savedAlbumIds.contains(id)
        toggle(\.savedAlbumIds, id, on: saved, done: saved ? "Ajouté à la bibliothèque" : "Retiré de la bibliothèque") {
            try await $0.setSaved(album: id, saved)
        }
    }

    func toggleFollowed(artist id: String) {
        let followed = !followedArtistIds.contains(id)
        toggle(\.followedArtistIds, id, on: followed, done: nil) { try await $0.setFollowed(artist: id, followed) }
    }

    func toggleSubscribed(podcast id: String) {
        let subscribed = !subscribedPodcastIds.contains(id)
        toggle(\.subscribedPodcastIds, id, on: subscribed, done: subscribed ? "Abonné au podcast" : nil) {
            try await $0.setSubscribed(podcast: id, subscribed)
        }
    }

    private func toggle(_ set: ReferenceWritableKeyPath<LibraryStore, Set<String>>, _ id: String, on: Bool, done: String?,
                        request: @escaping (APIClient) async throws -> Void) {
        guard let api = api() else { return }
        update(set, id, on)
        Task {
            do {
                try await request(api)
                version += 1
                if let done { toast(done) }
            } catch {
                update(set, id, !on)
                report(error)
            }
        }
    }

    private func update(_ set: ReferenceWritableKeyPath<LibraryStore, Set<String>>, _ id: String, _ on: Bool) {
        if on { self[keyPath: set].insert(id) } else { self[keyPath: set].remove(id) }
    }

    // MARK: - Playlists

    /// Creates a playlist (the server names it when `name` is empty) and returns its id.
    @discardableResult
    func createPlaylist(name: String, with tracks: [Track] = []) async -> String? {
        guard let api = api() else { return nil }
        do {
            let name = name.trimmingCharacters(in: .whitespaces)
            let playlist = try await api.createPlaylist(name: name.isEmpty ? nil : name)
            if !tracks.isEmpty { try await api.addToPlaylist(playlist.id, trackIds: tracks.map(\.id)) }
            await playlistsChanged()
            toast(tracks.isEmpty ? "Playlist créée" : "Ajouté à \(playlist.name)")
            return playlist.id
        } catch {
            report(error)
            return nil
        }
    }

    func add(_ tracks: [Track], to playlist: PlaylistSummary) async {
        guard let api = api() else { return }
        do {
            let added = try await api.addToPlaylist(playlist.id, trackIds: tracks.map(\.id))
            await playlistsChanged()
            toast(added == 0 ? "Déjà dans \(playlist.name)" : "Ajouté à \(playlist.name)")
        } catch {
            report(error)
        }
    }

    /// Runs a playlist edit, then refreshes the list; false when it failed (already reported).
    @discardableResult
    func editPlaylist(_ edit: (APIClient) async throws -> Void) async -> Bool {
        guard let api = api() else { return false }
        do {
            try await edit(api)
            await playlistsChanged()
            return true
        } catch {
            report(error)
            return false
        }
    }

    /// A new podcast of YouTube videos; returns its id.
    func createPodcast() async -> String? {
        guard let api = api() else { return nil }
        do {
            let id = try await api.createPodcast()
            subscribedPodcastIds.insert(id)
            version += 1
            return id
        } catch {
            report(error)
            return nil
        }
    }

    /// After a playlist or liked tracks changed elsewhere (a Spotify import).
    func refresh() async {
        await load()
        version += 1
    }

    private func playlistsChanged() async {
        if let playlists = try? await api()?.playlists() { self.playlists = playlists }
        version += 1
    }

    private func report(_ error: Error) {
        toast((error as? APIError)?.message ?? "Serveur injoignable")
    }
}
