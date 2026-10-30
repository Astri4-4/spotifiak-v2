import SpotifiakCore
import SwiftUI

/// The current track above the tab bar, with a thin progress line; tapping it opens the player.
/// Liquid Glass tinted with the cover's color on iOS 26, a bar of that color before.
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
                    .clipShape(RoundedRectangle(cornerRadius: Self.glass ? 10 : 4))
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
            .padding(.leading, Self.glass ? 14 : 8)
            .padding(.trailing, Self.glass ? 12 : 4)
            .padding(.vertical, Self.glass ? 8 : 6)
            .overlay(alignment: .bottom) {
                GeometryReader { geo in
                    Capsule().fill(.white)
                        .frame(width: geo.size.width * progress)
                }
                .frame(height: 2)
                .background(Color.white.opacity(0.3), in: Capsule())
                // Inside the capsule's rounded ends on iOS 26.
                .padding(.horizontal, Self.glass ? 24 : 8)
                .padding(.bottom, Self.glass ? 3 : 0)
                .accessibilityHidden(true)
            }
            .miniPlayerBackground(color)
            // iOS 26: as wide as the floating tab bar below it.
            .padding(.horizontal, Self.glass ? 21 : 8)
            .padding(.bottom, 4)
            .contentShape(Rectangle())
            .onTapGesture { showsPlayer = true }
            .fullScreenCover(isPresented: $showsPlayer) { PlayerSheet() }
            .coverColor(session.api?.coverURL(track: track), into: $color, fallback: Theme.elevated)
        }
    }

    private static var glass: Bool {
        if #available(iOS 26, *) { return true }
        return false
    }

    private var progress: Double {
        guard let duration = player.duration, duration > 0 else { return 0 }
        return min(player.position / duration, 1)
    }
}

private extension View {
    /// iOS 26: Liquid Glass in a capsule, tinted with the cover's color and reacting to touches.
    /// Before: a rounded bar of that color.
    @ViewBuilder func miniPlayerBackground(_ color: Color) -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.tint(color.opacity(0.45)).interactive(), in: .capsule)
        } else {
            background(color).clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }
}
