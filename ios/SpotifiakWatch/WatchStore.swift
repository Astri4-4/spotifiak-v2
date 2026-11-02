import Foundation
import Observation
import SpotifiakCore
import WatchConnectivity

/// The watch's side of the link with the iPhone: receives what plays there, sends commands
/// and requests (answered by the iPhone with its own session).
@MainActor @Observable
final class WatchStore: NSObject {
    enum Page: Hashable { case nowPlaying, library, friends }

    var page = Page.nowPlaying
    private(set) var nowPlaying: WatchNowPlaying?
    private(set) var library: [WatchItem]?
    private(set) var friends: WatchFriends?
    /// The last problem to show (iPhone unreachable, server error…); cleared on success.
    private(set) var error: String?

    private let session: WCSession? = WCSession.isSupported() ? .default : nil

    override init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    // MARK: - Commands (shown at once, then confirmed by the iPhone's next push)

    func send(_ command: WatchCommand) {
        switch command {
        case .togglePlay: nowPlaying?.isPlaying.toggle()
        case .toggleLike: nowPlaying?.liked?.toggle()
        case .toggleShuffle: nowPlaying?.shuffle.toggle()
        default: break
        }
        Task { _ = await request(.command(command)) }
    }

    func play(_ item: WatchItem) {
        page = .nowPlaying
        Task { _ = await request(.command(.play(item))) }
    }

    func loadLibrary() async {
        if case .library(let items) = await request(.library) { library = items }
    }

    func loadFriends() async {
        if case .friends(let friends) = await request(.friends) { self.friends = friends }
    }

    /// Asks the iPhone; nil (and `error` set) when it can't be reached or the request failed.
    private func request(_ request: WatchRequest) async -> WatchReply? {
        guard let session, session.activationState == .activated, session.isReachable else {
            error = "iPhone injoignable : gardez-le à proximité"
            return nil
        }
        guard let message = try? WatchMessage.pack(request) else { return nil }
        let reply: WatchReply? = await withCheckedContinuation { continuation in
            session.sendMessage(message, replyHandler: { answer in
                continuation.resume(returning: try? WatchMessage.unpack(WatchReply.self, from: answer))
            }, errorHandler: { _ in
                continuation.resume(returning: nil)
            })
        }
        switch reply {
        case .failed(let message): error = message
        case nil: error = "L'iPhone n'a pas répondu"
        default: error = nil
        }
        return reply
    }

    fileprivate func received(_ context: [String: Any]) {
        if let state = try? WatchMessage.unpack(WatchNowPlaying.self, from: context) { nowPlaying = state }
    }
}

extension WatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        // What played before the watch app opened.
        let context = session.receivedApplicationContext
        nonisolated(unsafe) let payload = context
        Task { @MainActor in self.received(payload) }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        nonisolated(unsafe) let payload = applicationContext
        Task { @MainActor in self.received(payload) }
    }
}
