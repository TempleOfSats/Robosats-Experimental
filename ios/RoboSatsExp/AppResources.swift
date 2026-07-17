import Foundation

enum AppResources {
    static var bundle: Bundle {
#if SWIFT_PACKAGE
        Bundle.module
#else
        Bundle.main
#endif
    }

    static var webAppRoot: URL? {
        resourceBundles.lazy.compactMap { bundle in
            guard let root = bundle.resourceURL?.appendingPathComponent("WebApp", isDirectory: true),
                  FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
                return nil
            }
            return root
        }.first
    }

    static var loadingMarkURL: URL? {
        resourceBundles.lazy.compactMap {
            $0.url(forResource: "RoboSatsMark", withExtension: "png")
        }.first
    }

    private static var resourceBundles: [Bundle] {
        var bundles = [bundle]
        if bundle != Bundle.main {
            bundles.append(Bundle.main)
        }
        if let url = Bundle.main.url(
            forResource: "RoboSatsExp_RoboSatsExp",
            withExtension: "bundle"
        ), let resourceBundle = Bundle(url: url),
           !bundles.contains(resourceBundle) {
            bundles.append(resourceBundle)
        }
        return bundles
    }
}
