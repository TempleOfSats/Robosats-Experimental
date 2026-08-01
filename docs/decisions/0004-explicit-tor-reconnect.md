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
only after the new circuit is reported ready. If a trade request is still
active then, its owner queues exactly one fresh request after that request
settles, whether it succeeded or failed. Disposing the trade view cancels the
queued work.

Focus, connectivity, resume, and Tor-ready events remain broad lifecycle
refresh signals. Equivalent signals in the same foreground transition are
coalesced, with Tor-ready and Tor-reconnected taking precedence. Order-change
notifications use a separate typed orders-domain channel, so lifecycle
coalescing cannot consume them. Nostr notifications include the recipient,
coordinator, and order identity. Native notifications use the coordinator and
order path when available; a missing or malformed native path retains the
legacy broad reconciliation fallback.

The notification broker retains a bounded, one-minute in-memory window so a
native startup event or Pro-mode activation cannot race an asynchronously
loaded consumer. Delivery is acknowledged per stable consumer ID, and pending
entries are capped and expire rather than becoming durable application state.
Distinct publishes remain distinct entries even when they identify the same
trade; the active request owner coalesces them when appropriate. A trade owner
acknowledges a hint after the request that covers it settles. Disposing an
owner leaves unstarted trailing work available for the replacement owner to
replay.

A visible OrderPage owns hint-driven GETs for its trade. Pro reconciliation
skips that locator and receives the authoritative result through the existing
order-activity bridge. One OrderPage recovery controller remains registered
across cold, loaded, and status-derived polling states, so a queued fresh load
cannot be lost during a React effect handoff. Identical in-flight cold reads
are shared across immediate controller replacement, while a hint newer than
the shared read still schedules one trailing request.

The order store records the coordinator endpoint, robot slot, coordinator
alias, and order ID that produced each private snapshot. OrderPage renders a
snapshot only when that full identity matches the current request. A genuine
identity change invalidates the prior store request and discards any cold-read
dedupe entry for the incoming identity before starting a fresh read. That read
becomes the transport scheduler's new in-flight coalescing owner without
cancelling callers of the older request. Later equivalent reads therefore join
the new request, while the old response remains confined to its original
callers. Work that is still queued remains reusable because it has not reached
Tor and cannot contain a pre-transition response. When both normal same-origin
slots are occupied, one active replacement may use the remaining global
capacity; the scheduler never admits a second replacement slot, bypasses action
priority, or exceeds its global/background budgets. The exact active predecessor
is retained until it settles so a failed replacement and its retry receive the
same bounded admission. The same-identity React Strict Mode replacement still
reuses its active request.
Confirmed create and take handoffs prime the store with the same full identity,
so their immediate transition remains smooth without weakening this check.

An order GET used to verify an incomplete action response also supersedes any
older matching GET. This prevents a pre-action snapshot from being accepted as
post-action verification while preserving the normal request budget and
coalescing behavior for all other reads.

## Consequences

Robots, Fleet records, settings, and cached Tor network state remain intact.
In-flight network operations may be cancelled and restarted after the fresh
route becomes ready. A failure to load one trade does not imply that its
coordinator is unavailable. Browser builds do not expose the control because
their Tor lifecycle belongs to Tor Browser.

Known order-change identities refresh only their matching standard or Fleet
trade. A known identity that does not match local state is ignored. Only a
native notification without a usable order identity performs broad
reconciliation. Concurrent standard notifications retain every notified order
ID per coordinator rather than overwriting earlier pending work.

Bridge parsing, targeted and broad notification routing, active-request
trailing refresh, disposal, and unsupported-runtime behavior require
regression coverage. Native platform builds remain the final verification for
lifecycle behavior.

## Alternatives

Reusing automatic recovery was rejected because its cooldown can defer an
explicit reconnect without visible effect. Deleting the Tor data directory was
rejected because it adds unnecessary bootstrap time and discards useful network
state. Managing native Tor processes from React was rejected because it
violates transport ownership.
