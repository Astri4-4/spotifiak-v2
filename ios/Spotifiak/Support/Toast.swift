import SwiftUI

extension View {
    /// A short message at the top of the screen (the view model clears it).
    func toast(_ text: String?) -> some View {
        overlay(alignment: .top) {
            if let text {
                Text(text)
                    .font(.subheadline)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: text)
    }
}
