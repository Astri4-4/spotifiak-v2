import AVFoundation
import SpotifiakCore
import SwiftUI

/// Blind test between friends: with a code, the game itself; without one, create or join.
/// Same game as the web QuizPage; the server runs it and sends its state over SSE.
struct QuizView: View {
    let code: String?

    var body: some View {
        Group {
            if let code { QuizGameView(code: code) } else { QuizHomeView() }
        }
        .navigationTitle("Blind test")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct QuizHomeView: View {
    @Environment(Session.self) private var session
    @Environment(\.navigate) private var navigate
    @State private var code = ""
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("10 extraits tirés de ce que vous écoutez, entre amis. Trouve le titre le plus vite possible : une bonne réponse rapporte jusqu'à 1000 points.")
                .foregroundStyle(Theme.subdued)
            Button {
                Task {
                    do { navigate(.quiz(try await session.requireAPI().createQuiz().id)) } catch { self.error = message(error) }
                }
            } label: {
                Text("Créer une partie").bold().frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.green)
            .foregroundStyle(.black)
            .controlSize(.large)
            HStack {
                TextField("Code de la partie", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 8))
                Button("Rejoindre") { if let c = quizCode(code) { navigate(.quiz(c)) } }
                    .buttonStyle(.bordered)
                    .disabled(quizCode(code) == nil)
            }
            if let error { Text(error).foregroundStyle(Theme.error) }
            Spacer()
        }
        .padding()
    }
}

private func message(_ error: Error) -> String {
    (error as? APIError)?.message ?? "Serveur injoignable"
}

/// Follows a game: joins it, listens to its events, plays each round's clip.
@MainActor @Observable
private final class QuizGame {
    let code: String
    private(set) var state: QuizState?
    private(set) var receivedAt = Date()
    private(set) var ended = false
    var error: String?

    private var api: APIClient?
    private var events: Task<Void, Never>?
    private var clip: AVPlayer?
    private var clipKey: String?

    init(code: String) { self.code = code }

    func start(api: APIClient) async {
        self.api = api
        do {
            apply(try await api.joinQuiz(code))
        } catch {
            self.error = message(error)
            return
        }
        events = Task { [weak self] in
            while !Task.isCancelled, let self, !self.ended {
                await self.read()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func stop() {
        events?.cancel()
        events = nil
        stopClip()
    }

    func remaining(at now: Date) -> Double {
        max(0, (state?.remainingMs ?? 0) / 1000 - now.timeIntervalSince(receivedAt))
    }

    func send(_ action: @escaping (APIClient) async throws -> Void) {
        guard let api else { return }
        Task { @MainActor in
            do { try await action(api) } catch { self.error = message(error) }
        }
    }

    private func read() async {
        guard let api else { return }
        var request = URLRequest(url: api.quizEventsURL(code))
        request.timeoutInterval = 120
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                ended = true
                return
            }
            var parser = ServerSentEvents()
            for try await line in bytes.lines {
                guard let (event, data) = parser.feed(line) else { continue }
                if event == "state", let state = try? JSONDecoder.spotifiak.decode(QuizState.self, from: Data(data.utf8)) {
                    apply(state)
                } else if event == "end" {
                    ended = true
                    stopClip()
                    return
                }
            }
        } catch {}
    }

    private func apply(_ state: QuizState) {
        self.state = state
        receivedAt = Date()
        // The clip loads during the countdown, plays during the round and keeps going through the reveal.
        let active: Bool = [QuizState.Phase.countdown, .question, .reveal].contains(state.phase)
        let key = active ? "\(state.index)" : nil
        if key != clipKey {
            stopClip()
            clipKey = key
            if let key, let api, let round = state.round {
                let player = AVPlayer(url: api.quizClipURL(code, index: Int(key)!, format: round.format))
                player.seek(to: CMTime(seconds: round.clipStart, preferredTimescale: 600))
                clip = player
            }
        }
        if state.phase == .question, let clip, clip.rate == 0, let round = state.round {
            try? AVAudioSession.sharedInstance().setActive(true)
            // A seek asked before the item was ready may not have taken.
            if clip.currentTime().seconds < round.clipStart - 1 {
                clip.seek(to: CMTime(seconds: round.clipStart, preferredTimescale: 600))
            }
            clip.play()
        }
    }

    private func stopClip() {
        clip?.pause()
        clip = nil
        clipKey = nil
    }
}

private struct QuizGameView: View {
    let code: String
    @Environment(Session.self) private var session
    @Environment(SocialStore.self) private var social
    @Environment(PlayerEngine.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var game: QuizGame
    @State private var invited: Set<String> = []

    init(code: String) {
        self.code = code
        _game = State(initialValue: QuizGame(code: code))
    }

    private var me: String? {
        if case .loggedIn(let user) = session.state { return user.id }
        return nil
    }

    var body: some View {
        Group {
            if game.ended {
                ContentUnavailableView {
                    Label("La partie est terminée", systemImage: "flag.checkered")
                } actions: {
                    Button("Fermer") { dismiss() }
                }
            } else if let state = game.state {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header(state)
                        switch state.phase {
                        case .lobby: lobby(state)
                        case .countdown: countdown
                        case .question, .reveal, .over: round(state)
                        }
                        if state.phase != .lobby { scores(state) }
                    }
                    .padding()
                }
            } else if let error = game.error {
                ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
        .task {
            if player.isPlaying { player.pause() }
            if let api = session.api { await game.start(api: api) }
        }
        .onDisappear { game.stop() }
        .alert("Blind test", isPresented: Binding(get: { game.state != nil && game.error != nil }, set: { if !$0 { game.error = nil } })) {
            Button("OK") {}
        } message: {
            Text(game.error ?? "")
        }
    }

    private func header(_ state: QuizState) -> some View {
        HStack {
            Text("Code ").foregroundStyle(Theme.subdued) + Text(state.id).bold().kerning(2)
            Spacer()
            if state.phase != .lobby && state.phase != .over {
                Text("Manche \(state.index + 1) / \(state.roundCount)").foregroundStyle(Theme.subdued)
            }
            Button(state.host.id == me ? "Terminer" : "Quitter") {
                game.send { try await $0.leaveQuiz(code) }
                dismiss()
            }
            .buttonStyle(.bordered)
            .font(.caption.bold())
        }
    }

    // MARK: Lobby

    @ViewBuilder
    private func lobby(_ state: QuizState) -> some View {
        Text("Joueurs").font(.title3.bold())
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                ForEach(state.players) { p in
                    VStack(spacing: 6) {
                        Avatar(person: p, size: 56)
                        Text(p.displayName).font(.caption).lineLimit(1)
                    }
                    .frame(width: 72)
                }
            }
        }
        if state.host.id == me {
            Button {
                game.send { try await $0.startQuiz(code) }
            } label: {
                Text("Lancer la partie").bold().frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.green)
            .foregroundStyle(.black)
            .controlSize(.large)
        } else {
            Text("En attente de \(state.host.displayName)…").foregroundStyle(Theme.subdued)
        }
        if let api = session.api {
            let link = api.quizInviteURL(code)
            ShareLink(item: link, subject: Text("Blind test"), message: Text("Viens jouer au blind test sur Spotifiak (code \(code))")) {
                Label("Partager le lien", systemImage: "square.and.arrow.up")
            }
        }
        let inGame = Set(state.players.map(\.id))
        let invitable = social.friends.filter { !inGame.contains($0.id) }
        if !invitable.isEmpty {
            Text("Défier des amis").font(.title3.bold())
            ForEach(invitable) { friend in
                HStack(spacing: 12) {
                    Avatar(person: friend, size: 36)
                    Text(friend.displayName).lineLimit(1)
                    Spacer()
                    Button(invited.contains(friend.id) ? "Invité" : "Inviter") {
                        invited.insert(friend.id)
                        game.send { try await $0.inviteToQuiz(code, userIds: [friend.id]) }
                    }
                    .buttonStyle(.bordered)
                    .font(.caption.bold())
                    .disabled(invited.contains(friend.id))
                }
            }
        }
    }

    // MARK: Rounds

    private var countdown: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { context in
            let left = Int(game.remaining(at: context.date).rounded(.up))
            Text(left > 0 ? "\(left)" : "Go")
                .font(.system(size: 96, weight: .heavy))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
                .contentTransition(.numericText())
        }
    }

    @ViewBuilder
    private func round(_ state: QuizState) -> some View {
        if let round = state.round {
            if state.phase == .question {
                TimelineView(.periodic(from: .now, by: 0.1)) { context in
                    ProgressView(value: game.remaining(at: context.date), total: 20)
                        .tint(Theme.green)
                }
            }
            if let track = round.track {
                HStack(spacing: 16) {
                    RemoteImage(url: session.api?.coverURL(track: track))
                        .frame(width: 88, height: 88)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(track.title).font(.headline)
                        Text(track.artistName).foregroundStyle(Theme.subdued)
                        if let mine = round.mine {
                            let gained = round.results.first { $0.userId == me }?.points ?? 0
                            Text(mine == round.answer ? "+\(gained) points" : "Raté")
                                .bold()
                                .foregroundStyle(mine == round.answer ? Theme.green : Theme.error)
                        } else {
                            Text("Pas de réponse").bold().foregroundStyle(Theme.error)
                        }
                    }
                }
            }
            if state.phase != .over {
                ForEach(Array(round.choices.enumerated()), id: \.offset) { index, choice in
                    choiceButton(state, round, index, choice)
                }
                if state.phase == .question {
                    Text("\(round.answered.count) / \(state.players.count) ont répondu").foregroundStyle(Theme.subdued)
                }
            } else {
                let winner = state.ranking.first
                Text(winner?.id == me ? "Tu as gagné 🏆" : "\(winner?.displayName ?? "") gagne 🏆").font(.title2.bold())
                if state.host.id == me {
                    Button {
                        game.send { try await $0.startQuiz(code) }
                    } label: {
                        Text("Revanche").bold().frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.green)
                    .foregroundStyle(.black)
                    .controlSize(.large)
                } else {
                    Text("L'hôte peut lancer une revanche").foregroundStyle(Theme.subdued)
                }
            }
        }
    }

    private func choiceButton(_ state: QuizState, _ round: QuizRound, _ index: Int, _ choice: QuizChoice) -> some View {
        let revealed = round.answer != nil
        let border: Color = revealed
            ? (index == round.answer ? Theme.green : round.mine == index ? Theme.error : .clear)
            : (round.mine == index ? .white : .clear)
        let pickers = round.results.filter { $0.choice == index }.compactMap { r in state.players.first { $0.id == r.userId } }
        return Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            game.send { try await $0.answerQuiz(code, index: state.index, choice: index) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(choice.title).font(.body.weight(.semibold)).multilineTextAlignment(.leading)
                Text(choice.artist).font(.subheadline).foregroundStyle(Theme.subdued)
                if !pickers.isEmpty {
                    HStack(spacing: 4) { ForEach(pickers) { Avatar(person: $0, size: 22) } }.padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(revealed && index == round.answer ? Theme.green.opacity(0.15) : Theme.elevated, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(border, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .disabled(round.mine != nil || state.phase != .question)
    }

    private func scores(_ state: QuizState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Classement").font(.title3.bold())
            ForEach(Array(state.ranking.enumerated()), id: \.element.id) { rank, p in
                HStack(spacing: 12) {
                    Text("\(rank + 1)").bold().foregroundStyle(Theme.subdued).frame(width: 20)
                    Avatar(person: p, size: 32)
                    Text(p.displayName).foregroundStyle(p.id == me ? Theme.green : .white).lineLimit(1)
                    Spacer()
                    Text("\(p.score)").bold().monospacedDigit()
                }
            }
        }
    }
}
