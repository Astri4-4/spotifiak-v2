import SwiftUI

/// Login until there is a user, then the tabs, each with its own navigation stack.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        if session.isRestoring {
            ProgressView()
        } else if case .loggedIn = session.state {
            TabView {
                tab("Accueil", systemImage: "house") { HomeView() }
                tab("Rechercher", systemImage: "magnifyingglass") { SearchView() }
                tab("Bibliothèque", systemImage: "books.vertical") {
                    ContentUnavailableView("Bientôt disponible", systemImage: "books.vertical")
                        .navigationTitle("Bibliothèque")
                        .toolbar {
                            Button("Se déconnecter") { Task { await session.logout() } }
                        }
                }
            }
            .toast(player.toast)
        } else {
            LoginView()
        }
    }

    private func tab<Content: View>(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content().navigationDestination(for: Route.self) { route in
                switch route {
                case .album(let id): AlbumView(id: id)
                case .artist(let id): ArtistView(id: id)
                }
            }
        }
        .safeAreaInset(edge: .bottom) { MiniPlayer() }
        .tabItem { Label(title, systemImage: systemImage) }
    }
}
