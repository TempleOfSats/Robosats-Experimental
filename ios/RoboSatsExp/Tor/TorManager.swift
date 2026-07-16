import Combine
import Foundation

extension Notification.Name {
    static let roboSatsTorStatusChanged = Notification.Name("robosats.torStatusChanged")
}

@MainActor
final class TorManager: ObservableObject {
    enum State: Equatable {
        case off
        case connecting
        case active(port: Int)
        case failed(message: String)
    }

    @Published private(set) var state: State = .off
    @Published private(set) var progress = 0
    @Published private(set) var displayProgress = 2
    @Published private(set) var message = "Preparing a private route..."
    @Published private(set) var bootstrapStage = "Starting Tor"

    private var startTask: Task<Void, Never>?
    private var progressTask: Task<Void, Never>?
    private var displayTask: Task<Void, Never>?
    private var initialized = false

    var isReady: Bool {
        if case .active = state { return true }
        return false
    }

    var diagnostics: [String: Any] {
        let port: Int?
        let stateName: String
        let error: String?
        switch state {
        case .off:
            port = nil
            stateName = "off"
            error = nil
        case .connecting:
            port = nil
            stateName = "connecting"
            error = nil
        case let .active(activePort):
            port = activePort
            stateName = "connected"
            error = nil
        case let .failed(message):
            port = nil
            stateName = "failed"
            error = message
        }
        return [
            "connected": isReady,
            "state": stateName,
            "socksHost": port == nil ? NSNull() : "127.0.0.1" as Any,
            "socksPort": (port as Any?) ?? NSNull(),
            "implementation": "Arti",
            "artiVersion": ArtiNative.version,
            "bootstrapProgress": progress,
            "clientInitialized": initialized,
            "proxyRunning": isReady,
            "networkAvailable": true,
            "routing": "Native HTTP and WebSocket traffic through Tor",
            "appVersion": AppVersion.marketing,
            "nativeBuild": AppVersion.build,
            "error": (error as Any?) ?? NSNull()
        ]
    }

    func start() {
        guard startTask == nil, !isReady else { return }
        AppDiagnostics.shared.record("Tor", "Start requested")
        state = .connecting
        progress = initialized ? 100 : 0
        displayProgress = initialized ? 70 : 2
        message = initialized ? "Restoring the private route..." : "Preparing a private route..."
        startProgressPresentation()
        postStatus()

        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("arti", isDirectory: true)
        startTask = Task {
            bootstrapStage = "Initializing Arti"
            AppDiagnostics.shared.record("Tor", "Initializing Arti")
            let initResult: Int32
            if initialized {
                initResult = 0
            } else {
                initResult = await Task.detached(priority: .userInitiated) {
                    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    return ArtiNative.initialize(at: directory)
                }.value
            }
            guard !Task.isCancelled else { return }
            guard initResult == 0 else {
                fail(ArtiNative.lastError ?? "Tor could not establish a private route")
                return
            }
            initialized = true
            progress = 100
            bootstrapStage = "Starting local proxy"
            AppDiagnostics.shared.record("Tor", "Bootstrap complete; starting local proxy")

            let port = await Task.detached(priority: .userInitiated) {
                ArtiNative.startProxy()
            }.value
            guard port > 0 else {
                fail(ArtiNative.lastError ?? "The local Tor proxy could not start")
                return
            }

            TorNetworkClient.shared.activate(port: Int(port))
            bootstrapStage = "Private route ready"
            AppDiagnostics.shared.record("Tor", "Local proxy ready")
            message = "Private route ready"
            await completeProgressPresentation()
            state = .active(port: Int(port))
            AppDiagnostics.shared.record("Tor", "Private route active")
            finishTasks()
            postStatus()
        }
    }

    func retry() {
        AppDiagnostics.shared.record("Tor", "Retry requested")
        startTask?.cancel()
        progressTask?.cancel()
        displayTask?.cancel()
        initialized = false
        TorNetworkClient.shared.deactivate()
        state = .off
        startTask = Task {
            _ = await Task.detached(priority: .userInitiated) {
                ArtiNative.destroy()
            }.value
            guard !Task.isCancelled else { return }
            startTask = nil
            start()
        }
    }

    func resume() {
        if !isReady { start() }
    }

    private func startProgressPresentation() {
        progressTask?.cancel()
        progressTask = Task.detached(priority: .utility) { [weak self] in
            var lastProgress = -1
            var lastStage = ""
            while !Task.isCancelled {
                let progress = ArtiNative.progress
                let stage = ArtiNative.bootstrapStatus
                if progress != lastProgress || stage != lastStage {
                    AppDiagnostics.shared.record("Tor", "\(progress)% - \(stage)")
                    lastProgress = progress
                    lastStage = stage
                }
                let shouldContinue = await MainActor.run {
                    guard let self, !self.initialized else { return false }
                    self.progress = progress
                    self.bootstrapStage = stage
                    return true
                }
                guard shouldContinue else { return }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }

        displayTask?.cancel()
        displayTask = Task.detached(priority: .utility) { [weak self] in
            let messages = [
                "Preparing a private route...",
                "Learning a private path...",
                "Checking encrypted circuits...",
                "Almost ready to trade privately..."
            ]
            let startedAt = DispatchTime.now().uptimeNanoseconds
            while !Task.isCancelled {
                let elapsed = Double(DispatchTime.now().uptimeNanoseconds - startedAt) / 1_000_000_000
                let synthetic = Self.syntheticProgress(after: elapsed)
                let shouldContinue = await MainActor.run {
                    guard let self, !self.isReady else { return false }
                    if synthetic > self.displayProgress {
                        self.displayProgress = synthetic
                    }
                    self.message = messages[Int(elapsed / 6) % messages.count]
                    return true
                }
                guard shouldContinue else { return }
                try? await Task.sleep(for: .milliseconds(120))
            }
        }
    }

    private func completeProgressPresentation() async {
        displayTask?.cancel()
        displayTask = nil
        let start = displayProgress
        let steps = 24
        for step in 1...steps {
            guard !Task.isCancelled else { return }
            displayProgress = start + ((100 - start) * step / steps)
            try? await Task.sleep(for: .milliseconds(24))
        }
        displayProgress = 100
    }

    nonisolated private static func syntheticProgress(after seconds: Double) -> Int {
        let value: Double
        switch seconds {
        case ..<4:
            value = interpolate(from: 2, to: 15, fraction: seconds / 4)
        case ..<10:
            value = interpolate(from: 15, to: 38, fraction: (seconds - 4) / 6)
        case ..<24:
            value = interpolate(from: 38, to: 62, fraction: (seconds - 10) / 14)
        case ..<45:
            value = interpolate(from: 62, to: 70, fraction: (seconds - 24) / 21)
        default:
            value = 70
        }
        return Int(value.rounded())
    }

    nonisolated private static func interpolate(from start: Double, to end: Double, fraction: Double) -> Double {
        start + (end - start) * min(1, max(0, fraction))
    }

    private func fail(_ message: String) {
        AppDiagnostics.shared.record("Tor", "Failed: \(message)")
        state = .failed(message: message)
        self.message = message
        finishTasks()
        postStatus()
    }

    var diagnosticReport: String {
        AppDiagnostics.shared.report(currentStage: bootstrapStage, progress: progress)
    }

    private func finishTasks() {
        progressTask?.cancel()
        displayTask?.cancel()
        progressTask = nil
        displayTask = nil
        startTask = nil
    }

    private func postStatus() {
        NotificationCenter.default.post(
            name: .roboSatsTorStatusChanged,
            object: self,
            userInfo: ["diagnostics": diagnostics]
        )
    }
}
