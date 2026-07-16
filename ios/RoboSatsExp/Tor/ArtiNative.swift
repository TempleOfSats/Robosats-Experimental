import Foundation

#if SWIFT_PACKAGE
import ArtiMobile
#endif

enum ArtiNative {
    static var version: String {
        guard let pointer = arti_mobile_version() else { return "Unavailable" }
        defer { arti_mobile_string_free(pointer) }
        return String(cString: pointer)
    }

    static var progress: Int {
        Int(arti_mobile_bootstrap_progress())
    }

    static var bootstrapStatus: String {
        guard let pointer = arti_mobile_bootstrap_status() else { return "Starting Tor" }
        defer { arti_mobile_string_free(pointer) }
        return String(cString: pointer)
    }

    static var lastError: String? {
        guard let pointer = arti_mobile_last_error() else { return nil }
        defer { arti_mobile_string_free(pointer) }
        return String(cString: pointer)
    }

    static func initialize(at directory: URL) -> Int32 {
        directory.path.withCString { arti_mobile_initialize($0) }
    }

    static func startProxy() -> Int32 {
        arti_mobile_start_socks_proxy(0)
    }

    static func stopProxy() {
        _ = arti_mobile_stop_socks_proxy()
    }

    static func destroy() {
        _ = arti_mobile_destroy()
    }
}
