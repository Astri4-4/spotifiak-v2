import SpotifiakCore
import SwiftUI

/// The user's downloads: waiting, downloading (with progress), done or failed; refreshed every
/// 2 s while any is on its way. Finished ones open their album.
struct DownloadsView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(\.navigate) private var navigate
    @State private var downloads: [Download]?
    @State private var error: String?

    var body: some View {
        Group {
            if let downloads {
                if downloads.isEmpty {
                    ContentUnavailableView(
                        "Aucun téléchargement",
                        systemImage: "arrow.down.circle",
                        description: Text("Cherchez un titre, un album ou un artiste et téléchargez-le depuis Deezer.")
                    )
                } else {
                    List {
                        ForEach(downloads) { row($0) }
                            .listRowBackground(Color.clear)
                    }
                    .listStyle(.plain)
                    .refreshable { await load() }
                }
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
