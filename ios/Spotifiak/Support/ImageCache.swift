import CryptoKit
import Foundation
import UIKit

/// Images by URL, in memory and on disk (Caches/Images). Loads through URLSession.shared,
/// so the session cookie reaches the cookie-protected /tracks/:id/cover.
actor ImageCache {
    static let shared = ImageCache()

    private let memory = NSCache<NSURL, UIImage>()
    private let directory: URL
    private var loading: [URL: Task<UIImage?, Never>] = [:]

    init() {
        directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "Images")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func image(for url: URL) async -> UIImage? {
        if let image = memory.object(forKey: url as NSURL) { return image }
        if let task = loading[url] { return await task.value }

        let file = directory.appending(path: Self.fileName(url))
        let task = Task<UIImage?, Never> {
            if let data = try? Data(contentsOf: file), let image = UIImage(data: data) { return image }
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let image = UIImage(data: data) else { return nil }
            try? data.write(to: file, options: .atomic)
            return image
        }
        loading[url] = task
        let image = await task.value
        loading[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }

    private static func fileName(_ url: URL) -> String {
        SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
