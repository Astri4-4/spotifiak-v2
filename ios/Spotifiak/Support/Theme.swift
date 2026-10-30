import SwiftUI

/// The web app's palette (frontend/src/index.css).
enum Theme {
    static let base = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255)
    static let elevated = Color(red: 0x1f / 255, green: 0x1f / 255, blue: 0x1f / 255)
    static let highlight = Color.white.opacity(0.1)
    static let subdued = Color(red: 0xb3 / 255, green: 0xb3 / 255, blue: 0xb3 / 255)
    static let green = Color(red: 0x1e / 255, green: 0xd7 / 255, blue: 0x60 / 255)
    static let error = Color(red: 0xf3 / 255, green: 0x72 / 255, blue: 0x7f / 255)

    /// Header color while the cover's own one loads.
    static let headerGray = Color(white: 0.33)
    /// "Titres likés": Spotify's purple-to-blue.
    static let liked = LinearGradient(colors: [Color(red: 0.27, green: 0.16, blue: 0.82), Color(red: 0.55, green: 0.73, blue: 0.85)],
                                      startPoint: .topLeading, endPoint: .bottomTrailing)

    /// Page header: `color` fading into the background.
    static func header(_ color: Color) -> LinearGradient {
        LinearGradient(colors: [color, base], startPoint: .top, endPoint: .bottom)
    }
}

/// The round green play button of album and artist pages.
struct BigPlayButton: View {
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.title2)
                .foregroundStyle(.black)
                .frame(width: 56, height: 56)
                .background(Theme.green, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isPlaying ? "Pause" : "Lecture")
    }
}
