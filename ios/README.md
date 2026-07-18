# RoboSats Exp. for iOS

This target hosts the bundled frontend in `WKWebView` and routes remote traffic through an embedded Arti SOCKS proxy. It has two build descriptions:

- `project.yml` generates an Xcode project on macOS.
- `Package.swift` and `xtool.yml` build directly on Linux with xtool.

`package.json` is the release version source. Build scripts generate the iOS
marketing version and build number. Validate the generated configuration with:

```bash
npm run check:ios:config
```

Both unsigned-IPA scripts run this check before compiling.

## Linux unsigned IPA

Requirements:

- Swift 6.3
- Rust through `rustup`
- xtool 1.17 or newer
- Xcode 26 `.xip` downloaded from Apple
- Node.js and the repository dependencies

Install xtool:

```bash
curl -fL \
  "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage" \
  -o "$HOME/.local/bin/xtool"
chmod +x "$HOME/.local/bin/xtool"
```

Install the Darwin Swift SDK from the downloaded archive:

```bash
xtool sdk install /path/to/Xcode.xip
swift sdk list
```

The SDK list must contain `darwin`. `xtool setup` is only needed when signing or deploying through an Apple account; generating the unsigned IPA does not require storing Apple credentials. This workflow does not require a Mac, but it still requires Apple's SDK archive and acceptance of its license.

SDK extraction needs substantial temporary and installed space. To keep SwiftPM's SDK storage on another filesystem, set `XDG_CONFIG_HOME` before both installation and builds:

```bash
export XDG_CONFIG_HOME=/path/with/free-space/xdg-config
xtool sdk install /path/to/Xcode.xip
npm run build:ios:unsigned:linux
```

Build:

```bash
npm ci
npm run build:ios:unsigned:linux
```

Output:

```text
ios/build/RoboSatsExp-unsigned.ipa
```

The Linux build script derives the iPhone SDK and `ld64.lld` paths from the registered Darwin Swift SDK, cross-compiles `libarti_mobile.a` for `arm64-apple-ios`, and asks xtool to package the SwiftPM product as an unsigned IPA.

## Startup diagnostics

The loading screen exposes a collapsed **Connection details** section. It shows the real Arti bootstrap percentage and phase, independently of the smoothed presentation percentage. Use **Copy diagnostics** to copy a redacted startup report containing native, Arti, asset-loader, and WebView failures.

With a trusted USB connection on Linux, stream the same startup events from the iPad while relaunching the app:

```bash
idevice_id -l
idevicesyslog -p RoboSatsExp --no-colors
```

If the device alternates between visible and unavailable, keep it unlocked, confirm the trust prompt, connect it directly instead of through a hub, and validate pairing before retrying:

```bash
idevicepair validate
ideviceinfo -k DeviceName
```

Startup diagnostics redact onion hostnames, Lightning invoices, long hexadecimal values, and token-like strings.

## macOS unsigned IPA

Requirements:

- Current Xcode and command-line tools
- XcodeGen
- Rust through `rustup`
- Node.js and the repository dependencies

```bash
npm ci
npm run build:ios:unsigned
```

## Privacy boundary

- Application UI is loaded from bundled resources.
- Direct WebKit HTTP, WebSocket, and DNS access to remote origins is blocked by CSP.
- Native requests fail closed until the embedded Arti proxy is active.
- Hostnames are passed to SOCKS without local DNS resolution.
- Robot state is persisted in the iOS Keychain.
- No continuous background Tor mode or notification service is enabled.
- Returning to the foreground restarts the local SOCKS listener and refreshes native transport state.

The transport uses iOS-supported `InputStream` and `OutputStream` SOCKS5 configuration for HTTP and WebSocket connections. WebSocket handshakes and frames are handled inside the app so no request can bypass the loopback Arti proxy through `URLSession`. TLS streams retain destination-host certificate validation. This must still be exercised on a physical iPhone before release.

References:

- https://github.com/xtool-org/xtool
- https://github.com/xtool-org/xtool/blob/main/Documentation/xtool.docc/Installation-Linux.md
- https://arti.torproject.org/integrating-arti/custom-wrappers/iOS/
