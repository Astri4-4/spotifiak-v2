import SpotifiakCore
import SwiftUI

/// "Tes ères musicales": the listening history as chapters on a timeline, newest first,
/// each playable. Same page as the web ErasPage.
struct ErasView: View {
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: { try await session.requireAPI().eras() }) { eras in
            if eras.isEmpty {
                ContentUnavailableView(
                    "Ta première ère s'écrit",
                    systemImage: "books.vertical",
                    description: Text("Écoute quelques semaines de musique : tes chapitres apparaîtront ici.")
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Ton historique d'écoute, découpé en chapitres : une ère commence quand tes artistes changent.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.subdued)
                            .padding(.bottom, 20)
                        ForEach(Array(eras.enumerated()), id: \.element.id) { index, era in
                            EraRow(era: era, number: eras.count - index, last: index == eras.count - 1)
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("Tes ères")
    }
}

private struct EraRow: View {
    let era: Era
    let number: Int
    let last: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            // The timeline: a dot per chapter, joined by a line.
            VStack(spacing: 0) {
                Circle()
                    .fill(era.current ? Theme.green : Theme.subdued)
                    .frame(width: 12, height: 12)
                    .padding(.top, 22)
                if !last {
                    Rectangle().fill(Theme.highlight).frame(width: 2).frame(maxHeight: .infinity)
                }
            }
            .frame(width: 12)
            EraCard(era: era, number: number).padding(.bottom, 18)
        }
    }
}

struct EraCard: View {
    let era: Era
    var number: Int?
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player

    private var isPlaying: Bool {
        player.isPlaying && era.tracks.contains { $0.id == player.current?.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text([number.map { "Chapitre \($0)" }, era.span()].compactMap { $0 }.joined(separator: " • ").uppercased())
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.75))
                    if era.current {
                        Text("En cours")
                            .font(.caption2.bold())
                            .foregroundStyle(.black)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Theme.green, in: Capsule())
                    }
                }
                Text(era.title).font(.title2.weight(.heavy)).fixedSize(horizontal: false, vertical: true)
                Text("\(era.plays) écoutes").font(.subheadline).foregroundStyle(.white.opacity(0.7))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(era.artists) { artist in
                        NavigationLink(value: Route.artist(artist.id)) {
                            VStack(spacing: 4) {
                                RemoteImage(url: session.api?.pictureURL(artist: artist.artist), placeholder: "person.fill")
                                    .frame(width: 48, height: 48)
                                    .clipShape(Circle())
                                Text(artist.name).font(.caption2).lineLimit(1)
                            }
                            .frame(width: 64)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Button {
                if isPlaying { player.togglePlay() } else { player.play(era.tracks, startAt: 0) }
            } label: {
                Label(isPlaying ? "Pause" : "Réécouter cette ère", systemImage: isPlaying ? "pause.fill" : "play.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.black)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .background(Theme.green, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack {
                Theme.elevated
                if let hero = era.artists.first {
                    RemoteImage(url: session.api?.pictureURL(artist: hero.artist))
                        .scaledToFill()
                        .blur(radius: 30)
                        .brightness(-0.4)
                        .saturation(1.3)
                }
            }
            .clipped()
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
