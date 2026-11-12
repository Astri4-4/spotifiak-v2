import SpotifiakCore
import SwiftUI

/// Searches as the user types (300 ms debounce): titles, albums, playlists (own and public), podcasts,
/// Deezer (to download), artists.
struct SearchView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @State private var query = ""
    @State private var results: SearchResults?
    /// From the podcast directory; empty when it doesn't answer.
    @State private var podcasts: [PodcastSearchResult] = []
    /// Downloadable through deemix; nil when deemix doesn't answer.
    @State private var deezer: [DeezerTrack]?
    @State private var deezerAlbums: [DeezerAlbum] = []
    @State private var deezerArtists: [DeezerArtist] = []
    @State private var showsAllDeezer = false
    /// Downloads started during this search, by "track:<id>", "album:<id>", "artist:<id>".
    @State private var started: [String: DownloadState] = [:]
    /// Asked before downloading a whole discography.
    @State private var confirmingArtist: DeezerArtist?
    @State private var error: String?
    @State private var attempt = 0
    @FocusState private var focused: Bool
    /// The library's artists, as the "Parcourir tout" tiles shown before typing.
    @State private var browse: [Artist] = []

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Rechercher").font(.title.bold())
                    Spacer()
                    NavigationLink(value: Route.downloads) {
                        Image(systemName: "arrow.down.circle").font(.title2).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Téléchargements")
                }
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.title3.weight(.semibold))
                    TextField("", text: $query, prompt: Text("Que souhaitez-vous écouter ?").foregroundStyle(Color(white: 0.33)))
                        .focused($focused)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark") }
                            .accessibilityLabel("Effacer")
                    }
                }
                .foregroundStyle(.black)
                .padding(.horizontal, 12)
                .frame(height: 48)
                .background(.white, in: RoundedRectangle(cornerRadius: 6))
                .onTapGesture { focused = true }

                if trimmed.isEmpty && !browse.isEmpty {
                    section("Parcourir tout") {
                        LazyVGrid(columns: [GridItem(spacing: 12), GridItem(spacing: 12)], spacing: 12) {
                            ForEach(Array(browse.enumerated()), id: \.element.id) { index, artist in
                                BrowseTile(artist: artist, color: BrowseTile.colors[index % BrowseTile.colors.count])
                            }
                        }
                    }
                } else if let results {
                    if !results.tracks.isEmpty {
                        section("Titres") {
                            ForEach(results.tracks.indices, id: \.self) { TrackRow(tracks: results.tracks, index: $0) }
                        }
                    }
                    if !results.albums.isEmpty {
                        section("Albums") {
                            ForEach(results.albums) { album in
                                NavigationLink(value: Route.album(album.id)) {
                                    row(session.api?.coverURL(album: album), album.title, "Album • \(album.artist.name)", circle: false)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if !results.playlists.isEmpty {
                        section("Playlists") {
                            ForEach(results.playlists) { playlist in
                                NavigationLink(value: Route.playlist(playlist.id)) {
                                    HStack(spacing: 12) {
                                        Mosaic(covers: playlist.covers).frame(width: 48, height: 48)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(playlist.name).lineLimit(1)
                                            Text("Playlist • \(playlist.owner.displayName)")
                                                .font(.subheadline)
                                                .foregroundStyle(Theme.subdued)
                                                .lineLimit(1)
                                        }
                                        Spacer(minLength: 0)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if !podcasts.isEmpty {
                        section("Podcasts") {
                            ForEach(podcasts, id: \.feedUrl) { podcast in
                                NavigationLink(value: podcast.podcastId.map(Route.podcast) ?? .podcastFeed(podcast.feedUrl)) {
                                    row(podcast.imageUrl, podcast.title, "Podcast • \(podcast.author ?? "")", circle: false)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    deezerSection
                    if !results.artists.isEmpty {
                        section("Artistes") {
                            ForEach(results.artists) { artist in
                                NavigationLink(value: Route.artist(artist.id)) {
                                    row(session.api?.pictureURL(artist: artist), artist.name, "Artiste", circle: true)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .scrollDismissesKeyboard(.immediately)
        .overlay {
            if let error {
                ContentUnavailableView {
                    Label(error, systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { attempt += 1 }
                }
            } else if let results, results.tracks.isEmpty && results.albums.isEmpty && results.artists.isEmpty && results.playlists.isEmpty && podcasts.isEmpty
                        && deezer?.isEmpty != false {
                ContentUnavailableView.search(text: trimmed)
            } else if trimmed.isEmpty && browse.isEmpty {
                VStack(spacing: 8) {
                    Text("Écoutez ce que vous aimez").font(.title3.bold())
                    Text("Recherchez des titres, des albums et des artistes.").foregroundStyle(Theme.subdued)
                }
                .multilineTextAlignment(.center)
                .padding()
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .confirmationDialog(
            confirmingArtist.map { "Télécharger les \($0.nb_album) albums de \($0.name) ?" } ?? "",
            isPresented: Binding(get: { confirmingArtist != nil }, set: { if !$0 { confirmingArtist = nil } }),
            titleVisibility: .visible,
            presenting: confirmingArtist
        ) { artist in
            Button("Télécharger la discographie") { download(key: "artist:\(artist.id)", link: artist.link, what: artist.name) }
        }
        .task(id: "\(trimmed)#\(attempt)") { await search() }
        .task { browse = (try? await session.requireAPI().artists()) ?? [] }
    }

    /// "Sur Deezer": tracks to download into the library (8, then all on demand), then albums and
    /// artists (their discography). What the library already has plays or opens instead.
    @ViewBuilder private var deezerSection: some View {
        if let deezer, !deezer.isEmpty {
            section("Sur Deezer") {
                ForEach(showsAllDeezer ? deezer : Array(deezer.prefix(8))) { track in
                    HStack(spacing: 12) {
                        RemoteImage(url: track.album.cover_medium).frame(width: 48, height: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title).lineLimit(1)
                            Text("\(track.artist.name) • \(formatDuration(track.duration))")
                                .font(.subheadline)
                                .foregroundStyle(Theme.subdued)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        if let local = track.libraryTrack {
                            Button { player.play([local], startAt: 0) } label: {
                                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(Theme.green).frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(track.title) est dans ta bibliothèque : lire")
                        } else {
                            downloadControl(started["track:\(track.id)"] ?? track.download, label: "Télécharger \(track.title)") {
                                download(key: "track:\(track.id)", link: track.link, what: track.title)
                            }
                        }
                    }
                }
                if deezer.count > 8 && !showsAllDeezer {
                    Button("Plus de résultats Deezer") { showsAllDeezer = true }
                        .font(.subheadline.bold())
                        .foregroundStyle(Theme.subdued)
                }
            }
        } else if deezer == nil {
            Text("Deezer est injoignable (deemix ne répond pas).").font(.footnote).foregroundStyle(Theme.subdued)
        }
        if !deezerAlbums.isEmpty {
            section("Albums sur Deezer") {
                ForEach(deezerAlbums.prefix(6)) { album in
                    HStack(spacing: 12) {
                        row(album.cover_medium, album.title, "\(album.artist.name) • \(trackCount(album.nb_tracks))", circle: false)
                        if let id = album.libraryAlbumId {
                            NavigationLink(value: Route.album(id)) { inLibraryLabel }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(album.title) est dans ta bibliothèque : ouvrir")
                        } else {
                            downloadControl(started["album:\(album.id)"] ?? album.download, label: "Télécharger l'album \(album.title)") {
                                download(key: "album:\(album.id)", link: album.link, what: album.title)
                            }
                        }
                    }
                }
            }
        }
        if !deezerArtists.isEmpty {
            section("Artistes sur Deezer") {
                ForEach(deezerArtists.prefix(5)) { artist in
                    HStack(spacing: 12) {
                        row(artist.picture_medium, artist.name, "\(artist.nb_album) album\(artist.nb_album > 1 ? "s" : "")", circle: true)
                        if let id = artist.libraryArtistId {
                            NavigationLink(value: Route.artist(id)) { inLibraryLabel }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(artist.name) est dans ta bibliothèque : ouvrir")
                        }
                        downloadControl(started["artist:\(artist.id)"], label: "Télécharger la discographie de \(artist.name)") {
                            confirmingArtist = artist
                        }
                    }
                }
            }
        }
    }

    private var inLibraryLabel: some View {
        Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Theme.green).frame(width: 44, height: 44)
    }

    /// A download button, or where the download stands (opens the downloads page).
    @ViewBuilder
    private func downloadControl(_ state: DownloadState?, label: String, action: @escaping () -> Void) -> some View {
        if let state, state.isActive {
            NavigationLink(value: Route.downloads) {
                Text(state.status == .queued || state.progress == 0 ? "En attente" : "\(state.progress) %")
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(Theme.green)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Téléchargement en cours : voir les téléchargements")
        } else {
            Button(action: action) {
                Image(systemName: "arrow.down.circle").font(.title2).foregroundStyle(Theme.subdued).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }

    private func download(key: String, link: String, what: String) {
        started[key] = DownloadState(id: "", status: .queued, progress: 0)
        Task {
            do {
                let downloads = try await session.requireAPI().download(link)
                if let first = downloads.first {
                    started[key] = DownloadState(id: first.id, status: first.status, progress: first.progress)
                }
                player.showToast("Téléchargement lancé : tu seras prévenu quand \(what) sera prêt")
            } catch {
                started[key] = nil
                player.showToast((error as? APIError)?.message ?? "Téléchargement impossible")
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.bold())
            content()
        }
    }

    private func search() async {
        let text = trimmed
        guard !text.isEmpty else {
            results = nil
            podcasts = []
            deezer = []
            deezerAlbums = []
            deezerArtists = []
            showsAllDeezer = false
            error = nil
            return
        }
        guard (try? await Task.sleep(for: .milliseconds(300))) != nil else { return }
        do {
            let api = try session.requireAPI()
            async let podcastResults = try? api.searchPodcasts(text)
            async let deezerResults = try? api.searchDeezer(text)
            async let albumResults = try? api.searchDeezerAlbums(text)
            async let artistResults = try? api.searchDeezerArtists(text)
            results = try await api.search(text)
            podcasts = Array((await podcastResults ?? []).prefix(5))
            deezer = await deezerResults
            deezerAlbums = await albumResults ?? []
            deezerArtists = await artistResults ?? []
            showsAllDeezer = false
            error = nil
        } catch is CancellationError {
        } catch let apiError as APIError where apiError.status != 0 {
            error = apiError.message
        } catch {
            if !Task.isCancelled { self.error = "Serveur injoignable" }
        }
    }

    private func row(_ image: URL?, _ title: String, _ subtitle: String, circle: Bool) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: image, placeholder: circle ? "person.fill" : "music.note")
                .frame(width: 48, height: 48)
                .clipShape(circle ? AnyShape(Circle()) : AnyShape(Rectangle()))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(1)
                Text(subtitle).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

/// A colored tile with the artist's name and their picture tilted in the corner.
private struct BrowseTile: View {
    let artist: Artist
    let color: Color
    @Environment(Session.self) private var session

    /// Spotify's category colors.
    static let colors: [Color] = [
        Color(red: 0.86, green: 0.09, blue: 0.47), Color(red: 0.12, green: 0.2, blue: 0.39),
        Color(red: 0.52, green: 0.47, blue: 0.27), Color(red: 0.47, green: 0.2, blue: 0.67),
        Color(red: 0.91, green: 0.07, blue: 0.16), Color(red: 0.15, green: 0.52, blue: 0.27),
        Color(red: 0.55, green: 0.1, blue: 0.2), Color(red: 0.05, green: 0.45, blue: 0.93),
    ]

    var body: some View {
        NavigationLink(value: Route.artist(artist.id)) {
            ZStack(alignment: .topLeading) {
                color
                RemoteImage(url: session.api?.pictureURL(artist: artist), placeholder: "person.fill")
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .shadow(radius: 4)
                    .rotationEffect(.degrees(25))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .offset(x: 14, y: 4)
                Text(artist.name)
                    .font(.headline)
                    .lineLimit(2)
                    .padding(12)
            }
            .frame(height: 100)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}
