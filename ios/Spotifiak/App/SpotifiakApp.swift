import SwiftUI

@main
struct SpotifiakApp: App {
    @State private var session: Session
    @State private var player: PlayerEngine
    private let nowPlaying: NowPlaying
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let session = Session()
        let player = PlayerEngine(output: AVQueuePlayerOutput(), api: { session.api }, defaults: .standard)
        _session = State(initialValue: session)
        _player = State(initialValue: player)
        nowPlaying = NowPlaying(engine: player, api: { session.api })
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(player)
                .task { await session.restore() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { player.saveNow() }
        }
    }
}
