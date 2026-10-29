import SpotifiakCore
import SwiftUI

/// Cover, title, artist, play / shuffle, tracks.
struct AlbumView: View {
    let id: String
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: { try await session.requireAPI().album(id) }) { album in
            ScrollView {
                VStack(spacing: 12) {
                    RemoteImage(url: session.api?.coverURL(album: album))
                        .frame(width: 240, height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .shadow(radius: 8)
                    Text(album.title).font(.title2.bold()).multilineTextAlignment(.center)
                    NavigationLink(value: Route.artist(album.artist.id)) {
                        Text(album.artist.name).font(.headline).foregroundStyle(Color.accentColor)
                    }
                    .buttonStyle(.plain)
                    Text([album.year.map { String($0) }, "\(album.tracks.count) titres"].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    PlayButtons(tracks: album.tracks)
                }
                .padding()

                TrackList(tracks: album.tracks, showsNumber: true)
            }
            .navigationTitle(album.title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Tracks stacked in a scroll view (a List would merge the page's buttons into rows).
struct TrackList: View {
    let tracks: [Track]
    var showsNumber = false

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(tracks.indices, id: \.self) { index in
                TrackRow(tracks: tracks, index: index, showsNumber: showsNumber)
                    .padding(.horizontal)
                    .padding(.vertical, 6)
            }
        }
    }
}

/// "Lecture" and "Aléatoire" for a list of tracks.
struct PlayButtons: View {
    let tracks: [Track]
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        HStack(spacing: 12) {
            Button { player.play(tracks, startAt: 0) } label: {
                Label("Lecture", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button { player.play(tracks, startAt: Int.random(in: tracks.indices), shuffle: true) } label: {
                Label("Aléatoire", systemImage: "shuffle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .disabled(tracks.isEmpty)
    }
}
