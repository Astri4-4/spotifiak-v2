import SpotifiakCore
import SwiftUI

/// What plays now and next. Locally: drag to reorder, swipe to remove. In a Jam: the
/// tracks added to it, then the rest of what was launched, each reordered within itself.
struct QueueSheet: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(JamSession.self) private var jamSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let current = player.current {
                    Section("En cours de lecture") { row(current, addedBy: player.jam?.current?.addedBy) }
                }
                if let jam = player.jam {
                    jamSection("À suivre", Array(jam.queue.dropFirst(jam.index + 1)))
                    jamSection(jam.fallbackName.map { "Ensuite : \($0)" } ?? "Ensuite", jam.fallback)
                } else if !player.queue.upNext.isEmpty {
                    Section("À suivre") {
                        ForEach(Array(player.queue.upNext.enumerated()), id: \.offset) { _, track in row(track, addedBy: nil) }
                            .onMove { source, destination in
                                guard let from = source.first else { return }
                                // onMove counts the destination before removing the moved row.
                                player.moveUpNext(from: from, to: destination > from ? destination - 1 : destination)
                            }
                            .onDelete { $0.sorted(by: >).forEach(player.removeUpNext) }
                    }
                }
                if player.current == nil {
                    ContentUnavailableView("La file d'attente est vide", systemImage: "list.bullet")
                }
            }
            .environment(\.editMode, .constant(.active))
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("File d'attente")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } } }
        }
    }

    @ViewBuilder private func jamSection(_ title: String, _ entries: [JamEntry]) -> some View {
        if !entries.isEmpty {
            Section(title) {
                ForEach(entries) { entry in row(entry.track, addedBy: entry.addedBy) }
                    .onMove { source, destination in
                        guard let from = source.first else { return }
                        var reordered = entries
                        reordered.move(fromOffsets: source, toOffset: destination)
                        let at = reordered.firstIndex(of: entries[from])!
                        jamSession.send(.move(entryId: entries[from].id, beforeEntryId: at + 1 < reordered.count ? reordered[at + 1].id : nil))
                    }
                    .onDelete { offsets in offsets.forEach { jamSession.send(.remove(entryId: entries[$0].id)) } }
            }
        }
    }

    private func row(_ track: Track, addedBy: JamPerson?) -> some View {
        QueueTrackRow(track: track, addedBy: addedBy)
    }
}

/// A track of a queue: cover, title, artist, and in a Jam the picture of who added it.
struct QueueTrackRow: View {
    let track: Track
    var addedBy: JamPerson?
    @Environment(Session.self) private var session

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: session.api?.coverURL(track: track)).frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title).lineLimit(1)
                Text(track.artistName).font(.caption).foregroundStyle(Theme.subdued).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let addedBy { Avatar(person: addedBy, size: 24) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel([track.title, track.artistName, addedBy.map { "ajouté par \($0.displayName)" }]
            .compactMap { $0 }.joined(separator: ", "))
    }
}
