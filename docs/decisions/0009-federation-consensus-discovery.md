# ADR-0009: Federation consensus discovery

- Status: Accepted
- Date: 2026-08-29

## Context

The bundled federation document gives every platform a fast, offline-capable
coordinator list, but changing that list previously required a client release.
RoboSats coordinators now expose a canonical federation hash through
`/api/info/` and the matching document through `/api/federation/`.

## Decision

The coordinator domain remains the owner of federation membership. It starts
from the last hash-verified document when available, otherwise from the bundled
document. Existing health refreshes collect federation hashes without adding a
request in the common case. At least two enabled federated coordinators must
vote, and one hash must receive a strict seniority-weighted majority before the
client considers an update.

Seniority is derived only from bundled establishment dates or a local
first-accepted ledger. Coordinator-provided dates do not influence voting
weight. When the winning hash differs from the active document, the client
fetches one `/api/federation/` document from a winning voter, validates it, and
recomputes the hash before adoption. Indecision, transport failure, invalid
data, or a hash mismatch leaves the active document unchanged.

Bundled badges remain authoritative. Newly discovered coordinators receive
neutral badges and no development-fund lottery advantage. Explicit custom
coordinators remain local and never vote. Accepted membership and join dates
are persisted for offline startup; live coordinator, relay, Nostr-author, Pro,
and API-orderbook consumers update through the existing federation store.

The bundled trust root remains this distribution's existing four-member
federation snapshot. An alias absent from that snapshot is deliberately treated
as a newcomer, even if another client distribution already bundles it. This
avoids granting retroactive seniority or trusted badges through remote data.

## Consequences

Coordinator additions, removals, and endpoint or Nostr-key changes can take
effect without a client release. The common path adds no Tor request because
it reuses `/api/info/`; a full document is downloaded only after a majority
hash changes. Self-hosted clients can apply removals immediately, while a new
coordinator remains unreachable until that deployment has a matching proxy.

Persistence and consensus failure paths require regression coverage. The
bundled document remains the recovery root if persisted state is unavailable
or malformed.
