import SpotifiakCore
import SwiftUI

/// Picture, play / shuffle, albums, tracks.
struct ArtistView: View {
    let id: String
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: { try await session.requireAPI().artist(id) }) { artist in
            ScrollView {
                VStack(spacing: 12) {
                    RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                        .frame(width: 200, height: 200)
                        .clipShape(Circle())
                    Text(artist.name).font(.title.bold()).multilineTextAlignment(.center)
                    PlayButtons(tracks: artist.tracks)
                }
                .padding()

                VStack(alignment: .leading, spacing: 24) {
                    if !artist.albums.isEmpty {
                        Shelf(title: "Albums") { ForEach(artist.albums) { AlbumCard(album: $0) } }
                    }
                    if !artist.tracks.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Titres").font(.title2.bold()).padding(.horizontal)
                            TrackList(tracks: artist.tracks)
                        }
                    }
                }
                .padding(.bottom)
            }
            .navigationTitle(artist.name)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
