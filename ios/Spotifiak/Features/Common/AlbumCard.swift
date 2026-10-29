import SpotifiakCore
import SwiftUI

/// Cover, title and artist, linking to the album.
struct AlbumCard: View {
    let album: Album
    @Environment(Session.self) private var session

    var body: some View {
        NavigationLink(value: Route.album(album.id)) {
            VStack(alignment: .leading, spacing: 4) {
                RemoteImage(url: session.api?.coverURL(album: album))
                    .frame(width: 150, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(album.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(album.artist.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
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
            VStack(spacing: 6) {
                RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                    .frame(width: 120, height: 120)
                    .clipShape(Circle())
                Text(artist.name).font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            .frame(width: 120)
        }
        .buttonStyle(.plain)
    }
}

/// A titled horizontal row of cards.
struct Shelf<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title2.bold()).padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 16) { content }.padding(.horizontal)
            }
        }
    }
}
