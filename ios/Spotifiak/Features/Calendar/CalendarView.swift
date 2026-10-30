import SpotifiakCore
import SwiftUI

/// New releases and upcoming shows of the followed artists, on a month view: green dots for
/// releases, pink for shows; tapping a day lists only that day. The server loads its sources
/// in the background, so this asks again every 3 s while some artists are still loading.
struct CalendarView: View {
    @Environment(Session.self) private var session
    @State private var calendar: ArtistCalendar?
    @State private var error: String?
    @State private var month = Calendar.current.dateInterval(of: .month, for: .now)!.start
    @State private var selected: String?

    private var isAdmin: Bool {
        if case .loggedIn(let user) = session.state { return user.role == .admin }
        return false
    }

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(Theme.error) }

            Section {
                MonthGrid(month: $month, selected: $selected,
                          releaseDays: Set(calendar?.releases.map(\.date) ?? []),
                          concertDays: Set(calendar?.concerts.map(\.date) ?? []))
            } footer: {
                HStack(spacing: 6) {
                    Circle().fill(Theme.green).frame(width: 6, height: 6)
                    Text("Sortie")
                    Circle().fill(Self.concertColor).frame(width: 6, height: 6).padding(.leading, 8)
                    Text("Concert")
                    if let loading = calendar?.loading, loading > 0 {
                        Text("• chargement de \(loading) artiste\(loading > 1 ? "s" : "")…")
                    }
                }
            }

            if let selected {
                Section {
                    Button("\(longDate(selected)) • Tout afficher") { self.selected = nil }
                }
            }

            Section("Nouvelles sorties") {
                let releases = calendar?.releases.filter { selected == nil || $0.date == selected } ?? []
                if calendar != nil && releases.isEmpty {
                    Text(selected == nil ? "Aucune sortie ces six derniers mois." : "Aucune sortie ce jour-là.")
                        .foregroundStyle(Theme.subdued)
                }
                ForEach(releases, id: \.self) { ReleaseRow(release: $0) }
            }

            Section("Concerts à venir") {
                let concerts = calendar?.concerts.filter { selected == nil || $0.date == selected } ?? []
                if let calendar, !calendar.concertsEnabled {
                    Text(isAdmin
                        ? "Les concerts viennent de Ticketmaster : créez une clé gratuite sur developer.ticketmaster.com et renseignez TICKETMASTER_API_KEY dans la configuration de l'API."
                        : "Les concerts ne sont pas activés sur ce serveur.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.subdued)
                } else if calendar != nil && concerts.isEmpty {
                    Text(selected == nil ? "Aucun concert annoncé." : "Aucun concert ce jour-là.").foregroundStyle(Theme.subdued)
                }
                ForEach(concerts, id: \.self) { ConcertRow(concert: $0) }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Calendrier")
        .refreshable { await load() }
        .task {
            await load()
            while calendar?.loading ?? 0 > 0, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                await load()
            }
        }
    }

    static let concertColor = Color(red: 0.96, green: 0.45, blue: 0.63)

    private func load() async {
        do {
            calendar = try await session.requireAPI().calendar()
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }
}

/// "YYYY-MM-DD" of a day in the user's calendar.
func isoDay(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// "jeudi 16 octobre 2026" from "2026-10-16".
func longDate(_ iso: String) -> String {
    guard let date = try? Date(iso + "T12:00:00Z", strategy: .iso8601) else { return iso }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide).year().locale(Locale(identifier: "fr_FR")))
}

/// The month's days, Monday first, with dots for releases and shows.
private struct MonthGrid: View {
    @Binding var month: Date
    @Binding var selected: String?
    let releaseDays: Set<String>
    let concertDays: Set<String>

    private var calendar: Calendar {
        var calendar = Calendar.current
        calendar.firstWeekday = 2
        return calendar
    }

    /// The month's days, preceded by blanks up to its first weekday.
    private var cells: [Date?] {
        let days = calendar.range(of: .day, in: .month, for: month)!.count
        let offset = (calendar.component(.weekday, from: month) - calendar.firstWeekday + 7) % 7
        return Array(repeating: nil, count: offset)
            + (0..<days).map { calendar.date(byAdding: .day, value: $0, to: month) }
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .accessibilityLabel("Mois précédent")
                Spacer()
                Text(month.formatted(.dateTime.month(.wide).year().locale(Locale(identifier: "fr_FR"))).capitalized)
                    .font(.headline)
                Spacer()
                Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .accessibilityLabel("Mois suivant")
            }
            .buttonStyle(.borderless)

            let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."], id: \.self) {
                    Text($0).font(.caption2).foregroundStyle(Theme.subdued)
                }
                ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                    if let day { dayCell(day) } else { Color.clear.frame(height: 44) }
                }
            }
        }
    }

    private func dayCell(_ day: Date) -> some View {
        let iso = isoDay(day)
        let hasRelease = releaseDays.contains(iso)
        let hasConcert = concertDays.contains(iso)
        let isToday = iso == isoDay(.now)
        return Button { selected = selected == iso ? nil : iso } label: {
            VStack(spacing: 3) {
                Text("\(calendar.component(.day, from: day))")
                    .font(.subheadline.weight(isToday ? .bold : .regular))
                    .foregroundStyle(isToday ? Theme.green : .white)
                HStack(spacing: 3) {
                    if hasRelease { Circle().fill(Theme.green).frame(width: 5, height: 5) }
                    if hasConcert { Circle().fill(CalendarView.concertColor).frame(width: 5, height: 5) }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(selected == iso ? Theme.highlight : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel([longDate(iso), hasRelease ? "nouvelle sortie" : nil, hasConcert ? "concert" : nil]
            .compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(selected == iso ? .isSelected : [])
    }

    private func shift(_ months: Int) {
        month = calendar.date(byAdding: .month, value: months, to: month)!
    }
}

/// Cover, title, type and artist; "Ouvrir" when it's in the library, download otherwise.
private struct ReleaseRow: View {
    let release: CalendarRelease
    @Environment(Session.self) private var session
    @Environment(PlayerEngine.self) private var player
    @Environment(\.navigate) private var navigate
    @State private var queued = false

    private static let types = ["album": "Album", "single": "Single", "ep": "EP", "compile": "Compilation"]

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(url: release.coverUrl).frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 2) {
                Text(release.title).lineLimit(1)
                Text("\(Self.types[release.type] ?? "Sortie") • \(release.artist.name)")
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
                    .lineLimit(1)
                Text(longDate(release.date)).font(.caption).foregroundStyle(Theme.subdued)
            }
            Spacer(minLength: 8)
            if let albumId = release.albumId {
                Button("Ouvrir") { navigate(.album(albumId)) }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
            } else {
                Button(action: download) {
                    Image(systemName: queued ? "checkmark.circle.fill" : "arrow.down.circle")
                        .font(.title2)
                        .foregroundStyle(queued ? Theme.green : Theme.subdued)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(queued)
                .accessibilityLabel(queued ? "Téléchargement lancé" : "Télécharger \(release.title)")
            }
        }
    }

    private func download() {
        queued = true
        Task {
            do {
                try await session.requireAPI().download(release.link)
                player.showToast("Téléchargement lancé : la sortie apparaîtra dans votre bibliothèque")
            } catch {
                queued = false
                player.showToast((error as? APIError)?.message ?? "Téléchargement impossible")
            }
        }
    }
}

/// Date block, artist, venue and time; "Billets" opens the ticket page.
private struct ConcertRow: View {
    let concert: CalendarConcert

    var body: some View {
        HStack(spacing: 12) {
            let date = (try? Date(concert.date + "T12:00:00Z", strategy: .iso8601)) ?? .now
            VStack(spacing: 0) {
                Text(date.formatted(.dateTime.month(.abbreviated).locale(Locale(identifier: "fr_FR"))).uppercased())
                    .font(.caption2)
                    .foregroundStyle(Theme.subdued)
                Text(date.formatted(.dateTime.day())).font(.title3.bold())
            }
            .frame(width: 56, height: 56)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(concert.artist.name).lineLimit(1)
                    if concert.cancelled {
                        Text("ANNULÉ").font(.caption2.bold()).foregroundStyle(Theme.error)
                    }
                }
                Text([concert.venue, concert.city, concert.country].compactMap { $0 }.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
                    .lineLimit(2)
                Text(longDate(concert.date) + (concert.time.map { " à \($0.replacingOccurrences(of: ":", with: "h"))" } ?? ""))
                    .font(.caption)
                    .foregroundStyle(Theme.subdued)
            }
            .opacity(concert.cancelled ? 0.6 : 1)
            Spacer(minLength: 8)
            if let url = concert.url, !concert.cancelled {
                Link("Billets", destination: url)
                    .font(.caption.bold())
                    .foregroundStyle(.black)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(Theme.green, in: Capsule())
                    .buttonStyle(.borderless)
            }
        }
    }
}
