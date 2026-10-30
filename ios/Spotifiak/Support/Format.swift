import Foundation

/// "3:07", "1:02:03"; "–" when unknown.
func formatDuration(_ seconds: Double?) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else { return "–" }
    let total = Int(seconds.rounded(.down))
    let hours = total / 3600, minutes = total / 60 % 60, rest = total % 60
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, rest)
        : String(format: "%d:%02d", minutes, rest)
}

/// The Home title, same hours as the web app.
func greeting(at date: Date, calendar: Calendar) -> String {
    let hour = calendar.component(.hour, from: date)
    if hour < 5 || hour >= 18 { return "Bonsoir" }
    if hour < 12 { return "Bonjour" }
    return "Bon après-midi"
}
