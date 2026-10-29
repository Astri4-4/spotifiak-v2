import Foundation

/// The API addresses to try, in order, for what the user typed as their server.
///
/// The web deployment serves the API under /api (nginx), a bare API at the root; without
/// a scheme, https comes first and http is the fallback for LAN servers.
public func candidateAPIBases(_ input: String) -> [URL] {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    while text.hasSuffix("/") { text.removeLast() }
    guard !text.isEmpty else { return [] }

    let schemes: [String]
    if let range = text.range(of: "://") {
        schemes = [text[..<range.lowerBound].lowercased()]
        text = String(text[range.upperBound...])
    } else {
        schemes = ["https", "http"]
    }
    guard schemes.allSatisfy({ $0 == "https" || $0 == "http" }) else { return [] }

    return schemes.flatMap { scheme -> [URL] in
        guard var components = URLComponents(string: "\(scheme)://\(text)"), let host = components.host, !host.isEmpty else { return [] }
        components.host = host.lowercased()
        guard let url = components.url else { return [] }
        if components.path.hasSuffix("/api") { return [url] }
        return [url.appendingPathComponent("api"), url]
    }
}
