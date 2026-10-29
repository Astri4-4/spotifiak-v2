import SpotifiakCore
import SwiftUI

/// The current track above the tab bar; tapping it opens the player.
struct MiniPlayer: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session
    @State private var showsPlayer = false

    var body: some View {
        if let track = player.queue.current {
            HStack(spacing: 12) {
                RemoteImage(url: session.api?.coverURL(track: track))
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(track.artistName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Button { player.togglePlay() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
                Button { player.next() } label: {
                    Image(systemName: "forward.fill").font(.title3)
                }
                .accessibilityLabel("Titre suivant")
            }
            .buttonStyle(.plain)
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
            .onTapGesture { showsPlayer = true }
            .sheet(isPresented: $showsPlayer) { PlayerSheet() }
        }
    }
}
