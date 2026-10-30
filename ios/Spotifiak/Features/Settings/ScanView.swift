import SpotifiakCore
import SwiftUI

/// The library scan (admins start one), the Deezer artwork lookup, and duplicates (admins).
/// Polls like the web page: every second while something runs, every 5 s otherwise.
struct ScanView: View {
    @Environment(Session.self) private var session
    @State private var status: ScanStatus?
    @State private var error: String?
    @State private var starting = false

    private var isAdmin: Bool {
        if case .loggedIn(let user) = session.state { return user.role == .admin }
        return false
    }

    var body: some View {
        List {
            if isAdmin {
                Section {
                    HStack(spacing: 12) {
                        pill("Scan rapide", filled: true) { start(full: false) }
                        pill("Scan complet", filled: false) { start(full: true) }
                    }
                    .disabled(status == nil || status?.running == true || starting)
                } footer: {
                    Text("Le scan rapide détecte les fichiers ajoutés ou supprimés. Le scan complet revérifie aussi chaque fichier existant.")
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if let error {
                Section { Text("API injoignable : \(error)").foregroundStyle(Theme.error) }
            }
            if let status {
                Section { scan(status) } header: {
                    HStack {
                        if status.running { ProgressView().controlSize(.small) }
                        Text(status.running ? "Scan \(status.mode == "full" ? "complet" : "rapide") en cours" : "Aucun scan en cours")
                    }
                }
                Section("Pochettes et photos Deezer") { enrichment(status.enrichment) }
                if isAdmin { DuplicatesSection(scanning: status.running) }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Analyse de la bibliothèque")
        .navigationBarTitleDisplayMode(.inline)
        .task { await poll() }
    }

    // MARK: - Sections

    @ViewBuilder private func scan(_ status: ScanStatus) -> some View {
        if status.running {
            if let started = status.lastStartedAt {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    LabeledContent("Durée", value: formatDuration(context.date.timeIntervalSince(started)))
                }
            }
            step("Liste des dossiers", phase: "listing", in: status, detail: "\(status.dirsListed.formatted()) dossiers parcourus")
            step("Lecture des fichiers", phase: "indexing", in: status, detail: status.progress.map(indexing))
            if let progress = status.progress, status.phase == "indexing", progress.total > 0 {
                ProgressView(value: Double(progress.done), total: Double(progress.total)).tint(Theme.green)
            }
            step("Nettoyage", phase: "cleanup", in: status, detail: nil)
        } else if let finished = status.lastFinishedAt {
            Text("Scan \(status.lastMode == "full" ? "complet" : "rapide") terminé \(finished.formatted(.relative(presentation: .named))), en \(formatDuration((status.lastDurationMs ?? 0) / 1000))")
                .font(.subheadline)
                .foregroundStyle(Theme.subdued)
            if let lastError = status.lastError { Text("Échec : \(lastError)").foregroundStyle(Theme.error) }
            if let r = status.lastResult {
                LazyVGrid(columns: Array(repeating: GridItem(), count: 3), spacing: 12) {
                    tile("Fichiers", r.files)
                    tile("Vérifiés", r.checked)
                    tile("Ajoutés", r.added)
                    tile("Mis à jour", r.updated)
                    tile("Supprimés", r.removed)
                    tile("Échecs", r.failed, warn: r.failed > 0)
                }
                .padding(.vertical, 4)
            }
        } else {
            Text("Aucun scan terminé depuis le démarrage du serveur.").foregroundStyle(Theme.subdued)
        }
    }

    @ViewBuilder private func enrichment(_ e: ScanStatus.Enrichment) -> some View {
        if !e.enabled {
            Text("Désactivé (DEEZER_ENRICH=false)").foregroundStyle(Theme.subdued)
        } else if !e.running && e.albums.total == 0 && e.artists.total == 0 {
            Text("Rien à chercher").foregroundStyle(Theme.subdued)
        } else {
            counts("Albums", e.albums)
            counts("Artistes", e.artists)
            if !e.running, let finished = e.lastFinishedAt {
                Text("Terminé \(finished.formatted(.relative(presentation: .named)))" + (e.lastFailed > 0 ? " • \(e.lastFailed) échecs" : ""))
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
            }
        }
    }

    private func step(_ title: String, phase: String, in status: ScanStatus, detail: String?) -> some View {
        let order = ["listing", "indexing", "cleanup"]
        let current = order.firstIndex(of: status.phase ?? "") ?? 0
        let index = order.firstIndex(of: phase)!
        let state = index < current ? "checkmark.circle.fill" : index == current ? "circle.dotted" : "circle"
        return HStack(alignment: .top) {
            Image(systemName: state).foregroundStyle(index <= current ? Theme.green : Theme.subdued)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if index == current, let detail { Text(detail).font(.caption).foregroundStyle(Theme.subdued) }
            }
        }
    }

    /// "1 234 / 5 678 fichiers • 42,0 fichiers/s • environ 2:15 restantes".
    private func indexing(_ progress: ScanStatus.Progress) -> String {
        let elapsed = Date().timeIntervalSince(progress.startedAt)
        let rate = elapsed > 0 ? Double(progress.done) / elapsed : 0
        var parts = ["\(progress.done.formatted()) / \(progress.total.formatted()) fichiers"]
        if rate > 0 {
            parts.append("\(rate.formatted(.number.precision(.fractionLength(1)))) fichiers/s")
            if progress.done < progress.total {
                parts.append("environ \(formatDuration(Double(progress.total - progress.done) / rate)) restantes")
            }
        }
        return parts.joined(separator: " • ")
    }

    private func counts(_ title: String, _ c: ScanCounts) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(title) : \(c.done.formatted()) / \(c.total.formatted())")
                Spacer()
                Text("\(c.matched.formatted()) trouvés").foregroundStyle(Theme.subdued)
            }
            .font(.subheadline)
            ProgressView(value: Double(c.done), total: Double(max(c.total, 1))).tint(Theme.green)
        }
    }

    private func tile(_ label: String, _ value: Int, warn: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(value.formatted()).font(.title3.bold()).foregroundStyle(warn ? Theme.error : .white)
            Text(label).font(.caption).foregroundStyle(Theme.subdued)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Theme.highlight, in: RoundedRectangle(cornerRadius: 6))
    }

    private func pill(_ title: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.bold())
                .foregroundStyle(filled ? .black : .white)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(filled ? AnyShapeStyle(Theme.green) : AnyShapeStyle(.clear), in: Capsule())
                .overlay(Capsule().stroke(filled ? .clear : Theme.subdued))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Polling

    private func poll() async {
        while !Task.isCancelled {
            do {
                status = try await session.requireAPI().scanStatus()
                error = nil
            } catch is CancellationError {
                return
            } catch {
                self.error = (error as? APIError)?.message ?? "Serveur injoignable"
            }
            let active = status?.running == true || status?.enrichment.running == true
            try? await Task.sleep(for: .seconds(active ? 1 : 5))
        }
    }

    private func start(full: Bool) {
        starting = true
        Task {
            defer { starting = false }
            do { try await session.requireAPI().startScan(full: full) } catch { self.error = (error as? APIError)?.message }
            status = try? await session.requireAPI().scanStatus()
        }
    }
}

/// Finds copies of the same track and deletes the extra files, keeping the chosen copy
/// (the best one by default) or all of them.
private struct DuplicatesSection: View {
    let scanning: Bool
    @Environment(Session.self) private var session
    @State private var groups: [DuplicateGroup]?
    /// The kept copy per group (keyed by its best copy's id); nil keeps them all.
    @State private var keep: [String: String?] = [:]
    @State private var busy = false
    @State private var confirming = false
    @State private var error: String?
    @State private var result: DuplicateRemoval?

    private var selection: [DuplicateResolution] {
        (groups ?? []).compactMap { group in
            guard let keepId = keep[group.tracks[0].id] ?? group.tracks[0].id else { return nil }
            return DuplicateResolution(keepId: keepId, removeIds: group.tracks.map(\.id).filter { $0 != keepId })
        }
    }

    private var fileCount: Int { selection.reduce(0) { $0 + $1.removeIds.count } }

    var body: some View {
        Section {
            HStack(spacing: 12) {
                Button(groups == nil ? "Chercher les doublons" : "Actualiser") { Task { await search() } }
                    .buttonStyle(.bordered)
                if fileCount > 0 {
                    Button("Supprimer \(fileCount) fichier\(fileCount > 1 ? "s" : "")", role: .destructive) { confirming = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.error)
                        .disabled(scanning)
                }
                if busy { ProgressView() }
            }
            .disabled(busy)
            if let error { Text(error).foregroundStyle(Theme.error) }
            if let result {
                Text("\(result.removed) fichier\(result.removed > 1 ? "s" : "") supprimé\(result.removed > 1 ? "s" : "")")
                    .foregroundStyle(Theme.green)
                ForEach(result.failed, id: \.path) { failure in
                    Text("\(failure.path) : \(failure.error)").font(.caption).foregroundStyle(Theme.error)
                }
            }
            if let groups, groups.isEmpty { Text("Aucun doublon").foregroundStyle(Theme.subdued) }
        } header: {
            Text("Doublons")
        } footer: {
            if scanning { Text("Attendez la fin du scan pour supprimer.") }
        }
        .confirmationDialog("Supprimer \(fileCount) fichier\(fileCount > 1 ? "s" : "") du disque ?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Supprimer", role: .destructive) { Task { await remove() } }
        } message: {
            Text("Les copies non gardées sont effacées définitivement ; leurs likes et places dans les playlists passent à la copie gardée.")
        }

        ForEach(groups ?? [], id: \.tracks.first?.id) { group in
            let key = group.tracks[0].id
            Section {
                // .some: assigning a bare nil ("Tout garder") would delete the entry instead.
                Picker("Copie gardée", selection: Binding(get: { keep[key] ?? key }, set: { keep[key] = .some($0) })) {
                    ForEach(group.tracks) { copy in
                        VStack(alignment: .leading) {
                            Text("\(copy.format) • \(copy.bitrateKbps.map { "\($0) kb/s" } ?? "?") • \((Double(copy.fileSize) / 1_048_576).formatted(.number.precision(.fractionLength(1)))) Mo")
                            Text(copy.path).font(.caption2).foregroundStyle(Theme.subdued).lineLimit(2)
                        }
                        .tag(Optional(copy.id))
                    }
                    Text("Tout garder").tag(String?.none)
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("\(group.tracks[0].title) — \(group.tracks[0].artistName)")
            }
        }
    }

    private func search() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let found = try await session.requireAPI().duplicates()
            // Keep earlier choices ("Tout garder" included) when they still apply.
            keep = Dictionary(uniqueKeysWithValues: found.map { group in
                let key = group.tracks[0].id
                let choice = keep[key] ?? key
                return (key, choice == nil || group.tracks.contains { $0.id == choice } ? choice : key)
            })
            groups = found
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }

    private func remove() async {
        busy = true
        error = nil
        do {
            result = try await session.requireAPI().removeDuplicates(selection)
            busy = false
            await search()
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
            busy = false
        }
    }
}
