// swift-tools-version: 6.0

import Foundation
import PackageDescription

let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let artiLibraryDirectory = packageDirectory
    .appendingPathComponent("tor-native/target/aarch64-apple-ios/release")
    .path

let package = Package(
    name: "RoboSatsExp",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "RoboSatsExp", targets: ["RoboSatsExp"]),
    ],
    targets: [
        .target(
            name: "ArtiMobile",
            path: "tor-native/swiftpm",
            publicHeadersPath: "include"
        ),
        .target(
            name: "RoboSatsExp",
            dependencies: ["ArtiMobile"],
            path: "RoboSatsExp",
            exclude: [
                "Assets.xcassets",
                "Resources/Raw/AppIcon.png",
                "Resources/WebApp/.gitkeep",
                "Support",
            ],
            resources: [
                .copy("Resources/Raw/RoboSatsMark.png"),
                .copy("Resources/WebApp"),
            ],
            linkerSettings: [
                .unsafeFlags(["-L", artiLibraryDirectory, "-larti_mobile"]),
                .linkedFramework("Security"),
                .linkedFramework("SystemConfiguration"),
                .linkedLibrary("resolv"),
                .linkedLibrary("z"),
            ]
        ),
    ]
)
