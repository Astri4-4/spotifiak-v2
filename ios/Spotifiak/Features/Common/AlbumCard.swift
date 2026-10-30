import SpotifiakCore
import SwiftUI

/// Cover, title and artist, linking to the album.
struct AlbumCard: View {
    let album: Album
    @Environment(Session.self) private var session

    var body: some View {
        NavigationLink(value: Route.album(album.id)) {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: session.api?.coverURL(album: album))
                    .frame(width: 150, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                Text(album.title).font(.footnote.weight(.semibold)).lineLimit(1)
                Text(album.artist.name).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
            }
            .frame(width: 150)
        }
        .buttonStyle(.plain)
    }
}

/// Round picture and name, linking to the artist.
struct ArtistCard: View {
    let artist: Artist
    @Environment(Session.self) private var session

    var body: some View {
        NavigationLink(value: Route.artist(artist.id)) {
            VStack(spacing: 8) {
                RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                    .frame(width: 150, height: 150)
                    .clipShape(Circle())
                Text(artist.name).font(.footnote.weight(.semibold)).lineLimit(1)
                Text("Artiste").font(.caption).foregroundStyle(Theme.subdued)
            }
            .frame(width: 150)
        }
        .buttonStyle(.plain)
    }
}

/// A titled horizontal row of cards.
struct Shelf<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title2.bold()).padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 16) { content }.padding(.horizontal)
            }
        }
    }
}
