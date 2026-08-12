import SwiftUI

@main
struct RoboSatsExpApp: App {
    @StateObject private var tor = TorManager()

    init() {
        AppDiagnostics.shared.record("App", "Build \(AppVersion.identifier)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView(tor: tor)
        }
    }
}
