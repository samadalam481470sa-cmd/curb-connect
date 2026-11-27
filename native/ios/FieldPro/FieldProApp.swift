import SwiftUI
import UIKit
import UserNotifications

@main struct FieldProApp: App {
    @UIApplicationDelegateAdaptor(FieldProAppDelegate.self) private var appDelegate
    var body: some Scene {
        WindowGroup { FieldProWebContainer() }
    }
}

/// APNs registration for the native shell. Compiled only with the FIELDPRO_NATIVE_PUSH
/// build flag (see project.yml) — without it the shell is a plain web + AR wrapper.
///
/// Registering a token is only half of push: the web app records the token through
/// POST /v1/devices (platform "ios"), and the server reports iOS delivery as
/// `native_push_not_connected` until the owner has an Apple Developer account and an
/// APNs auth key wired into the server sender. Nothing here claims otherwise.
final class FieldProAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        #if FIELDPRO_NATIVE_PUSH
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                application.registerForRemoteNotifications()
            }
        }
        #endif
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NativePushBridge.shared.apnsToken = token
        NotificationCenter.default.post(name: .fieldProApnsToken, object: token)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // No token reaches the web app; the in-app devices screen already reports the
        // honest not-connected state for iOS.
    }
}

extension Notification.Name {
    static let fieldProApnsToken = Notification.Name("fieldpro-native-token")
}

/// Holds the latest APNs token so the web bridge can inject it into the page on load.
final class NativePushBridge {
    static let shared = NativePushBridge()
    var apnsToken: String?
    private init() {}
}
