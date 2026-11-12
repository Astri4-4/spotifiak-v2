import Foundation

/// What a tapped push notification opens: the `link` the server puts in its payload.
public enum PushLink: Equatable, Sendable {
    case inbox
    case friends
    case person(String)
    case podcast(String)

    public init?(_ link: String) {
        let parts = link.split(separator: "/", maxSplits: 1).map(String.init)
        switch (parts.first, parts.count) {
        case ("inbox", 1): self = .inbox
        case ("friends", 1): self = .friends
        case ("person", 2): self = .person(parts[1])
        case ("podcast", 2): self = .podcast(parts[1])
        default: return nil
        }
    }
}

public enum PushToken {
    /// The APNs device token as the server stores it: lowercase hex.
    public static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// The `aps-environment` entitlement ("development" or "production") of an
    /// embedded.mobileprovision: a signed (CMS) envelope around an XML plist.
    public static func apsEnvironment(provisioningProfile data: Data) -> String? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: Data(data[start.lowerBound..<end.upperBound]), format: nil),
              let entitlements = (plist as? [String: Any])?["Entitlements"] as? [String: Any]
        else { return nil }
        return entitlements["aps-environment"] as? String
    }
}
