import SpotifiakCore
import SwiftUI

/// The full player: large cover, scrubber, transport, shuffle and repeat.
struct PlayerSheet: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session
    /// The scrubber's value while the user drags it.
    @State private var scrubbing: Double?

    var body: some View {
        VStack(spacing: 24) {
            if let track = player.queue.current {
                CoverImage(url: session.api?.coverURL(track: track))
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 12)

                VStack(alignment: .leading, spacing: 4) {
                    Text(track.title).font(.title2.bold()).lineLimit(2)
                    Text(track.artistName).font(.title3).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                scrubber

                HStack {
                    Button { player.setShuffle(!player.queue.shuffle) } label: {
                        Image(systemName: "shuffle").foregroundStyle(player.queue.shuffle ? Color.accentColor : .secondary)
                    }
                    .accessibilityLabel(player.queue.shuffle ? "Désactiver la lecture aléatoire" : "Lecture aléatoire")
                    Spacer()
                    Button { player.previous() } label: { Image(systemName: "backward.fill") }
                        .accessibilityLabel("Titre précédent")
                    Spacer()
                    Button { player.togglePlay() } label: {
                        Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 64))
                    }
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
                    Spacer()
                    Button { player.next() } label: { Image(systemName: "forward.fill") }
                        .accessibilityLabel("Titre suivant")
                    Spacer()
                    Button { player.cycleRepeat() } label: {
                        Image(systemName: player.queue.repeatMode == .one ? "repeat.1" : "repeat")
                            .foregroundStyle(player.queue.repeatMode == .off ? .secondary : Color.accentColor)
                    }
                    .accessibilityLabel(repeatLabel)
                }
                .font(.title)
                .buttonStyle(.plain)
            }
        }
        .padding(24)
        .presentationDragIndicator(.visible)
    }

    private var scrubber: some View {
        let duration = max(player.duration ?? 0, 1)
        return VStack(spacing: 4) {
            Slider(
                value: Binding(get: { min(scrubbing ?? player.position, duration) }, set: { scrubbing = $0 }),
                in: 0...duration,
                onEditingChanged: { editing in
                    if !editing, let scrubbing {
                        player.seek(to: scrubbing)
                        self.scrubbing = nil
                    }
                }
            )
            HStack {
                Text(Self.time(scrubbing ?? player.position))
                Spacer()
                Text(player.duration.map(Self.time) ?? "--:--")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }

    private var repeatLabel: String {
        switch player.queue.repeatMode {
        case .off: "Répéter"
        case .all: "Répéter le titre"
        case .one: "Ne plus répéter"
        }
    }

    static func time(_ seconds: Double) -> String {
        let total = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
