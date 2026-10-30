import SpotifiakCore
import SwiftUI

/// Outside a Jam: start one with what plays here, or join one by code or link. In a Jam:
/// the invitation, the participants (the host removes them), what plays next, and leaving
/// (ending it, for the host).
struct JamSheet: View {
    @Environment(JamSession.self) private var jamSession
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    /// Friends invited from here during this Jam.
    @State private var invited: Set<String> = []
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let jam = jamSession.jam { inJam(jam) } else { outside }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
            .navigationTitle("Jam")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }

    // MARK: - Outside a Jam

    private var outside: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: "person.2.wave.2.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Theme.green)
                    .padding(.top, 32)
                    .accessibilityHidden(true)
                Text("Écoutez ensemble").font(.title2.bold())
                Text("Démarrez une Jam : vos amis rejoignent avec le lien, ajoutent des titres et contrôlent la lecture avec vous.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.subdued)
                    .multilineTextAlignment(.center)
                pill("Démarrer une Jam") { run { try await jamSession.start() } }

                Text("ou rejoindre une Jam").font(.footnote).foregroundStyle(Theme.subdued).padding(.top, 12)
                HStack(spacing: 8) {
                    TextField("", text: $code, prompt: Text("Code ou lien d'invitation").foregroundStyle(Color(white: 0.45)))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12)
                        .frame(height: 44)
                        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
                    Button("Rejoindre") { run { try await jamSession.join(code) } }
                        .font(.subheadline.bold())
                        .foregroundStyle(.black)
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                        .background(.white, in: Capsule())
                        .buttonStyle(.plain)
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill").font(.subheadline).foregroundStyle(Theme.error)
                }
            }
            .padding(.horizontal, 24)
            .disabled(busy)
        }
    }

    // MARK: - In a Jam

    private func inJam(_ jam: JamState) -> some View {
        let isHost = jam.host.id == currentUserId
        return List {
            Section {
                VStack(spacing: 12) {
                    Text("Jam de \(jam.host.displayName)").font(.title3.bold())
                    Text(jam.id)
                        .font(.system(.largeTitle, design: .monospaced).bold())
                        .foregroundStyle(Theme.green)
                        .textSelection(.enabled)
                        .accessibilityLabel("Code \(jam.id.map(String.init).joined(separator: " "))")
                    if let link = session.api?.jamInviteURL(jam.id) {
                        ShareLink(item: link, subject: Text("Rejoins ma Jam"), message: Text("Rejoins ma Jam sur Spotifiak")) {
                            Label("Inviter", systemImage: "square.and.arrow.up")
                                .font(.headline)
                                .foregroundStyle(.black)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Theme.green, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            Section("Participants") {
                ForEach(jam.participants) { person in
                    HStack {
                        Text(person.displayName)
                        if person.id == jam.host.id { Text("Hôte").font(.caption).foregroundStyle(Theme.subdued) }
                    }
                    .swipeActions {
                        if isHost && person.id != jam.host.id {
                            Button("Retirer", role: .destructive) { Task { await jamSession.remove(person) } }
                        }
                    }
                }
            }

            let invitable = social.friends.filter { friend in !jam.participants.contains { $0.id == friend.id } }
            if !invitable.isEmpty {
                Section("Inviter des amis") {
                    ForEach(invitable) { friend in
                        HStack(spacing: 12) {
                            Avatar(name: friend.displayName, size: 32)
                            Text(friend.displayName)
                            Spacer()
                            Button(invited.contains(friend.id) ? "Invité" : "Inviter") { invite(friend, to: jam) }
                                .font(.caption.bold())
                                .buttonStyle(.bordered)
                                .disabled(invited.contains(friend.id))
                        }
                    }
                }
            }

            if let current = jam.current {
                Section("En cours de lecture") { entryRow(current) }
            }
            let added = Array(jam.queue.dropFirst(jam.index + 1))
            if !added.isEmpty {
                Section("À suivre") { entries(added) }
            }
            if !jam.fallback.isEmpty {
                Section(jam.fallbackName.map { "Ensuite : \($0)" } ?? "Ensuite") { entries(jam.fallback) }
            }

            Section {
                Button(isHost ? "Mettre fin à la Jam" : "Quitter la Jam", role: .destructive) {
                    Task {
                        await jamSession.leave()
                        dismiss()
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
    }

    /// Tap to play it now, swipe to take it out.
    private func entries(_ list: [JamEntry]) -> some View {
        ForEach(list) { entry in
            Button { jamSession.send(.jump(entryId: entry.id)) } label: { entryRow(entry) }
                .buttonStyle(.plain)
                .swipeActions {
                    Button("Retirer", role: .destructive) { jamSession.send(.remove(entryId: entry.id)) }
                }
        }
    }

    private func entryRow(_ entry: JamEntry) -> some View {
        HStack(spacing: 12) {
            RemoteImage(url: session.api?.coverURL(track: entry.track)).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.track.title).lineLimit(1)
                Text("\(entry.track.artistName) • ajouté par \(entry.addedBy.displayName)")
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    // MARK: - Helpers

    /// Sends a friend an invitation (in their notifications) to this Jam.
    private func invite(_ friend: Person, to jam: JamState) {
        invited.insert(friend.id)
        Task {
            do {
                try await session.requireAPI().inviteToJam(jam.id, userIds: [friend.id])
                player.showToast("Invitation envoyée à \(friend.displayName)")
            } catch {
                invited.remove(friend.id)
                player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
            }
        }
    }

    private var currentUserId: String? {
        if case .loggedIn(let user) = session.state { return user.id }
        return nil
    }

    private func pill(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Theme.green, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                try await action()
            } catch let apiError as APIError {
                error = apiError.message
            } catch {
                self.error = "Serveur injoignable"
            }
        }
    }
}
