import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import SpotifiakCore

@Test func pushLinksParseWhatTheServerSends() {
    #expect(PushLink("inbox") == .inbox)
    #expect(PushLink("friends") == .friends)
    #expect(PushLink("person/u1") == .person("u1"))
    #expect(PushLink("podcast/p1") == .podcast("p1"))
    #expect(PushLink("podcast") == nil)
    #expect(PushLink("inbox/x") == nil)
    #expect(PushLink("unknown/1") == nil)
}

@Test func pushTokensAreLowercaseHex() {
    #expect(PushToken.hex(Data([0x00, 0xab, 0x7f, 0xff])) == "00ab7fff")
}

@Test func apsEnvironmentComesFromTheProfilesPlist() {
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict>
    <key>Name</key><string>SideStore</string>
    <key>Entitlements</key><dict><key>aps-environment</key><string>development</string></dict>
    </dict></plist>
    """
    // The plist sits inside a binary CMS envelope.
    let profile = Data([0x30, 0x82, 0x0f, 0x00, 0x06, 0x09]) + Data(plist.utf8) + Data([0xa0, 0x82, 0x00])
    #expect(PushToken.apsEnvironment(provisioningProfile: profile) == "development")
    #expect(PushToken.apsEnvironment(provisioningProfile: Data(plist.replacingOccurrences(of: "aps-environment", with: "other").utf8)) == nil)
    #expect(PushToken.apsEnvironment(provisioningProfile: Data([0x30, 0x82])) == nil)
}

@Test func registerPushDeviceSendsTokenTopicAndEnvironment() async throws {
    let transport = FakeTransport()
    transport.respond("https://h/api/me/push-device", #"{"enabled":true}"#)
    let client = APIClient(base: URL(string: "https://h/api")!, transport: transport, onUnauthorized: {})
    try await client.registerPushDevice(token: "00ab", topic: "dev.spotifiak.ios.TEAM", sandbox: true)
    let request = try #require(transport.requests.first)
    #expect(request.httpMethod == "PUT")
    let body = try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: Any]
    #expect(body?["token"] as? String == "00ab")
    #expect(body?["topic"] as? String == "dev.spotifiak.ios.TEAM")
    #expect(body?["sandbox"] as? Bool == true)
}
