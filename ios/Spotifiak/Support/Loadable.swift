import SpotifiakCore
import SwiftUI

/// Loads a value, then shows it; a spinner meanwhile, "Serveur injoignable" with a retry on failure.
struct Loadable<Value: Sendable, Content: View>: View {
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var error: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let error {
                ContentUnavailableView {
                    Label(error, systemImage: "wifi.exclamationmark")
                } actions: {
                    Button("Réessayer") { Task { await run() } }
                }
            } else {
                ProgressView()
            }
        }
        .task { await run() }
        .refreshable { await run() }
    }

    private func run() async {
        do {
            value = try await load()
            error = nil
        } catch is CancellationError {
        } catch let apiError as APIError where apiError.status != 0 {
            error = apiError.message
        } catch {
            self.error = "Serveur injoignable"
        }
    }
}

extension Session {
    /// The API, or a "not connected" error for loaders.
    func requireAPI() throws -> APIClient {
        guard let api else { throw APIError(message: "Serveur injoignable", status: 0) }
        return api
    }
}

/// Destinations pushed on each tab's NavigationStack.
enum Route: Hashable {
    case album(String)
    case artist(String)
}
