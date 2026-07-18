# Desktop application

Tauri packages the production frontend with the system webview and a native
Arti sidecar.

## Runtime

1. Show the amber loading window.
2. Start Arti on an application scoped SOCKS5 port.
3. Create the main webview with that proxy.
4. Reveal the frontend after Tor and the app are ready.
5. Hide the main window and restart Arti if the proxy stops.

The frontend has no shell or sidecar permission. Tauri exposes connection
status, notifications, external URL opening, and window controls.

## Development

Requirements:

1. Node.js 22
2. Rustup
3. Tauri system libraries
4. WebKitGTK 4.1 and `patchelf` on Linux
5. macOS 14 or newer on macOS

```bash
npm run dev:desktop
```

## Packages

```bash
npm run build:desktop:linux
npm run build:desktop:windows
npm run build:desktop:macos
```

Outputs are copied to `desktop/release/`. GitHub Actions builds each target on
its native runner. Linux packages use the host Wayland runtime so the webview
matches the installed graphics stack.
