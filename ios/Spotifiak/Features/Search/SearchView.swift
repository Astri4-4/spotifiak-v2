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
    @State private var showsAllDeezer = false
    /// Deezer tracks sent to deemix during this search.
    @State private var queued: Set<Int> = []
    @State private var error: String?
    @State private var attempt = 0
    @FocusState private var focused: Bool
    /// The library's artists, as the "Parcourir tout" tiles shown before typing.
    @State private var browse: [Artist] = []

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Rechercher").font(.title.bold())
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
        .task(id: "\(trimmed)#\(attempt)") { await search() }
        .task { browse = (try? await session.requireAPI().artists()) ?? [] }
    }

    /// "Sur Deezer": tracks to download into the library (8, then all on demand).
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
                        let isQueued = queued.contains(track.id)
                        Button { download(track) } label: {
                            Image(systemName: isQueued ? "checkmark.circle.fill" : "arrow.down.circle")
                                .font(.title2)
                                .foregroundStyle(isQueued ? Theme.green : Theme.subdued)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(isQueued)
                        .accessibilityLabel(isQueued ? "Téléchargement lancé" : "Télécharger \(track.title)")
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
    }

    private func download(_ track: DeezerTrack) {
        queued.insert(track.id)
        Task {
            do {
                try await session.requireAPI().download(track.link)
                player.showToast("Téléchargement lancé : le titre apparaîtra dans votre bibliothèque")
            } catch {
                queued.remove(track.id)
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
            showsAllDeezer = false
            error = nil
            return
        }
        guard (try? await Task.sleep(for: .milliseconds(300))) != nil else { return }
        do {
            let api = try session.requireAPI()
            async let podcastResults = try? api.searchPodcasts(text)
            async let deezerResults = try? api.searchDeezer(text)
            results = try await api.search(text)
            podcasts = Array((await podcastResults ?? []).prefix(5))
            deezer = await deezerResults
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
