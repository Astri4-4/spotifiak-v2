import Foundation
import SpotifiakCore
import UIKit
import WatchConnectivity

/// The Apple Watch's link to the app: pushes what's playing (application context, the
/// latest one wins), runs the watch's commands and answers its requests with the API
/// session of this iPhone. The watch app has no login of its own.
@MainActor
final class WatchBridge: NSObject {
    private let player: PlayerEngine
    private let library: LibraryStore
    private let api: () -> APIClient?
    private let session: WCSession?
    /// The last state pushed, without its time and position: only real changes are sent
    /// (the watch moves the position on by itself).
    private var lastPushed: WatchNowPlaying?
    /// Small covers already made, by track.
    private var covers: [String: Data] = [:]

    init(player: PlayerEngine, library: LibraryStore, api: @escaping () -> APIClient?) {
        self.player = player
        self.library = library
        self.api = api
        session = WCSession.isSupported() ? WCSession.default : nil
        super.init()
        session?.delegate = self
        session?.activate()
        follow()
    }

    // MARK: - Now playing

    /// Pushes the state whenever what the watch shows changes (not on every position tick).
    private func follow() {
        withObservationTracking {
            _ = (player.current, player.isPlaying, player.queue.shuffle, player.queue.repeatMode, player.jam, library.likedIds)
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.push()
                self?.follow()
            }
        }
    }

    private func push() {
        guard let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        guard let track = player.current else { return }
        Task {
            let cover = await cover(for: track)
            let state = WatchNowPlaying(
                trackId: track.id, title: track.title, artist: track.artistName, cover: cover,
                isPlaying: player.isPlaying, liked: track.episode == nil ? library.likedIds.contains(track.id) : nil,
                shuffle: player.queue.shuffle, repeatMode: player.queue.repeatMode.rawValue,
                position: player.position, duration: player.duration, sentAt: .now,
                jamHost: player.jam?.host.displayName, jamPeople: player.jam?.participants.count ?? 0)
            var key = state
            key.sentAt = .distantPast
            key.position = 0
            guard key != lastPushed else { return }
            lastPushed = key
            try? session.updateApplicationContext(WatchMessage.pack(state))
        }
    }

    /// A ~120 px JPEG of the track's cover, small enough for watch messages.
    private func cover(for track: Track) async -> Data? {
        if let cached = covers[track.id] { return cached }
        guard let url = api()?.coverURL(track: track), let image = await ImageCache.shared.image(for: url) else { return nil }
        let data = thumbnail(image, side: 120)
        covers[track.id] = data
        return data
    }

    private func thumbnail(_ image: UIImage, side: CGFloat) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }.jpegData(compressionQuality: 0.7)
    }

    // MARK: - Requests

    fileprivate func handle(_ request: WatchRequest) async -> WatchReply {
        guard let api = api() else { return .failed("Ouvrez Spotifiak sur l'iPhone pour vous connecter") }
        do {
            switch request {
            case .command(let command):
                try await run(command, api)
                return .done
            case .library:
                return .library(try await libraryItems(api))
            case .friends:
                return .friends(try await friends(api))
            }
        } catch {
            return .failed((error as? APIError)?.message ?? "Serveur injoignable")
        }
    }

    private func run(_ command: WatchCommand, _ api: APIClient) async throws {
        switch command {
        case .togglePlay: player.togglePlay()
        case .next: player.next()
        case .previous: player.previous()
        case .toggleLike: if let track = player.current, track.episode == nil { library.toggleLike(track) }
        case .toggleShuffle: player.setShuffle(!player.queue.shuffle)
        case .cycleRepeat: player.cycleRepeat()
        case .play(let item):
            let tracks: [Track] = switch item.kind {
            case .liked: try await api.likedTracks()
            case .playlist: try await api.playlist(item.itemId).entries.map(\.track)
            case .album: try await api.album(item.itemId).tracks
            case .track: [try await api.track(item.itemId)]
            }
            guard !tracks.isEmpty else { throw APIError(message: "Rien à écouter ici", status: 0) }
            player.play(tracks, startAt: 0)
        }
    }

    /// Liked tracks, playlists and saved albums, with small covers for the first ones.
    private func libraryItems(_ api: APIClient) async throws -> [WatchItem] {
        async let likedCount = api.likedTrackIds()
        async let playlists = api.playlists()
        async let albums = api.savedAlbums()
        let liked = try await likedCount.count
        var items = [WatchItem(kind: .liked, itemId: "", title: "Titres likés", subtitle: "\(liked) titre\(liked > 1 ? "s" : "")")]
        for playlist in try await playlists {
            let url = playlist.covers.first.map { api.coverURL(mosaic: $0) }
            items.append(WatchItem(kind: .playlist, itemId: playlist.id, title: playlist.name,
                                   subtitle: "Playlist", thumbnail: await small(url)))
        }
        for album in try await albums {
            items.append(WatchItem(kind: .album, itemId: album.id, title: album.title,
                                   subtitle: album.artist.name, thumbnail: await small(api.coverURL(album: album))))
        }
        return items
    }

    private func friends(_ api: APIClient) async throws -> WatchFriends {
        async let activity = api.friendActivity()
        async let notifications = api.notifications()
        async let counts = api.notificationCounts()
        let friends = try await activity.map { item in
            WatchFriendActivity(id: item.user.id, name: item.user.displayName,
                                track: WatchItem(kind: .track, itemId: item.track.id, title: item.track.title, subtitle: item.track.artistName),
                                listening: item.listening, playedAt: item.playedAt)
        }
        let shared = try await notifications.compactMap { n -> WatchItem? in
            guard let track = n.track else { return nil }
            return WatchItem(kind: .track, itemId: track.id, title: track.title, subtitle: "De \(n.from.displayName)")
        }
        return WatchFriends(activity: friends, shared: shared, unread: (try? await counts.unread) ?? 0)
    }

    /// A 60 px thumbnail for lists (watch messages stay small).
    private func small(_ url: URL?) async -> Data? {
        guard let url, let image = await ImageCache.shared.image(for: url) else { return nil }
        return thumbnail(image, side: 60)
    }
}

extension WatchBridge: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.push() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        // Switched to another watch: talk to the new one.
        session.activate()
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.lastPushed = nil
            self.push()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        guard let request = try? WatchMessage.unpack(WatchRequest.self, from: message) else {
            replyHandler((try? WatchMessage.pack(WatchReply.failed("Message inconnu"))) ?? [:])
            return
        }
        // The reply handler isn't Sendable; the reply is built on the main actor and sent from there.
        nonisolated(unsafe) let reply = replyHandler
        Task { @MainActor in
            let answer = await self.handle(request)
            reply((try? WatchMessage.pack(answer)) ?? [:])
        }
    }
}
