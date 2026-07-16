import Foundation
import OSLog
import UIKit

final class AppDiagnostics: @unchecked Sendable {
    static let shared = AppDiagnostics()

    private let logger = Logger(subsystem: "com.robosats.exp.ios", category: "startup")
    private let lock = NSLock()
    private var lines: [String] = []
    private let startedAt = Date()

    private init() {}

    func record(_ area: String, _ message: String) {
        let elapsed = Date().timeIntervalSince(startedAt)
        let line = String(format: "+%.1fs [%@] %@", elapsed, area, sanitize(message))
        logger.notice("\(line, privacy: .public)")
        lock.withLock {
            lines.append(line)
            if lines.count > 120 {
                lines.removeFirst(lines.count - 120)
            }
        }
    }

    private func sanitize(_ value: String) -> String {
        var output = String(value.prefix(1_000))
        let replacements = [
            (#"\b[a-z2-7]{56}\.onion\b"#, "[onion]"),
            (#"\b(?:lnbc|lntb|lnbcrt)[0-9a-z]{20,}\b"#, "[invoice]"),
            (#"\b[a-fA-F0-9]{32,}\b"#, "[hex]"),
            (#"\b[A-Za-z0-9_-]{40,}\b"#, "[secret]")
        ]
        for (pattern, replacement) in replacements {
            output = output.replacingOccurrences(
                of: pattern,
                with: replacement,
                options: [.regularExpression, .caseInsensitive]
            )
        }
        return output
    }

    @MainActor
    func report(currentStage: String, progress: Int) -> String {
        let history = lock.withLock { lines.joined(separator: "\n") }
        return """
        RoboSats Exp. iOS diagnostics
        App: \(AppVersion.marketing)
        Build: \(AppVersion.build)
        System: \(ProcessInfo.processInfo.operatingSystemVersionString)
        Device: \(UIDevice.current.model)
        Arti: \(ArtiNative.version)
        Stage: \(currentStage)
        Bootstrap: \(progress)%

        \(history)
        """
    }
}
