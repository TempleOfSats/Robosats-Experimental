# ADR-0010: Required background work reports failure and the user reloads

- Status: Accepted
- Date: 2026-09-05

## Context

The interface starts two kinds of background work after the first route mounts: the
prewarm loop and, when Pro is enabled, Fleet synchronization. Both arrive as lazy
chunks over Tor, where a stream can fail mid-download.

Two earlier behaviors were wrong. A failed optional route preload could surface the
application error screen for work the user never asked for. And a required runtime
that failed to load was reported as unavailable while the app kept claiming it was
synchronizing; an automatic "retry" of the same dynamic import could not help,
because a browser keeps a failed module load failed for the life of the document.

## Decision

`startBackgroundRuntime(load, onStarted, unavailableMessage)` owns required back-
ground work in the app shell.

- A chunk that cannot be **loaded** is unrecoverable in this document. The failure is
  reported once and never retried here. Recovery is a new document, and only the user
  decides to start one.
- A module that loaded but threw while **starting** also requires an explicit
  reload. Starters can register partial work before throwing, without returning
  its cleanup. Retrying would risk duplicate subscriptions or timers. The helper
  does not claim to roll back that partial work; reloading discards the document.
- Each runtime owns its failure notice. Stopping that owner removes its message
  without hiding another runtime's failure. Successful owners show no notice.
- Optional preload failures stay silent: `settlePreloads` in the router settles them,
  and nothing in the interface changes.

The notice is markup in `index.html` beside the boot overlay, and its reload control
is wired by the existing boot script. `src/app/runtimeNotice.ts` only fills in and
reveals it.

## Consequences

- The failure contract is one helper, not a per-runtime decision, so a third runtime
  cannot silently invent its own retry policy.
- The notice is visible even when the React tree is unhealthy, because it is not part
  of it.
- Placing the notice outside the React shell was a budget decision as much as a
  robustness one: initial JavaScript sits close to its cap, and a shell component
  would have been paid for by every visitor. Rotating the inline boot script required
  updating its hash in `nodeapp/security-headers.conf`; no directive changed.
- Tests: `src/app/backgroundRuntime.test.ts` for the two failure paths and the single
  owner, `src/app/runtimeNotice.test.ts` against the shipped `index.html`, and two
  production-browser cases in `scripts/audit-production-journeys.mjs` — one proving a
  blocked optional chunk neither reloads the document nor reveals the error screen,
  one proving the notice appears, names Fleet synchronization, and reloads into a
  working desk.

## Alternatives

- **Retry the failed import on reconnect.** Insufficient: the module map is
  immutable, so the retry repeats the same failure while the user is told nothing.
- **Reload automatically on failure.** Rejected: it discards in-page state for a
  problem that is not urgent, and on a slow circuit it can loop.
- **Retry initialization on lifecycle events.** Rejected without rollback in
  every starter. User-controlled reload is the smaller, safer recovery policy.
- **A React notice component in `AppShell`.** Rejected on size and reachability: it
  costs initial JavaScript for every visitor and disappears with the tree it reports
  on.
- **Keep the failure in the console only.** Insufficient for required work: a desk
  that shows a fleet nobody is synchronizing is worse than one that says it stopped.
