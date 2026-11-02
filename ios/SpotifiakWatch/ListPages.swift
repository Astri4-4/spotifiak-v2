import SpotifiakCore
import SwiftUI
import UIKit

/// Liked tracks, playlists and saved albums; tapping one plays it on the iPhone.
struct LibraryPage: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if let error = store.error, store.library == nil {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(store.library ?? []) { item in
                    Button { store.play(item) } label: { ItemRow(item: item) }
                }
            }
            .overlay { if store.library == nil && store.error == nil { ProgressView() } }
            .navigationTitle("Bibliothèque")
            .task { await store.loadLibrary() }
        }
    }
}

/// Friends' activity and the tracks they shared; tapping a track plays it on the iPhone.
struct FriendsPage: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if let error = store.error, store.friends == nil {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                }
                if let friends = store.friends {
                    Section("Activité") {
                        if friends.activity.isEmpty {
                            Text("Aucune activité").font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(friends.activity) { activity in
                            Button { store.play(activity.track) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack {
                                        Text(activity.name).font(.headline).lineLimit(1)
                                        if activity.listening {
                                            Circle().fill(WatchTheme.green).frame(width: 6, height: 6)
                                                .accessibilityLabel("En écoute")
                                        }
                                    }
                                    Text("\(activity.track.title) • \(activity.track.subtitle ?? "")")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                        }
                    }
                    if !friends.shared.isEmpty {
                        Section(friends.unread > 0 ? "Partagés avec vous (\(friends.unread) nouveaux)" : "Partagés avec vous") {
                            ForEach(friends.shared) { item in
                                Button { store.play(item) } label: { ItemRow(item: item) }
                            }
                        }
                    }
                }
            }
            .overlay { if store.friends == nil && store.error == nil { ProgressView() } }
            .navigationTitle("Amis")
            .task { await store.loadFriends() }
        }
    }
}

private struct ItemRow: View {
    let item: WatchItem

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if let data = item.thumbnail, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if item.kind == .liked {
                    LinearGradient(colors: [Color(red: 0.27, green: 0.16, blue: 0.82), Color(red: 0.55, green: 0.73, blue: 0.85)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                        .overlay { Image(systemName: "heart.fill").font(.caption) }
                } else {
                    Color.gray.opacity(0.3).overlay { Image(systemName: "music.note").font(.caption) }
                }
            }
            .frame(width: 32, height: 32)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).lineLimit(1)
                if let subtitle = item.subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
    }
}
