import Foundation
import UIKit
import WebKit

@MainActor
final class WebBridge: NSObject {
    static let messageHandlerName = "robosats"
    static let appScheme = "robosats-exp"

    private weak var webView: WKWebView?
    private var diagnostics: [String: Any]
    private var wasConnected = false
    private var pendingSocketMessages: [[String]] = []
    private var socketMessageFlushTask: Task<Void, Never>?
    private let readinessChanged: (Bool) -> Void

    init(diagnostics: [String: Any], readinessChanged: @escaping (Bool) -> Void) {
        self.diagnostics = diagnostics
        self.readinessChanged = readinessChanged
        super.init()
        TorNetworkClient.shared.delegate = self
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
        AppDiagnostics.shared.record("Web", "WebView attached")
    }

    func updateDiagnostics(_ diagnostics: [String: Any], notify: Bool = false) {
        self.diagnostics = diagnostics
        let connected = diagnostics["connected"] as? Bool == true
        defer { wasConnected = connected }
        guard notify, connected, !wasConnected else { return }
        evaluate(
            "window.__robosatsIOS?.updateDiagnostics(\(Self.json(diagnostics)));" +
            "window.dispatchEvent(new Event('robosats:tor-reconnected'));" +
            "window.dispatchEvent(new Event('robosats:native-resume'));"
        )
    }

    func bootstrapScript() -> String {
        let initialSecureStorage = SecureStorage.shared.snapshot()
        let cacheEntries = initialSecureStorage.filter { CacheStorage.accepts($0.key) }
        if !cacheEntries.isEmpty {
            CacheStorage.shared.merge(cacheEntries)
            SecureStorage.shared.delete(Array(cacheEntries.keys))
            AppDiagnostics.shared.record("Storage", "Migrated \(cacheEntries.count) cache entries out of Keychain")
        }

        let secureStorage = SecureStorage.shared.snapshot()
        let cacheStorage = CacheStorage.shared.snapshot()
        let secureBytes = secureStorage.values.reduce(0) { $0 + $1.utf8.count }
        let cacheBytes = cacheStorage.values.reduce(0) { $0 + $1.utf8.count }
        AppDiagnostics.shared.record(
            "Storage",
            "Loaded \(secureStorage.count) secure entries (\(secureBytes) bytes) and \(cacheStorage.count) cache entries (\(cacheBytes) bytes)"
        )
        for (key, value) in secureStorage where value.utf8.count >= 4_096 {
            AppDiagnostics.shared.record("Storage", "Large secure entry \(key): \(value.utf8.count) bytes")
        }

        let storage = Self.json(secureStorage.merging(cacheStorage) { _, cached in cached })
        let diagnostics = Self.json(diagnostics)
        return """
        (() => {
          const storage = \(storage);
          let diagnostics = \(diagnostics);
          const post = (method, payload = {}) => {
            window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage({ method, ...payload });
          };
          const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
          window.__robosatsIOS = {
            updateDiagnostics(value) { diagnostics = value || {}; }
          };
          const bridge = {
            getStorage(key) { return has(storage, key) ? storage[key] : null; },
            setStorage(key, value) {
              storage[key] = String(value);
              post('setStorage', { key, value: String(value) });
            },
            deleteStorage(key) {
              delete storage[key];
              post('deleteStorage', { key });
            },
            getTorStatus() {
              return String(diagnostics.state || 'off').toUpperCase();
            },
            getTorDiagnostics() { return JSON.stringify(diagnostics); },
            getNotificationState() {
              return JSON.stringify({ enabled: false, permissionGranted: false, permissionRequired: false });
            },
            setNotificationsEnabled() {},
            httpRequest(requestId, method, url, headersJson, body) {
              post('httpRequest', { requestId, verb: method, url, headersJson, body });
            },
            openWebSocket(socketId, url, protocolsJson) {
              post('openWebSocket', { socketId, url, protocolsJson });
            },
            sendWebSocket(socketId, message) {
              post('sendWebSocket', { socketId, message });
              return true;
            },
            closeWebSocket(socketId, code, reason) {
              post('closeWebSocket', { socketId, code, reason });
            },
            copyToClipboard(value) { post('copyToClipboard', { value }); },
            openExternal(url) { post('openExternal', { url }); },
            clientLog(message) { post('clientLog', { message: String(message) }); }
          };
          Object.defineProperty(window, 'IOSAppRobosats', { value: bridge, configurable: false });
          window.RobosatsSettings = 'mobile-basic';
        })();
        """
    }

    private func handle(_ message: [String: Any]) {
        guard let method = message["method"] as? String else { return }
        switch method {
        case "setStorage":
            guard let key = message["key"] as? String, let value = message["value"] as? String else { return }
            if CacheStorage.accepts(key) {
                CacheStorage.shared.set(value, for: key)
                SecureStorage.shared.delete(key)
            } else {
                SecureStorage.shared.set(value, for: key)
            }
        case "deleteStorage":
            guard let key = message["key"] as? String else { return }
            if CacheStorage.accepts(key) {
                CacheStorage.shared.delete(key)
                SecureStorage.shared.delete(key)
            } else {
                SecureStorage.shared.delete(key)
            }
        case "httpRequest":
            handleHTTPRequest(message)
        case "openWebSocket":
            handleOpenWebSocket(message)
        case "sendWebSocket":
            guard let id = identifier(message["socketId"]), let value = message["message"] as? String else { return }
            if !TorNetworkClient.shared.sendSocket(id: id, message: value) {
                socketError(id: id, message: "Tor WebSocket is not open")
            }
        case "closeWebSocket":
            guard let id = identifier(message["socketId"]) else { return }
            let code = message["code"] as? Int ?? 1000
            let reason = String((message["reason"] as? String ?? "").prefix(123))
            TorNetworkClient.shared.closeSocket(id: id, code: min(max(code, 1000), 4999), reason: reason)
        case "copyToClipboard":
            guard let value = message["value"] as? String else { return }
            UIPasteboard.general.string = value
        case "openExternal":
            guard let rawURL = message["url"] as? String, let url = allowedExternalURL(rawURL) else { return }
            UIApplication.shared.open(url)
        case "clientLog":
            guard let value = message["message"] as? String else { return }
            AppDiagnostics.shared.record("Web", String(value.prefix(500)))
        case "clientReady":
            AppDiagnostics.shared.record("Web", "Frontend reported ready")
            readinessChanged(true)
        default:
            break
        }
    }

    private func handleHTTPRequest(_ message: [String: Any]) {
        guard let requestID = identifier(message["requestId"]),
              let method = message["verb"] as? String,
              let url = message["url"] as? String else { return }
        let headers = Self.stringDictionary(from: message["headersJson"] as? String)
        TorNetworkClient.shared.request(
            method: method,
            url: url,
            headers: headers,
            body: message["body"] as? String ?? ""
        ) { [weak self] result in
            let script: String
            switch result {
            case let .success(response):
                script = "window.__robosatsNativeTransport?.resolve(\(Self.json(requestID)), \(Self.json(response)))"
            case let .failure(error):
                script = "window.__robosatsNativeTransport?.reject(\(Self.json(requestID)), \(Self.json(error.localizedDescription)))"
            }
            Task { @MainActor [weak self, script] in
                self?.evaluate(script)
            }
        }
    }

    private func handleOpenWebSocket(_ message: [String: Any]) {
        guard let socketID = identifier(message["socketId"]), let url = message["url"] as? String else { return }
        let protocols = Self.stringArray(from: message["protocolsJson"] as? String)
        TorNetworkClient.shared.openSocket(id: socketID, url: url, protocols: protocols)
    }

    private func identifier(_ value: Any?) -> String? {
        guard let value = value as? String,
              value.range(of: "^[A-Za-z0-9_-]{1,96}$", options: .regularExpression) != nil else { return nil }
        return value
    }

    private func socketError(id: String, message: String) {
        evaluate("window.__robosatsNativeTransport?.webSocketError(\(Self.json(id)), \(Self.json(message)))")
    }

    private func evaluate(_ script: String) {
        webView?.evaluateJavaScript(script)
    }

    private func enqueueSocketMessage(id: String, message: String) {
        pendingSocketMessages.append([id, message])
        if pendingSocketMessages.count >= 32 {
            flushSocketMessages()
            return
        }
        guard socketMessageFlushTask == nil else { return }
        socketMessageFlushTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(16))
            guard !Task.isCancelled else { return }
            self?.flushSocketMessages()
        }
    }

    private func flushSocketMessages() {
        socketMessageFlushTask?.cancel()
        socketMessageFlushTask = nil
        guard !pendingSocketMessages.isEmpty else { return }
        let batch = pendingSocketMessages
        pendingSocketMessages.removeAll(keepingCapacity: true)
        evaluate("for (const [id, data] of \(Self.json(batch))) window.__robosatsNativeTransport?.webSocketMessage(id, data)")
    }

    private func allowedExternalURL(_ value: String) -> URL? {
        guard let url = URL(string: value), ["http", "https", "lightning", "bitcoin"].contains(url.scheme?.lowercased() ?? "") else {
            return nil
        }
        return url
    }

    private static func stringDictionary(from value: String?) -> [String: String] {
        guard let data = value?.data(using: .utf8),
              let result = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return result
    }

    private static func stringArray(from value: String?) -> [String] {
        guard let data = value?.data(using: .utf8),
              let result = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return result
    }

    nonisolated private static func json(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8) else {
            if let string = value as? String,
               let data = try? JSONSerialization.data(withJSONObject: [string]),
               let array = String(data: data, encoding: .utf8) {
                return String(array.dropFirst().dropLast())
            }
            return "null"
        }
        return json
    }
}

extension WebBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageHandlerName,
              message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any] else { return }
        handle(body)
    }
}

extension WebBridge: TorNetworkClientDelegate {
    func networkClient(_ client: TorNetworkClient, socketOpened id: String, protocolName: String) {
        evaluate("window.__robosatsNativeTransport?.webSocketOpen(\(Self.json(id)), \(Self.json(protocolName)))")
    }

    func networkClient(_ client: TorNetworkClient, socket id: String, received message: String) {
        enqueueSocketMessage(id: id, message: message)
    }

    func networkClient(_ client: TorNetworkClient, socketClosed id: String, code: Int, reason: String) {
        flushSocketMessages()
        evaluate("window.__robosatsNativeTransport?.webSocketClosed(\(Self.json(id)), \(code), \(Self.json(reason)))")
    }

    func networkClient(_ client: TorNetworkClient, socketFailed id: String, message: String) {
        flushSocketMessages()
        socketError(id: id, message: message)
    }
}

extension WebBridge: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        AppDiagnostics.shared.record("Web", "Bundled frontend loaded")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        AppDiagnostics.shared.record("Web", "Navigation failed: \(error.localizedDescription)")
        readinessChanged(false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        AppDiagnostics.shared.record("Web", "Initial navigation failed: \(error.localizedDescription)")
        readinessChanged(false)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        AppDiagnostics.shared.record("Web", "Web content process terminated")
        readinessChanged(false)
        webView.reload()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.scheme == Self.appScheme || url.scheme == "about" { return .allow }
        if let external = allowedExternalURL(url.absoluteString) {
            await UIApplication.shared.open(external)
        }
        return .cancel
    }
}

extension WebBridge: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, let external = allowedExternalURL(url.absoluteString) {
            UIApplication.shared.open(external)
        }
        return nil
    }
}
