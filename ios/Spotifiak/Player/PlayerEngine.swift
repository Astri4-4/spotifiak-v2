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
    /// Playback speed (episodes); 1 for music.
    func setRate(_ rate: Float)
    var position: Double { get }
    var duration: Double? { get }
    var onItemEnded: (() -> Void)? { get set }
    var onFailed: ((Error) -> Void)? { get set }
}

/// Drives the audio output from the queue. The queue survives relaunches (restored paused).
/// In a Jam (see JamSession) the server's queue replaces the local one: controls become
/// commands, and the output follows the shared state.
@MainActor @Observable
final class PlayerEngine {
    private(set) var queue = QueueModel()
    private(set) var isPlaying = false
    private(set) var position: Double = 0
    private(set) var duration: Double?
    private(set) var toast: String?
    /// The Jam this account is in; set by JamSession.
    private(set) var jam: JamState?
    /// Sends a command to the Jam; set by JamSession.
    var jamCommand: ((JamCommand) -> Void)?

    /// Speed of episodes, kept across launches; music always plays at 1×.
    private(set) var episodeRate: Float
    static let episodeRates: [Float] = [0.8, 1, 1.2, 1.5, 1.8, 2]

    /// What plays: the Jam's current track, or the local queue's.
    var current: Track? { jam.map { $0.current?.track } ?? queue.current }

    private let output: AudioOutput
    private let api: () -> APIClient?
    private let defaults: UserDefaults
    /// The restored current track isn't loaded until the user presses play.
    private var needsLoad = false
    private var failures = 0
    private var resumeAfterInterruption = false
    private var lastSave = Date.distantPast
    private var unsaved = false
    private var toastTask: Task<Void, Never>?
    private var jamReceivedAt = Date()
    /// The Jam entry loaded in the output (the same track can be queued twice).
    private var jamEntryId: String?
    private var lastProgressSave: Double = 0
    /// Bumped for each track loaded; the load last reported as a listen (friend activity).
    private var loadCount = 0
    private var recordedLoad = -1

    private static let queueKey = "playerQueue"
    private static let rateKey = "episodeRate"

    init(output: AudioOutput, api: @escaping () -> APIClient?, defaults: UserDefaults) {
        self.output = output
        self.api = api
        self.defaults = defaults
        let savedRate = defaults.float(forKey: Self.rateKey)
        episodeRate = Self.episodeRates.contains(savedRate) ? savedRate : 1
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
        if jam != nil {
            guard !tracks.contains(where: { $0.episode != nil }) else { return showToast("Les podcasts ne se lisent pas dans une Jam") }
            // A Jam has no shuffle mode: it gets the tracks already shuffled, the chosen one first.
            let ordered = shuffle ? [tracks[index]] + tracks.enumerated().filter { $0.offset != index }.map(\.element).shuffled() : tracks
            jamCommand?(.playTracks(trackIds: ordered.map(\.id), index: shuffle ? 0 : index))
            return
        }
        saveEpisodeProgress()
        queue.play(tracks, startAt: index, shuffle: shuffle)
        failures = 0
        startCurrent()
    }

    func add(_ tracks: [Track]) {
        if jam != nil {
            let music = tracks.filter { $0.episode == nil }
            if !music.isEmpty { jamCommand?(.add(trackIds: music.map(\.id))) }
            return
        }
        let wasEmpty = queue.current == nil
        queue.add(tracks)
        if wasEmpty { startCurrent() } else { queueChanged() }
    }

    func play() {
        if jam != nil { jamCommand?(.play(position: output.position)); return }
        guard queue.current != nil else { return }
        if needsLoad { loadCurrent() }
        output.play()
        isPlaying = true
        recordListen()
    }

    func pause() {
        if jam != nil { jamCommand?(.pause(position: output.position)); return }
        pauseHere()
    }

    /// Pauses this device only (headphones unplugged, a call), even in a Jam.
    func pauseHere() {
        output.pause()
        isPlaying = false
        saveEpisodeProgress()
    }

    /// A call, Siri, an alarm… Resume afterwards only if music was playing.
    func interruptionBegan() {
        resumeAfterInterruption = isPlaying
        pauseHere()
    }

    func interruptionEnded(shouldResume: Bool) {
        if shouldResume && resumeAfterInterruption {
            if jam != nil { syncToJam(force: true) } else { play() }
        }
        resumeAfterInterruption = false
    }

    func togglePlay() {
        isPlaying ? pause() : play()
    }

    func next() {
        if jam != nil { jamCommand?(.next); return }
        saveEpisodeProgress()
        failures = 0
        handle(queue.next(auto: false))
    }

    func previous() {
        if jam != nil { jamCommand?(.prev); return }
        failures = 0
        handle(queue.previous(position: output.position))
    }

    func seek(to seconds: Double) {
        if jam != nil { jamCommand?(.seek(position: seconds)); return }
        output.seek(to: seconds)
        position = seconds
    }

    /// Episodes: the next speed (0.8× … 2×, then back).
    func cycleEpisodeRate() {
        let index = Self.episodeRates.firstIndex(of: episodeRate) ?? 1
        episodeRate = Self.episodeRates[(index + 1) % Self.episodeRates.count]
        defaults.set(episodeRate, forKey: Self.rateKey)
        if current?.episode != nil { output.setRate(episodeRate) }
    }

    /// Episodes: back or forward by `seconds`.
    func skip(by seconds: Double) {
        seek(to: min(max(0, output.position + seconds), duration ?? .infinity))
    }

    // MARK: - Jam

    /// Follows a new Jam state (nil: out of the Jam).
    func applyJam(_ state: JamState?) {
        let wasInJam = jam != nil
        jam = state
        jamReceivedAt = Date()
        guard let state else {
            guard wasInJam else { return }
            // Back to the local queue, paused; it loads again on play.
            output.pause()
            isPlaying = false
            jamEntryId = nil
            needsLoad = queue.current != nil
            position = 0
            duration = queue.current?.durationSec
            return
        }
        guard let entry = state.current, let api = api() else {
            output.pause()
            isPlaying = false
            jamEntryId = nil
            return
        }
        if entry.id != jamEntryId {
            // Starting a Jam with this track already playing here: keep it, don't restart it.
            let alreadyLoaded = !wasInJam && entry.track.id == queue.current?.id && !needsLoad
            jamEntryId = entry.id
            if !alreadyLoaded {
                output.pause()
                isPlaying = false
                loadCount += 1
                output.load(api.streamURL(for: entry.track), preload: state.upNext.first.map { api.streamURL(for: $0.track) })
                output.setRate(1)
                position = 0
                duration = entry.track.durationSec
            }
        }
        syncToJam(force: true)
    }

    /// Brings the output to the Jam's position (when more than a second off) and play state.
    private func syncToJam(force: Bool) {
        guard let jam, jamEntryId != nil else { return }
        let expected = jam.position + (jam.playing ? Date().timeIntervalSince(jamReceivedAt) : 0)
        if abs(output.position - expected) > 1 && (force || output.duration != nil) {
            output.seek(to: expected)
            position = expected
        }
        guard force else { return }
        if jam.playing && !isPlaying {
            output.play()
            isPlaying = true
            recordListen()
        } else if !jam.playing && isPlaying {
            output.pause()
            isPlaying = false
        }
    }

    /// The local queue as a Jam's start: the current track, then what was coming.
    func jamStart() -> JamStart {
        let tracks = ([queue.current].compactMap { $0 } + queue.upNext).filter { $0.episode == nil }
        let playingMusic = queue.current?.episode == nil
        return JamStart(trackIds: tracks.map(\.id), index: 0, position: playingMusic ? output.position : 0,
                        playing: isPlaying && playingMusic)
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
        recordListen()
        queueChanged()
    }

    private func loadCurrent() {
        guard let track = queue.current, let api = api() else { return }
        needsLoad = false
        loadCount += 1
        output.load(api.streamURL(for: track), preload: queue.upNext.first.map(api.streamURL))
        output.setRate(track.episode == nil ? 1 : episodeRate)
        position = 0
        duration = track.durationSec
        // Episodes resume where they were left.
        if let startAt = track.episode?.startAt, startAt > 0 {
            output.seek(to: startAt)
            position = startAt
        }
        lastProgressSave = position
    }

    /// Tells the server a track started playing here, once per load (friend activity; not episodes).
    private func recordListen() {
        guard recordedLoad != loadCount, let track = current, track.episode == nil, let api = api() else { return }
        recordedLoad = loadCount
        Task { try? await api.recordPlay(track.id) }
    }

    // Within this many seconds of the end an episode counts as heard (outros, ads), like the web app.
    private static let completedFromEnd: Double = 30

    /// Saves where the listener is in the current episode (no-op for music).
    private func saveEpisodeProgress(ended: Bool = false) {
        guard jam == nil, let track = queue.current, track.episode != nil, !needsLoad, let api = api() else { return }
        let at = ended ? 0 : output.position
        let length = duration ?? track.durationSec ?? 0
        let progress = EpisodeProgress(positionSec: at.rounded(.down),
                                       completed: ended || (length > 0 && length - at < Self.completedFromEnd))
        lastProgressSave = at
        Task { try? await api.saveProgress(episodeId: track.id, progress) }
    }

    private func itemEnded() {
        if jam != nil {
            if let jamEntryId { jamCommand?(.ended(entryId: jamEntryId)) }
            return
        }
        saveEpisodeProgress(ended: true)
        failures = 0
        handle(queue.next(auto: true))
    }

    private func failed() {
        if jam != nil { return showToast("Lecture impossible") }
        failures += 1
        if failures == 1 {
            // Streams bypass APIClient, so a 401 here would go unnoticed: ask the server.
            let api = api()
            Task { await api?.checkSession() }
        }
        if failures >= 3 {
            failures = 0
            pause()
            showToast("Lecture impossible")
        } else {
            showToast("Lecture impossible, titre suivant")
            handle(queue.next(auto: false))
        }
    }

    func showToast(_ text: String) {
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
            if jam?.playing == true { syncToJam(force: false) }
            // Podcasts: progress is saved every 15 s while playing.
            if abs(position - lastProgressSave) >= 15 { saveEpisodeProgress() }
        }
        if let outputDuration = output.duration { duration = outputDuration }
        if unsaved && Date().timeIntervalSince(lastSave) >= 2 { saveNow() }
    }
}
