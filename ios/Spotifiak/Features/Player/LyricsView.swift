import SpotifiakCore
import SwiftUI

/// A track's lyrics in the full-screen player. Synced lyrics follow the music: the current line
/// is lit and kept centred, and tapping a line plays from there.
struct LyricsView: View {
    let lyrics: Lyrics
    @Environment(PlayerEngine.self) private var player

    /// Lines light up slightly early: the position only updates twice a second.
    private static let lead = 0.3

    var body: some View {
        if lyrics.isEmpty {
            ContentUnavailableView(
                lyrics.instrumental ? "Titre instrumental" : "Pas de paroles pour ce titre",
                systemImage: lyrics.instrumental ? "pianokeys" : "text.quote"
            )
        } else {
            let current = lyrics.currentLine(at: player.position + Self.lead)
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(Array(lyrics.lines.enumerated()), id: \.offset) { index, line in
                            Text(line.text.isEmpty ? "♪" : line.text)
                                .font(lyrics.synced ? .title2.bold() : .title3.weight(.semibold))
                                .foregroundStyle(color(of: index, current: current))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    if let time = line.time { player.seek(to: time) }
                                }
                                .id(index)
                        }
                        if lyrics.source == "lrclib" {
                            Text("Paroles : LRCLIB").font(.caption).foregroundStyle(Theme.subdued).padding(.top, 8)
                        }
                    }
                    .padding(.vertical, 48)
                    .animation(.easeOut(duration: 0.2), value: current)
                }
                .onAppear {
                    if let current { proxy.scrollTo(current, anchor: .center) }
                }
                .onChange(of: current) { _, index in
                    guard let index else { return }
                    withAnimation(.easeInOut(duration: 0.4)) { proxy.scrollTo(index, anchor: .center) }
                }
            }
            // Lines fade out at the edges.
            .mask {
                LinearGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.08),
                    .init(color: .black, location: 0.92),
                    .init(color: .clear, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            }
        }
    }

    private func color(of index: Int, current: Int?) -> Color {
        guard lyrics.synced else { return .white }
        if index == current { return .white }
        if let current, index < current { return .white.opacity(0.6) }
        return .white.opacity(0.35)
    }
}
