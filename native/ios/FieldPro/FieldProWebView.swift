import SwiftUI
import WebKit

/// Wraps the existing authenticated web client and exposes a narrow native AR bridge.
final class FieldProBridge: NSObject, ObservableObject, WKScriptMessageHandler {
    let webView: WKWebView
    @Published var presentingMeasurement = false

    override init() {
        let controller = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let injection = """
        window.FieldProNativeAR = {
          available: true,
          open: function () {
            window.webkit.messageHandlers.fieldProAR.postMessage({ action: "measure" });
          }
        };
        """
        controller.addUserScript(WKUserScript(
            source: injection, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.add(self, name: "fieldProAR")
        controller.add(self, name: "fieldProPush")
        webView.allowsBackForwardNavigationGestures = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(apnsTokenArrived(_:)),
            name: .fieldProApnsToken, object: nil)
        if let url = URL(string: "https://curb-connect-web.onrender.com/curb") {
            webView.load(URLRequest(url: url))
        }
    }

    @objc private func apnsTokenArrived(_ note: Notification) {
        guard let token = note.object as? String else { return }
        injectApnsToken(token)
    }

    /// Hands the APNs token to the web app, whose NativeDeviceBridge registers it via
    /// POST /v1/devices (platform "ios"). The token goes nowhere else.
    func injectApnsToken(_ token: String) {
        let escaped = token.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        window.__fieldProNativeToken = "\(escaped)";
        window.dispatchEvent(new CustomEvent('fieldpro-native-token', { detail: "\(escaped)" }));
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "curb-connect-web.onrender.com",
              let object = message.body as? [String: String] else { return }
        if message.name == "fieldProAR", object["action"] == "measure" {
            DispatchQueue.main.async { self.presentingMeasurement = true }
        } else if message.name == "fieldProPush", object["action"] == "token" {
            // The page asks for the current token (e.g. after sign-in); re-inject it.
            if let token = NativePushBridge.shared.apnsToken {
                injectApnsToken(token)
            }
        }
    }

    func sendMeasurement(_ result: NativeMeasurementResult) {
        let feet = result.feet
        guard feet.isFinite, feet > 0, feet < 1000 else { return }
        let result: [String: Any] = [
            "feet": feet, "method": result.method,
            "lidarAvailable": result.lidarAvailable, "lidarPoints": result.lidarPoints,
            "raycastPoints": result.raycastPoints, "verified": false
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.dispatchEvent(new CustomEvent('fieldpro:ar-result', {detail:\(json)}));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "fieldProAR")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "fieldProPush")
        NotificationCenter.default.removeObserver(self)
    }
}

private struct FieldProEmbeddedWebView: UIViewRepresentable {
    let bridge: FieldProBridge
    func makeUIView(context: Context) -> WKWebView { bridge.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct FieldProWebContainer: View {
    @StateObject private var bridge = FieldProBridge()
    var body: some View {
        FieldProEmbeddedWebView(bridge: bridge)
            .ignoresSafeArea()
            .sheet(isPresented: $bridge.presentingMeasurement) {
                NativeCurbARView { result in
                    bridge.sendMeasurement(result)
                    bridge.presentingMeasurement = false
                }
            }
    }
}
