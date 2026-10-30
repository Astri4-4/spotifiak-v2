import CoreImage
import SwiftUI
import UIKit

extension ImageCache {
    /// The cover's average color, darkened enough for white text over it (like Spotify's headers).
    func color(for url: URL) async -> Color? {
        guard let image = await image(for: url), let input = CIImage(image: image) else { return nil }
        let filter = CIFilter(name: "CIAreaAverage", parameters: [kCIInputImageKey: input, kCIInputExtentKey: CIVector(cgRect: input.extent)])
        guard let output = filter?.outputImage else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext(options: [.workingColorSpace: NSNull()])
            .render(output, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0
        UIColor(red: CGFloat(pixel[0]) / 255, green: CGFloat(pixel[1]) / 255, blue: CGFloat(pixel[2]) / 255, alpha: 1)
            .getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: nil)
        return Color(hue: hue, saturation: min(saturation * 1.2, 0.75), brightness: min(max(brightness, 0.3), 0.5))
    }
}

extension View {
    /// Sets `color` to the color of the cover at `url` (the fallback until it loads, or without one).
    func coverColor(_ url: URL?, into color: Binding<Color>, fallback: Color = Theme.headerGray) -> some View {
        task(id: url) {
            guard let url else { color.wrappedValue = fallback; return }
            let loaded = await ImageCache.shared.color(for: url)
            withAnimation(.easeOut(duration: 0.3)) { color.wrappedValue = loaded ?? fallback }
        }
    }
}
