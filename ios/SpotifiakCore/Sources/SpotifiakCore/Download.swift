import Foundation

public enum DownloadStatus: String, Codable, Sendable {
    case queued, downloading, done, partial, failed
}

/// The user's latest download of a search result.
public struct DownloadState: Codable, Sendable, Hashable {
    public let id: String
    public let status: DownloadStatus
    public let progress: Int

    public init(id: String, status: DownloadStatus, progress: Int) {
        self.id = id
        self.status = status
        self.progress = progress
    }

    public var isActive: Bool { status == .queued || status == .downloading }
}

/// A download sent to deemix, followed by the server until it is in the library.
public struct Download: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    /// "track" or "album"
    public let type: String
    public let title: String
    public let artist: String
    public let coverUrl: URL?
    public let status: DownloadStatus
    public let progress: Int
    /// Tracks
    public let size: Int
    public let downloaded: Int
    public let failed: Int
    public let error: String?
    /// Finished and found in the library (or given up looking).
    public let ready: Bool
    public let trackId: String?
    public let albumId: String?
    public let createdAt: Date

    /// Nothing more will happen to it: failed, or finished and found in the library.
    public var isSettled: Bool { status == .failed || ready }

    /// Where it stands, in a few words.
    public var statusText: String {
        switch status {
        case .queued: "En attente"
        case .downloading: size > 1 ? "\(progress) % • \(downloaded)/\(size) titres" : "\(progress) %"
        case .done: ready ? "Terminé" : "Ajout à la bibliothèque…"
        case .partial: "\(downloaded) titre\(downloaded > 1 ? "s" : "") sur \(size)\(ready ? "" : " • ajout à la bibliothèque…")"
        case .failed: error ?? "Échec"
        }
    }
}

public struct DeezerAlbum: Codable, Sendable, Hashable, Identifiable {
    public struct Artist: Codable, Sendable, Hashable { public let name: String }

    public let id: Int
    public let title: String
    public let link: String
    public let cover_medium: URL?
    public let nb_tracks: Int
    public let artist: Artist
    public let libraryAlbumId: String?
    public let download: DownloadState?
}

public struct DeezerArtist: Codable, Sendable, Hashable, Identifiable {
    public let id: Int
    public let name: String
    public let link: String
    public let picture_medium: URL?
    public let nb_album: Int
    public let libraryArtistId: String?
}
