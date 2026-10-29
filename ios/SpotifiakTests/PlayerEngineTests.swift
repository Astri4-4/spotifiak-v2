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
}

private let api = APIClient(base: URL(string: "https://h/api")!, transport: FakeTransport()) {}
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
