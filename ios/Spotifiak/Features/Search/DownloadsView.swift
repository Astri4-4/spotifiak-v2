import SpotifiakCore
import SwiftUI

/// The user's downloads: waiting, downloading (with progress), done or failed; refreshed every
/// 2 s while any is on its way. Finished ones open their album.
struct DownloadsView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(\.navigate) private var navigate
    @State private var downloads: [Download]?
    @State private var suggestions: Suggestions?
    @State private var error: String?

    var body: some View {
        Group {
            if let downloads {
                List {
                    if downloads.isEmpty {
                        Text("Aucun téléchargement. Cherchez un titre, un album ou un artiste et téléchargez-le depuis Deezer.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.subdued)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(downloads) { row($0) }
                        .listRowBackground(Color.clear)
                    SuggestionsSection(suggestions: suggestions) { await load() }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            } else if let error {
                ContentUnavailableView {
                    Label(error, systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { Task { await load() } }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Téléchargements")
        .toolbar {
            if downloads?.contains(where: \.isSettled) == true {
                Button("Effacer les terminés") { act { try await $0.clearFinishedDownloads() } }
            }
        }
        // Made once a day on the server, from Deezer: loaded once per visit.
        .task { suggestions = try? await session.api?.suggestions() }
        // Loads, then polls while anything is on its way.
        .task {
            while !Task.isCancelled {
                await load()
                let active = downloads?.contains { !$0.isSettled } == true
                try? await Task.sleep(for: .seconds(active ? 2 : 15))
            }
        }
    }

    private func row(_ download: Download) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: download.coverUrl)
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                Text(download.title).font(.body.weight(.semibold)).lineLimit(1)
                Text("\(download.type == "album" ? "Album" : "Titre") • \(download.artist)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.subdued)
                    .lineLimit(1)
                Text(download.statusText)
                    .font(.caption)
                    .foregroundStyle(statusColor(download))
                    .lineLimit(2)
                if !download.isSettled {
                    ProgressView(value: Double(download.status == .queued ? 0 : download.progress), total: 100)
                        .tint(Theme.green)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if download.ready, let albumId = download.albumId { navigate(.album(albumId)) }
        }
        .swipeActions {
            Button(download.isSettled ? "Retirer" : "Annuler", role: .destructive) {
                act { try await $0.removeDownload(download.id) }
            }
            if download.status == .failed || download.status == .partial {
                Button("Réessayer") { act { try await $0.retryDownload(download.id) } }
                    .tint(Theme.green)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(download.ready && download.albumId != nil ? "Ouvre l'album" : "")
    }

    private func statusColor(_ download: Download) -> Color {
        switch download.status {
        case .failed: .red
        case .downloading, .done: Theme.green
        default: Theme.subdued
        }
    }

    private func load() async {
        do {
            downloads = try await session.requireAPI().downloads()
            error = nil
        } catch is CancellationError {
        } catch {
            if downloads == nil { self.error = (error as? APIError)?.message ?? "Serveur injoignable" }
        }
    }

    private func act(_ action: @escaping (APIClient) async throws -> Void) {
        Task {
            do {
                try await action(session.requireAPI())
            } catch {
                player.showToast((error as? APIError)?.message ?? "Action impossible")
            }
            await load()
        }
    }
}

/// What to download next: albums to finish, and friends' artists' top tracks the library lacks.
/// DownloadsView loads `suggestions`: a List leaves an empty section out, with any `.task` on it.
private struct SuggestionsSection: View {
    let suggestions: Suggestions?
    /// Reloads the downloads above once some start.
    let onStart: @MainActor () async -> Void
    @Environment(Session.self) private var session
    /// Started from here: hidden from the suggestions (the list above shows them now).
    @State private var started: Set<String> = []

    var body: some View {
        Group {
            if let suggestions {
                let albums = suggestions.albums.filter { !started.contains($0.link) }
                let tracks = suggestions.tracks.filter { !started.contains($0.track.link) && $0.track.download == nil }
                if !albums.isEmpty {
                    Section("Albums à compléter") {
                        ForEach(albums) { item in
                            suggestion(
                                image: session.api?.coverURL(album: item.album),
                                title: item.album.title,
                                subtitle: "\(item.album.artist.name) • \(item.have) titres sur \(item.total)",
                                action: "Compléter",
                                links: [item.link]
                            )
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                if !tracks.isEmpty {
                    Section {
                        ForEach(tracks) { item in
                            suggestion(
                                image: item.track.album.cover_medium,
                                title: item.track.title,
                                subtitle: item.fans.isEmpty ? item.track.artist.name : "\(item.track.artist.name) • aimé par \(item.fans.joined(separator: " et "))",
                                action: "Télécharger",
                                links: [item.track.link]
                            )
                        }
                    } header: {
                        HStack {
                            Text("Les artistes de tes amis")
                            Spacer()
                            Button("Tout télécharger") { download(tracks.map(\.track.link)) }
                                .font(.caption.bold())
                        }
                    }
                    .listRowBackground(Color.clear)
                }
            }
        }
    }

    private func suggestion(image: URL?, title: String, subtitle: String, action: String, links: [String]) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: image)
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.semibold)).lineLimit(1)
                Text(subtitle).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(2)
            }
            Spacer(minLength: 0)
            Button(action) { download(links) }
                .font(.caption.bold())
                .buttonStyle(.bordered)
                .accessibilityLabel("\(action) \(title)")
        }
    }

    private func download(_ links: [String]) {
        started.formUnion(links)
        Task {
            for link in links { _ = try? await session.api?.download(link) }
            await onStart()
        }
    }
}
