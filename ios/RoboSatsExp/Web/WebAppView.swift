import SwiftUI
import WebKit

struct WebAppView: UIViewRepresentable {
    @ObservedObject var tor: TorManager
    @Binding var isReady: Bool

    func makeCoordinator() -> WebBridge {
        WebBridge(diagnostics: tor.diagnostics) { ready in
            isReady = ready
        }
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: WebBridge.messageHandlerName)
        contentController.addUserScript(
            WKUserScript(
                source: context.coordinator.bootstrapScript(),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        contentController.addUserScript(
            WKUserScript(
                source: """
                (() => {
                  window.addEventListener('robosats:app-ready', () => {
                    window.webkit.messageHandlers.robosats.postMessage({ method: 'clientReady' });
                  }, { once: true });
                  const report = (kind, value) => {
                    const message = value?.message || String(value || kind);
                    window.webkit.messageHandlers.robosats.postMessage({ method: 'clientLog', message: `${kind}: ${message}` });
                  };
                  window.addEventListener('error', event => report('error', event.error || event.message));
                  window.addEventListener('unhandledrejection', event => report('rejection', event.reason));
                })();
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(WebAppSchemeHandler(), forURLScheme: WebBridge.appScheme)
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.customUserAgent = "RoboSatsExp/\(AppVersion.marketing) iOS"
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        context.coordinator.attach(to: webView)
        AppDiagnostics.shared.record("Web", "Loading bundled frontend")
        webView.load(URLRequest(url: URL(string: "\(WebBridge.appScheme)://app/index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.updateDiagnostics(tor.diagnostics, notify: tor.isReady)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: WebBridge) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: WebBridge.messageHandlerName)
        webView.stopLoading()
        TorNetworkClient.shared.deactivate()
    }
}
