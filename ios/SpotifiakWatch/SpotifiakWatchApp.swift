import SwiftUI

@main
struct SpotifiakWatchApp: App {
    @State private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            WatchRootView().environment(store)
        }
    }
}

/// The three pages, swiped vertically: what plays, the library, friends.
struct WatchRootView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        @Bindable var store = store
        TabView(selection: $store.page) {
            NowPlayingPage().tag(WatchStore.Page.nowPlaying)
            LibraryPage().tag(WatchStore.Page.library)
            FriendsPage().tag(WatchStore.Page.friends)
        }
        .tabViewStyle(.verticalPage)
        .tint(WatchTheme.green)
    }
}

enum WatchTheme {
    static let green = Color(red: 0x1e / 255, green: 0xd7 / 255, blue: 0x60 / 255)
}
