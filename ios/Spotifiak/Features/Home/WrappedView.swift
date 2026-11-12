import SpotifiakCore
import SwiftUI

/// The user's year in Spotifiak, like Spotify Wrapped: minutes, top tracks, artists and genres.
struct WrappedView: View {
    @Environment(Session.self) private var session
    @State private var year: Int?

    var body: some View {
        Loadable(load: { try await session.requireAPI().wrapped(year: year) }) { wrapped in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if wrapped.years.count > 1 {
                        Picker("Année", selection: Binding(get: { wrapped.year }, set: { year = $0 })) {
                            ForEach(wrapped.years, id: \.self) { Text(String($0)).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal)
                    }
                    if wrapped.plays == 0 {
                        ContentUnavailableView(
                            "Rien d'écouté en \(String(wrapped.year))",
                            systemImage: "chart.bar",
                            description: Text("Lance quelques titres : ton année se remplit au fil des écoutes.")
                        )
                    } else {
                        content(wrapped)
                    }
                }
                .padding(.vertical)
            }
            .navigationTitle("Ton année \(String(wrapped.year))")
        }
        // A new year loads anew.
        .id(year)
    }

    @ViewBuilder
    private func content(_ wrapped: Wrapped) -> some View {
        LazyVGrid(columns: [GridItem(spacing: 12), GridItem(spacing: 12)], spacing: 12) {
            stat(wrapped.minutes.formatted(), "minutes d'écoute")
            stat(wrapped.plays.formatted(), "titres lancés")
            if let genre = wrapped.topGenres.first { stat(genre.name, "ton genre préféré") }
        }
        .padding(.horizontal)

        if !wrapped.topArtists.isEmpty {
            Shelf(title: "Tes artistes préférés") {
                ForEach(wrapped.topArtists) { ArtistCard(artist: $0) }
            }
        }

        if !wrapped.topTracks.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Tes titres préférés").font(.title2.bold()).padding(.horizontal).padding(.bottom, 8)
                ForEach(wrapped.topTracks.indices, id: \.self) { index in
                    TrackRow(tracks: wrapped.topTracks, index: index, badge: AnyView(
                        Text("\(wrapped.trackPlays[index]) écoute\(wrapped.trackPlays[index] > 1 ? "s" : "")")
                            .font(.caption)
                            .foregroundStyle(Theme.subdued)
                    ))
                    .padding(.leading)
                    .padding(.trailing, 8)
                    .padding(.vertical, 6)
                }
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title.weight(.heavy)).lineLimit(1).minimumScaleFactor(0.5)
            Text(label).font(.subheadline).foregroundStyle(Theme.subdued)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Theme.highlight, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}
