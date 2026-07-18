# Desktop application

The desktop application packages the production frontend in Electron and
starts a native Arti sidecar before creating the application window.

## Network boundary

1. Electron starts `robosats-arti` with an application-private state directory.
2. Arti bootstraps Tor and binds a random SOCKS5 port on `127.0.0.1`.
3. Electron assigns that proxy to an isolated persistent session.
4. The frontend uses coordinator onion endpoints for HTTP and WebSocket
   traffic.
5. If Arti exits, the application window is hidden and the session remains
   configured for the now-closed proxy while the sidecar restarts, preventing
   direct fallback.

The loading window appears before Tor bootstrap and reports Arti progress.
After system resume or network restoration, the application checks the local
SOCKS listener before deciding whether to restart Arti. Desktop notifications
are optional and can be enabled from Settings while the application is
running.

The renderer has Node integration disabled, context isolation and sandboxing
enabled, no permission grants, and no access to the sidecar process. Static
application files are served through the private `robosats://app` protocol.

## Local development

Requirements:

- Node.js 22
- Rustup and a native Rust toolchain
- Native packaging tools for the current operating system

Build the web application and sidecar, then start Electron:

```bash
npm run dev:desktop
```

This command uses the production Vite bundle so the same custom protocol,
asset paths, proxy, and loading lifecycle are exercised locally.

## Packaging

Run the command on its matching operating system:

```bash
npm run build:desktop:linux
npm run build:desktop:windows
npm run build:desktop:macos
```

Packages are written to `desktop/release/` as an AppImage on Linux, an NSIS
installer on Windows, or a DMG on macOS. Cross-compiling only the Electron
wrapper is insufficient because each package also needs a native Arti
executable; the GitHub workflow therefore uses a native runner for each target.
