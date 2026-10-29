import SpotifiakCore
import SwiftUI

/// Greeting, then the library's albums and artists.
struct HomeView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: load) { library in
            if library.albums.isEmpty && library.artists.isEmpty {
                ContentUnavailableView("Votre bibliothèque est vide", systemImage: "music.note.list")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if !library.albums.isEmpty {
                            Shelf(title: "Albums") { ForEach(library.albums) { AlbumCard(album: $0) } }
                        }
                        if !library.artists.isEmpty {
                            Shelf(title: "Artistes") { ForEach(library.artists) { ArtistCard(artist: $0) } }
                        }
                    }
                    .padding(.vertical)
                }
            }
        }
        .navigationTitle(greeting(at: .now, calendar: .current))
    }

    private func load() async throws -> (albums: [Album], artists: [Artist]) {
        let api = try session.requireAPI()
        async let albums = api.albums()
        async let artists = api.artists()
        return try await (albums, artists)
    }
}
