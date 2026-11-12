import Foundation
import Observation
import SpotifiakCore
import UIKit
import UserNotifications

/// Push notifications (APNs): asks permission once logged in, gives the server this iPhone's token,
/// and keeps what a tapped notification should open. They need the app signed with the Push
/// capability, which takes a paid Apple Developer account (see .github/workflows/ios-release.yml).
@MainActor @Observable
final class PushNotifications {
    /// Shared with the app delegate, which iOS may call before any view exists (a tap that launches the app).
    static let shared = PushNotifications()

    /// What a tapped notification opens; RootView takes it once logged in.
    var opened: PushLink?
    /// Bumped when a notification arrives while the app is in front.
    private(set) var received = 0

    @ObservationIgnored var api: () -> APIClient? = { nil }

    /// After login and at launch: asks permission (iOS only asks once) and registers with APNs,
    /// which answers in `didRegister`.
    func start() async {
        let granted = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        guard granted == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(_ deviceToken: Data) {
        let token = PushToken.hex(deviceToken)
        let topic = Bundle.main.bundleIdentifier ?? ""
        Task { try? await api()?.registerPushDevice(token: token, topic: topic, sandbox: Self.sandbox) }
    }

    func didReceive() {
        received += 1
    }

    func open(_ link: String?) {
        opened = link.flatMap(PushLink.init)
    }

    /// The app icon's badge, kept equal to the "Amis" tab's.
    func setBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(count, withCompletionHandler: nil)
    }

    /// Whether APNs gave a sandbox token: development-signed builds (SideStore, Xcode) carry
    /// aps-environment "development" in their profile; App Store builds have no embedded profile.
    private static let sandbox: Bool = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url)
        else { return false }
        return PushToken.apsEnvironment(provisioningProfile: data) != "production"
    }()
}

/// Receives the APNs token and the notifications, for `PushNotifications`.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushNotifications.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // No Push capability in this build's signature (e.g. a free Apple account): the app works without.
    }

    // In front: show it anyway, and let the badge refresh.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await PushNotifications.shared.didReceive()
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let link = response.notification.request.content.userInfo["link"] as? String
        await PushNotifications.shared.open(link)
    }
}
