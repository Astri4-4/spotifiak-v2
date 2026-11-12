import Foundation

/// Tracks kept on the device to play without the server.
public enum Offline {
    /// What the user keeps offline: every track of it is downloaded, and follows its changes.
    public enum Collection: Codable, Hashable, Sendable {
        case liked
        case album(String)
        case playlist(String)
    }

    /// The local file's name: its extension tells AVPlayer the format, which the server converts
    /// to AAC (m4a) when iOS can't play the original. Nil without a known format (and episodes):
    /// those stay online.
    public static func fileName(for track: Track) -> String? {
        guard track.episode == nil, let format = track.format else { return nil }
        return "\(track.id).\(APIClient.playableFormats.contains(format) ? format : "m4a")"
    }

    /// What to download (wanted, not there yet) and what to delete (there, no longer wanted).
    public static func plan(wanted: [Track], have: Set<String>) -> (download: [Track], delete: Set<String>) {
        let keep = wanted.filter { fileName(for: $0) != nil }
        return (keep.filter { !have.contains($0.id) }, have.subtracting(keep.map(\.id)))
    }
}
