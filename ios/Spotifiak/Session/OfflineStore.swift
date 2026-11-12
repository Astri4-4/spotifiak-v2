import Foundation
import Observation
import SpotifiakCore

/// The albums, playlists and liked tracks kept on the device, and their downloaded files.
/// Each sync follows the collections' changes on the server: new tracks are downloaded,
/// removed ones deleted. Without the server, everything stays as it is.
@MainActor @Observable
final class OfflineStore {
    private(set) var collections: Set<Offline.Collection> = []
    /// The downloaded tracks, in the collections' order.
    private(set) var tracks: [Track] = []
    /// Tracks left to download in the running sync.
    private(set) var remaining = 0

    private let api: () -> APIClient?
    private let folder: URL
    private var syncing: Task<Void, Never>?
    private var resync = false

    private struct Index: Codable {
        var collections: Set<Offline.Collection>
        var tracks: [Track]
    }

    init(api: @escaping () -> APIClient?) {
        self.api = api
        var folder = URL.applicationSupportDirectory.appending(path: "Offline", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Music the server can give again: not worth the user's iCloud backup.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        self.folder = folder
        if let data = try? Data(contentsOf: indexURL), let index = try? JSONDecoder.spotifiak.decode(Index.self, from: data) {
            collections = index.collections
            tracks = index.tracks
        }
    }

    private var indexURL: URL { folder.appending(path: "index.json") }

    func contains(_ collection: Offline.Collection) -> Bool { collections.contains(collection) }

    func toggle(_ collection: Offline.Collection) {
        if collections.remove(collection) == nil { collections.insert(collection) }
        save()
        sync()
    }

    /// The downloaded file to play instead of streaming.
    func localURL(for track: Track) -> URL? {
        guard let name = Offline.fileName(for: track) else { return nil }
        let url = folder.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Starts a sync, or runs another one after the current one (a collection changed meanwhile).
    func sync() {
        guard syncing == nil else { resync = true; return }
        syncing = Task {
            repeat {
                resync = false
                await run()
            } while resync
            syncing = nil
        }
    }

    /// Forgets everything (logout).
    func reset() {
        syncing?.cancel()
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        collections = []
        tracks = []
        remaining = 0
    }

    private func run() async {
        guard let api = api() else { return }
        var wanted: [Track] = []
        for collection in collections {
            // The server is unreachable: keep every file rather than delete what can't be checked.
            guard let list = try? await self.tracks(of: collection, api) else { return }
            wanted += list
        }
        var seen = Set<String>()
        wanted = wanted.filter { seen.insert($0.id).inserted }

        let have = Set(tracks.compactMap { localURL(for: $0) != nil ? $0.id : nil })
        let plan = Offline.plan(wanted: wanted, have: have)
        for track in tracks where plan.delete.contains(track.id) {
            if let name = Offline.fileName(for: track) { try? FileManager.default.removeItem(at: folder.appending(path: name)) }
        }
        tracks = wanted.filter { have.contains($0.id) && !plan.delete.contains($0.id) }
        save()

        remaining = plan.download.count
        for track in plan.download {
            if Task.isCancelled { break }
            if await download(track, api) {
                // Keep the collections' order as tracks arrive.
                let done = Set(tracks.map(\.id)).union([track.id])
                tracks = wanted.filter { done.contains($0.id) }
                save()
            }
            remaining -= 1
        }
        remaining = 0
    }

    private func tracks(of collection: Offline.Collection, _ api: APIClient) async throws -> [Track] {
        switch collection {
        case .liked: try await api.likedTracks()
        case .album(let id): try await api.album(id).tracks
        case .playlist(let id): try await api.playlist(id).entries.map(\.track)
        }
    }

    /// shortcut: downloads only while the app runs; a background URLSession would go on when it's closed.
    private func download(_ track: Track, _ api: APIClient) async -> Bool {
        guard let name = Offline.fileName(for: track) else { return false }
        do {
            let (temporary, response) = try await URLSession.shared.download(from: api.streamURL(for: track))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                try? FileManager.default.removeItem(at: temporary)
                return false
            }
            let destination = folder.appending(path: name)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: temporary, to: destination)
            return true
        } catch {
            // Tried again at the next sync.
            return false
        }
    }

    private func save() {
        guard let data = try? JSONEncoder.spotifiak.encode(Index(collections: collections, tracks: tracks)) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }
}
