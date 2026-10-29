import Foundation
import Observation
import SpotifiakCore

/// Plays URLs; AVQueuePlayerOutput in the app, a fake in tests.
@MainActor
protocol AudioOutput: AnyObject {
    /// Replaces what plays with `url`, buffering `next` behind it.
    func load(_ url: URL, preload next: URL?)
    func play()
    func pause()
    func seek(to seconds: Double)
    var position: Double { get }
    var duration: Double? { get }
    var onItemEnded: (() -> Void)? { get set }
    var onFailed: ((Error) -> Void)? { get set }
}

/// Drives the audio output from the queue. The queue survives relaunches (restored paused).
@MainActor @Observable
final class PlayerEngine {
    private(set) var queue = QueueModel()
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var duration: Double?
    private(set) var toast: String?

    private let output: AudioOutput
    private let api: () -> APIClient?
    private let defaults: UserDefaults
    /// The restored current track isn't loaded until the user presses play.
    private var needsLoad = false
    private var failures = 0
    private var lastSave = Date.distantPast
    private var unsaved = false
    private var toastTask: Task<Void, Never>?

    private static let queueKey = "playerQueue"

    init(output: AudioOutput, api: @escaping () -> APIClient?, defaults: UserDefaults) {
        self.output = output
        self.api = api
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.queueKey),
           let saved = try? JSONDecoder.spotifiak.decode(QueueModel.self, from: data) {
            queue = saved
            needsLoad = saved.current != nil
            duration = saved.current?.durationSec
        }
        output.onItemEnded = { [weak self] in self?.itemEnded() }
        output.onFailed = { [weak self] _ in self?.failed() }
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self else { return }
                self.tick()
            }
        }
    }

    // MARK: - Controls

    func play(_ tracks: [Track], startAt index: Int, shuffle: Bool = false) {
        queue.play(tracks, startAt: index, shuffle: shuffle)
        failures = 0
        startCurrent()
    }

    func add(_ tracks: [Track]) {
        let wasEmpty = queue.current == nil
        queue.add(tracks)
        if wasEmpty { startCurrent() } else { queueChanged() }
    }

    func play() {
        guard queue.current != nil else { return }
        if needsLoad { loadCurrent() }
        output.play()
        isPlaying = true
    }

    func pause() {
        output.pause()
        isPlaying = false
    }

    func togglePlay() {
        isPlaying ? pause() : play()
    }

    func next() {
        failures = 0
        handle(queue.next(auto: false))
    }

    func previous() {
        failures = 0
        handle(queue.previous(position: output.position))
    }

    func seek(to seconds: Double) {
        output.seek(to: seconds)
        position = seconds
    }

    func setShuffle(_ on: Bool) {
        queue.setShuffle(on)
        queueChanged()
    }

    func cycleRepeat() {
        switch queue.repeatMode {
        case .off: queue.repeatMode = .all
        case .all: queue.repeatMode = .one
        case .one: queue.repeatMode = .off
        }
        queueChanged()
    }

    func moveUpNext(from: Int, to: Int) {
        queue.moveUpNext(from: from, to: to)
        queueChanged()
    }

    func removeUpNext(at index: Int) {
        queue.removeUpNext(at: index)
        queueChanged()
    }

    /// Writes the queue now (the app calls this when going to the background).
    func saveNow() {
        guard let data = try? JSONEncoder.spotifiak.encode(queue) else { return }
        defaults.set(data, forKey: Self.queueKey)
        lastSave = Date()
        unsaved = false
    }

    // MARK: - Internals

    private func handle(_ advance: QueueModel.Advance) {
        switch advance {
        case .track:
            startCurrent()
        case .restart:
            seek(to: 0)
            if isPlaying { output.play() }
        case .stop:
            output.pause()
            seek(to: 0)
            isPlaying = false
            queueChanged()
        }
    }

    private func startCurrent() {
        guard queue.current != nil else { return }
        loadCurrent()
        output.play()
        isPlaying = true
        queueChanged()
    }

    private func loadCurrent() {
        guard let track = queue.current, let api = api() else { return }
        needsLoad = false
        output.load(api.streamURL(for: track), preload: queue.upNext.first.map(api.streamURL))
        position = 0
        duration = track.durationSec
    }

    private func itemEnded() {
        failures = 0
        handle(queue.next(auto: true))
    }

    private func failed() {
        failures += 1
        if failures >= 3 {
            failures = 0
            pause()
            showToast("Lecture impossible")
        } else {
            showToast("Lecture impossible, titre suivant")
            handle(queue.next(auto: false))
        }
    }

    private func showToast(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            guard (try? await Task.sleep(for: .seconds(3))) != nil else { return }
            self?.toast = nil
        }
    }

    private func queueChanged() {
        unsaved = true
        if Date().timeIntervalSince(lastSave) >= 2 { saveNow() }
    }

    private func tick() {
        if isPlaying {
            position = output.position
            if position > 0 { failures = 0 }
        }
        if let outputDuration = output.duration { duration = outputDuration }
        if unsaved && Date().timeIntervalSince(lastSave) >= 2 { saveNow() }
    }
}
