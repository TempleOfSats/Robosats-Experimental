import Foundation
import WebKit

final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let contentSecurityPolicy = [
        "default-src 'self' data: blob:",
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "font-src 'self' data:",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'"
    ].joined(separator: "; ")

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url,
              let root = AppResources.bundle.resourceURL?.appendingPathComponent("WebApp", isDirectory: true) else {
            AppDiagnostics.shared.record("Assets", "WebApp resource root is missing")
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let rawPath = requestURL.path == "/" ? "/index.html" : requestURL.path
        let relativePath = String(rawPath.drop(while: { $0 == "/" }))
        let fileURL = root.appendingPathComponent(relativePath).standardizedFileURL
        let resolvedURL: URL
        if fileURL.pathExtension.isEmpty && !FileManager.default.fileExists(atPath: fileURL.path) {
            resolvedURL = root.appendingPathComponent("index.html")
        } else {
            resolvedURL = fileURL
        }
        let rootPath = root.standardizedFileURL.path + "/"
        guard resolvedURL.path.hasPrefix(rootPath),
              let data = try? Data(contentsOf: resolvedURL),
              let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mimeType(for: resolvedURL.pathExtension),
                    "Content-Security-Policy": contentSecurityPolicy,
                    "Cache-Control": relativePath == "index.html" ? "no-store" : "public, max-age=31536000, immutable"
                ]
              ) else {
            AppDiagnostics.shared.record("Assets", "Missing bundled asset: \(relativePath)")
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func mimeType(for fileExtension: String) -> String {
        switch fileExtension.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js": "application/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json; charset=utf-8"
        case "wasm": "application/wasm"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "webp": "image/webp"
        case "jpg", "jpeg": "image/jpeg"
        case "mp3": "audio/mpeg"
        default: "application/octet-stream"
        }
    }
}
