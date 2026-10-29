import SpotifiakCore
import SwiftUI

/// Searches as the user types (300 ms debounce): titles, albums, artists.
struct SearchView: View {
    @Environment(Session.self) private var session
    @State private var query = ""
    @State private var results: SearchResults?
    @State private var error: String?
    @State private var attempt = 0

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        List {
            if let results {
                if !results.tracks.isEmpty {
                    Section("Titres") {
                        ForEach(results.tracks.indices, id: \.self) { TrackRow(tracks: results.tracks, index: $0) }
                    }
                }
                if !results.albums.isEmpty {
                    Section("Albums") {
                        ForEach(results.albums) { album in
                            NavigationLink(value: Route.album(album.id)) {
                                row(session.api?.coverURL(album: album), album.title, album.artist.name, circle: false)
                            }
                        }
                    }
                }
                if !results.artists.isEmpty {
                    Section("Artistes") {
                        ForEach(results.artists) { artist in
                            NavigationLink(value: Route.artist(artist.id)) {
                                row(session.api?.pictureURL(artist: artist), artist.name, nil, circle: true)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if let error {
                ContentUnavailableView {
                    Label(error, systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { attempt += 1 }
                }
            } else if let results, results.tracks.isEmpty && results.albums.isEmpty && results.artists.isEmpty {
                ContentUnavailableView.search(text: trimmed)
            }
        }
        .navigationTitle("Rechercher")
        .searchable(text: $query, prompt: "Titres, albums, artistes")
        .task(id: "\(trimmed)#\(attempt)") { await search() }
    }

    private func search() async {
        let text = trimmed
        guard !text.isEmpty else {
            results = nil
            error = nil
            return
        }
        guard (try? await Task.sleep(for: .milliseconds(300))) != nil else { return }
        do {
            results = try await session.requireAPI().search(text)
            error = nil
        } catch is CancellationError {
        } catch let apiError as APIError where apiError.status != 0 {
            error = apiError.message
        } catch {
            if !Task.isCancelled { self.error = "Serveur injoignable" }
        }
    }

    private func row(_ image: URL?, _ title: String, _ subtitle: String?, circle: Bool) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: image, placeholder: circle ? "person.fill" : "music.note")
                .frame(width: 44, height: 44)
                .clipShape(circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 4)))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(1)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}
