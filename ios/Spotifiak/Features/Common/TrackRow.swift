import SpotifiakCore
import SwiftUI

/// A track in a list: its number (album) or cover, title, artist, duration. Tapping plays
/// `tracks` from it; the context menu adds it to the queue.
struct TrackRow: View {
    let tracks: [Track]
    let index: Int
    var showsNumber = false

    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session

    private var track: Track { tracks[index] }

    var body: some View {
        Button { player.play(tracks, startAt: index) } label: {
            HStack(spacing: 12) {
                if showsNumber {
                    Text(track.trackNumber.map { String($0) } ?? "–")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 24)
                } else {
                    RemoteImage(url: session.api?.coverURL(track: track))
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .foregroundStyle(player.queue.current?.id == track.id ? Color.accentColor : .primary)
                        .lineLimit(1)
                    Text(track.artistName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(formatDuration(track.durationSec))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Ajouter à la file d'attente", systemImage: "text.badge.plus") { player.add([track]) }
        }
    }
}
