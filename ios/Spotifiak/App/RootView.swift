import SpotifiakCore
import SwiftUI

/// Login until there is a user, then the tabs, each with its own navigation stack.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(JamSession.self) private var jam
    @Environment(SocialStore.self) private var social
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        if session.isRestoring {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
        } else if case .loggedIn(let user) = session.state {
            TabView {
                tab("Accueil", systemImage: "house.fill") { HomeView() }
                tab("Rechercher", systemImage: "magnifyingglass") { SearchView() }
                tab("Bibliothèque", systemImage: "books.vertical.fill") { LibraryView(user: user) }
                tab("Amis", systemImage: "person.2.fill") { FriendsView() }
                    .badge(social.badge)
            }
            .toast(player.toast)
            .task(id: user.id) {
                await library.load()
                await jam.restore()
            }
            // The badge, while the app is in front.
            .task(id: "\(user.id)-\(scenePhase == .active)") {
                if scenePhase == .active { await social.poll() }
            }
        } else {
            LoginView()
                .onAppear {
                    library.reset()
                    jam.reset()
                    social.reset()
                }
        }
    }

    private func tab<Content: View>(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        TabStack(content: content())
            .safeAreaInset(edge: .bottom) { MiniPlayer() }
            .toolbarBackground(Color.black.opacity(0.95), for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .tabItem { Label(title, systemImage: systemImage) }
    }
}

/// A tab's navigation stack, whose path pages can push to (`\.navigate`).
private struct TabStack<Content: View>: View {
    let content: Content
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.base)
                .toolbarBackground(Theme.base, for: .navigationBar)
                .navigationDestination(for: Route.self) { RouteView(route: $0) }
        }
        .environment(\.navigate) { path.append($0) }
    }
}
