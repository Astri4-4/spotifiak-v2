import SpotifiakCore
import SwiftUI

/// A track in a list: its cover (unless `showsCover` is off, on album pages), title in green
/// while playing, artist, and a "…" menu (like, add to a playlist or the queue, `onRemove`).
/// Tapping plays `tracks` from it.
struct TrackRow: View {
    let tracks: [Track]
    let index: Int
    var showsCover = true
    /// Popular tracks on artist pages are numbered.
    var number: Int?
    /// "Retirer de cette playlist", on the owner's playlists.
    var onRemove: (() -> Void)?

    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session

    private var track: Track { tracks[index] }

    var body: some View {
        HStack(spacing: 12) {
            Button { player.play(tracks, startAt: index) } label: {
                HStack(spacing: 12) {
                    if let number {
                        Text("\(number)")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Theme.subdued)
                            .frame(width: 20)
                    }
                    if showsCover {
                        RemoteImage(url: session.api?.coverURL(track: track))
                            .frame(width: 48, height: 48)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title)
                            .foregroundStyle(player.current?.id == track.id ? Theme.green : .white)
                            .lineLimit(1)
                        Text(track.artistName).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(formatDuration(track.durationSec))

            TrackMenu(tracks: [track], onRemove: onRemove) {
                Image(systemName: "ellipsis")
                    .foregroundStyle(Theme.subdued)
                    .frame(width: 32, height: 44)
            }
            .accessibilityLabel("Plus d'options pour \(track.title)")
        }
    }
}

/// Like (one track), add to a playlist (a new one asks its name), add to the queue, `onRemove`.
struct TrackMenu<Label: View>: View {
    let tracks: [Track]
    var onRemove: (() -> Void)?
    @ViewBuilder let label: Label

    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    @State private var naming = false
    @State private var newName = ""
    @State private var sharing = false

    var body: some View {
        Menu {
            if tracks.count == 1, let track = tracks.first, track.episode == nil {
                let liked = library.likedIds.contains(track.id)
                Button(liked ? "Retirer des titres likés" : "Ajouter aux titres likés", systemImage: liked ? "heart.slash" : "heart") {
                    library.toggleLike(track)
                }
            }
            if tracks.allSatisfy({ $0.episode == nil }) {
                Menu("Ajouter à une playlist", systemImage: "plus") {
                    Button("Nouvelle playlist", systemImage: "plus.square") {
                        newName = ""
                        naming = true
                    }
                    ForEach(library.playlists) { playlist in
                        Button(playlist.name) { Task { await library.add(tracks, to: playlist) } }
                    }
                }
            }
            Button("Ajouter à la file d'attente", systemImage: "text.badge.plus") { player.add(tracks) }
            if tracks.count == 1, tracks[0].episode == nil {
                Button("Partager avec un ami", systemImage: "paperplane") { sharing = true }
            }
            if let onRemove {
                Button("Retirer de cette playlist", systemImage: "minus.circle", role: .destructive, action: onRemove)
            }
        } label: {
            label
        }
        .sheet(isPresented: $sharing) { ShareSheet(track: tracks[0]) }
        .alert("Nouvelle playlist", isPresented: $naming) {
            TextField("Nom", text: $newName)
            Button("Annuler", role: .cancel) {}
            Button("Créer") { Task { await library.createPlaylist(name: newName, with: tracks) } }
        }
    }
}
