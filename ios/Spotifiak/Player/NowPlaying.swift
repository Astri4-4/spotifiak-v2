import AVFoundation
import MediaPlayer
import SpotifiakCore
import UIKit

/// The system side of playback: audio session, lock screen info and remote commands.
@MainActor
final class NowPlaying {
    private let engine: PlayerEngine
    private let api: () -> APIClient?
    private var artwork: (trackId: String, image: MPMediaItemArtwork)?
    private var artworkTrackId: String?
    private var observers: [NSObjectProtocol] = []

    init(engine: PlayerEngine, api: @escaping () -> APIClient?) {
        self.engine = engine
        self.api = api
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        observeAudioSession()
        Self.registerCommands(engine)
        track()
    }

    private func observeAudioSession() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [engine] note in
            let info = note.userInfo
            let type = (info?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            let options = AVAudioSession.InterruptionOptions(rawValue: info?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            MainActor.assumeIsolated {
                switch type {
                case .began: engine.interruptionBegan()
                case .ended: engine.interruptionEnded(shouldResume: options.contains(.shouldResume))
                default: break
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [engine] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
            MainActor.assumeIsolated {
                if reason == .oldDeviceUnavailable { engine.pause() }
            }
        })
    }

    /// Nonisolated so the handlers aren't main-actor closures: MediaPlayer may call them from any thread.
    private nonisolated static func registerCommands(_ engine: PlayerEngine) {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { _ in Task { @MainActor in engine.play() }; return .success }
        commands.pauseCommand.addTarget { _ in Task { @MainActor in engine.pause() }; return .success }
        commands.togglePlayPauseCommand.addTarget { _ in Task { @MainActor in engine.togglePlay() }; return .success }
        commands.nextTrackCommand.addTarget { _ in Task { @MainActor in engine.next() }; return .success }
        commands.previousTrackCommand.addTarget { _ in Task { @MainActor in engine.previous() }; return .success }
        commands.changePlaybackPositionCommand.addTarget { event in
            guard let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else { return .commandFailed }
            Task { @MainActor in engine.seek(to: position) }
            return .success
        }
    }

    /// Re-renders the lock screen info whenever what it shows changes.
    private func track() {
        withObservationTracking {
            update()
        } onChange: { [weak self] in
            Task { @MainActor in self?.track() }
        }
    }

    private func update() {
        let center = MPNowPlayingInfoCenter.default()
        guard let track = engine.queue.current else {
            center.nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artistName,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: engine.position,
            MPNowPlayingInfoPropertyPlaybackRate: engine.isPlaying ? 1.0 : 0.0,
        ]
        if let album = track.album?.title { info[MPMediaItemPropertyAlbumTitle] = album }
        if let duration = engine.duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork, artwork.trackId == track.id {
            info[MPMediaItemPropertyArtwork] = artwork.image
        } else {
            loadArtwork(for: track)
        }
        center.nowPlayingInfo = info
    }

    /// Downloads the cover once per track.
    private func loadArtwork(for track: Track) {
        guard artworkTrackId != track.id, let url = api()?.coverURL(track: track) else { return }
        artworkTrackId = track.id
        Task {
            guard let (data, _) = try? await URLSession.shared.data(from: url), let image = UIImage(data: data),
                  artworkTrackId == track.id else { return }
            artwork = (track.id, Self.artwork(image))
            update()
        }
    }

    /// Nonisolated: MediaPlayer calls the request handler off the main thread.
    private nonisolated static func artwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
