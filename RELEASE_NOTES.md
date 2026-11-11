# RoboSats Exp. 0.3.1-alpha.7 Release Notes

**This is an alpha release. Please back up both ordinary robot tokens and the Pro Fleet key before testing.**

## Chat Reaches Upstream Robots

- Chat sends are now mirrored as NIP-17 gift wraps on the coordinator relay pool, so upstream-enabled peers that read Nostr (instead of coordinator PGP history) see messages in real time (ADR-0012)
- Wrapping code loads on demand; plaintext never enters persistence or logs
- Partial relay delivery is reported honestly — no silent retries of the coordinator POST
- Pre-chat and legacy robots keep the existing API/WebSocket path unchanged

## Desktop Tor Engine

- Arti upgraded 0.44 → 0.48; the vendored `saturating-time` patch crate and its build patches are gone (resolved from crates.io)

## Security Updates

- Patched `zod` (high: memory exhaustion via oversized collections) via lockfile update
- `happy-dom` raised to 21.0.4 (high: SSRF/incomplete-sanitization advisories covering ≤21.0.3); full suite green on the new version
- Two RustSec advisories with no upstream fix are now allowlisted as monitored exceptions, each with documented scope, rationale, and review triggers in the security workflow: `crypto-bigint` (verify-only authority-signature path) and bundled SQLite in `libsqlite3-sys` (requires opening attacker-supplied database files; the desktop sidecar only opens its own cache)

## Carried Over From 0.3.1-alpha.6

- Graceful recovery and actionable errors for encrypted chat images
- Coordinator validation payloads surfaced as human-readable messages
- Android bridge error classification with dedicated tests

**Note:** As always on alpha builds, export your robot tokens and Fleet vault before upgrading, and report regressions to the development coordinator.
