import Combine
import Foundation
import Network

extension Notification.Name {
    static let roboSatsTorStatusChanged = Notification.Name("robosats.torStatusChanged")
}

private struct TorNetworkSnapshot: Equatable, Sendable {
    let available: Bool
    let wifi: Bool
    let cellular: Bool
    let wired: Bool
    let other: Bool

    init(_ path: NWPath) {
        available = path.status == .satisfied
        wifi = path.usesInterfaceType(.wifi)
        cellular = path.usesInterfaceType(.cellular)
        wired = path.usesInterfaceType(.wiredEthernet)
        other = path.usesInterfaceType(.other)
    }
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
    private var rebuildTask: Task<Void, Never>?
    private var initialized = false
    private let networkMonitor = NWPathMonitor()
    private let networkMonitorQueue = DispatchQueue(label: "com.robosats.exp.network-path")
    private var networkSnapshot: TorNetworkSnapshot?
    private var networkAvailable = true
    private var networkHandoffPending = false
    private var networkEpoch = 0
    private var networkCompletedEpoch = 0
    private var networkRecoveryCount = 0

    init() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let snapshot = TorNetworkSnapshot(path)
            Task { @MainActor [weak self] in
                self?.handleNetworkSnapshot(snapshot)
            }
        }
        networkMonitor.start(queue: networkMonitorQueue)
    }

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
            "networkAvailable": networkAvailable,
            "networkHandoffPending": networkHandoffPending,
            "networkEpoch": networkEpoch,
            "networkCompletedEpoch": networkCompletedEpoch,
            "networkRecoveryCount": networkRecoveryCount,
            "routing": "Native HTTP and WebSocket traffic through Tor",
            "appVersion": AppVersion.marketing,
            "nativeBuild": AppVersion.build,
            "error": (error as Any?) ?? NSNull()
        ]
    }

    func start() {
        guard startTask == nil, rebuildTask == nil, !isReady else { return }
        guard networkAvailable else {
            showWaitingForNetwork()
            return
        }
        beginStartPresentation()
        startTask = Task { [weak self] in
            _ = await self?.startTransport()
        }
    }

    private func beginStartPresentation() {
        AppDiagnostics.shared.record("Tor", "Start requested")
        state = .connecting
        progress = initialized ? 100 : 0
        displayProgress = initialized ? 70 : 2
        message = initialized ? "Restoring the private route..." : "Preparing a private route..."
        startProgressPresentation()
        postStatus()
    }

    private func startTransport() async -> Bool {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("arti", isDirectory: true)
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
        guard !Task.isCancelled else { return false }
        guard initResult == 0 else {
            fail(ArtiNative.lastError ?? "Tor could not establish a private route")
            return false
        }
        initialized = true
        progress = 100
        bootstrapStage = "Starting local proxy"
        AppDiagnostics.shared.record("Tor", "Bootstrap complete; starting local proxy")

        let port = await Task.detached(priority: .userInitiated) {
            ArtiNative.startProxy()
        }.value
        guard !Task.isCancelled else { return false }
        guard port > 0 else {
            fail(ArtiNative.lastError ?? "The local Tor proxy could not start")
            return false
        }
        guard networkAvailable else {
            ArtiNative.stopProxy()
            showWaitingForNetwork()
            finishTasks()
            return false
        }

        TorNetworkClient.shared.activate(port: Int(port))
        let transportReadyEpoch = networkEpoch
        bootstrapStage = "Private route ready"
        AppDiagnostics.shared.record("Tor", "Local proxy ready")
        message = "Private route ready"
        await completeProgressPresentation()
        guard networkAvailable else {
            TorNetworkClient.shared.deactivate()
            showWaitingForNetwork()
            finishTasks()
            return false
        }
        if networkHandoffPending, networkEpoch > transportReadyEpoch {
            TorNetworkClient.shared.deactivate()
            state = .connecting
            message = "Restoring the private route..."
            bootstrapStage = "Network changed"
            finishTasks()
            postStatus()
            scheduleNetworkRecovery()
            return false
        }
        state = .active(port: Int(port))
        completeNetworkRecovery()
        AppDiagnostics.shared.record("Tor", "Private route active")
        finishTasks()
        postStatus()
        return true
    }

    func retry() {
        AppDiagnostics.shared.record("Tor", "Retry requested")
        scheduleRebuild(networkRecoveryEpoch: nil)
    }

    private func scheduleRebuild(networkRecoveryEpoch: Int?) {
        guard rebuildTask == nil else { return }
        guard networkAvailable else {
            showWaitingForNetwork()
            return
        }
        if networkRecoveryEpoch != nil {
            networkRecoveryCount += 1
        }
        startTask?.cancel()
        progressTask?.cancel()
        displayTask?.cancel()
        TorNetworkClient.shared.deactivate()
        state = .off
        postStatus()
        rebuildTask = Task { [weak self] in
            guard let self else { return }
            defer {
                rebuildTask = nil
                if networkHandoffPending, networkAvailable, !isReady {
                    if let networkRecoveryEpoch, networkRecoveryEpoch == networkEpoch {
                        networkCompletedEpoch = networkEpoch
                        networkHandoffPending = false
                        postStatus()
                    } else {
                        scheduleNetworkRecovery()
                    }
                }
            }
            initialized = false
            _ = await Task.detached(priority: .userInitiated) {
                ArtiNative.destroy()
            }.value
            guard !Task.isCancelled else { return }
            startTask = nil
            guard networkAvailable else {
                showWaitingForNetwork()
                return
            }
            beginStartPresentation()
            _ = await startTransport()
        }
    }

    func resume() {
        guard isReady else {
            start()
            return
        }
        guard rebuildTask == nil, startTask == nil, networkAvailable else { return }

        let resumeEpoch = networkEpoch
        TorNetworkClient.shared.deactivate()
        state = .connecting
        message = "Refreshing the private route..."
        bootstrapStage = "Restarting local proxy"
        postStatus()
        rebuildTask = Task { [weak self] in
            guard let self else { return }
            defer {
                rebuildTask = nil
                if networkHandoffPending, networkAvailable, !isReady {
                    scheduleNetworkRecovery()
                }
            }
            let port = await Task.detached(priority: .userInitiated) {
                ArtiNative.startProxy()
            }.value
            guard port > 0 else {
                fail(ArtiNative.lastError ?? "The local Tor proxy could not restart")
                return
            }
            guard networkAvailable, networkEpoch == resumeEpoch, !networkHandoffPending else {
                ArtiNative.stopProxy()
                return
            }
            TorNetworkClient.shared.activate(port: Int(port))
            state = .active(port: Int(port))
            message = "Private route ready"
            bootstrapStage = "Private route ready"
            postStatus()
        }
    }

    private func handleNetworkSnapshot(_ snapshot: TorNetworkSnapshot) {
        guard let previous = networkSnapshot else {
            networkSnapshot = snapshot
            networkAvailable = snapshot.available
            if snapshot.available {
                if !isReady, startTask == nil, rebuildTask == nil { start() }
            } else {
                networkHandoffPending = true
                TorNetworkClient.shared.deactivate()
                showWaitingForNetwork()
            }
            postStatus()
            return
        }
        guard previous != snapshot else { return }

        networkSnapshot = snapshot
        networkEpoch += 1
        networkAvailable = snapshot.available
        networkHandoffPending = true
        TorNetworkClient.shared.deactivate()
        state = .connecting
        progress = min(progress, 99)
        if !snapshot.available {
            message = "Waiting for a network..."
            bootstrapStage = "Network unavailable"
            postStatus()
            return
        }

        message = "Restoring the private route..."
        bootstrapStage = "Network changed"
        postStatus()
        scheduleNetworkRecovery()
    }

    private func scheduleNetworkRecovery() {
        guard networkAvailable, networkHandoffPending else { return }
        if startTask != nil || rebuildTask != nil { return }
        scheduleRebuild(networkRecoveryEpoch: networkEpoch)
    }

    private func completeNetworkRecovery() {
        guard networkHandoffPending, networkAvailable else { return }
        networkCompletedEpoch = networkEpoch
        networkHandoffPending = false
    }

    private func showWaitingForNetwork() {
        state = .connecting
        message = "Waiting for a network..."
        bootstrapStage = "Network unavailable"
        postStatus()
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
        if networkHandoffPending, networkAvailable {
            scheduleNetworkRecovery()
        }
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
