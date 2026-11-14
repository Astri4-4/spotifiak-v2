import SpotifiakCore
import SwiftUI

/// Time capsules: tracks sealed until a date, for this user (sealed or opened) and by them.
/// Same page as the web CapsulesPage.
struct CapsulesView: View {
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @State private var capsules: Capsules?
    @State private var error: String?

    private var me: String? {
        if case .loggedIn(let user) = session.state { return user.id }
        return nil
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            content(now: context.date)
        }
        .navigationTitle("Capsules")
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        if let capsules {
            if capsules.sealed.isEmpty && capsules.opened.isEmpty && capsules.sent.isEmpty {
                ContentUnavailableView(
                    "Scelle un titre pour le futur",
                    systemImage: "hourglass",
                    description: Text("Dans le menu ⋯ d'un titre, choisis « Mettre en capsule » : pour toi dans un an, ou pour un ami. Personne ne sait ce qu'il y a dedans avant le jour J.")
                )
            } else {
                List {
                    if !capsules.sealed.isEmpty {
                        Section("À ouvrir") {
                            ForEach(capsules.sealed) { sealed($0, now: now) }
                        }
                    }
                    if !capsules.opened.isEmpty {
                        Section("Ouvertes") {
                            ForEach(capsules.opened) { capsule in
                                opened(capsule)
                                    .swipeActions {
                                        Button("Effacer", role: .destructive) { Task { await remove(capsule.id) } }
                                    }
                            }
                        }
                    }
                    if !capsules.sent.isEmpty {
                        Section("Envoyées") {
                            ForEach(capsules.sent) { capsule in
                                sent(capsule, now: now)
                                    .swipeActions {
                                        if !capsule.open {
                                            Button("Reprendre", role: .destructive) { Task { await remove(capsule.id) } }
                                        }
                                    }
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                // A capsule whose day comes while the page is open: reload to reveal it.
                .onChange(of: capsules.sealed.first.map { $0.openAt <= now } ?? false) { _, due in
                    if due { Task { await load() } }
                }
            }
        } else if let error {
            ContentUnavailableView {
                Label(error, systemImage: "wifi.exclamationmark")
            } actions: {
                Button("Réessayer") { Task { await load() } }
            }
        } else {
            ProgressView()
        }
    }

    private func sealed(_ capsule: SealedCapsule, now: Date) -> some View {
        let total = capsule.openAt.timeIntervalSince(capsule.createdAt)
        let left = capsule.openAt.timeIntervalSince(now)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("🔒").font(.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text(capsuleCountdown(left)).font(.title3.bold()).monospacedDigit()
                    Text("le \(capsule.openAt.formatted(date: .long, time: .omitted))").font(.caption).foregroundStyle(Theme.subdued)
                }
            }
            ProgressView(value: min(1, max(0, 1 - left / max(total, 1))))
                .tint(Color(red: 0.96, green: 0.61, blue: 0.14))
            HStack(spacing: 6) {
                Avatar(person: capsule.from, size: 20)
                Text(capsule.from.id == me
                     ? "Scellée par toi le \(capsule.createdAt.formatted(date: .long, time: .omitted))"
                     : "Scellée par \(capsule.from.displayName)")
                    .font(.caption)
            }
        }
        .padding(.vertical, 6)
        .listRowBackground(
            LinearGradient(colors: [Color(red: 0.23, green: 0.16, blue: 0.36), Color(red: 0.09, green: 0.06, blue: 0.15)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        )
    }

    private func opened(_ capsule: OpenedCapsule) -> some View {
        let isCurrent = player.current?.id == capsule.track.id
        return Button {
            if isCurrent { player.togglePlay() } else { player.play([capsule.track], startAt: 0) }
        } label: {
            HStack(spacing: 12) {
                RemoteImage(url: session.api?.coverURL(track: capsule.track))
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                VStack(alignment: .leading, spacing: 3) {
                    Text(capsule.track.title).font(.body.weight(.semibold)).foregroundStyle(isCurrent ? Theme.green : .white).lineLimit(1)
                    Text(capsule.track.artistName).font(.subheadline).foregroundStyle(Theme.subdued).lineLimit(1)
                    if let message = capsule.message { Text("« \(message) »").font(.subheadline).italic() }
                    Text("\(capsule.from.displayName) • scellée le \(capsule.createdAt.formatted(date: .long, time: .omitted))")
                        .font(.caption)
                        .foregroundStyle(Theme.subdued)
                }
                Spacer(minLength: 0)
                Image(systemName: isCurrent && player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title)
                    .foregroundStyle(Theme.green)
            }
        }
        .buttonStyle(.plain)
    }

    private func sent(_ capsule: SentCapsule, now: Date) -> some View {
        HStack(spacing: 12) {
            Avatar(person: capsule.to, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(capsule.track.title) pour \(capsule.to.displayName)").lineLimit(1)
                Text(capsule.open
                     ? "Ouverte le \(capsule.openAt.formatted(date: .long, time: .omitted))"
                     : "S'ouvre \(capsuleCountdown(capsule.openAt.timeIntervalSince(now)))")
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
            }
        }
    }

    private func load() async {
        do {
            capsules = try await session.requireAPI().capsules()
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }

    private func remove(_ id: String) async {
        do {
            try await session.requireAPI().removeCapsule(id)
            await load()
        } catch {
            player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
        }
    }
}

/// Seals a track with a word, for oneself or a friend, until a chosen day (opens at 9:00).
struct CapsuleSheet: View {
    let track: Track
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var recipient = ""
    @State private var day = Calendar.current.date(byAdding: .year, value: 1, to: .now) ?? .now
    @State private var message = ""
    @State private var sending = false

    private static let presets: [(String, Calendar.Component, Int)] = [
        ("1 mois", .month, 1), ("6 mois", .month, 6), ("1 an", .year, 1), ("5 ans", .year, 5),
    ]

    private var me: String? {
        if case .loggedIn(let user) = session.state { return user.id }
        return nil
    }

    /// 9:00 on the chosen day, a nice time to find it.
    private var openAt: Date {
        Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        RemoteImage(url: session.api?.coverURL(track: track)).frame(width: 48, height: 48)
                        VStack(alignment: .leading) {
                            Text(track.title).lineLimit(1)
                            Text(track.artistName).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
                        }
                    }
                } footer: {
                    Text("Le titre et ton mot restent cachés jusqu'au jour choisi : on ne voit qu'une capsule scellée et un compte à rebours.")
                }
                Section("Pour") {
                    Picker("Pour", selection: $recipient) {
                        Text("Moi, dans le futur").tag(me ?? "")
                        ForEach(social.friends) { Text($0.displayName).tag($0.id) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("S'ouvre le") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(Self.presets, id: \.0) { preset in
                                Button("Dans \(preset.0)") {
                                    day = Calendar.current.date(byAdding: preset.1, value: preset.2, to: .now) ?? day
                                }
                                .buttonStyle(.bordered)
                                .font(.caption.bold())
                            }
                        }
                    }
                    DatePicker("Date", selection: $day, in: Date.now.addingTimeInterval(86400)..., displayedComponents: .date)
                }
                Section {
                    TextField(recipient == me ? "Un mot pour toi dans le futur…" : "Un mot, à lire le jour venu…", text: $message, axis: .vertical)
                        .lineLimit(2...6)
                }
            }
            .navigationTitle("Sceller une capsule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sceller") { seal() }.disabled(sending || recipient.isEmpty)
                }
            }
            .task {
                if recipient.isEmpty { recipient = me ?? "" }
                await social.refreshFriends()
            }
        }
    }

    private func seal() {
        sending = true
        Task {
            defer { sending = false }
            do {
                let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
                try await session.requireAPI().sealCapsule(trackId: track.id, to: recipient, openAt: openAt, message: text.isEmpty ? nil : text)
                player.showToast("Capsule scellée jusqu'au \(openAt.formatted(date: .long, time: .omitted))")
                dismiss()
            } catch {
                player.showToast((error as? APIError)?.message ?? "Serveur injoignable")
            }
        }
    }
}
