import Foundation
import Testing
@testable import SpotifiakCore

/// SplitMix64, so shuffles are reproducible.
struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

func t(_ id: String) -> Track { Track(id: id, title: "Track \(id)", artistName: "A", artistId: "a") }
let ts = (0..<5).map { t(String($0)) }
let x = t("x")

@Test func addedTracksPlayBeforeTheRestOfTheContext() {
    var q = QueueModel()
    q.play(ts, startAt: 0, shuffle: false)
    q.add([x])
    #expect(q.upNext.map(\.id) == ["x", "1", "2", "3", "4"])
    #expect(q.next(auto: true) == .track(x))
    #expect(q.upNext.map(\.id) == ["1", "2", "3", "4"])
    #expect(q.next(auto: true) == .track(ts[1]))
}

@Test func shuffleKeepsCurrentAndUnshuffleResumesInOrder() {
    var rng = SeededGenerator(state: 42)
    var q = QueueModel()
    q.play(ts, startAt: 2, shuffle: true, using: &rng)
    #expect(q.current == ts[2])
    #expect(q.shuffle)
    #expect(q.upNext.map(\.id).sorted() == ["0", "1", "3", "4"])
    q.setShuffle(false)
    #expect(q.current == ts[2])
    #expect(q.upNext.map(\.id) == ["3", "4"])
    q.setShuffle(true, using: &rng)
    #expect(q.current == ts[2])
    #expect(q.upNext.map(\.id).sorted() == ["0", "1", "3", "4"])
}

@Test func repeatOneRestartsOnlyOnAuto() {
    var q = QueueModel()
    q.play(ts, startAt: 0, shuffle: false)
    q.repeatMode = .one
    #expect(q.next(auto: true) == .restart)
    #expect(q.current == ts[0])
    #expect(q.next(auto: false) == .track(ts[1]))
}

@Test func endOfContextStopsOrWraps() {
    var q = QueueModel()
    q.play(ts, startAt: 4, shuffle: false)
    #expect(q.next(auto: true) == .stop)
    #expect(q.current == ts[4])
    q.repeatMode = .all
    #expect(q.next(auto: true) == .track(ts[0]))
    #expect(q.upNext.count == 4)
}

@Test func previousRestartsAfterThreeSeconds() {
    var q = QueueModel()
    q.play(ts, startAt: 2, shuffle: false)
    #expect(q.previous(position: 3.5) == .restart)
    #expect(q.current == ts[2])
    #expect(q.previous(position: 1) == .track(ts[1]))
    #expect(q.previous(position: 0) == .track(ts[0]))
    #expect(q.previous(position: 0) == .restart)
    q.repeatMode = .all
    #expect(q.previous(position: 0) == .track(ts[4]))
}

@Test func previousFromAnAddedTrackReturnsToTheContext() {
    var q = QueueModel()
    q.play(ts, startAt: 1, shuffle: false)
    q.add([x])
    #expect(q.next(auto: false) == .track(x))
    #expect(q.previous(position: 0) == .track(ts[1]))
    #expect(q.upNext.map(\.id) == ["2", "3", "4"])
}

@Test func moveAndRemoveInUpNext() {
    var q = QueueModel()
    q.play(ts, startAt: 0, shuffle: false)
    q.add([x])
    q.moveUpNext(from: 0, to: 2)
    #expect(q.upNext.map(\.id) == ["1", "2", "x", "3", "4"])
    q.moveUpNext(from: 3, to: 0)
    #expect(q.upNext.map(\.id) == ["3", "1", "2", "x", "4"])
    q.add([t("y")])
    #expect(q.upNext.map(\.id) == ["y", "3", "1", "2", "x", "4"])
    q.moveUpNext(from: 2, to: 0)
    #expect(q.upNext.map(\.id) == ["1", "y", "3", "2", "x", "4"])
    #expect(q.next(auto: false) == .track(ts[1]))
    q.removeUpNext(at: 0)
    #expect(q.upNext.map(\.id) == ["3", "2", "x", "4"])
    q.removeUpNext(at: 9)
    #expect(q.upNext.count == 4)
}

@Test func roundTripsThroughCodable() throws {
    var rng = SeededGenerator(state: 7)
    var q = QueueModel()
    q.play(ts, startAt: 1, shuffle: true, using: &rng)
    q.add([x])
    q.repeatMode = .all
    let data = try JSONEncoder.spotifiak.encode(q)
    #expect(try JSONDecoder.spotifiak.decode(QueueModel.self, from: data) == q)
}

@Test func emptyQueueIsSafe() {
    var q = QueueModel()
    #expect(q.current == nil)
    #expect(q.next(auto: true) == .stop)
    #expect(q.previous(position: 10) == .stop)
    q.setShuffle(true)
    q.moveUpNext(from: 0, to: 1)
    q.removeUpNext(at: 0)
    q.play([], startAt: 0, shuffle: false)
    #expect(q.current == nil)
    q.add([x])
    #expect(q.current == x)
    #expect(q.upNext.isEmpty)
}
