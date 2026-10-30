import SpotifiakCore
import SwiftUI

/// Tracks friends shared and their Jam invitations, newest first. Opening it marks them read
/// (unread ones stay highlighted while it's open); swipe to delete one.
struct InboxView: View {
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @Environment(JamSession.self) private var jamSession
    @State private var notifications: [AppNotification]?
    @State private var error: String?

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(Theme.error) }
            if notifications?.isEmpty == true {
                Text("Rien pour l'instant. Les titres que vos amis partagent et leurs invitations à une Jam arrivent ici.")
                    .foregroundStyle(Theme.subdued)
            }
            ForEach(notifications ?? []) { notification in
                row(notification)
                    .listRowBackground(notification.read ? Color.clear : Theme.green.opacity(0.08))
                    .swipeActions {
                        Button("Supprimer", role: .destructive) { Task { await delete(notification) } }
                    }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Notifications")
        .refreshable { await load() }
        .task { await load() }
    }

    private func row(_ n: AppNotification) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                NavigationLink(value: Route.person(n.from.id)) { Avatar(name: n.from.displayName, size: 36) }
                    .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(Text(n.from.displayName).bold()) \(n.type == "share" ? "vous a partagé un titre" : "vous invite à sa Jam")")
                        .font(.subheadline)
                    Text(n.createdAt.formatted(.relative(presentation: .named))).font(.caption).foregroundStyle(Theme.subdued)
                }
                Spacer(minLength: 4)
                if n.type == "jam" {
                    if n.jamActive, let jamId = n.jamId {
                        Button("Rejoindre") { join(jamId) }
                            .font(.caption.bold())
                            .foregroundStyle(.black)
                            .padding(.horizontal, 12)
                            .frame(height: 28)
                            .background(Theme.green, in: Capsule())
                            .buttonStyle(.borderless)
                    } else {
                        Text("Terminée").font(.caption).foregroundStyle(Theme.subdued)
                    }
                }
            }
            if let message = n.message { Text("« \(message) »").font(.subheadline).italic() }
            if let track = n.track {
                Button { play(track) } label: {
                    HStack(spacing: 12) {
                        RemoteImage(url: session.api?.coverURL(track: track)).frame(width: 44, height: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title).foregroundStyle(player.current?.id == track.id ? Theme.green : .white).lineLimit(1)
                            Text(track.artistName).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: player.current?.id == track.id && player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.title)
                            .foregroundStyle(Theme.green)
                    }
                    .padding(8)
                    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Écouter \(track.title) de \(track.artistName)")
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        do {
            notifications = try await session.requireAPI().notifications()
            error = nil
            if notifications?.contains(where: { !$0.read }) == true {
                try? await session.api?.markNotificationsRead()
                await social.refreshCounts()
            }
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }

    private func delete(_ notification: AppNotification) async {
        try? await session.api?.deleteNotification(notification.id)
        notifications?.removeAll { $0.id == notification.id }
    }

    private func play(_ track: Track) {
        if player.current?.id == track.id { player.togglePlay() } else { player.play([track], startAt: 0) }
    }

    private func join(_ jamId: String) {
        Task {
            do { try await jamSession.join(jamId) } catch {
                player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
                await load()
            }
        }
    }
}

/// Someone's page: avatar, friendship buttons, recent listens (friends sharing them) and public playlists.
struct ProfileView: View {
    let id: String
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @State private var profile: Profile?
    @State private var error: String?
    @State private var confirmingRemoval = false

    private var isMe: Bool {
        if case .loggedIn(let user) = session.state { return user.id == id }
        return false
    }

    var body: some View {
        Group {
            if let profile { page(profile) } else if let error {
                ContentUnavailableView(error, systemImage: "person.crop.circle.badge.exclamationmark")
            } else {
                ProgressView()
            }
        }
        .task { await load() }
        .confirmationDialog("Retirer \(profile?.user.displayName ?? "") de vos amis ?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Retirer", role: .destructive) {
                Task {
                    try? await session.api?.removeFriend(id)
                    await social.changed()
                    await load()
                }
            }
        }
    }

    private func page(_ profile: Profile) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                Avatar(name: profile.user.displayName, size: 140).padding(.top, 16)
                Text(profile.user.displayName).font(.largeTitle.bold())
                Text("@\(profile.user.username)").foregroundStyle(Theme.subdued)
                if !isMe {
                    if profile.relation == .friend {
                        Button("Amis ✓") { confirmingRemoval = true }
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20)
                            .frame(height: 36)
                            .overlay(Capsule().stroke(Theme.subdued))
                            .buttonStyle(.plain)
                    } else {
                        RelationButtons(person: profile.user, relation: profile.relation) { Task { await load() } }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 16)
            .background(alignment: .top) {
                Theme.header(Color(red: 0.55, green: 0.3, blue: 0.2)).frame(height: 360).padding(.top, -160)
            }

            VStack(alignment: .leading, spacing: 24) {
                if !profile.recentPlays.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Écoutes récentes").font(.title2.bold()).padding(.horizontal)
                        TrackList(tracks: profile.recentPlays.map(\.track))
                    }
                } else if profile.activityHidden {
                    note("\(profile.user.displayName) ne partage pas son activité d'écoute.")
                } else if profile.relation == .sent || profile.relation == .received {
                    note("Ses écoutes apparaîtront quand vous serez amis.")
                } else if profile.relation == nil && !isMe {
                    note("Ajoutez \(profile.user.displayName) en ami pour voir ce qu'il ou elle écoute.")
                }
                if !profile.playlists.isEmpty {
                    Shelf(title: "Playlists publiques") {
                        ForEach(profile.playlists) { playlist in
                            NavigationLink(value: Route.playlist(playlist.id)) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Mosaic(covers: playlist.covers)
                                        .frame(width: 150, height: 150)
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                    Text(playlist.name).font(.footnote.weight(.semibold)).lineLimit(1)
                                    Text(trackCount(playlist.trackCount)).font(.caption).foregroundStyle(Theme.subdued)
                                }
                                .frame(width: 150)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.bottom)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(Theme.subdued).padding(.horizontal)
    }

    private func load() async {
        do {
            profile = try await session.requireAPI().profile(id)
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }
}

/// Picks friends and an optional message, then sends them a track.
struct ShareSheet: View {
    let track: Track
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var message = ""
    @State private var sending = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        RemoteImage(url: session.api?.coverURL(track: track)).frame(width: 48, height: 48)
                        VStack(alignment: .leading) {
                            Text(track.title).lineLimit(1)
                            Text(track.artistName).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
                        }
                    }
                    TextField("Message (facultatif)", text: $message, axis: .vertical).lineLimit(1...4)
                }
                Section("Envoyer à") {
                    if social.friends.isEmpty {
                        Text("Ajoutez des amis depuis l'onglet Amis.").foregroundStyle(Theme.subdued)
                    }
                    ForEach(social.friends) { friend in
                        Button {
                            if selected.contains(friend.id) { selected.remove(friend.id) } else { selected.insert(friend.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Avatar(name: friend.displayName, size: 32)
                                Text(friend.displayName).foregroundStyle(.white)
                                Spacer()
                                Image(systemName: selected.contains(friend.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(friend.id) ? Theme.green : Theme.subdued)
                            }
                        }
                        .accessibilityAddTraits(selected.contains(friend.id) ? .isSelected : [])
                    }
                }
            }
            .navigationTitle("Partager avec des amis")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Envoyer") { send() }.disabled(selected.isEmpty || sending)
                }
            }
            .task { await social.refreshFriends() }
        }
    }

    private func send() {
        sending = true
        Task {
            defer { sending = false }
            do {
                let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
                try await session.requireAPI().share(track.id, with: Array(selected), message: text.isEmpty ? nil : text)
                let names = social.friends.filter { selected.contains($0.id) }.map(\.displayName)
                player.showToast("Envoyé à \(names.formatted(.list(type: .and)))")
                dismiss()
            } catch {
                player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
            }
        }
    }
}
