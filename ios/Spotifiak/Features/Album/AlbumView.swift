import SpotifiakCore
import SwiftUI

/// Cover on its color, title, artist, save / shuffle / play, tracks.
struct AlbumView: View {
    let id: String
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library

    var body: some View {
        Loadable(load: { try await session.requireAPI().album(id) }) { album in
            let cover = session.api?.coverURL(album: album)
            DetailPage(colorURL: cover, tracks: album.tracks, showsCovers: false) {
                RemoteImage(url: cover)
            } info: {
                Text(album.title).font(.title2.bold())
                NavigationLink(value: Route.artist(album.artist.id)) {
                    HStack(spacing: 8) {
                        RemoteImage(url: album.artist.pictureUrl, placeholder: "person.fill")
                            .frame(width: 24, height: 24)
                            .clipShape(Circle())
                        Text(album.artist.name).font(.subheadline.bold())
                    }
                }
                .buttonStyle(.plain)
                Text((["Album"] + [album.year.map { String($0) }].compactMap { $0 }).joined(separator: " • "))
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
            } actions: {
                let saved = library.savedAlbumIds.contains(album.id)
                Button { library.toggleSaved(album: album.id) } label: {
                    Image(systemName: saved ? "checkmark.circle.fill" : "plus.circle")
                        .font(.title)
                        .foregroundStyle(saved ? Theme.green : Theme.subdued)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(saved ? "Retirer de la bibliothèque" : "Ajouter à la bibliothèque")
            }
        }
    }
}

/// The layout of album, playlist, liked and podcast pages: the cover on a wash of its color
/// (or `background`), the page's info, its actions with shuffle / play, then `content`
/// (the tracks by default).
struct DetailPage<Cover: View, Info: View, Actions: View, Content: View>: View {
    var colorURL: URL?
    var background: AnyShapeStyle?
    let tracks: [Track]
    var showsCovers = true
    /// Off for podcasts, which play episode by episode.
    var showsPlayButtons = true
    var onRemove: ((Int) -> Void)?
    /// The rows to list when they differ from `tracks` (a filtered playlist); play / shuffle keep `tracks`.
    var listed: [Track]?
    @ViewBuilder let cover: Cover
    @ViewBuilder let info: Info
    @ViewBuilder let actions: Actions
    @ViewBuilder let content: Content

    @State private var color = Theme.headerGray

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                cover
                    .frame(width: 240, height: 240)
                    .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 8)
                info
                if showsPlayButtons {
                    PlayButtons(tracks: tracks) { actions }
                } else {
                    HStack(spacing: 20) { actions }
                }
            }
            .padding(.horizontal)
            .padding(.top, 8)
            .background(alignment: .top) {
                Rectangle()
                    .fill(background ?? AnyShapeStyle(Theme.header(color)))
                    .mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                    .frame(height: 460)
                    .padding(.top, -200)
            }

            if Content.self == EmptyView.self {
                TrackList(tracks: listed ?? tracks, showsCover: showsCovers, onRemove: onRemove)
                    .padding(.bottom)
            } else {
                content
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .coverColor(colorURL, into: $color)
    }
}

extension DetailPage where Content == EmptyView {
    init(colorURL: URL? = nil, background: AnyShapeStyle? = nil, tracks: [Track], showsCovers: Bool = true,
         onRemove: ((Int) -> Void)? = nil, listed: [Track]? = nil,
         @ViewBuilder cover: () -> Cover, @ViewBuilder info: () -> Info, @ViewBuilder actions: () -> Actions) {
        self.init(colorURL: colorURL, background: background, tracks: tracks, showsCovers: showsCovers, onRemove: onRemove,
                  listed: listed, cover: cover, info: info, actions: actions, content: { EmptyView() })
    }
}

extension DetailPage where Content == EmptyView, Actions == EmptyView {
    init(colorURL: URL? = nil, background: AnyShapeStyle? = nil, tracks: [Track], showsCovers: Bool = true,
         @ViewBuilder cover: () -> Cover, @ViewBuilder info: () -> Info) {
        self.init(colorURL: colorURL, background: background, tracks: tracks, showsCovers: showsCovers,
                  cover: cover, info: info, actions: { EmptyView() })
    }
}

/// Tracks stacked in a scroll view (a List would merge the page's buttons into rows).
struct TrackList: View {
    let tracks: [Track]
    var showsCover = true
    var numbered = false
    var onRemove: ((Int) -> Void)?

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(tracks.indices, id: \.self) { index in
                TrackRow(tracks: tracks, index: index, showsCover: showsCover, number: numbered ? index + 1 : nil,
                         onRemove: onRemove.map { remove in { remove(index) } })
                    .padding(.leading)
                    .padding(.trailing, 8)
                    .padding(.vertical, 6)
            }
        }
    }
}

/// The page's own buttons (save, follow…), shuffle, and the big green play button on the
/// right. Play pauses / resumes when one of `tracks` is the current one.
struct PlayButtons<Accessory: View>: View {
    let tracks: [Track]
    @ViewBuilder var accessory: Accessory
    @Environment(PlayerEngine.self) private var player

    private var isCurrent: Bool { tracks.contains { $0.id == player.current?.id } }

    var body: some View {
        HStack(spacing: 20) {
            accessory
            Button { player.play(tracks, startAt: Int.random(in: tracks.indices), shuffle: true) } label: {
                Image(systemName: "shuffle").font(.title2).foregroundStyle(Theme.subdued)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Lecture aléatoire")
            .disabled(tracks.isEmpty)
            Spacer()
            BigPlayButton(isPlaying: isCurrent && player.isPlaying) {
                if isCurrent { player.togglePlay() } else { player.play(tracks, startAt: 0) }
            }
            .disabled(tracks.isEmpty)
        }
    }
}

extension PlayButtons where Accessory == EmptyView {
    init(tracks: [Track]) {
        self.init(tracks: tracks) { EmptyView() }
    }
}
