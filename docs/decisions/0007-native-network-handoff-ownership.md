# ADR-0007: Process-owned native network handoffs

- Status: Accepted
- Date: 2026-08-11

## Context

Wi-Fi, cellular, VPN, and offline transitions can invalidate Arti sockets.
Android previously had competing callbacks, while iOS and desktop lacked a
single owner for transport recovery.

## Decision

Each native process owns one network-handoff state machine and monotonic epoch.
An epoch can rebuild Arti once; newer usable paths supersede queued work.

- Android owns its callback in the application process.
- iOS shares one `NWPathMonitor` and Tor manager across windows.
- Tauri owns recovery in `DesktopRuntime`; the webview only reports its network
  boundary.

Feature consumers cancel stale HTTP, WebSocket, and Nostr work during handoff
and resume after native recovery. Arti remains native-owned; coordinator and
Nostr reachability remain application-domain concerns. Android uses a
single-task `MainActivity` so notification intents reuse the active WebView.

## Consequences

- One handoff performs at most one state-preserving Arti rebuild.
- Offline periods cancel work without bootstrapping until a usable path exists.
- Rapid changes converge on the newest validated path.
- Diagnostics expose only aggregate epochs and recovery counters.

## Alternatives

Longer debounce windows cannot bound callback or bootstrap timing. Per-consumer
rebuilds conflict with the single process-wide transport, and clearing Tor state
on each handoff adds latency without improving correctness.
