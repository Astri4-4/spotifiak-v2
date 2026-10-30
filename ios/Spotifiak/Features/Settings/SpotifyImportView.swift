import SafariServices
import SpotifiakCore
import SwiftUI

/// Connects a Spotify account, imports its playlists and liked tracks (missing tracks are
/// downloaded through deemix), and follows the imports. Same flow as the web page: the
/// consent page opens in Safari and the server finishes the connection at its callback.
struct SpotifyImportView: View {
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @State private var status: SpotifyStatus?
    @State private var playlists: SpotifyPlaylists?
    @State private var imports: [SpotifyImport] = []
    @State private var authorizeURL: URL?
    @State private var busy: String?
    @State private var error: String?
    /// Bumped to restart the imports' polling after starting one.
    @State private var importsVersion = 0

    private var isAdmin: Bool {
        if case .loggedIn(let user) = session.state { return user.role == .admin }
        return false
    }

    var body: some View {
        List {
            if let error {
                Section { Text(error).foregroundStyle(Theme.error) }
            }
            if let status {
                if !status.configured {
                    Section { setupHelp(status) }
                } else if let account = status.account {
                    playlistsSection(account)
                    importsSection
                } else {
                    Section {
                        Text("Connectez votre compte Spotify pour retrouver vos playlists. Les titres déjà dans votre bibliothèque sont ajoutés tout de suite, les autres sont téléchargés via deemix puis ajoutés à leur place dans la playlist.")
                            .font(.subheadline)
                        Button { connect() } label: {
                            Text("Connecter Spotify")
                                .font(.headline)
                                .foregroundStyle(.black)
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .background(Theme.green, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(busy != nil)
                    }
                    importsSection
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Importer depuis Spotify")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadStatus() }
        .task(id: importsVersion) { await pollImports() }
        .sheet(item: $authorizeURL, onDismiss: { Task { await loadStatus() } }) { url in
            SafariView(url: url).ignoresSafeArea()
        }
    }

    // MARK: - Sections

    private func playlistsSection(_ account: SpotifyStatus.Account) -> some View {
        Section {
            if let playlists {
                row(image: nil, liked: true, title: "Titres likés", subtitle: "\(titles(playlists.likedTotal)) • ajoutés à vos Titres likés") {
                    importButton("Importer", outlined: false, key: "liked", disabled: playlists.likedTotal == 0) {
                        try await $0.importFromSpotify(playlistId: nil, name: "Titres likés")
                    }
                }
                // Importable first; Spotify hides the tracks of playlists you only follow.
                ForEach(playlists.playlists.sorted { $0.importable && !$1.importable }) { playlist in
                    row(image: playlist.image, liked: false, title: playlist.name,
                        subtitle: playlist.importable ? "\(playlist.owner) • \(titles(playlist.total))"
                                                      : "\(playlist.owner) • Spotify ne donne accès qu'à vos propres playlists") {
                        if let imported = playlist.importedPlaylistId {
                            NavigationLink(value: Route.playlist(imported)) { Text("Voir").font(.footnote.bold()) }
                                .fixedSize()
                        }
                        if playlist.importable {
                            importButton(playlist.importedPlaylistId == nil ? "Importer" : "Réimporter",
                                         outlined: playlist.importedPlaylistId != nil, key: playlist.id, disabled: playlist.total == 0) {
                                try await $0.importFromSpotify(playlistId: playlist.id, name: playlist.name)
                            }
                        }
                    }
                    .opacity(playlist.importable ? 1 : 0.5)
                }
            } else {
                Text("Chargement de vos playlists Spotify…").foregroundStyle(Theme.subdued)
            }
        } header: {
            HStack {
                Text("Vos playlists Spotify")
                Spacer()
                Button("Déconnecter \(account.displayName ?? account.spotifyUserId)") {
                    Task {
                        try? await session.requireAPI().disconnectSpotify()
                        await loadStatus()
                    }
                }
                .font(.caption)
                .textCase(nil)
            }
        }
    }

    @ViewBuilder private var importsSection: some View {
        if !imports.isEmpty {
            Section("Imports") {
                ForEach(imports) { ImportRow(item: $0) }
            }
        }
    }

    @ViewBuilder private func setupHelp(_ status: SpotifyStatus) -> some View {
        if isAdmin {
            VStack(alignment: .leading, spacing: 8) {
                Text("L'import Spotify demande une application développeur Spotify :")
                Text("1. Sur developer.spotify.com/dashboard, créez une application (le compte qui la crée doit être Premium) avec l'API « Web API ».")
                Text("2. Ajoutez l'URI de redirection \(status.redirectUri ?? "http://127.0.0.1:8080/api/spotify/callback"). En HTTP, Spotify exige 127.0.0.1 et refuse localhost.")
                Text("3. Dans « User Management », ajoutez l'email Spotify de chaque personne qui importera ses playlists (5 au maximum en mode développement).")
                Text("4. Renseignez SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET et SPOTIFY_REDIRECT_URI dans .env, puis redémarrez l'API.")
            }
            .font(.subheadline)
            .textSelection(.enabled)
        } else {
            Text("L'import Spotify n'est pas encore configuré. Demandez à un administrateur de l'activer.").foregroundStyle(Theme.subdued)
        }
    }

    private func row<Trailing: View>(image: URL?, liked: Bool, title: String, subtitle: String,
                                     @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            Group {
                if liked { LikedCover() } else { RemoteImage(url: image) }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(1)
                Text(subtitle).font(.caption).foregroundStyle(Theme.subdued).lineLimit(2)
            }
            Spacer(minLength: 8)
            trailing()
        }
    }

    private func importButton(_ title: String, outlined: Bool, key: String, disabled: Bool,
                              start: @escaping (APIClient) async throws -> Void) -> some View {
        Button {
            busy = key
            Task {
                defer { busy = nil }
                do {
                    try await start(try session.requireAPI())
                    importsVersion += 1
                    await library.refresh()
                    playlists = try? await session.requireAPI().spotifyPlaylists()
                } catch {
                    self.error = (error as? APIError)?.message ?? "Serveur injoignable"
                }
            }
        } label: {
            Text(title)
                .font(.footnote.bold())
                .foregroundStyle(outlined ? .white : .black)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(outlined ? AnyShapeStyle(.clear) : AnyShapeStyle(Theme.green), in: Capsule())
                .overlay(Capsule().stroke(outlined ? Theme.subdued : .clear))
        }
        .buttonStyle(.borderless)
        .disabled(busy != nil || disabled)
    }

    // MARK: - Loading

    // The API answers 409 when the Spotify connection is missing or expired.
    private static let notConnected = 409

    private func loadStatus() async {
        do {
            let api = try session.requireAPI()
            status = try await api.spotifyStatus()
            error = nil
            guard status?.account != nil else { return }
            do {
                playlists = try await api.spotifyPlaylists()
            } catch let apiError as APIError where apiError.status == Self.notConnected {
                // Connection revoked or expired: back to the "Connecter Spotify" button.
                error = apiError.message
                status = try await api.spotifyStatus()
            }
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }

    /// Every 2 s while an import analyses, every 10 s while it waits for downloads.
    private func pollImports() async {
        var lastMatched: Int?
        while !Task.isCancelled {
            guard let found = try? await session.requireAPI().spotifyImports() else { return }
            imports = found
            // Tracks landed in a playlist or the liked tracks: the library follows.
            let matched = found.reduce(0) { $0 + $1.counts.matched }
            if let lastMatched, matched != lastMatched { await library.refresh() }
            lastMatched = matched
            let active = found.contains { $0.status == "running" }
            let waiting = found.contains { $0.status == "waiting" }
            guard active || waiting else { return }
            try? await Task.sleep(for: .seconds(active ? 2 : 10))
        }
    }

    private func connect() {
        busy = "connect"
        Task {
            defer { busy = nil }
            do {
                authorizeURL = try await session.requireAPI().spotifyAuthorizeURL()
            } catch {
                self.error = (error as? APIError)?.message ?? "Serveur injoignable"
            }
        }
    }

    private func titles(_ count: Int) -> String {
        "\(count.formatted()) titre\(count > 1 ? "s" : "")"
    }
}

/// An import: its status, how many tracks are in the library, and the missing ones on demand.
private struct ImportRow: View {
    let item: SpotifyImport
    @Environment(Session.self) private var session
    @State private var missing: [MissingTrack]?
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if let target = item.liked ? Route.liked : item.playlistId.map(Route.playlist) {
                        NavigationLink(value: target) { Text(item.name).font(.headline) }
                    } else {
                        Text(item.name + (item.liked ? "" : " (playlist supprimée)")).font(.headline)
                    }
                    HStack(spacing: 4) {
                        if item.status == "running" || item.status == "waiting" { ProgressView().controlSize(.mini) }
                        Text("\(label) • \(item.createdAt.formatted(.relative(presentation: .named)))")
                            .font(.caption)
                            .foregroundStyle(item.status == "failed" ? Theme.error : Theme.subdued)
                    }
                }
                Spacer()
                if item.counts.queued + item.counts.not_found > 0 {
                    Button(open ? "Masquer" : "Titres manquants") { open.toggle() }
                        .font(.caption.bold())
                        .buttonStyle(.borderless)
                }
            }
            ProgressView(value: Double(item.counts.matched), total: Double(max(item.total, 1))).tint(Theme.green)
            Text(numbers).font(.caption).foregroundStyle(Theme.subdued)
            if open {
                ForEach(missing ?? []) { track in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(track.title).font(.subheadline)
                            Text([track.artist, track.album].compactMap { $0 }.joined(separator: " • "))
                                .font(.caption)
                                .foregroundStyle(Theme.subdued)
                        }
                        Spacer()
                        Text(track.status == "queued" ? "En téléchargement" : "Introuvable")
                            .font(.caption)
                            .foregroundStyle(track.status == "queued" ? Theme.green : Theme.error)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .task(id: open) {
            if open { missing = (try? await session.requireAPI().missingTracks(importId: item.id)) ?? [] }
        }
    }

    private var label: String {
        switch item.status {
        case "running": "Analyse en cours…"
        case "waiting": "Téléchargement des titres manquants…"
        case "failed": "Échec : \(item.error ?? "erreur inconnue")"
        default: "Terminé"
        }
    }

    private var numbers: String {
        let c = item.counts
        var text = "\(c.matched.formatted()) / \(item.total.formatted()) titres dans la bibliothèque"
        if item.status == "running" && item.total > 0 { text += " • \((item.total - c.pending).formatted()) analysés" }
        var missing: [String] = []
        if c.queued > 0 { missing.append("\(c.queued.formatted()) en téléchargement") }
        if c.not_found > 0 { missing.append("\(c.not_found.formatted()) introuvables") }
        return missing.isEmpty ? text : text + "\n" + missing.joined(separator: " • ")
    }
}

/// Safari inside the app, for Spotify's consent page.
private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
