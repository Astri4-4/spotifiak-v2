import SwiftUI

@main
struct SpotifiakApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session: Session
    @State private var player: PlayerEngine
    @State private var library: LibraryStore
    @State private var offline: OfflineStore
    @State private var jam: JamSession
    @State private var social: SocialStore
    @State private var push = PushNotifications.shared
    private let nowPlaying: NowPlaying
    private let watch: WatchBridge
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let session = Session()
        let offline = OfflineStore(api: { session.api })
        _offline = State(initialValue: offline)
        let player = PlayerEngine(output: AVQueuePlayerOutput(), api: { session.api }, defaults: .standard,
                                  localURL: { offline.localURL(for: $0) })
        _session = State(initialValue: session)
        _player = State(initialValue: player)
        let library = LibraryStore(api: { session.api }, toast: { player.showToast($0) })
        _library = State(initialValue: library)
        _jam = State(initialValue: JamSession(player: player, api: { session.api }))
        _social = State(initialValue: SocialStore(api: { session.api }))
        PushNotifications.shared.api = { session.api }
        nowPlaying = NowPlaying(engine: player, api: { session.api })
        watch = WatchBridge(player: player, library: library, api: { session.api })
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(player)
                .environment(library)
                .environment(offline)
                .environment(jam)
                .environment(social)
                .environment(push)
                .preferredColorScheme(.dark)
                .tint(Theme.green)
                .task { await session.restore() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { player.saveNow() }
        }
    }
}
