import Foundation

/// What plays next: the launched context (album, playlist…) in play order, with
/// tracks added by the user played before the rest of it.
public struct QueueModel: Codable, Sendable, Equatable {
    public enum Repeat: String, Codable, Sendable { case off, all, one }

    public enum Advance: Equatable, Sendable {
        case track(Track)
        /// Seek the current track back to 0.
        case restart
        /// Nothing to play; the current track stays, the player rewinds and pauses.
        case stop
    }

    /// Storage for context tracks; `order` holds the indices still in the queue, in play order.
    private var context: [Track] = []
    private var order: [Int] = []
    /// Index into `order` of the current context track (the one before any added track playing).
    private var position = 0
    private var added: [Track] = []
    private var playingAdded: Track?
    public private(set) var shuffle = false
    public var repeatMode = Repeat.off

    public init() {}

    public var current: Track? {
        playingAdded ?? (order.indices.contains(position) ? context[order[position]] : nil)
    }

    public var upNext: [Track] {
        added + upcomingOrder.map { context[$0] }
    }

    private var upcomingOrder: ArraySlice<Int> {
        order.isEmpty ? [] : order[(position + 1)...]
    }

    public mutating func play(_ tracks: [Track], startAt index: Int, shuffle: Bool) {
        var rng = SystemRandomNumberGenerator()
        play(tracks, startAt: index, shuffle: shuffle, using: &rng)
    }

    public mutating func play(
        _ tracks: [Track], startAt index: Int, shuffle: Bool, using rng: inout some RandomNumberGenerator
    ) {
        context = tracks
        added = []
        playingAdded = nil
        self.shuffle = shuffle
        guard tracks.indices.contains(index) else {
            order = Array(tracks.indices)
            position = 0
            return
        }
        if shuffle {
            order = [index] + tracks.indices.filter { $0 != index }.shuffled(using: &rng)
            position = 0
        } else {
            order = Array(tracks.indices)
            position = index
        }
    }

    public mutating func add(_ tracks: [Track]) {
        if current == nil {
            play(tracks, startAt: 0, shuffle: false)
        } else {
            added += tracks
        }
    }

    public mutating func setShuffle(_ on: Bool) {
        var rng = SystemRandomNumberGenerator()
        setShuffle(on, using: &rng)
    }

    public mutating func setShuffle(_ on: Bool, using rng: inout some RandomNumberGenerator) {
        guard on != shuffle else { return }
        shuffle = on
        guard order.indices.contains(position) else { return }
        let anchor = order[position]
        let rest = order.filter { $0 != anchor }
        if on {
            order = [anchor] + rest.shuffled(using: &rng)
            position = 0
        } else {
            // Context indices grow in original order (moved-in tracks are appended).
            order = (rest + [anchor]).sorted()
            position = order.firstIndex(of: anchor)!
        }
    }

    public mutating func next(auto: Bool) -> Advance {
        guard current != nil else { return .stop }
        if repeatMode == .one && auto { return .restart }
        if !added.isEmpty {
            playingAdded = added.removeFirst()
            return .track(playingAdded!)
        }
        if position + 1 < order.count {
            playingAdded = nil
            position += 1
        } else if repeatMode == .all && !order.isEmpty {
            playingAdded = nil
            position = 0
        } else {
            return .stop
        }
        return .track(context[order[position]])
    }

    public mutating func previous(position seconds: Double) -> Advance {
        guard current != nil else { return .stop }
        if seconds > 3 { return .restart }
        if playingAdded != nil, order.indices.contains(position) {
            playingAdded = nil
        } else if position > 0 {
            position -= 1
        } else if repeatMode == .all && order.count > 1 {
            position = order.count - 1
        } else {
            return .restart
        }
        return .track(context[order[position]])
    }

    /// Indices are into `upNext`. A track dropped strictly inside the other section joins it.
    public mutating func moveUpNext(from: Int, to: Int) {
        guard let entry = takeUpNext(at: from) else { return }
        let to = min(max(to, 0), added.count + upcomingOrder.count)
        let intoAdded: Bool
        switch entry {
        case .added: intoAdded = to <= added.count
        case .context: intoAdded = to < added.count
        }
        switch (entry, intoAdded) {
        case (.added(let track), true): added.insert(track, at: to)
        case (.context(let index), true): added.insert(context[index], at: to)
        case (.context(let index), false): order.insert(index, at: position + 1 + to - added.count)
        case (.added(let track), false):
            context.append(track)
            order.insert(context.count - 1, at: position + 1 + to - added.count)
        }
    }

    public mutating func removeUpNext(at index: Int) {
        _ = takeUpNext(at: index)
    }

    private enum Entry {
        case added(Track)
        case context(Int)
    }

    private mutating func takeUpNext(at index: Int) -> Entry? {
        if added.indices.contains(index) {
            return .added(added.remove(at: index))
        }
        let orderIndex = position + 1 + index - added.count
        guard index >= 0, !order.isEmpty, orderIndex < order.count else { return nil }
        return .context(order.remove(at: orderIndex))
    }
}
