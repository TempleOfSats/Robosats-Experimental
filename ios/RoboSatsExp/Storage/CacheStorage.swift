import Foundation

final class CacheStorage: @unchecked Sendable {
    static let shared = CacheStorage()

    private let fileURL: URL
    private let lock = NSLock()
    private var values: [String: String]

    private init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("frontend-cache.json")
        values = Self.read(from: fileURL)
    }

    func snapshot() -> [String: String] {
        lock.withLock { values }
    }

    func set(_ value: String, for key: String) {
        guard Self.accepts(key) else { return }
        lock.withLock {
            guard values[key] != value else { return }
            values[key] = value
            persist()
        }
    }

    func merge(_ entries: [String: String]) {
        let accepted = entries.filter { Self.accepts($0.key) }
        guard !accepted.isEmpty else { return }
        lock.withLock {
            let changed = accepted.reduce(into: false) { changed, entry in
                if values[entry.key] != entry.value {
                    values[entry.key] = entry.value
                    changed = true
                }
            }
            guard changed else { return }
            persist()
        }
    }

    func delete(_ key: String) {
        guard Self.accepts(key) else { return }
        lock.withLock {
            guard values.removeValue(forKey: key) != nil else { return }
            persist()
        }
    }

    static func accepts(_ key: String) -> Bool {
        key.hasPrefix("robosats_exp_orderbook_cache_") ||
            key.hasPrefix("robosats_exp_federation_cache_") ||
            key == "federation_relays" ||
            key == "federation_pubkeys"
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(values) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    private static func read(from fileURL: URL) -> [String: String] {
        guard let data = try? Data(contentsOf: fileURL),
              let values = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return values
    }
}
