import SwiftUI

@main
struct SpotifiakApp: App {
    @State private var session: Session
    @State private var player: PlayerEngine
    @State private var library: LibraryStore
    @State private var jam: JamSession
    @State private var social: SocialStore
    private let nowPlaying: NowPlaying
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let session = Session()
        let player = PlayerEngine(output: AVQueuePlayerOutput(), api: { session.api }, defaults: .standard)
        _session = State(initialValue: session)
        _player = State(initialValue: player)
        _library = State(initialValue: LibraryStore(api: { session.api }, toast: { player.showToast($0) }))
        _jam = State(initialValue: JamSession(player: player, api: { session.api }))
        _social = State(initialValue: SocialStore(api: { session.api }))
        nowPlaying = NowPlaying(engine: player, api: { session.api })
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(player)
                .environment(library)
                .environment(jam)
                .environment(social)
                .preferredColorScheme(.dark)
                .tint(Theme.green)
                .task { await session.restore() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { player.saveNow() }
        }
    }
}
