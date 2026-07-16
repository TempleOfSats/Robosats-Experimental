import Foundation
import Security

final class SecureStorage: @unchecked Sendable {
    static let shared = SecureStorage()

    private let service = "com.robosats.exp.ios.secure-storage"
    private let account = "frontend-state"
    private let lock = NSLock()
    private var values: [String: String]

    private init() {
        values = Self.read(service: service, account: account)
    }

    func snapshot() -> [String: String] {
        lock.withLock { values }
    }

    func set(_ value: String, for key: String) {
        guard valid(key) else { return }
        lock.withLock {
            guard values[key] != value else { return }
            values[key] = value
            persist()
        }
    }

    func delete(_ key: String) {
        delete([key])
    }

    func delete(_ keys: [String]) {
        let validKeys = keys.filter(valid)
        guard !validKeys.isEmpty else { return }
        lock.withLock {
            let changed = validKeys.reduce(into: false) { changed, key in
                changed = values.removeValue(forKey: key) != nil || changed
            }
            guard changed else { return }
            persist()
        }
    }

    private func valid(_ key: String) -> Bool {
        key.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(values) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var insertion = query
            attributes.forEach { insertion[$0.key] = $0.value }
            SecItemAdd(insertion as CFDictionary, nil)
        }
    }

    private static func read(service: String, account: String) -> [String: String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let values = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return values
    }
}

extension NSLock {
    func withLock<T>(_ operation: () -> T) -> T {
        lock()
        defer { unlock() }
        return operation()
    }
}
