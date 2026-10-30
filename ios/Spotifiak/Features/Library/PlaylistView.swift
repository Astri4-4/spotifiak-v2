import SpotifiakCore
import SwiftUI

/// Mosaic, name, description, owner, shuffle / play, tracks, with a field to search inside them
/// (title, artist or album). Its owner edits and deletes it.
struct PlaylistView: View {
    let id: String
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    /// Bumped after an edit to load the playlist again.
    @State private var reload = 0
    @State private var editing: PlaylistDetail?
    @State private var confirmingDelete = false
    @State private var filter = ""

    var body: some View {
        Loadable(load: { try await session.requireAPI().playlist(id) }) { playlist in
            let tracks = playlist.entries.map(\.track)
            let query = filter.trimmingCharacters(in: .whitespaces)
            // Entries the filter keeps; removing a row maps back through them.
            let shown = query.isEmpty ? Array(playlist.entries) : playlist.entries.filter { $0.track.matches(query) }
            DetailPage(colorURL: playlist.covers.first.flatMap { session.api?.coverURL(mosaic: $0) }, tracks: tracks,
                       onRemove: playlist.owned ? { index in remove(shown[index]) } : nil, listed: shown.map(\.track)) {
                Mosaic(covers: playlist.covers)
            } info: {
                Text(playlist.name).font(.title2.bold())
                if let description = playlist.description, !description.isEmpty {
                    Text(description).font(.subheadline).foregroundStyle(Theme.subdued)
                }
                Text(playlist.owner.displayName).font(.subheadline.bold())
                Text("\(playlist.isPublic ? "Playlist publique" : "Playlist") • \(trackCount(tracks.count))")
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
                if !tracks.isEmpty {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Theme.subdued)
                        TextField("", text: $filter, prompt: Text("Rechercher dans la playlist").foregroundStyle(Theme.subdued))
                            .autocorrectionDisabled()
                            .submitLabel(.search)
                        if !filter.isEmpty {
                            Button { filter = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.subdued) }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Effacer la recherche")
                        }
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 10)
                    .frame(height: 36)
                    .background(Theme.highlight, in: RoundedRectangle(cornerRadius: 6))
                    .padding(.top, 4)
                    if shown.isEmpty {
                        Text("Aucun titre pour « \(query) » dans cette playlist.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.subdued)
                    }
                }
            } actions: {
                if playlist.owned {
                    Menu {
                        Button("Modifier", systemImage: "pencil") { editing = playlist }
                        Button("Supprimer la playlist", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                    } label: {
                        Image(systemName: "ellipsis").font(.title2).foregroundStyle(Theme.subdued).frame(width: 32, height: 44)
                    }
                    .accessibilityLabel("Plus d'options pour la playlist")
                }
            }
        }
        .id(reload)
        .sheet(item: $editing, onDismiss: { reload += 1 }) { PlaylistEditor(playlist: $0) }
        .confirmationDialog("Supprimer cette playlist ?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Supprimer", role: .destructive) {
                Task { if await library.editPlaylist({ try await $0.deletePlaylist(id) }) { dismiss() } }
            }
        }
    }

    private func remove(_ entry: PlaylistEntry) {
        Task {
            if await library.editPlaylist({ try await $0.removeFromPlaylist(id, entryId: entry.id) }) { reload += 1 }
        }
    }
}

/// Name, description, public switch, and the tracks to reorder or remove (saved as they change).
private struct PlaylistEditor: View {
    let playlist: PlaylistDetail
    @Environment(LibraryStore.self) private var library
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var isPublic = false
    @State private var entries: [PlaylistEntry] = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Nom", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                    Toggle("Publique", isOn: $isPublic)
                } footer: {
                    Text("Une playlist publique est visible et lisible par tous les comptes.")
                }
                Section("Titres") {
                    ForEach(entries) { entry in
                        HStack(spacing: 12) {
                            RemoteImage(url: session.api?.coverURL(track: entry.track)).frame(width: 40, height: 40)
                            VStack(alignment: .leading) {
                                Text(entry.track.title).lineLimit(1)
                                Text(entry.track.artistName).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
                            }
                        }
                    }
                    .onMove(perform: move)
                    .onDelete(perform: delete)
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Modifier la playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .onAppear {
            name = playlist.name
            description = playlist.description ?? ""
            isPublic = playlist.isPublic
            entries = playlist.entries
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        guard let from = source.first else { return }
        let moved = entries[from]
        entries.move(fromOffsets: source, toOffset: destination)
        let at = entries.firstIndex(of: moved)!
        let before = at + 1 < entries.count ? entries[at + 1].id : nil
        Task { await library.editPlaylist { try await $0.movePlaylistEntry(playlist.id, entryId: moved.id, before: before) } }
    }

    private func delete(at offsets: IndexSet) {
        let removed = offsets.map { entries[$0] }
        entries.remove(atOffsets: offsets)
        Task {
            for entry in removed {
                await library.editPlaylist { try await $0.removeFromPlaylist(playlist.id, entryId: entry.id) }
            }
        }
    }

    private func save() async {
        let saved = await library.editPlaylist {
            try await $0.updatePlaylist(playlist.id, name: name.trimmingCharacters(in: .whitespaces),
                                        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                                        isPublic: isPublic)
        }
        if saved { dismiss() }
    }
}

/// The user's liked tracks, latest first, under Spotify's purple header.
struct LikedView: View {
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library

    var body: some View {
        Loadable(load: { try await session.requireAPI().likedTracks() }) { tracks in
            DetailPage(background: AnyShapeStyle(LinearGradient(colors: [Color(red: 0.31, green: 0.22, blue: 0.62), Theme.base],
                                                                 startPoint: .top, endPoint: .bottom)),
                       tracks: tracks) {
                LikedCover(iconSize: 80)
            } info: {
                Text("Titres likés").font(.title2.bold())
                Text(trackCount(tracks.count)).font(.caption).foregroundStyle(Theme.subdued)
            }
        }
        // Reloads once a like or unlike anywhere has reached the server.
        .id(library.version)
    }
}

/// "12 titres", "1 titre".
func trackCount(_ count: Int) -> String {
    count == 1 ? "1 titre" : "\(count) titres"
}

/// The white heart on the purple-blue gradient.
struct LikedCover: View {
    var iconSize: CGFloat = 20

    var body: some View {
        Theme.liked.overlay {
            Image(systemName: "heart.fill").font(.system(size: iconSize)).foregroundStyle(.white)
        }
    }
}

/// A playlist's cover: four covers in a grid, one when it has fewer, a note when empty.
struct Mosaic: View {
    let covers: [MosaicCover]
    @Environment(Session.self) private var session

    var body: some View {
        let urls = covers.compactMap { session.api?.coverURL(mosaic: $0) }
        if urls.count >= 4 {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow { RemoteImage(url: urls[0]); RemoteImage(url: urls[1]) }
                GridRow { RemoteImage(url: urls[2]); RemoteImage(url: urls[3]) }
            }
            .clipped()
        } else {
            RemoteImage(url: urls.first)
        }
    }
}
