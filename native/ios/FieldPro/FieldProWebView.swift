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
        webView.allowsBackForwardNavigationGestures = true
        if let url = URL(string: "https://curb-connect-web.onrender.com/curb") {
            webView.load(URLRequest(url: url))
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "fieldProAR",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "curb-connect-web.onrender.com",
              let object = message.body as? [String: String],
              object["action"] == "measure" else { return }
        DispatchQueue.main.async { self.presentingMeasurement = true }
    }

    func sendMeasurement(_ feet: Double, lidarAvailable: Bool) {
        guard feet.isFinite, feet > 0, feet < 1000 else { return }
        let result: [String: Any] = [
            "feet": feet, "method": "arkit",
            "lidarAvailable": lidarAvailable, "verified": false
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.dispatchEvent(new CustomEvent('fieldpro:ar-result', {detail:\(json)}));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "fieldProAR")
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
                    bridge.sendMeasurement(result.feet, lidarAvailable: result.lidarAvailable)
                    bridge.presentingMeasurement = false
                }
            }
    }
}
