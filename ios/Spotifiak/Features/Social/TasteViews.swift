import SpotifiakCore
import SwiftUI

/// The weekly taste duel with each friend: a favourite of theirs you never heard, one of yours for
/// them; whoever's pick the other likes scores a point.
/// FriendsView loads `duels` (a List leaves an empty section out, with any `.task` on it).
struct DuelSection: View {
    let duels: [Duel]
    /// Loads the duels again after a vote.
    let reload: @MainActor () async -> Void
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        Group {
            if !duels.isEmpty {
                Section {
                    ForEach(duels) { duel in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 8) {
                                Text("Toi \(duel.score.me)").bold()
                                Avatar(person: duel.friend, size: 24)
                                Text("\(duel.score.friend) \(duel.friend.displayName)").bold()
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("Score : toi \(duel.score.me), \(duel.friend.displayName) \(duel.score.friend)")
                            if let forMe = duel.forMe {
                                pick("Le choix de \(duel.friend.displayName) pour toi", forMe.track)
                                HStack {
                                    vote(duel, liked: true, current: forMe.myVote, label: "J'aime")
                                    vote(duel, liked: false, current: forMe.myVote, label: "Pas pour moi")
                                }
                            } else {
                                Text("Tu as déjà écouté tous les préférés de \(duel.friend.displayName) !")
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.subdued)
                            }
                            if let fromMe = duel.fromMe {
                                pick("Ton choix pour \(duel.friend.displayName)", fromMe.track)
                                Text(verdict(fromMe.theirVote, duel.friend))
                                    .font(.caption)
                                    .foregroundStyle(Theme.subdued)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Duel des goûts")
                } footer: {
                    Text("Chaque semaine, un titre préféré de ton ami que tu n'as jamais écouté, et un des tiens pour lui.")
                }
            }
        }
    }

    private func pick(_ label: String, _ track: Track) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.subdued)
            Button { player.play([track], startAt: 0) } label: {
                HStack(spacing: 10) {
                    RemoteImage(url: session.api?.coverURL(track: track)).frame(width: 44, height: 44)
                    VStack(alignment: .leading) {
                        Text(track.title).lineLimit(1)
                        Text(track.artistName).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Écouter \(track.title)")
        }
    }

    private func vote(_ duel: Duel, liked: Bool, current: Bool?, label: String) -> some View {
        Button(label) {
            Task {
                try? await session.api?.voteDuel(friendId: duel.friend.id, liked: liked)
                await reload()
            }
        }
        .buttonStyle(.bordered)
        .tint(current == liked ? Theme.green : nil)
        .accessibilityAddTraits(current == liked ? .isSelected : [])
    }

    private func verdict(_ vote: Bool?, _ friend: Person) -> String {
        guard let vote else { return "Pas encore écouté" }
        return vote ? "\(friend.displayName) a aimé" : "\(friend.displayName) n'a pas accroché"
    }
}

/// Me in the middle, friends around; the thicker the line, the closer two tastes are.
/// FriendsView loads `map`, like the duels.
struct TasteMapSection: View {
    let map: TasteMap?
    @Environment(Session.self) private var session

    var body: some View {
        Group {
            if let map, map.people.count > 1, case .loggedIn(let me) = session.state {
                Section("Carte des goûts") {
                    graph(map, me: me.id)
                        .frame(height: 260)
                        .accessibilityHidden(true)
                    ForEach(map.links.filter { $0.a == me.id || $0.b == me.id }.sorted { $0.similarity > $1.similarity }, id: \.self) { link in
                        if let friend = map.people.first(where: { $0.id == (link.a == me.id ? link.b : link.a) }) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(friend.displayName) : \(Int((link.similarity * 100).rounded())) %").bold()
                                if !link.artists.isEmpty {
                                    Text(link.artists.joined(separator: ", ")).font(.subheadline).foregroundStyle(Theme.subdued)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func graph(_ map: TasteMap, me: String) -> some View {
        GeometryReader { geometry in
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            let radius = min(geometry.size.width, geometry.size.height) / 2 - 36
            let friends = map.people.filter { $0.id != me }
            let positions = Dictionary(uniqueKeysWithValues: [(me, center)] + friends.enumerated().map { index, person in
                let angle = 2 * Double.pi * Double(index) / Double(friends.count) - Double.pi / 2
                return (person.id, CGPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle)))
            })
            ZStack {
                ForEach(map.links, id: \.self) { link in
                    if let a = positions[link.a], let b = positions[link.b] {
                        Path { path in
                            path.move(to: a)
                            path.addLine(to: b)
                        }
                        .stroke(Theme.green.opacity(0.15 + link.similarity * 0.85), style: StrokeStyle(lineWidth: 1 + link.similarity * 10, lineCap: .round))
                    }
                }
                ForEach(map.people) { person in
                    if let point = positions[person.id] {
                        VStack(spacing: 2) {
                            Avatar(person: person, size: 40)
                            Text(person.id == me ? "Toi" : person.displayName).font(.caption2).lineLimit(1)
                        }
                        .frame(width: 72)
                        .position(x: point.x, y: point.y + 8)
                    }
                }
            }
        }
    }
}
