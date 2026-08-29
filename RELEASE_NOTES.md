# RoboSats Exp. 0.2.0-alpha.1 Release Notes

**This is an alpha release. Please back up both ordinary robot tokens and the Pro Fleet key before testing.**

## Pro Mode and Robot Fleet

- Added a dedicated Pro Desk for managing multiple independent RoboSats identities from one view
- Fleet size capped at six active robots
- Each robot retains its own RoboSats token, keys, avatar, coordinator orders, and one-order-at-a-time lifecycle
- Centralized robot lifecycle selection (Ready, Renewable trade, Ongoing trade, waiting, unavailable, attention states)
- Optimistic Fleet status refreshes without disabling normal robot actions during background checks
- Create/take handoff into the Trade view for seamless coordinator actions
- Standard Garage remains available for non-Pro users with isolated robot selection

## Encrypted Fleet Synchronization

- Fleet key and local encrypted Fleet vault for cross-device recovery
- Fleet records encrypted before publication through coordinator relays
- Nostr synchronization using replaceable NIP-78 kind 30078 records with NIP-44 ciphertext
- Synchronized data: robot entries, offer presets, preferences, removal markers, completed-trade history, collaborative cancellations
- Live order state intentionally not treated as backup (reconciled with coordinators after recovery)
- Tolerant of slow or partially unavailable coordinator relays
- UI reports concise `Fleet syncing` and `Fleet synced` states

**Note:** Relay retention remains an operational dependency. Coordinators should accept, federate, and retain kind 30078 for substantially longer than ordinary order events.

## Offer Presets

- Pro users can create, name, edit, delete, select, and synchronize reusable offer presets
- Presets capture normal and advanced create-offer parameters
- Coordinator selection remains an explicit choice for each new offer
- Available from Pro Desk quick actions and create flow

## Trade Lifecycle and History

- Improved immediate API-to-client state reconciliation after coordinator actions
- Renewable/resumable treatment for paused and expired maker offers
- Pro Desk categories: Needs action, Active trades, Public offers, and Renewable (mutually exclusive)
- Terminal orders removed from active trade rows; robots become reusable with identity-reuse context
- Completed trades and collaborative cancellations archived into encrypted Fleet history
- Corrected buyer/seller payout behavior, terminal deadlines, payout retry presentation, duplicate sounds, and duplicate notifications

## Optional Early Peer Message

- One optional encrypted early message per robot/order
- Both maker and taker can prepare a message when peer key is available
- Peer does not see it until normal trade chat opens
- Loading and key-discovery states no longer falsely report message status
- Presence not shown in pre-chat state
- Coordinators without support retain existing RoboSats behavior

## Order Discovery and Market Tools

- Redesigned public orderbook with prominent Amount and Premium columns, payment-method column, Buy/Sell marks, coordinator names, responsive mobile rows, mutually exclusive filters
- Beginner-oriented Guided trade flow (direction, currency, amount, payment method)
- Guided review preserves wizard on cancel and pre-fills requested amount within offer range
- Market statistics using coordinator endpoints:
  - Live public liquidity
  - Depth/premium comparison
  - Currency comparisons
  - Average premiums
  - Recent public market activity

## F2F Discovery

- Lightweight, self-contained map for approximate F2F areas
- Searchable cities including locations relevant to Bitcoin circular economies
- Mouse-wheel zoom on desktop, pinch zoom on touch devices
- F2F offers discoverable and selectable from map without third-party map services
- Antarctica cropped from useful map viewport

## Tor, API, and Nostr Reliability

- Request profiles for user-visible and background work (slower Tor responses tolerated for manual loads)
- Coalesced duplicate API requests, prevented stale background responses
- Coordinator cooldown/backoff behavior for offline onion nodes
- Successful cached data visible while revalidation runs
- Route/module warming for Offers and Settings after startup
- Reused relay sessions and subscriptions to avoid excessive concurrent Nostr REQs
- Improved optimistic coordinator availability
- Diagnostic hooks and probes for Tor behavior validation (no sensitive data logged)

## UI, Themes, and Accessibility

- Reworked semantic light/dark palettes (Dark as default)
- Consistent hierarchy, spacing, typography, dialog behavior, focus visibility, disabled/loading states, responsive layouts
- Improved Pro Desk mobile tables, history empty states, settings controls, payment-method selectors, trade progress, payout routing, ratings, disputes, navigation feedback
- Disabled Pro navigation items explain unavailability without redirecting
- Fixed sidebar and tab tooltips to render above content cards
- Reduced-motion and keyboard/focus considerations
- Automated typography and theme-color checks

## Cross-Platform and Deployment

- Android, iOS, Linux, Windows, macOS, and Nginx web builds consume version from package.json
- Android native libraries: arm64-v8a and x86_64 (16 KB ELF alignment validated)
- Android builds require full JDK 17 installation
- Windows Rust binaries statically link CRT (no VCRUNTIME140_1.dll required)
- Desktop navigation follows Pro Mode, usable at compact window sizes
- Notification routing avoids duplicate Pro background notifications
- Nginx production: content-addressed assets, Brotli/gzip sidecars, non-cacheable shell, immutable versioned assets
- Coordinator avatars and /static/ resources use generated versioned static path
- OpenPGP, Nostr, maps, statistics, and robot identity remain lazy-loaded

## Performance and Recovery

- Boot screen recovers with actionable guidance when bundle assets fail to load
- Robot-setup and vault/Fleet dependencies load on demand at action time instead of eagerly
- Per-route JavaScript budgets enforced by the production build check; order, settings, and Pro routes stay within their request and transfer limits
- Recoverable guided orderbook loading with retry; deferred robot avatars

## Documentation

- Standard Garage and Pro Mode user guides with screenshots
- Fleet identity and workflow illustrations
- Color and typography system documentation
- Replaced old README demo with current-product walkthrough
- Removed development plans, temporary audits, generated build outputs, stale files, unreleased compatibility code

---

**Alpha Release Notice:** This is an alpha release intended for testing. Fleet recovery depends on coordinator relay retention policies. Please back up your robot tokens and Fleet key before testing.
