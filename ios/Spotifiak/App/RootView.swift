import SpotifiakCore
import SwiftUI

/// Login until there is a user, then the tabs, each with its own navigation stack.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(OfflineStore.self) private var offline
    @Environment(JamSession.self) private var jam
    @Environment(SocialStore.self) private var social
    @Environment(PushNotifications.self) private var push
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = AppTab.home
    /// A page a tapped notification opens, until its tab's stack takes it.
    @State private var pending: PendingRoute?

    var body: some View {
        if session.isRestoring {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
        } else if case .loggedIn(let user) = session.state {
            TabView(selection: $selectedTab) {
                tab(.home, "Accueil", systemImage: "house.fill") { HomeView() }
                tab(.search, "Rechercher", systemImage: "magnifyingglass") { SearchView() }
                tab(.library, "Bibliothèque", systemImage: "books.vertical.fill") { LibraryView(user: user) }
                tab(.friends, "Amis", systemImage: "person.2.fill") { FriendsView() }
                    .badge(social.badge)
            }
            .toast(player.toast)
            .task(id: user.id) {
                await library.load()
                await jam.restore()
                await push.start()
            }
            // A tapped notification, also one that launched the app.
            .onChange(of: push.opened, initial: true) { _, link in
                guard let link else { return }
                push.opened = nil
                let route = PendingRoute(link)
                selectedTab = route.tab
                pending = route
            }
            .onChange(of: push.received) { Task { await social.refreshCounts() } }
            .onChange(of: social.badge, initial: true) { _, badge in push.setBadge(badge) }
            // The badge, while the app is in front.
            .task(id: "\(user.id)-\(scenePhase == .active)") {
                // Downloads follow their collections' changes each time the app comes back.
                if scenePhase == .active { offline.sync() }
                if scenePhase == .active { await social.poll() }
            }
        } else {
            LoginView()
                .onAppear {
                    library.reset()
                    jam.reset()
                    social.reset()
                    push.setBadge(0)
                }
        }
    }

    private func tab<Content: View>(_ id: AppTab, _ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        TabStack(tab: id, pending: $pending, content: content())
            .safeAreaInset(edge: .bottom) { MiniPlayer() }
            .toolbarBackground(Color.black.opacity(0.95), for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .tabItem { Label(title, systemImage: systemImage) }
            .tag(id)
    }
}

enum AppTab: Hashable {
    case home, search, library, friends
}

/// Where a notification's link leads: a tab, and a page on it.
struct PendingRoute: Equatable {
    let tab: AppTab
    let route: Route?

    init(_ link: PushLink) {
        switch link {
        case .inbox:
            tab = .friends
            route = .inbox
        case .friends:
            tab = .friends
            route = nil
        case .person(let id):
            tab = .friends
            route = .person(id)
        case .podcast(let id):
            tab = .library
            route = .podcast(id)
        case .downloads:
            tab = .search
            route = .downloads
        case .album(let id):
            tab = .library
            route = .album(id)
        }
    }
}

/// A tab's navigation stack, whose path pages can push to (`\.navigate`).
private struct TabStack<Content: View>: View {
    let tab: AppTab
    @Binding var pending: PendingRoute?
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
        .environment(\.canNavigate, true)
        .onChange(of: pending, initial: true) { _, pending in
            guard let pending, pending.tab == tab else { return }
            self.pending = nil
            path = NavigationPath()
            if let route = pending.route { path.append(route) }
        }
    }
}
