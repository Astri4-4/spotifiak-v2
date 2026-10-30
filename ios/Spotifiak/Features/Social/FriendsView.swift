import SpotifiakCore
import SwiftUI

/// The "Amis" tab: notifications, friend requests, what friends listen to, finding people,
/// and the friends list. Activity refreshes every 30 s while shown.
struct FriendsView: View {
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @State private var friends: Friends?
    @State private var activity: [FriendActivity] = []
    @State private var query = ""
    @State private var results: [PersonResult]?

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.inbox) {
                    HStack {
                        Label("Notifications", systemImage: "bell")
                        Spacer()
                        if social.counts.unread > 0 { CountBadge(count: social.counts.unread) }
                    }
                }
            }

            if let incoming = friends?.incoming, !incoming.isEmpty {
                Section("Demandes d'amis") {
                    ForEach(incoming) { entry in
                        PersonRow(person: entry.person) {
                            RelationButtons(person: entry.person, relation: .received) { Task { await reload() } }
                        }
                    }
                }
            }

            Section("Activité de vos amis") {
                if activity.isEmpty {
                    Text("Vos amis n'ont encore rien écouté, ou ne partagent pas leur activité.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.subdued)
                }
                ForEach(activity) { item in ActivityRow(item: item) }
            }

            Section("Ajouter des amis") {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.subdued)
                    TextField("Nom ou nom d'utilisateur", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let results, !trimmed.isEmpty {
                    if results.isEmpty {
                        Text("Personne ne correspond à « \(trimmed) »").foregroundStyle(Theme.subdued)
                    }
                    ForEach(results) { result in
                        PersonRow(person: result.person) {
                            RelationButtons(person: result.person, relation: result.relation) { Task { await reload() } }
                        }
                    }
                }
            }

            Section(friends.map { "Vos amis (\($0.friends.count))" } ?? "Vos amis") {
                if friends?.friends.isEmpty == true {
                    Text("Cherchez quelqu'un ci-dessus pour l'ajouter.").foregroundStyle(Theme.subdued)
                }
                ForEach(friends?.friends ?? []) { entry in PersonRow(person: entry.person) {} }
            }

            if let outgoing = friends?.outgoing, !outgoing.isEmpty {
                Section("Demandes envoyées") {
                    ForEach(outgoing) { entry in
                        PersonRow(person: entry.person) {
                            RelationButtons(person: entry.person, relation: .sent) { Task { await reload() } }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Amis")
        .refreshable { await reload() }
        .task {
            while !Task.isCancelled {
                await reload()
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .task(id: trimmed) { await search() }
    }

    private func reload() async {
        guard let api = session.api else { return }
        async let friends = try? api.friends()
        async let activity = try? api.friendActivity()
        if let friends = await friends { self.friends = friends }
        if let activity = await activity { self.activity = activity }
        await social.refreshCounts()
        if !trimmed.isEmpty { await search(debounce: false) }
    }

    private func search(debounce: Bool = true) async {
        guard !trimmed.isEmpty else { results = nil; return }
        if debounce { guard (try? await Task.sleep(for: .milliseconds(300))) != nil else { return } }
        results = try? await session.api?.people(trimmed)
    }
}

/// A friend's last listen: tapping the track plays it, the name opens their profile.
private struct ActivityRow: View {
    let item: FriendActivity
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(\.navigate) private var navigate

    var body: some View {
        HStack(spacing: 12) {
            // Buttons, not NavigationLinks: in a List row a link gets a chevron and stretches.
            Button { navigate(.person(item.user.id)) } label: { Avatar(name: item.user.displayName, size: 40) }
                .buttonStyle(.borderless)
                .accessibilityLabel("Profil de \(item.user.displayName)")
            VStack(alignment: .leading, spacing: 4) {
                Button { navigate(.person(item.user.id)) } label: { Text(item.user.displayName).font(.subheadline.bold()) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.white)
                Button { player.play([item.track], startAt: 0) } label: {
                    HStack(spacing: 6) {
                        RemoteImage(url: session.api?.coverURL(track: item.track)).frame(width: 20, height: 20)
                        Text("\(item.track.title) • \(item.track.artistName)").lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Écouter \(item.track.title) de \(item.track.artistName)")
            }
            Spacer(minLength: 4)
            if item.listening {
                HStack(spacing: 4) {
                    Circle().frame(width: 6, height: 6)
                    Text("En écoute")
                }
                .font(.caption2)
                .foregroundStyle(Theme.green)
            } else {
                Text(item.playedAt.formatted(.relative(presentation: .named))).font(.caption2).foregroundStyle(Theme.subdued)
            }
        }
    }
}

/// Avatar, name and @username linking to the profile, then `trailing` (buttons).
struct PersonRow<Trailing: View>: View {
    let person: Person
    @ViewBuilder let trailing: Trailing
    @Environment(\.navigate) private var navigate

    var body: some View {
        HStack(spacing: 12) {
            Button { navigate(.person(person.id)) } label: {
                HStack(spacing: 12) {
                    Avatar(name: person.displayName, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(person.displayName)
                        Text("@\(person.username)").font(.caption).foregroundStyle(Theme.subdued)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.white)
            Spacer(minLength: 4)
            trailing
        }
    }
}

/// Ajouter / Annuler / Accepter + Refuser / "Amis", from where the user stands with someone.
struct RelationButtons: View {
    let person: Person
    let relation: Relation?
    let onChange: () -> Void
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player

    var body: some View {
        HStack(spacing: 8) {
            switch relation {
            case .friend:
                Text("Amis").font(.caption).foregroundStyle(Theme.subdued)
            case .sent:
                pill("Annuler", filled: false) { try await $0.removeFriend(person.id) }
            case .received:
                pill("Accepter", filled: true, done: "Vous êtes amis avec \(person.displayName)") { try await $0.acceptFriend(person.id) }
                pill("Refuser", filled: false) { try await $0.removeFriend(person.id) }
            case nil:
                pill("Ajouter", filled: true, done: "Demande envoyée à \(person.displayName)") { try await $0.addFriend(person.id) }
            }
        }
        .buttonStyle(.borderless)
    }

    private func pill(_ title: String, filled: Bool, done: String? = nil, action: @escaping (APIClient) async throws -> Void) -> some View {
        Button {
            Task {
                do {
                    try await action(try session.requireAPI())
                    if let done { player.showToast(done) }
                    await social.changed()
                    onChange()
                } catch {
                    player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
                }
            }
        } label: {
            Text(title)
                .font(.caption.bold())
                .foregroundStyle(filled ? .black : .white)
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(filled ? AnyShapeStyle(Theme.green) : AnyShapeStyle(.clear), in: Capsule())
                .overlay(Capsule().stroke(filled ? .clear : Theme.subdued))
        }
    }
}

/// A person's initial in a colored circle (accounts have no pictures).
struct Avatar: View {
    let name: String
    var size: CGFloat = 32

    var body: some View {
        Text(name.trimmingCharacters(in: .whitespaces).prefix(1).uppercased())
            .font(.system(size: size * 0.42, weight: .bold))
            .foregroundStyle(.black)
            .frame(width: size, height: size)
            .background(Color(red: 1, green: 0.6, blue: 0.4), in: Circle())
            .accessibilityHidden(true)
    }
}

/// The green count on the tab, the bell and the menus.
struct CountBadge: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.caption2.bold())
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(Theme.green, in: Capsule())
    }
}
