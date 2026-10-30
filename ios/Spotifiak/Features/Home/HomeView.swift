import SpotifiakCore
import SwiftUI

/// Greeting, a grid of shortcuts (liked tracks, playlists, first albums), then the playlists,
/// other accounts' public playlists, new episodes of the subscribed podcasts, albums and artists.
struct HomeView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: load) { library in
            if library.albums.isEmpty && library.artists.isEmpty {
                ContentUnavailableView("Votre bibliothèque est vide", systemImage: "music.note.list")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        Text(greeting(at: .now, calendar: .current))
                            .font(.title.bold())
                            .padding(.horizontal)
                        LazyVGrid(columns: [GridItem(spacing: 8), GridItem(spacing: 8)], spacing: 8) {
                            ShortcutTile(route: .liked, title: "Titres likés") { LikedCover() }
                            ForEach(library.playlists.prefix(3)) { playlist in
                                ShortcutTile(route: .playlist(playlist.id), title: playlist.name) { Mosaic(covers: playlist.covers) }
                            }
                            ForEach(library.albums.prefix(7 - min(library.playlists.count, 3))) { album in
                                ShortcutTile(route: .album(album.id), title: album.title) {
                                    RemoteImage(url: session.api?.coverURL(album: album))
                                }
                            }
                        }
                        .padding(.horizontal)
                        if !library.playlists.isEmpty {
                            Shelf(title: "Vos playlists") {
                                ForEach(library.playlists) { playlist in
                                    NavigationLink(value: Route.playlist(playlist.id)) {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Mosaic(covers: playlist.covers)
                                                .frame(width: 150, height: 150)
                                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                            Text(playlist.name).font(.footnote.weight(.semibold)).lineLimit(1)
                                            Text(trackCount(playlist.trackCount)).font(.caption).foregroundStyle(Theme.subdued)
                                        }
                                        .frame(width: 150)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        if !library.publicPlaylists.isEmpty {
                            Shelf(title: "Playlists publiques") {
                                ForEach(library.publicPlaylists) { playlist in
                                    NavigationLink(value: Route.playlist(playlist.id)) {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Mosaic(covers: playlist.covers)
                                                .frame(width: 150, height: 150)
                                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                            Text(playlist.name).font(.footnote.weight(.semibold)).lineLimit(1)
                                            Text("De \(playlist.owner.displayName)").font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
                                        }
                                        .frame(width: 150)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        if !library.episodes.isEmpty {
                            Shelf(title: "Nouveaux épisodes") { ForEach(library.episodes) { EpisodeCard(episode: $0) } }
                        }
                        if !library.albums.isEmpty {
                            Shelf(title: "Albums") { ForEach(library.albums) { AlbumCard(album: $0) } }
                        }
                        if !library.artists.isEmpty {
                            Shelf(title: "Artistes") { ForEach(library.artists) { ArtistCard(artist: $0) } }
                        }
                    }
                    .padding(.vertical)
                }
                .background(alignment: .top) {
                    LinearGradient(colors: [Theme.green.opacity(0.25), Theme.base], startPoint: .top, endPoint: .bottom)
                        .frame(height: 280)
                        .ignoresSafeArea()
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func load() async throws -> (albums: [Album], artists: [Artist], playlists: [PlaylistSummary], episodes: [Episode],
                                         publicPlaylists: [PublicPlaylist]) {
        let api = try session.requireAPI()
        async let albums = api.albums()
        async let artists = api.artists()
        async let playlists = api.playlists()
        // Publishers' feeds can be down: the home page shows without them.
        async let episodes = try? api.newEpisodes()
        async let publicPlaylists = try? api.publicPlaylists()
        return try await (albums, artists, playlists, await episodes ?? [], await publicPlaylists ?? [])
    }
}

/// Small cover and title on a gray tile, two per row.
private struct ShortcutTile<Cover: View>: View {
    let route: Route
    let title: String
    @ViewBuilder let cover: Cover

    var body: some View {
        NavigationLink(value: route) {
            HStack(spacing: 8) {
                cover.frame(width: 56, height: 56)
                Text(title)
                    .font(.footnote.bold())
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.trailing, 8)
            .background(Theme.highlight)
            .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
    }
}
