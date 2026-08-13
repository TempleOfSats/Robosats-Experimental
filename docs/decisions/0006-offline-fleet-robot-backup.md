# ADR-0006: Offline Fleet robot backup

- Status: Accepted
- Date: 2026-08-13

## Context

A Fleet key cannot reproduce a robot until its random Fleet entry ID is known.
Nostr normally supplies those encrypted entries, so key-only recovery fails if
no retaining relay is reachable.

## Decision

**Back up Fleet** exports the normalized Fleet key and a NIP-44-encrypted Garage
manifest, including tombstones and revision metadata. It does not include
explicit robot tokens, settings, presets, history, coordinator state, chats,
invoices, or relay bookkeeping. Imports are size-bounded and authenticated;
legacy key-only files continue through relay recovery.

Import restores only the robot manifest and invalidates that Fleet's pull
cursors. A reconciliation barrier is stored with the encrypted local envelope.
Each relay must complete a full read with real EOSE before restored records can
be published to it. The normal sync runtime restores any available settings and
history and keeps this guard across restarts.

## Consequences

- Robot identities remain recoverable when relays are unavailable.
- The backup is a point-in-time copy and should be refreshed after Fleet edits.
- Presets, settings, and history still depend on encrypted Nostr records.
- The file is as sensitive as the Fleet key; its encryption protects the
  manifest from casual disclosure but is not a second access-control layer.

## Alternatives

Sequential derivation would break existing identities without avoiding the
manifest lookup. Exporting the local envelope would leak transport bookkeeping;
exporting the full recovery snapshot would include unrelated private data.
