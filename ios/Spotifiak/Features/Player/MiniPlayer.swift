import SpotifiakCore
import SwiftUI

/// The current track above the tab bar, with a thin progress line; tapping it opens the player.
struct MiniPlayer: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @State private var showsPlayer = false
    @State private var color = Theme.elevated

    var body: some View {
        if let track = player.current {
            HStack(spacing: 10) {
                RemoteImage(url: session.api?.coverURL(track: track))
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                VStack(alignment: .leading, spacing: 1) {
                    Text(track.title).font(.footnote.bold()).lineLimit(1)
                    if let jam = player.jam {
                        Label("Jam de \(jam.host.displayName)", systemImage: "person.2.wave.2.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.green)
                            .lineLimit(1)
                    } else {
                        Text(track.artistName).font(.footnote).foregroundStyle(Theme.subdued).lineLimit(1)
                    }
                }
                Spacer()
                if track.episode == nil {
                    let liked = library.likedIds.contains(track.id)
                    Button { library.toggleLike(track) } label: {
                        Image(systemName: liked ? "heart.fill" : "heart")
                            .font(.title3)
                            .foregroundStyle(liked ? Theme.green : .white)
                            .frame(width: 40, height: 44)
                    }
                    .accessibilityLabel(liked ? "Retirer des titres likés" : "Ajouter aux titres likés")
                }
                Button { player.togglePlay() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
            }
            .buttonStyle(.plain)
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .padding(.vertical, 6)
            .background(color)
            .overlay(alignment: .bottom) {
                GeometryReader { geo in
                    Capsule().fill(.white)
                        .frame(width: geo.size.width * progress)
                }
                .frame(height: 2)
                .background(Color.white.opacity(0.3))
                .padding(.horizontal, 8)
                .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 8)
            .padding(.bottom, 4)
            .contentShape(Rectangle())
            .onTapGesture { showsPlayer = true }
            .fullScreenCover(isPresented: $showsPlayer) { PlayerSheet() }
            .coverColor(session.api?.coverURL(track: track), into: $color, fallback: Theme.elevated)
        }
    }

    private var progress: Double {
        guard let duration = player.duration, duration > 0 else { return 0 }
        return min(player.position / duration, 1)
    }
}
