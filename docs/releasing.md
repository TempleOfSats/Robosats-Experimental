# Releasing RoboSats Exp.

## Versioning

The package version is the release source of truth. Supported versions are:

```text
0.1.0
0.1.0-alpha.1
0.1.0-beta.1
0.1.0-rc.1
```

Android version codes and iOS build numbers are derived from that version.
Run the metadata and consistency checks after changing `package.json`:

```bash
npm run release:metadata
npm run check:ios:config
```

Update the static values in `ios/project.yml` and
`ios/Config/Info.xtool.plist` to the values printed by the metadata command.

## Android packaging

Android release builds produce APKs for each supported ABI and a universal APK.

## iOS packaging

The GitHub release builds `RoboSatsExp-unsigned.ipa` on a macOS runner with
Xcode. An unsigned IPA cannot run directly on iOS. It is intended for users or
tools that apply their own Apple development signature, such as SideStore.
App Store or TestFlight distribution should be a separate workflow using App
Store Connect credentials and Apple-managed signing.

The Linux xtool path remains available for local parity checks:

```bash
npm run build:ios:unsigned:linux
```

## Publish

1. Merge the release version and release notes to `main`.
2. Confirm CI and security checks pass.
3. Create an annotated tag matching the package version exactly.
4. Push the tag.

```bash
git tag -a v0.1.0-alpha.1 -m 'RoboSats Exp. 0.1.0-alpha.1'
git push origin v0.1.0-alpha.1
```

The release workflow validates the tag, runs tests, builds the web archive,
Android APKs, and unsigned IPA, verifies Android ELF alignment, creates checksums
and provenance attestations, and publishes a GitHub release. Versions containing
`alpha`, `beta`, or `rc` are marked as prereleases.
