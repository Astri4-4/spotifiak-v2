import Foundation
import Observation
import SpotifiakCore

/// Friends and what's waiting for the user (notifications, friend requests): the "Amis" tab's
/// badge, and the friends that the share and Jam invitation menus list. No push notifications
/// (a free Apple account can't send them): the counts are checked every 30 s while in front.
@MainActor @Observable
final class SocialStore {
    private(set) var counts = NotificationCounts(unread: 0, friendRequests: 0)
    private(set) var friends: [Person] = []

    var badge: Int { counts.unread + counts.friendRequests }

    private let api: () -> APIClient?

    init(api: @escaping () -> APIClient?) {
        self.api = api
    }

    /// Runs while logged in and in front: counts now, then every 30 s.
    func poll() async {
        await refreshFriends()
        while !Task.isCancelled {
            await refreshCounts()
            try? await Task.sleep(for: .seconds(30))
        }
    }

    func refreshCounts() async {
        if let counts = try? await api()?.notificationCounts() { self.counts = counts }
    }

    func refreshFriends() async {
        if let friends = try? await api()?.friends() { self.friends = friends.friends.map(\.person) }
    }

    /// After a friendship changed (request sent, accepted, removed).
    func changed() async {
        await refreshFriends()
        await refreshCounts()
    }

    func reset() {
        counts = NotificationCounts(unread: 0, friendRequests: 0)
        friends = []
    }
}
