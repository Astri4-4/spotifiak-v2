import AVFoundation

/// AudioOutput on AVQueuePlayer: the next track is buffered behind the current one,
/// and the player pauses at each item's end so the engine decides what comes next.
@MainActor
final class AVQueuePlayerOutput: AudioOutput {
    var onItemEnded: (() -> Void)?
    var onFailed: ((Error) -> Void)?

    private let player = AVQueuePlayer()
    private var statusObservation: NSKeyValueObservation?
    /// The item the engine last asked for; failures of any other item are stale.
    private var expectedItem: ObjectIdentifier?
    private var observers: [NSObjectProtocol] = []

    init() {
        player.actionAtItemEnd = .pause
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let item = (note.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated {
                guard let self, item == self.expectedItem else { return }
                self.onItemEnded?()
            }
        })
        observers.append(center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let item = (note.object as AnyObject?).map(ObjectIdentifier.init)
            let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error ?? URLError(.unknown)
            MainActor.assumeIsolated {
                guard let self, item == self.expectedItem else { return }
                self.onFailed?(error)
            }
        })
    }

    private var currentItemID: ObjectIdentifier? {
        player.currentItem.map(ObjectIdentifier.init)
    }

    var position: Double {
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? seconds : 0
    }

    var duration: Double? {
        guard let seconds = player.currentItem?.duration.seconds, seconds.isFinite else { return nil }
        return seconds
    }

    func load(_ url: URL, preload next: URL?) {
        let items = player.items()
        if items.count > 1, (items[1].asset as? AVURLAsset)?.url == url {
            // Already buffered as the next item.
            player.advanceToNextItem()
        } else {
            player.removeAllItems()
            player.insert(Self.item(url), after: nil)
        }
        for stale in player.items().dropFirst() { player.remove(stale) }
        if let next { player.insert(Self.item(next), after: nil) }
        expectedItem = currentItemID
        observeStatus()
    }

    func play() {
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
    }

    func pause() {
        player.pause()
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }

    /// The API session is a cookie; hand it to AVFoundation's own loader.
    private static func item(_ url: URL) -> AVPlayerItem {
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        return AVPlayerItem(asset: AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies]))
    }

    private func observeStatus() {
        statusObservation = player.currentItem.map {
            Self.observeFailure(of: $0) { [weak self] id, error in
                Task { @MainActor in
                        guard let self, id == self.expectedItem else { return }
                    self.onFailed?(error)
                }
            }
        }
    }

    /// Nonisolated: KVO calls the handler on whatever thread changed the status.
    private nonisolated static func observeFailure(
        of item: AVPlayerItem, report: @escaping @Sendable (ObjectIdentifier, Error) -> Void
    ) -> NSKeyValueObservation {
        // .initial: a preloaded item may have failed before it became current.
        item.observe(\.status, options: [.initial, .new]) { item, _ in
            guard item.status == .failed else { return }
            report(ObjectIdentifier(item), item.error ?? URLError(.unknown))
        }
    }
}
