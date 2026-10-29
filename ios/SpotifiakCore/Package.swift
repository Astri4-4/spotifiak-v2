// swift-tools-version: 6.0
// Pure logic of the iOS app (models, API client, queue): Foundation only, so it builds
// and tests on Linux as well as on Apple platforms.
import PackageDescription

let package = Package(
    name: "SpotifiakCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SpotifiakCore", targets: ["SpotifiakCore"])],
    targets: [
        .target(name: "SpotifiakCore"),
        .testTarget(name: "SpotifiakCoreTests", dependencies: ["SpotifiakCore"], resources: [.copy("Fixtures")]),
    ]
)
