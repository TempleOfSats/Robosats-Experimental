import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var tor = TorManager()
    @State private var webReady = false

    var body: some View {
        ZStack {
            WebAppView(tor: tor, isReady: $webReady)
                .ignoresSafeArea(.container, edges: .bottom)

            if !tor.isReady || !webReady {
                TorLoadingView(
                    message: tor.isReady ? "Opening the private interface..." : tor.message,
                    progress: tor.displayProgress,
                    actualProgress: tor.progress,
                    stage: tor.isReady ? "Waiting for the interface" : tor.bootstrapStage,
                    diagnosticReport: tor.diagnosticReport,
                    retry: tor.retry
                )
                .transition(.opacity)
            }
        }
        .background(Color(red: 0.043, green: 0.035, blue: 0.035))
        .task { tor.start() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { tor.resume() }
        }
        .animation(.easeOut(duration: 0.28), value: tor.isReady && webReady)
    }
}
