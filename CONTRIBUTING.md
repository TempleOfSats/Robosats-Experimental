# Contributing

## Requirements

- Node.js 22.12 or newer in the Node 22 release line
- npm with lockfile support
- Rust 1.94.1 for native bridge work
- Java 17, Android SDK 36, and NDK 27.0.12077973 for Android work
- Xcode and XcodeGen, or xtool on Linux, for iOS work

Install JavaScript dependencies with `npm ci`. Do not commit `dist`, `build`,
`target`, mobile assets generated from `dist`, signing keys, provisioning
profiles, robot tokens, invoices, coordinator credentials, or Tor state.

## Required checks

Run the checks relevant to the change before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
npm run check:production-build
npm run check:ios:config
```

Changes to a Rust bridge must also pass `cargo check --locked` for that crate.
Android changes should pass `npm run build:android:debug` and `android/gradlew
lintDebug` when the Android toolchain is available.

## Pull requests

Keep pull requests focused. Explain changes to authentication, PGP keys, Nostr
events, Tor routing, coordinator requests, persistence, payments, and mobile
bridges explicitly. Add regression tests for behavior fixes. Never put live
trade data or credentials in an issue, fixture, screenshot, or test.

Dependency updates must keep lockfiles in sync and pass dependency review.
Avoid suppressing an advisory without a written rationale and an expiry date.
