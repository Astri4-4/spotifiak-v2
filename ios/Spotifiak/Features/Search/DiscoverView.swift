import AVFoundation
import SpotifiakCore
import SwiftUI

/// Music outside the library: new artists close to what the user plays, albums to finish, and the
/// artists friends love. Each track has Deezer's 30 s preview, to listen before downloading.
struct DiscoverView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @State private var suggestions: Suggestions?
    @State private var failed = false
    /// Started from here: hidden from the suggestions (the Downloads page follows them).
    @State private var started: Set<String> = []
    @State private var preview: AVPlayer?
    @State private var previewing: Int?

    var body: some View {
        Group {
            if let suggestions {
                let forYou = suggestions.forYou.filter { !started.contains($0.track.link) && $0.track.download == nil }
                let albums = suggestions.albums.filter { !started.contains($0.link) }
                let friends = suggestions.tracks.filter { !started.contains($0.track.link) && $0.track.download == nil }
                if forYou.isEmpty && albums.isEmpty && friends.isEmpty {
                    ContentUnavailableView(
                        "Rien de nouveau pour l'instant",
                        systemImage: "sparkles",
                        description: Text("Écoute quelques titres : les suggestions viennent de ce que tu écoutes dans Spotifiak.")
                    )
                } else {
                    List {
                        if !forYou.isEmpty {
                            Section {
                                ForEach(forYou) { trackRow($0.track, "parce que tu écoutes \($0.because)") }
                            } header: {
                                header("Nouveaux artistes pour toi", links: forYou.map(\.track.link))
                            }
                        }
                        if !albums.isEmpty {
                            Section("Albums à compléter") {
                                ForEach(albums) { item in
                                    row(cover: RemoteImage(url: session.api?.coverURL(album: item.album)),
                                        title: item.album.title,
                                        subtitle: "\(item.album.artist.name) • \(item.have) titres sur \(item.total)",
                                        action: "Compléter", links: [item.link])
                                }
                            }
                        }
                        if !friends.isEmpty {
                            Section {
                                ForEach(friends) { item in
                                    trackRow(item.track, item.fans.isEmpty ? "dans les goûts de tes amis" : "aimé par \(item.fans.joined(separator: " et "))")
                                }
                            } header: {
                                header("Les artistes de tes amis", links: friends.map(\.track.link))
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            } else if failed {
                ContentUnavailableView {
                    Label("Serveur injoignable", systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { Task { await load() } }
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Recherche de nouveautés pour toi…\nÇa peut prendre une minute la première fois de la journée.")
                        .font(.footnote)
                        .foregroundStyle(Theme.subdued)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .navigationTitle("Découvrir")
        .task { await load() }
        .onDisappear { stopPreview() }
    }

    private func load() async {
        failed = false
        do {
            suggestions = try await session.requireAPI().suggestions()
        } catch {
            failed = true
        }
    }

    private func header(_ title: String, links: [String]) -> some View {
        HStack {
            Text(title)
            Spacer()
            Button("Tout télécharger") { download(links) }.font(.caption.bold())
        }
    }

    private func trackRow(_ track: DeezerTrack, _ detail: String) -> some View {
        let playing = previewing == track.id
        return row(
            cover: Button { togglePreview(track) } label: {
                RemoteImage(url: track.album.cover_medium)
                    .overlay {
                        if track.previewURL != nil {
                            Image(systemName: playing ? "pause.fill" : "play.fill")
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(.black.opacity(0.4))
                        }
                    }
            }
            .buttonStyle(.plain)
            .disabled(track.previewURL == nil)
            .accessibilityLabel(playing ? "Arrêter l'extrait de \(track.title)" : "Écouter un extrait de \(track.title)"),
            title: track.title,
            subtitle: "\(track.artist.name) • \(detail)",
            action: "Télécharger",
            links: [track.link]
        )
    }

    private func row(cover: some View, title: String, subtitle: String, action: String, links: [String]) -> some View {
        HStack(spacing: 12) {
            cover
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(2)
            }
            Spacer(minLength: 0)
            Button(action) { download(links) }
                .font(.caption.bold())
                .buttonStyle(.bordered)
                .accessibilityLabel("\(action) \(title)")
        }
    }

    /// One preview at a time; the main player pauses while it plays.
    private func togglePreview(_ track: DeezerTrack) {
        let same = previewing == track.id
        stopPreview()
        guard !same, let url = track.previewURL else { return }
        if player.isPlaying { player.pause() }
        let item = AVPlayerItem(url: url)
        let preview = AVPlayer(playerItem: item)
        preview.play()
        self.preview = preview
        previewing = track.id
    }

    private func stopPreview() {
        preview?.pause()
        preview = nil
        previewing = nil
    }

    private func download(_ links: [String]) {
        started.formUnion(links)
        Task {
            for link in links { _ = try? await session.api?.download(link) }
        }
    }
}
