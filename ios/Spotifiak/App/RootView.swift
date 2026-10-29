import SwiftUI

/// Login until there is a user, then the tabs.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        if session.isRestoring {
            ProgressView()
        } else if case .loggedIn = session.state {
            TabView {
                placeholder("Accueil", systemImage: "house")
                placeholder("Rechercher", systemImage: "magnifyingglass")
                placeholder("Bibliothèque", systemImage: "books.vertical")
            }
            .overlay(alignment: .top) {
                if let toast = player.toast {
                    Text(toast)
                        .font(.subheadline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.default, value: player.toast)
        } else {
            LoginView()
        }
    }

    private func placeholder(_ title: String, systemImage: String) -> some View {
        NavigationStack {
            Text(title)
                .navigationTitle(title)
                .toolbar {
                    Button("Se déconnecter") { Task { await session.logout() } }
                }
        }
        .safeAreaInset(edge: .bottom) { MiniPlayer() }
        .tabItem { Label(title, systemImage: systemImage) }
    }
}
