import Foundation

enum AppResources {
    static var bundle: Bundle {
#if SWIFT_PACKAGE
        Bundle.module
#else
        Bundle.main
#endif
    }
}
