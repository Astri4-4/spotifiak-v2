import SpotifiakCore
import SwiftUI
import UIKit

/// What plays on the iPhone: cover, title, progress and the controls.
struct NowPlayingPage: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        if let now = store.nowPlaying {
            VStack(spacing: 6) {
                VStack(spacing: 2) {
                    if let host = now.jamHost {
                        Label("Jam de \(host) • \(now.jamPeople)", systemImage: "person.2.wave.2.fill")
                            .font(.caption2)
                            .foregroundStyle(WatchTheme.green)
                            .lineLimit(1)
                    }
                    Text(now.title).font(.headline).lineLimit(1)
                    Text(now.artist).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    ProgressView(value: now.position(at: context.date), total: max(now.duration ?? 1, 1))
                        .tint(.white)
                }
                HStack {
                    control("backward.end.fill", "Titre précédent") { store.send(.previous) }
                    Button { store.send(.togglePlay) } label: {
                        Image(systemName: now.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .foregroundStyle(.black)
                            .frame(width: 48, height: 48)
                            .background(.white, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(now.isPlaying ? "Pause" : "Lecture")
                    control("forward.end.fill", "Titre suivant") { store.send(.next) }
                }
                HStack {
                    if let liked = now.liked {
                        control(liked ? "heart.fill" : "heart", liked ? "Retirer des titres likés" : "Ajouter aux titres likés",
                                color: liked ? WatchTheme.green : .white) { store.send(.toggleLike) }
                    }
                    control("shuffle", now.shuffle ? "Désactiver la lecture aléatoire" : "Lecture aléatoire",
                            color: now.shuffle ? WatchTheme.green : .white) { store.send(.toggleShuffle) }
                    control(now.repeatMode == "one" ? "repeat.1" : "repeat", "Répétition",
                            color: now.repeatMode == "off" ? .white : WatchTheme.green) { store.send(.cycleRepeat) }
                }
                .font(.footnote)
                if let error = store.error {
                    Text(error).font(.caption2).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
            .containerBackground(for: .tabView) { CoverBackground(data: now.cover) }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "music.note").font(.largeTitle).foregroundStyle(WatchTheme.green)
                Text("Rien en lecture").font(.headline)
                Text("Lancez de la musique sur l'iPhone, ou faites défiler vers la bibliothèque.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func control(_ symbol: String, _ label: String, color: Color = .white, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).foregroundStyle(color).frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The cover, blurred and darkened behind the controls.
private struct CoverBackground: View {
    let data: Data?

    var body: some View {
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill().blur(radius: 20).overlay(.black.opacity(0.45))
        } else {
            Color.black
        }
    }
}
