import SpotifiakCore
import SwiftUI

/// Liked tracks, playlists, saved albums, followed artists and podcasts, filtered by kind like Spotify's library.
struct LibraryView: View {
    let user: User
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.navigate) private var navigate
    @State private var filter: Filter?
    @State private var naming = false
    @State private var newName = ""
    @State private var showsJam = false

    enum Filter: String, CaseIterable {
        case playlists = "Playlists", albums = "Albums", artists = "Artistes", podcasts = "Podcasts"
    }

    private struct Collection: Sendable {
        var liked: [Track], playlists: [PlaylistSummary], albums: [Album], artists: [Artist], podcasts: [PodcastSummary]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            chips
            Loadable(load: load) { collection in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        if filter == nil || filter == .playlists {
                            NavigationLink(value: Route.liked) {
                                LibraryRow(title: "Titres likés", subtitle: "Playlist • \(trackCount(collection.liked.count))") {
                                    LikedCover()
                                }
                            }
                            ForEach(collection.playlists) { playlist in
                                NavigationLink(value: Route.playlist(playlist.id)) {
                                    LibraryRow(title: playlist.name, subtitle: "Playlist • \(user.displayName)") {
                                        Mosaic(covers: playlist.covers)
                                    }
                                }
                            }
                        }
                        if filter == nil || filter == .albums {
                            ForEach(collection.albums) { album in
                                NavigationLink(value: Route.album(album.id)) {
                                    LibraryRow(title: album.title, subtitle: "Album • \(album.artist.name)") {
                                        RemoteImage(url: session.api?.coverURL(album: album))
                                    }
                                }
                            }
                        }
                        if filter == nil || filter == .podcasts {
                            ForEach(collection.podcasts) { podcast in
                                NavigationLink(value: Route.podcast(podcast.id)) {
                                    LibraryRow(title: podcast.title, subtitle: "Podcast • \(podcast.author ?? "")") {
                                        RemoteImage(url: session.api?.imageURL(podcast: podcast.id, hasImage: podcast.hasImage),
                                                    placeholder: "mic.fill")
                                    }
                                }
                            }
                        }
                        if filter == nil || filter == .artists {
                            ForEach(collection.artists) { artist in
                                NavigationLink(value: Route.artist(artist.id)) {
                                    LibraryRow(title: artist.name, subtitle: "Artiste", round: true) {
                                        RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                                    }
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal)
                    .padding(.bottom)
                }
            }
            // Something saved, followed or created: the list follows.
            .id(library.version)
        }
        .toolbar(.hidden, for: .navigationBar)
        .alert("Nouvelle playlist", isPresented: $naming) {
            TextField("Nom", text: $newName)
            Button("Annuler", role: .cancel) {}
            Button("Créer") { Task { await library.createPlaylist(name: newName) } }
        }
        .sheet(isPresented: $showsJam) { JamSheet() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Menu {
                Section(user.displayName) {
                    Button("Compte", systemImage: "person.crop.circle") { navigate(.account) }
                    Button("Importer depuis Spotify", systemImage: "square.and.arrow.down") { navigate(.spotifyImport) }
                    Button("Analyse de la bibliothèque", systemImage: "arrow.triangle.2.circlepath") { navigate(.scan) }
                    if user.role == .admin {
                        Button("Comptes", systemImage: "person.2") { navigate(.users) }
                    }
                    Button("Jam", systemImage: "person.2.wave.2") { showsJam = true }
                }
                Button("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await session.logout() }
                }
            } label: {
                Text(user.displayName.prefix(1).uppercased())
                    .font(.headline)
                    .foregroundStyle(.black)
                    .frame(width: 32, height: 32)
                    .background(Color(red: 1, green: 0.6, blue: 0.4), in: Circle())
            }
            .accessibilityLabel("Compte et réglages")
            Text("Bibliothèque").font(.title2.bold())
            Spacer()
            Menu {
                Button("Playlist", systemImage: "music.note.list") {
                    newName = ""
                    naming = true
                }
                if library.canCreatePodcasts {
                    Button("Podcast de vidéos YouTube", systemImage: "mic") {
                        Task { if let id = await library.createPodcast() { navigate(.podcast(id)) } }
                    }
                }
            } label: {
                Image(systemName: "plus").font(.title3).frame(width: 44, height: 44)
            }
            .foregroundStyle(.white)
            .accessibilityLabel("Créer")
        }
        .padding(.horizontal)
    }

    /// Spotify's filter pills; tapping the selected one clears it.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Filter.allCases, id: \.self) { kind in
                    Button { filter = filter == kind ? nil : kind } label: {
                        Text(kind.rawValue)
                            .font(.footnote)
                            .foregroundStyle(filter == kind ? .black : .white)
                            .padding(.horizontal, 14)
                            .frame(height: 32)
                            .background(filter == kind ? Theme.green : Theme.elevated, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(filter == kind ? .isSelected : [])
                }
            }
            .padding(.horizontal)
        }
    }

    private func load() async throws -> Collection {
        let api = try session.requireAPI()
        async let liked = api.likedTracks()
        async let playlists = api.playlists()
        async let albums = api.savedAlbums()
        async let artists = api.followedArtists()
        async let podcasts = api.subscriptions()
        return try await Collection(liked: liked, playlists: playlists, albums: albums, artists: artists, podcasts: podcasts)
    }
}

/// A 64-point image (round for artists), the title and a gray subtitle.
private struct LibraryRow<Image: View>: View {
    let title: String
    let subtitle: String
    var round = false
    @ViewBuilder let image: Image

    var body: some View {
        HStack(spacing: 12) {
            image
                .frame(width: 64, height: 64)
                .clipShape(round ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 4)))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).lineLimit(1)
                Text(subtitle).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
