import SwiftUI

/// Login until there is a user, then the tabs.
struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isRestoring {
            ProgressView()
        } else if case .loggedIn = session.state {
            TabView {
                placeholder("Accueil", systemImage: "house")
                placeholder("Rechercher", systemImage: "magnifyingglass")
                placeholder("Bibliothèque", systemImage: "books.vertical")
            }
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
        .tabItem { Label(title, systemImage: systemImage) }
    }
}
