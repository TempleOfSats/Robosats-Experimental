# ADR-0004: Explicit Tor reconnect

- Status: Accepted
- Date: 2026-07-30

## Context

The native Android, iOS, and desktop shells own their embedded Arti clients.
Automatic transport recovery is deliberately throttled. The native interface
also needs an explicit recovery control that can replace stale live connections
without clearing application data or waiting for the automatic-recovery
cooldown.

## Decision

Expose one optional `reconnectTorTransport` operation through the existing
native bridge. A shared transport-domain controller invokes the operation and
observes native Tor diagnostics; Settings and recoverable trade-loading UI
consume that controller rather than managing Arti directly.

Each native shell rebuilds its Arti client and proxy, retains the cached Tor
directory, replaces live HTTP and WebSocket connections, and emits the existing
Tor-reconnected lifecycle event when the new route is ready. An explicit
reconnect bypasses the cooldown that protects automatic recovery.

Transient trade-load failures receive one bounded request retry. Rebuilding Tor
remains an explicit user action. Tor completion triggers a fresh trade request
only after the new circuit is reported ready.

## Consequences

Robots, Fleet records, settings, and cached Tor network state remain intact.
In-flight network operations may be cancelled and restarted after the fresh
route becomes ready. A failure to load one trade does not imply that its
coordinator is unavailable. Browser builds do not expose the control because
their Tor lifecycle belongs to Tor Browser.

Bridge dispatch and unsupported-runtime behavior require regression coverage.
Native platform builds remain the final verification for lifecycle behavior.

## Alternatives

Reusing automatic recovery was rejected because its cooldown can defer an
explicit reconnect without visible effect. Deleting the Tor data directory was
rejected because it adds unnecessary bootstrap time and discards useful network
state. Managing native Tor processes from React was rejected because it
violates transport ownership.
