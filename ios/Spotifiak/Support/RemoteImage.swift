import SwiftUI

/// An image from ImageCache, with a neutral placeholder while it loads or when there is none.
struct RemoteImage: View {
    let url: URL?
    var placeholder = "music.note"
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Color.secondary.opacity(0.2)
                Image(systemName: placeholder).foregroundStyle(.secondary)
            }
        }
        .task(id: url) {
            image = nil
            guard let url else { return }
            image = await ImageCache.shared.image(for: url)
        }
    }
}
