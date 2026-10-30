import SpotifiakCore
import SwiftUI

/// Picture across the top with the name over it, follow / shuffle / play, popular tracks, albums.
struct ArtistView: View {
    let id: String
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library

    var body: some View {
        Loadable(load: { try await session.requireAPI().artist(id) }) { artist in
            ScrollView {
                RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                    .frame(height: 320)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .overlay(alignment: .bottomLeading) {
                        LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                        Text(artist.name)
                            .font(.system(size: 44, weight: .black))
                            .lineLimit(2)
                            .minimumScaleFactor(0.5)
                            .padding()
                    }

                VStack(alignment: .leading, spacing: 24) {
                    PlayButtons(tracks: artist.tracks) {
                        let followed = library.followedArtistIds.contains(artist.id)
                        Button(followed ? "Abonné" : "Suivre") { library.toggleFollowed(artist: artist.id) }
                            .font(.footnote.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 32)
                            .overlay(Capsule().stroke(followed ? .white : Theme.subdued))
                            .buttonStyle(.plain)
                            .accessibilityLabel(followed ? "Ne plus suivre \(artist.name)" : "Suivre \(artist.name)")
                    }
                    .padding(.horizontal)
                    if !artist.tracks.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Populaires").font(.title2.bold()).padding(.horizontal)
                            TrackList(tracks: artist.tracks, numbered: true)
                        }
                    }
                    if !artist.albums.isEmpty {
                        Shelf(title: "Discographie") { ForEach(artist.albums) { AlbumCard(album: $0) } }
                    }
                }
                .padding(.vertical)
            }
            .ignoresSafeArea(edges: .top)
            .toolbarBackground(.hidden, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
