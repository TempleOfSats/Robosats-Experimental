import SwiftUI

@main
struct RoboSatsExpApp: App {
    init() {
        AppDiagnostics.shared.record("App", "Build \(AppVersion.identifier)")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
