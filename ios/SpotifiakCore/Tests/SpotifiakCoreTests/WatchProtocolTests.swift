import Foundation
import Testing
@testable import SpotifiakCore

@Test func watchMessagesRoundTrip() throws {
    let item = WatchItem(kind: .playlist, itemId: "p1", title: "Route", subtitle: "12 titres", thumbnail: Data([1, 2]))
    let request = WatchRequest.command(.play(item))
    #expect(try WatchMessage.unpack(WatchRequest.self, from: WatchMessage.pack(request)) == request)

    let reply = WatchReply.friends(WatchFriends(
        activity: [WatchFriendActivity(id: "u2", name: "Ana", track: WatchItem(kind: .track, itemId: "t1", title: "T", subtitle: "A"),
                                       listening: true, playedAt: Date(timeIntervalSince1970: 1_000))],
        shared: [], unread: 2))
    #expect(try WatchMessage.unpack(WatchReply.self, from: WatchMessage.pack(reply)) == reply)
}

@Test func watchUnpackRejectsForeignMessages() {
    #expect(throws: (any Error).self) { try WatchMessage.unpack(WatchRequest.self, from: ["other": 1]) }
}

@Test func nowPlayingPositionMovesOnlyWhilePlaying() {
    let sent = Date(timeIntervalSince1970: 100)
    var now = WatchNowPlaying(trackId: "t", title: "T", artist: "A", cover: nil, isPlaying: true, liked: false, shuffle: false,
                              repeatMode: "off", position: 30, duration: 40, sentAt: sent, jamHost: nil, jamPeople: 0)
    #expect(now.position(at: sent.addingTimeInterval(5)) == 35)
    #expect(now.position(at: sent.addingTimeInterval(60)) == 40)
    now.isPlaying = false
    #expect(now.position(at: sent.addingTimeInterval(5)) == 30)
}
