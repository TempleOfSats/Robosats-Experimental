# ADR-0005: Process-owned native network handoffs

- Status: Accepted
- Date: 2026-08-11

## Context

Mobile and desktop operating systems can replace an application's network
path whenever a device moves between Wi-Fi, cellular service, Ethernet, VPNs,
and offline periods. Arti's existing sockets cannot be assumed to survive
that replacement.

On Android, the activity and notification service previously registered
separate default-network callbacks. Both callbacks could request an Arti reset
for the same handoff. A time debounce did not prevent this when the first
bootstrap took longer than the debounce, and multiple activity instances
multiplied the effect. iOS assumed the network was always available, while the
Tauri runtime accepted browser online events but only checked whether its
local SOCKS listener was open.

## Decision

Each native application process owns one network-handoff state machine and a
monotonic recovery epoch. Each epoch can rebuild Arti at most once, and a
newer usable path supersedes queued older work. When Arti reaches its active
state after a newer network was validated during an in-flight bootstrap, that
successful bootstrap completes the newest epoch instead of destroying the
just-recovered client and bootstrapping a second time.

- Android owns its validated default-network callback in the application.
- iOS owns one `NWPathMonitor` and Tor manager at the app level, shared by all
  SwiftUI windows.
- Tauri owns recovery state in `DesktopRuntime`; the webview reports its
  online/offline boundary but cannot directly restart the sidecar.

Platform consumers cancel their own HTTP, WebSocket, and Nostr work when a
handoff starts and resume it only after the process-owned recovery completes.
The native bridges continue to own Arti; application domains continue to own
coordinator and Nostr reachability decisions.

`MainActivity` is a single task so launcher and notification intents reuse its
existing WebView and network-event consumer. `onNewIntent` remains responsible
for routing notification order hints.

## Consequences

- One detected native handoff performs at most one state-preserving Arti
  rebuild.
- Offline periods cancel stale work immediately but do not bootstrap until a
  replacement default network is validated.
- Rapid changes are conflated to the newest validated network. A native reset
  already executing cannot be cancelled. If it reaches Arti's active state
  after a newer route was validated, that transport-ready boundary satisfies
  the newest epoch; a failed attempt still leaves the newer epoch queued for
  another rebuild.
- Safe aggregate epoch and recovery counters are exposed in native Tor
  diagnostics for platform verification. Network handles, destinations, and
  user data are not exposed.
- Coordinator HTTP and Nostr probes remain above the native bridge; native
  network recovery does not hardcode federation endpoints.
- Apple path monitoring intentionally compares public path characteristics;
  changes that do not alter those characteristics remain Arti's responsibility
  to recover internally.

## Alternatives

Keeping two callbacks with a longer debounce was rejected because bootstrap
duration and callback timing are unbounded. Making the notification service
the sole owner was rejected because notifications can be disabled. Letting
every consumer rebuild Arti was rejected because Arti is one process-wide
transport. Clearing Tor state on every handoff was rejected because it adds
latency and discards useful persistent state.
