import Foundation
import SpotifiakCore
import Testing
@testable import Spotifiak

/// Records what the engine asks of the audio output.
@MainActor
final class FakeAudioOutput: AudioOutput {
    var loads: [(url: URL, next: URL?)] = []
    var plays = 0
    var pauses = 0
    var seeks: [Double] = []
    var position: Double = 0
    var duration: Double?
    var onItemEnded: (() -> Void)?
    var onFailed: ((Error) -> Void)?

    func load(_ url: URL, preload next: URL?) { loads.append((url, next)) }
    func play() { plays += 1 }
    func pause() { pauses += 1 }
    func seek(to seconds: Double) { seeks.append(seconds) }
    var rate: Float = 1
    func setRate(_ rate: Float) { self.rate = rate }
}

private let transport = FakeTransport()
private let api = APIClient(base: URL(string: "https://h/api")!, transport: transport) {}
private let tracks = (0..<5).map { Track(id: String($0), title: "Track \($0)", artistName: "A", artistId: "a") }

@MainActor
private func makeEngine(defaults: UserDefaults? = nil) -> (PlayerEngine, FakeAudioOutput) {
    let output = FakeAudioOutput()
    let defaults = defaults ?? UserDefaults(suiteName: "PlayerEngineTests-\(UUID().uuidString)")!
    return (PlayerEngine(output: output, api: { api }, defaults: defaults), output)
}

@MainActor @Test func playLoadsTheTrackAndPreloadsTheNext() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 1)
    #expect(output.loads.count == 1)
    #expect(output.loads.last?.url == api.streamURL(for: tracks[1]))
    #expect(output.loads.last?.next == api.streamURL(for: tracks[2]))
    #expect(output.plays == 1)
    #expect(engine.isPlaying)
    #expect(engine.queue.current == tracks[1])
}

@MainActor @Test func repeatOneRestartsTheTrackAtItsEnd() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    engine.cycleRepeat()
    engine.cycleRepeat()
    #expect(engine.queue.repeatMode == .one)
    output.onItemEnded?()
    #expect(output.seeks == [0])
    #expect(output.loads.count == 1)
    #expect(engine.isPlaying)
}

@MainActor @Test func itemEndPlaysTheNextTrackAndStopsAtTheEnd() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 3)
    output.onItemEnded?()
    #expect(output.loads.last?.url == api.streamURL(for: tracks[4]))
    #expect(output.loads.last?.next == nil)
    output.onItemEnded?()
    #expect(!engine.isPlaying)
    #expect(output.seeks == [0])
    #expect(engine.queue.current == tracks[4])
}

@MainActor @Test func previousRestartsAfterThreeSeconds() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 1)
    output.position = 5
    engine.previous()
    #expect(output.seeks == [0])
    #expect(output.loads.count == 1)
    output.position = 1
    engine.previous()
    #expect(output.loads.last?.url == api.streamURL(for: tracks[0]))
}

@MainActor @Test func threeFailuresInARowStopPlayback() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    output.onFailed?(URLError(.badServerResponse))
    #expect(engine.toast == "Lecture impossible, titre suivant")
    #expect(engine.queue.current == tracks[1])
    output.onFailed?(URLError(.badServerResponse))
    #expect(engine.queue.current == tracks[2])
    #expect(engine.isPlaying)
    output.onFailed?(URLError(.badServerResponse))
    #expect(engine.queue.current == tracks[2])
    #expect(!engine.isPlaying)
    #expect(engine.toast != nil)
}

@MainActor @Test func aSuccessResetsTheFailureCount() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    output.onFailed?(URLError(.badServerResponse))
    output.onFailed?(URLError(.badServerResponse))
    output.onItemEnded?()
    output.onFailed?(URLError(.badServerResponse))
    #expect(engine.queue.current == tracks[4])
    #expect(engine.isPlaying)
}

@MainActor @Test func theQueueIsRestoredPaused() {
    let defaults = UserDefaults(suiteName: "PlayerEngineTests-\(UUID().uuidString)")!
    let (engine, _) = makeEngine(defaults: defaults)
    engine.play(tracks, startAt: 2)
    engine.saveNow()

    let (restored, output) = makeEngine(defaults: defaults)
    #expect(restored.queue.current == tracks[2])
    #expect(!restored.isPlaying)
    #expect(output.loads.isEmpty)
    restored.togglePlay()
    #expect(output.loads.last?.url == api.streamURL(for: tracks[2]))
    #expect(restored.isPlaying)
}

@MainActor @Test func interruptionResumesOnlyWhatWasPlaying() {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    engine.interruptionBegan()
    #expect(!engine.isPlaying)
    engine.interruptionEnded(shouldResume: true)
    #expect(engine.isPlaying)

    engine.pause()
    let plays = output.plays
    engine.interruptionBegan()
    engine.interruptionEnded(shouldResume: true)
    #expect(!engine.isPlaying)
    #expect(output.plays == plays)
}

@MainActor @Test func aFailureChecksTheSession() async {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    output.onFailed?(URLError(.badServerResponse))
    for _ in 0..<100 where !transport.requests.contains(where: { $0.url?.path == "/api/auth/status" }) {
        await Task.yield()
    }
    #expect(transport.requests.contains { $0.url?.path == "/api/auth/status" })
}

// MARK: - Jam

/// A Jam state as the server sends it: tracks[0...] as entries e0, e1…, current at `index`.
private func jamState(index: Int, playing: Bool, position: Double = 0, count: Int = 3) throws -> JamState {
    let entries = (0..<count).map {
        #"{"id":"e\#($0)","track":{"id":"\#($0)","title":"Track \#($0)","artistName":"A","artistId":"a","album":null,"durationSec":200,"trackNumber":null,"discNumber":null,"addedAt":"2026-01-01T00:00:00Z","format":"mp3"},"addedBy":{"id":"u1","displayName":"Ana"}}"#
    }.joined(separator: ",")
    let json = #"{"id":"K7Q2XP","host":{"id":"u1","displayName":"Ana"},"participants":[{"id":"u1","displayName":"Ana"}],"queue":[\#(entries)],"index":\#(index),"fallback":[],"fallbackName":null,"playing":\#(playing),"position":\#(position)}"#
    return try JSONDecoder.spotifiak.decode(JamState.self, from: Data(json.utf8))
}

@MainActor @Test func aJamDrivesTheOutputAndControlsBecomeCommands() throws {
    let (engine, output) = makeEngine()
    var sent: [JamCommand] = []
    engine.jamCommand = { sent.append($0) }

    engine.applyJam(try jamState(index: 1, playing: true, position: 30))
    #expect(engine.current?.id == "1")
    #expect(output.loads.last?.url == api.streamURL(for: tracks[1]))
    #expect(abs((output.seeks.last ?? 0) - 30) < 0.5)
    #expect(engine.isPlaying)

    output.position = 30
    engine.pause()
    engine.next()
    engine.seek(to: 50)
    engine.play(tracks, startAt: 2)
    #expect(sent == [.pause(position: 30), .next, .seek(position: 50), .playTracks(trackIds: tracks.map(\.id), index: 2)])
    // Only the server moves the Jam: nothing changed here yet.
    #expect(engine.isPlaying)
    #expect(engine.queue.current == nil)

    output.onItemEnded?()
    #expect(sent.last == .ended(entryId: "e1"))

    // The server's answer: paused.
    engine.applyJam(try jamState(index: 1, playing: false, position: 30))
    #expect(!engine.isPlaying)
    #expect(output.loads.count == 1)
}

@MainActor @Test func leavingAJamGoesBackToTheLocalQueuePaused() throws {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 4)
    engine.applyJam(try jamState(index: 0, playing: true))
    #expect(engine.current?.id == "0")
    engine.applyJam(nil)
    #expect(engine.jam == nil)
    #expect(!engine.isPlaying)
    #expect(engine.current == tracks[4])
    engine.play()
    #expect(output.loads.last?.url == api.streamURL(for: tracks[4]))
}

@MainActor @Test func startingAJamKeepsTheTrackPlayingHere() throws {
    let (engine, output) = makeEngine()
    engine.play(tracks, startAt: 0)
    let start = engine.jamStart()
    #expect(start.trackIds == tracks.map(\.id))
    #expect(start.playing)
    engine.applyJam(try jamState(index: 0, playing: true))
    #expect(output.loads.count == 1)
}

// MARK: - Episodes

@MainActor @Test func episodesResumeAndSaveTheirProgress() async throws {
    let (engine, output) = makeEngine()
    transport.respond("https://h/api/me/episodes/ep1/progress", "")
    let episode = Track(id: "ep1", title: "E", artistName: "Pod", artistId: "", durationSec: 600,
                        episode: TrackEpisode(podcastId: "p1", audioUrl: URL(string: "https://cdn/ep1.mp3")!, startAt: 120))
    engine.play([episode], startAt: 0)
    #expect(output.loads.last?.url == URL(string: "https://cdn/ep1.mp3")!)
    #expect(output.seeks.last == 120)

    output.position = 200
    engine.pause()
    let saved = { transport.requests.last { $0.url?.path == "/api/me/episodes/ep1/progress" } }
    for _ in 0..<100 where saved() == nil { await Task.yield() }
    let body = try #require(saved()?.httpBody)
    let progress = try JSONDecoder().decode(EpisodeProgress.self, from: body)
    #expect(progress == EpisodeProgress(positionSec: 200, completed: false))
}

@MainActor @Test func episodesPlayAtTheirSpeedAndMusicAtOne() {
    let (engine, output) = makeEngine()
    let episode = Track(id: "ep2", title: "E", artistName: "Pod", artistId: "",
                        episode: TrackEpisode(podcastId: "p1", audioUrl: URL(string: "https://cdn/ep2.mp3")!, startAt: 0))
    engine.play([episode], startAt: 0)
    engine.cycleEpisodeRate()
    #expect(engine.episodeRate == 1.2)
    #expect(output.rate == 1.2)
    engine.play(tracks, startAt: 0)
    #expect(output.rate == 1)
}

// MARK: - Friend activity

@MainActor @Test func startedTracksAreReportedOnceForFriendActivity() async {
    // Its own transport: other tests play tracks in parallel.
    let ownTransport = FakeTransport()
    let ownAPI = APIClient(base: URL(string: "https://h/api")!, transport: ownTransport) {}
    let engine = PlayerEngine(output: FakeAudioOutput(), api: { ownAPI },
                              defaults: UserDefaults(suiteName: "PlayerEngineTests-\(UUID().uuidString)")!)
    let plays = { ownTransport.requests.filter { $0.url?.path == "/api/me/plays" }.count }

    engine.play(tracks, startAt: 0)
    engine.pause()
    engine.play()
    for _ in 0..<100 where plays() < 1 { await Task.yield() }
    #expect(plays() == 1)
    engine.next()
    for _ in 0..<100 where plays() < 2 { await Task.yield() }
    #expect(plays() == 2)
}
