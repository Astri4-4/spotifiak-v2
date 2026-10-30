import SpotifiakCore
import SwiftUI

/// The full-screen player: large cover, like, scrubber, transport, shuffle and repeat (±15 s
/// for episodes; neither in a Jam, whose queue is the server's), and the Jam.
struct PlayerSheet: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    /// The scrubber's value while the user drags it.
    @State private var scrubbing: Double?
    @State private var color = Theme.headerGray
    @State private var showsJam = false
    @State private var showsQueue = false

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.down").font(.title3.weight(.semibold)).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Fermer le lecteur")
                Spacer()
                VStack(spacing: 2) {
                    Text(player.jam.map { "Jam de \($0.host.displayName)" } ?? "En cours de lecture").font(.footnote.bold())
                    if let jam = player.jam {
                        Text("\(jam.participants.count) participant\(jam.participants.count > 1 ? "s" : "")")
                            .font(.caption2)
                            .foregroundStyle(Theme.subdued)
                    }
                }
                Spacer()
                Button { showsJam = true } label: {
                    Image(systemName: "person.2.wave.2.fill")
                        .font(.title3)
                        .foregroundStyle(player.jam == nil ? .white : Theme.green)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Jam")
            }

            if let track = player.current {
                Spacer(minLength: 0)
                RemoteImage(url: session.api?.coverURL(track: track))
                    .aspectRatio(1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
                Spacer(minLength: 0)

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(track.title).font(.title2.bold()).lineLimit(1)
                        Text(track.artistName).font(.body).foregroundStyle(Theme.subdued).lineLimit(1)
                    }
                    Spacer()
                    if track.episode == nil {
                        let liked = library.likedIds.contains(track.id)
                        Button { library.toggleLike(track) } label: {
                            Image(systemName: liked ? "heart.fill" : "heart")
                                .font(.title2)
                                .foregroundStyle(liked ? Theme.green : .white)
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(liked ? "Retirer des titres likés" : "Ajouter aux titres likés")
                    }
                }

                scrubber

                HStack {
                    if track.episode != nil {
                        Button { player.skip(by: -15) } label: { Image(systemName: "gobackward.15").font(.title2) }
                            .accessibilityLabel("Reculer de 15 secondes")
                    } else if player.jam == nil {
                        Button { player.setShuffle(!player.queue.shuffle) } label: {
                            Image(systemName: "shuffle").font(.title2)
                                .foregroundStyle(player.queue.shuffle ? Theme.green : .white)
                        }
                        .accessibilityLabel(player.queue.shuffle ? "Désactiver la lecture aléatoire" : "Lecture aléatoire")
                    } else {
                        Color.clear.frame(width: 28)
                    }
                    Spacer()
                    Button { player.previous() } label: { Image(systemName: "backward.end.fill").font(.largeTitle) }
                        .accessibilityLabel("Titre précédent")
                    Spacer()
                    Button { player.togglePlay() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.largeTitle)
                            .foregroundStyle(.black)
                            .frame(width: 72, height: 72)
                            .background(.white, in: Circle())
                    }
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Lecture")
                    Spacer()
                    Button { player.next() } label: { Image(systemName: "forward.end.fill").font(.largeTitle) }
                        .accessibilityLabel("Titre suivant")
                    Spacer()
                    if track.episode != nil {
                        Button { player.skip(by: 15) } label: { Image(systemName: "goforward.15").font(.title2) }
                            .accessibilityLabel("Avancer de 15 secondes")
                    } else if player.jam == nil {
                        Button { player.cycleRepeat() } label: {
                            Image(systemName: player.queue.repeatMode == .one ? "repeat.1" : "repeat").font(.title2)
                                .foregroundStyle(player.queue.repeatMode == .off ? .white : Theme.green)
                        }
                        .accessibilityLabel(repeatLabel)
                    } else {
                        Color.clear.frame(width: 28)
                    }
                }

                HStack {
                    if track.episode != nil {
                        Button { player.cycleEpisodeRate() } label: {
                            Text("\(player.episodeRate.formatted())×")
                                .font(.subheadline.bold().monospacedDigit())
                                .foregroundStyle(player.episodeRate == 1 ? .white : Theme.green)
                                .frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("Vitesse de lecture \(player.episodeRate.formatted())×")
                    }
                    Spacer()
                    Button { showsQueue = true } label: {
                        Image(systemName: "list.bullet").font(.title3).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("File d'attente")
                }
                .padding(.bottom, 16)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 24)
        .background {
            LinearGradient(colors: [color, Color(white: 0.07)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
        .sheet(isPresented: $showsJam) { JamSheet() }
        .sheet(isPresented: $showsQueue) { QueueSheet() }
        .coverColor(player.current.flatMap { session.api?.coverURL(track: $0) }, into: $color)
        // The current track can end while the player is open: close it once the queue is empty.
        .onChange(of: player.current == nil) { _, empty in if empty { dismiss() } }
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
            .tint(.white)
            HStack {
                Text(formatDuration(scrubbing ?? player.position))
                Spacer()
                Text(formatDuration(player.duration))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(Theme.subdued)
        }
    }

    private var repeatLabel: String {
        switch player.queue.repeatMode {
        case .off: "Répéter"
        case .all: "Répéter le titre"
        case .one: "Ne plus répéter"
        }
    }
}
