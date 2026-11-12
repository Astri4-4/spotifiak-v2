import SpotifiakCore
import SwiftUI

/// A Daily Mix or an "Entre amis" mix: made by the server from what people listen to, new every day.
struct MixView: View {
    let id: String
    @Environment(Session.self) private var session

    var body: some View {
        Loadable(load: { try await session.requireAPI().mix(id) }) { mix in
            DetailPage(colorURL: mix.covers.first.flatMap { session.api?.coverURL(mosaic: $0) }, tracks: mix.tracks) {
                MixArt(kind: mix.kind, title: mix.title, covers: mix.covers, labelFont: .title2.weight(.heavy))
            } info: {
                Text(mix.title).font(.title2.bold())
                Text(mix.friend.map { "Chaque titre vient de toi, de \($0.displayName) ou de vous deux." } ?? mix.description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.subdued)
                HStack(spacing: 6) {
                    if let friend = mix.friend { Avatar(person: friend, size: 20) }
                    Text("Mis à jour chaque jour • \(trackCount(mix.tracks.count))")
                }
                .font(.caption)
                .foregroundStyle(Theme.subdued)
            } actions: {
                EmptyView()
            } content: {
                LazyVStack(spacing: 0) {
                    ForEach(mix.tracks.indices, id: \.self) { index in
                        TrackRow(tracks: mix.tracks, index: index, badge: badge(mix, index))
                            .padding(.leading)
                            .padding(.trailing, 8)
                            .padding(.vertical, 6)
                    }
                }
                .padding(.bottom)
            }
        }
    }

    /// In "Entre amis": whose taste the track comes from, as their pictures.
    private func badge(_ mix: MixDetail, _ index: Int) -> AnyView? {
        guard let friend = mix.friend, let source = mix.source(at: index),
              case .loggedIn(let me) = session.state
        else { return nil }
        let label = switch source {
        case .both: "De toi et \(friend.displayName)"
        case .me: "De toi"
        case .friend: "De \(friend.displayName)"
        }
        return AnyView(
            HStack(spacing: -6) {
                if source != .friend { Avatar(person: me, size: 22) }
                if source != .me {
                    Avatar(person: friend, size: 22)
                        .overlay(Circle().stroke(Theme.base, lineWidth: 2))
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
        )
    }
}

/// A mix's cover: its tracks' mosaic with the mix's name across the bottom, like Spotify's.
struct MixArt: View {
    let kind: MixSummary.Kind
    let title: String
    let covers: [MosaicCover]
    var labelFont: Font = .footnote.weight(.heavy)

    init(mix: MixSummary) {
        self.init(kind: mix.kind, title: mix.title, covers: mix.covers)
    }

    init(kind: MixSummary.Kind, title: String, covers: [MosaicCover], labelFont: Font = .footnote.weight(.heavy)) {
        self.kind = kind
        self.title = title
        self.covers = covers
        self.labelFont = labelFont
    }

    var body: some View {
        Mosaic(covers: covers)
            .overlay(alignment: .bottomLeading) {
                Text(kind == .blend ? "Entre amis" : title)
                    .font(labelFont)
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.3), radius: 1, y: 1)
                    .padding(.horizontal, 10)
                    .padding(.top, 28)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(LinearGradient(colors: [.clear, color.opacity(0.92)], startPoint: .top, endPoint: .center))
            }
            .clipped()
    }

    private var color: Color {
        kind == .blend ? Color(red: 0.63, green: 0.31, blue: 0.86) : Theme.green
    }
}
