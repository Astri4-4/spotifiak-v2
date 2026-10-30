import SpotifiakCore
import SwiftUI

/// Loads a value, then shows it; a spinner meanwhile, "Serveur injoignable" with a retry on failure.
struct Loadable<Value: Sendable, Content: View>: View {
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var error: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let error {
                ContentUnavailableView {
                    Label(error, systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { Task { await run() } }
                }
            } else {
                ProgressView()
            }
        }
        .task { await run() }
        .refreshable { await run() }
    }

    private func run() async {
        do {
            value = try await load()
            error = nil
        } catch is CancellationError {
        } catch let apiError as APIError where apiError.status != 0 {
            error = apiError.message
        } catch {
            self.error = "Serveur injoignable"
        }
    }
}

extension Session {
    /// The API, or a "not connected" error for loaders.
    func requireAPI() throws -> APIClient {
        guard let api else { throw APIError(message: "Serveur injoignable", status: 0) }
        return api
    }
}

/// Destinations pushed on each tab's NavigationStack.
enum Route: Hashable {
    case album(String)
    case artist(String)
    case playlist(String)
    case liked
    case podcast(String)
    /// A podcast from the directory the server may not know yet.
    case podcastFeed(String)
    case account
    case spotifyImport
    case scan
    case users
    case inbox
    case person(String)
}

extension EnvironmentValues {
    /// Pushes a page on the current tab's stack (for pages opened after an action).
    @Entry var navigate: (Route) -> Void = { _ in }
}

/// The page of each route.
struct RouteView: View {
    let route: Route

    var body: some View {
        Group {
            switch route {
            case .album(let id): AlbumView(id: id)
            case .artist(let id): ArtistView(id: id)
            case .playlist(let id): PlaylistView(id: id)
            case .liked: LikedView()
            case .podcast(let id): PodcastView(id: id)
            case .podcastFeed(let feedUrl): OpenPodcastView(feedUrl: feedUrl)
            case .account: AccountView()
            case .spotifyImport: SpotifyImportView()
            case .scan: ScanView()
            case .users: UsersView()
            case .inbox: InboxView()
            case .person(let id): ProfileView(id: id)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.base)
    }
}
