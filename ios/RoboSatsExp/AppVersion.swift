import Foundation

enum AppVersion {
    static var marketing: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
    }

    static var build: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "Unknown"
    }

    static var identifier: String {
        "\(marketing) (\(build))"
    }
}
