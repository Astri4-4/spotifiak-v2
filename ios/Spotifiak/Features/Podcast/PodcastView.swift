import SpotifiakCore
import SwiftUI

/// Artwork on its color, title, author, subscribe, description, then the episodes. On a
/// podcast created here, its owner adds YouTube videos, edits and deletes it; the page
/// refreshes every 3 s while videos download.
struct PodcastView: View {
    let id: String
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var podcast: PodcastDetail?
    @State private var error: String?
    @State private var editing = false
    @State private var confirmingDelete = false

    var body: some View {
        Group {
            if let podcast {
                page(podcast)
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
        .task { await load() }
        .task(id: podcast?.episodes.contains { $0.status == "queued" || $0.status == "downloading" }) {
            while podcast?.episodes.contains(where: { $0.status == "queued" || $0.status == "downloading" }) == true {
                guard (try? await Task.sleep(for: .seconds(3))) != nil else { return }
                await load()
            }
        }
        .sheet(isPresented: $editing) {
            if let podcast { PodcastEditor(podcast: podcast) { Task { await load() } } }
        }
        .confirmationDialog("Supprimer « \(podcast?.title ?? "") » ?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Supprimer", role: .destructive) {
                Task {
                    do {
                        try await session.requireAPI().deletePodcast(id)
                        await library.refresh()
                        dismiss()
                    } catch {
                        self.error = (error as? APIError)?.message
                    }
                }
            }
        } message: {
            Text("Le son de ses vidéos sera supprimé. Cette action est définitive.")
        }
    }

    private func page(_ podcast: PodcastDetail) -> some View {
        let image = session.api?.imageURL(podcast: podcast.id, hasImage: podcast.hasImage)
        return DetailPage(colorURL: image, tracks: [], showsPlayButtons: false) {
            RemoteImage(url: image, placeholder: "mic.fill").clipShape(RoundedRectangle(cornerRadius: 8))
        } info: {
            Text(podcast.title).font(.title2.bold())
            if let author = podcast.author { Text(author).font(.subheadline.bold()) }
            Text("Podcast • \(podcast.episodeCount) épisodes").font(.caption).foregroundStyle(Theme.subdued)
        } actions: {
            let subscribed = library.subscribedPodcastIds.contains(podcast.id)
            Button(subscribed ? "Abonné" : "S'abonner") { library.toggleSubscribed(podcast: podcast.id) }
                .font(.footnote.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 32)
                .overlay(Capsule().stroke(subscribed ? .white : Theme.subdued))
                .buttonStyle(.plain)
            if podcast.owned {
                Menu {
                    Button("Modifier", systemImage: "pencil") { editing = true }
                    Button("Supprimer le podcast", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                } label: {
                    Image(systemName: "ellipsis").font(.title2).foregroundStyle(Theme.subdued).frame(width: 32, height: 44)
                }
                .accessibilityLabel("Plus d'options pour le podcast")
            }
            Spacer()
        } content: {
            if let description = podcast.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.subdued)
                    .lineLimit(4)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
            }
            if podcast.owned { AddVideo(podcastId: podcast.id) { Task { await load() } } }
            Text("Tous les épisodes").font(.title3.bold()).padding(.horizontal).padding(.top, 8)
            if podcast.episodes.isEmpty {
                Text(podcast.owned ? "Ajoutez une première vidéo YouTube ci-dessus." : "Ce podcast ne contient aucun épisode.")
                    .foregroundStyle(Theme.subdued)
                    .padding()
            }
            LazyVStack(spacing: 0) {
                ForEach(podcast.episodes) { episode in
                    EpisodeRow(episode: episode, ownedPodcastId: podcast.owned ? podcast.id : nil) { Task { await load() } }
                    Divider().overlay(Theme.highlight).padding(.leading)
                }
            }
            .padding(.bottom)
        }
    }

    private func load() async {
        do {
            podcast = try await session.requireAPI().podcast(id)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }
}

/// Created podcasts: a YouTube video or playlist link, whose audio the server downloads.
private struct AddVideo: View {
    let podcastId: String
    let onAdded: () -> Void
    @Environment(Session.self) private var session
    @State private var url = ""
    @State private var busy = false
    @State private var message: (ok: Bool, text: String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ajouter une vidéo ou une playlist YouTube").font(.headline)
            Text("Le son de chaque vidéo devient un épisode de ce podcast.").font(.caption).foregroundStyle(Theme.subdued)
            HStack(spacing: 8) {
                TextField("", text: $url, prompt: Text("Lien YouTube").foregroundStyle(Color(white: 0.45)))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
                    .onSubmit(add)
                Button("Ajouter", action: add)
                    .font(.subheadline.bold())
                    .foregroundStyle(.black)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(Theme.green, in: Capsule())
                    .buttonStyle(.plain)
                    .disabled(busy || url.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let message {
                Text(message.text).font(.caption).foregroundStyle(message.ok ? Theme.green : Theme.error)
            }
        }
        .padding()
    }

    private func add() {
        busy = true
        message = nil
        Task {
            defer { busy = false }
            do {
                let (added, skipped) = try await session.requireAPI().addVideo(to: podcastId, url: url.trimmingCharacters(in: .whitespaces))
                if added > 1 || skipped > 0 {
                    message = (true, "\(added) vidéo\(added > 1 ? "s" : "") ajoutée\(added > 1 ? "s" : "")"
                        + (skipped > 0 ? ", \(skipped) déjà présente\(skipped > 1 ? "s" : "")" : ""))
                }
                url = ""
                onAdded()
            } catch {
                message = (false, (error as? APIError)?.message ?? "Serveur injoignable")
            }
        }
    }
}

/// The title and description of a created podcast.
private struct PodcastEditor: View {
    let podcast: PodcastDetail
    let onSaved: () -> Void
    @Environment(Session.self) private var session
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Nom", text: $title)
                TextField("Description", text: $description, axis: .vertical).lineLimit(3...8)
                if let error { Text(error).foregroundStyle(Theme.error) }
            }
            .navigationTitle("Modifier le podcast")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") {
                        Task {
                            do {
                                try await session.requireAPI().updatePodcast(
                                    podcast.id, title: title.trimmingCharacters(in: .whitespaces),
                                    description: description.trimmingCharacters(in: .whitespacesAndNewlines))
                                onSaved()
                                await library.refresh()
                                dismiss()
                            } catch {
                                self.error = (error as? APIError)?.message ?? "Serveur injoignable"
                            }
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .onAppear {
            title = podcast.title
            description = podcast.description ?? ""
        }
    }
}

/// A podcast from the directory: the server reads its feed the first time, then its page.
struct OpenPodcastView: View {
    let feedUrl: String
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: { try await session.requireAPI().openPodcast(feedUrl: feedUrl) }) { id in
            PodcastView(id: id)
        }
    }
}

/// Date, title, description, and where the listener is (left, heard); tapping plays it
/// (or pauses / resumes it when it's the one playing).
struct EpisodeRow: View {
    let episode: Episode
    /// Set on a created podcast's page for its owner: retry and delete episodes.
    var ownedPodcastId: String?
    /// After its progress changed from the menu.
    var onChange: () -> Void = {}

    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session

    private var isCurrent: Bool { player.current?.id == episode.id }
    private var ready: Bool { episode.status == "ready" }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(url: session.api?.imageURL(episode: episode), placeholder: "mic.fill")
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 6) {
                Text(episode.title)
                    .font(.subheadline.bold())
                    .foregroundStyle(isCurrent ? Theme.green : .white)
                    .lineLimit(2)
                if let description = episode.description {
                    Text(description).font(.caption).foregroundStyle(Theme.subdued).lineLimit(2)
                }
                HStack(spacing: 12) {
                    Button(action: play) {
                        Image(systemName: isCurrent && player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.title)
                            .foregroundStyle(ready ? .white : Theme.subdued)
                    }
                    .buttonStyle(.plain)
                    .disabled(!ready)
                    .accessibilityLabel(isCurrent && player.isPlaying ? "Pause" : "Lire \(episode.title)")
                    status
                    Spacer()
                    menu
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }

    /// "12 févr. • 45 min", how much is left, or why it can't play yet.
    @ViewBuilder private var status: some View {
        let date = episode.publishedAt.formatted(.dateTime.day().month(.abbreviated).year())
        switch episode.status {
        case "queued": Text("En attente de téléchargement").font(.caption).foregroundStyle(Theme.subdued)
        case "downloading": Text("Téléchargement…").font(.caption).foregroundStyle(Theme.subdued)
        case "failed": Text(episode.error.map { "Échec : \($0)" } ?? "Échec du téléchargement").font(.caption).foregroundStyle(Theme.error).lineLimit(2)
        default:
            if let progress = episode.progress, progress.completed {
                Label("Écouté", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(Theme.green)
            } else if let progress = episode.progress, progress.positionSec > 0, let length = episode.durationSec, length > 0 {
                HStack(spacing: 6) {
                    ProgressView(value: min(progress.positionSec / length, 1)).tint(Theme.green).frame(width: 40)
                    Text("\(minutes(length - progress.positionSec)) restantes").font(.caption).foregroundStyle(Theme.subdued)
                }
            } else {
                Text([date, episode.durationSec.map(minutes)].compactMap { $0 }.joined(separator: " • "))
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
            }
        }
    }

    private var menu: some View {
        Menu {
            let heard = episode.progress?.completed == true
            Button(heard ? "Marquer comme non écouté" : "Marquer comme écouté", systemImage: heard ? "circle" : "checkmark.circle") {
                Task {
                    try? await session.api?.saveProgress(episodeId: episode.id, EpisodeProgress(positionSec: 0, completed: !heard))
                    onChange()
                }
            }
            if ready, let track = session.api?.track(episode: episode) {
                Button("Ajouter à la file d'attente", systemImage: "text.badge.plus") { player.add([track]) }
            }
            if let podcastId = ownedPodcastId {
                if episode.status == "failed" {
                    Button("Réessayer le téléchargement", systemImage: "arrow.clockwise") {
                        Task {
                            try? await session.api?.retryEpisode(episode.id, of: podcastId)
                            onChange()
                        }
                    }
                }
                Button("Supprimer l'épisode", systemImage: "trash", role: .destructive) {
                    Task {
                        try? await session.api?.deleteEpisode(episode.id, of: podcastId)
                        onChange()
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis").foregroundStyle(Theme.subdued).frame(width: 32, height: 32)
        }
        .accessibilityLabel("Plus d'options pour \(episode.title)")
    }

    private func play() {
        if isCurrent { return player.togglePlay() }
        guard let track = session.api?.track(episode: episode) else { return }
        player.play([track], startAt: 0)
    }

    private func minutes(_ seconds: Double) -> String {
        let total = Int((seconds / 60).rounded(.up))
        return total >= 60 ? "\(total / 60) h \(String(format: "%02d", total % 60))" : "\(total) min"
    }
}

/// Artwork, title and podcast name, for the home shelf of new episodes; tapping plays it.
struct EpisodeCard: View {
    let episode: Episode
    @Environment(PlayerEngine.self) private var player
    @Environment(Session.self) private var session

    var body: some View {
        Button {
            if player.current?.id == episode.id { return player.togglePlay() }
            if let track = session.api?.track(episode: episode) { player.play([track], startAt: 0) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                RemoteImage(url: session.api?.imageURL(episode: episode), placeholder: "mic.fill")
                    .frame(width: 150, height: 150)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(episode.title).font(.footnote.weight(.semibold)).lineLimit(2)
                Text(episode.podcast.title).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
            }
            .frame(width: 150, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
}
