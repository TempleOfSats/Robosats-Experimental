# Private Buyer Reputation for RoboSats Fleets

RoboSats identities are intentionally disposable. This protects traders, but it
also means a reliable buyer looks identical to a first-time buyer whenever a new
robot is used.

The Fleet model creates an opportunity to improve that experience without
turning robots into permanent public identities. A Fleet can privately collect
evidence from several robots, calculate one coarse buyer tier, and disclose only
that tier during a trade.

This proposal does not create public profiles, publish trade histories, or let
coordinators discover which robots belong to the same Fleet.

## Goals

The system should:

1. Measure only successful trades completed as the buyer.
2. Aggregate successful trades across Fleet robots and coordinators.
3. Reveal only `none`, `beginner`, `intermediate`, or `expert`.
4. Keep counts, dates, order IDs, amounts, currencies, coordinators, and robot
   identities private.
5. Prevent a coordinator from linking two Fleet robots through reputation data.
6. Remain optional for coordinators and compatible with older frontends.
7. Use the Fleet key for recovery and cross-device synchronization.
8. Treat coordinator APIs as authoritative for order state.

The tier rules are:

```ts
export type BuyerTier = "none" | "beginner" | "intermediate" | "expert";

export function buyerTier(successCount: number, ageDays: number): BuyerTier {
  if (successCount >= 31 && ageDays >= 120) return "expert";
  if (successCount >= 11 && ageDays >= 90) return "intermediate";
  if (successCount >= 6) return "beginner";
  return "none";
}
```

The original rules use strict `>` comparisons. That means the effective
thresholds are 6, 11, and 31 successful trades.

`ageDays` is measured from the first coordinator-certified successful buyer
trade. Fleet creation time does not count because a Fleet key can be generated
and left unused.

## Why Frontend-Only Reputation Is Not Enough

The frontend can already observe an authenticated order with:

```ts
order.status === 14 && order.is_buyer === true
```

It can store that observation in encrypted Nostr application data and calculate
a tier. This is useful for private progress tracking, but it is not a reputation
proof. The Fleet owner controls the frontend and could fabricate records,
counts, or dates.

A Nostr signature from a Fleet-derived key only proves that the Fleet made the
claim. It does not prove that a coordinator completed the trades.

Existing RoboSats success notifications are also insufficient as credentials.
They notify both participants, do not contain a structured buyer attestation,
and are intended as wake-up messages rather than portable proofs.

The smallest trustworthy backend responsibility is therefore:

> After a successful trade, issue one private, signed credential to the buyer.

Coordinators do not calculate tiers and do not share reputation databases.

## Architecture

The design has four independent layers:

1. A hidden Fleet reputation secret.
2. A randomized commitment for each buyer trade.
3. A coordinator-signed success credential.
4. A zero-knowledge tier proof presented to the seller.

### Fleet Reputation Secret

The frontend derives a dedicated secret from the Fleet key:

```ts
const reputationSecret = hkdf(
  sha256,
  fleetSecret,
  new TextEncoder().encode("robosats:fleet-reputation:v1"),
  new TextEncoder().encode("master"),
  32
);
```

This derivation domain must be separate from robot generation, Fleet
synchronization, settings synchronization, and trade-cache encryption.

The reputation secret is never sent to a coordinator, relay, peer, or proof
verifier.

### Per-Trade Commitment

For each buyer trade, the frontend creates a randomized cryptographic
commitment:

```ts
const blinding = secureRandomScalar();
const commitment = pedersenCommit(reputationSecret, blinding);
```

This is protocol pseudocode. Production code must use an audited commitment
implementation compatible with the selected proof system.

Every commitment hides the same Fleet reputation secret but uses different
randomness. A coordinator seeing two commitments cannot determine whether they
belong to the same Fleet.

The buyer submits the commitment with an existing buyer-only request, preferably
the payout invoice or on-chain address submission. This avoids an additional
Tor round trip.

The blinding value remains encrypted inside the Fleet reputation ledger.

### Success Credential

When an order first reaches status `14`, the coordinator creates exactly one
credential for the authenticated buyer:

```json
{
  "schema": "robosats/buyer-success/v1",
  "issuer": "coordinator-reputation-public-key",
  "serial": "32-byte-unique-value",
  "subject_commitment": "hidden-fleet-commitment",
  "completed_day": 20658,
  "network": "mainnet",
  "role": "buyer",
  "outcome": "success"
}
```

The credential must not contain:

* The order ID.
* The robot token, hash, name, or Nostr key.
* The peer identity.
* The amount, currency, payment method, or premium.
* A Fleet identifier.

`completed_day` is a UTC day number rather than an exact timestamp. Day
precision is sufficient for the tier rules and avoids creating a more precise
historical record than required.

The credential is signed by a coordinator reputation key and delivered in two
ways:

1. Privately through a [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)
   message inside a [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md)
   gift wrap.
2. Through the authenticated order API so the buyer can recover it when the
   relay notification was missed.

Nostr is the asynchronous transport. The authenticated API remains the reliable
recovery path.

### Idempotent Issuance

Credential creation must be attached to the actual transition to successful
status, not to a human-readable notification.

Conceptually:

```py
def on_order_success(order):
    buyer = get_buyer(order)
    commitment = order.buyer_reputation_commitment

    if commitment is None:
        return

    credential, created = BuyerSuccessCredential.objects.get_or_create(
        order=order,
        defaults=issue_buyer_success_credential(order, buyer, commitment),
    )

    if created:
        send_private_credential(buyer.robot.nostr_pubkey, credential)
```

A one-to-one database constraint between the order and credential prevents task
retries from issuing multiple successes for one trade.

The credential should remain available to the authenticated buyer after
issuance. Repeated API reads return the same signed credential.

### Capability Discovery

Supporting coordinators advertise the feature through `/api/info`:

```json
{
  "buyer_reputation": {
    "version": 1,
    "issuer_pubkey": "hex-public-key",
    "credential_transport": "nip17",
    "proof_profile": "robosats-buyer-tier-v1"
  }
}
```

The frontend sends no commitment when this capability is absent. Older
coordinators and older frontends continue operating normally.

Only credentials from recognized coordinator issuer keys contribute to a
proof. A partially upgraded federation therefore remains usable, although
unsupported successful trades cannot increase the verified tier.

## Private Fleet Ledger

Credentials and commitment openings are synchronized as encrypted
[NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) application
data under a dedicated `reputation-sync` derivation domain.

A local record can use the following shape:

```ts
type BuyerSuccessRecord = {
  version: 1;
  credential: SignedBuyerSuccessCredential;
  commitmentBlinding: string;
  receivedAt: number;
};
```

The relay-facing event should use:

* NIP-44 encrypted content.
* Opaque tags.
* Padded payload buckets.
* Coalesced publication.
* Publication jitter unrelated to the trade completion time.

Publishing one event immediately after every trade would create avoidable
timing correlation. The local ledger should update immediately, while remote
publication happens later in the background.

Credential serials provide deterministic deduplication across devices.
Credentials are immutable. Cross-device convergence is therefore set union by
validated serial rather than last-write-wins replacement.

## Tier Proof

The buyer does not send credentials to the seller. Doing so would expose trade
count, dates, coordinators, and potentially relationships between robots.

Instead, the frontend produces a zero-knowledge proof. Its private inputs are:

```text
Fleet reputation secret
credential signatures
credential serials
completion days
commitment blinding values
```

Its public inputs are:

```text
tier
current UTC day
trusted coordinator issuer-set root
current order challenge
```

The proof verifies that:

1. Every credential signature is valid.
2. Every issuer belongs to the accepted coordinator set.
3. Every credential has `role = buyer` and `outcome = success`.
4. Credential serials are distinct.
5. Every subject commitment opens to the same hidden Fleet reputation secret.
6. Count and age satisfy the claimed tier.
7. The proof is bound to the current order challenge.

The seller receives only:

```json
{
  "schema": "robosats/buyer-tier-proof/v1",
  "tier": "intermediate",
  "proof": "base64-proof",
  "challenge": "current-order-challenge"
}
```

Binding the proof to the current order prevents another trader from copying and
replaying it. The challenge must not be reusable as a stable Fleet identifier.

Proof generation may be expensive on mobile devices. It should run after the
peer is assigned, provide immediate progress feedback, and cache only
order-bound results. Verification should remain fast.

The proof circuit, commitment scheme, signature scheme, serialization, trusted
setup requirements, and issuer-set construction require a separate security
review before implementation.

## User Experience

The badge should appear only after a peer is assigned. Public orderbook badges
would provide spectators with a behavioral fingerprint.

The seller sees one compact label:

```text
Buyer experience: Intermediate
```

A tooltip explains the tier threshold but never shows the exact count, first
trade date, coordinator distribution, or supporting receipts.

Recommended states are:

```text
No badge
Verifying buyer experience
Beginner
Intermediate
Expert
Could not verify
```

`Could not verify` must not imply bad behavior. It can mean the buyer has no
Fleet, used unsupported coordinators, uses an older frontend, or could not
produce a proof over Tor.

Older frontends simply omit the badge. Reputation must never block taking,
creating, or completing an order.

## Rejected Simpler Designs

### Public NIP-58 Badges

[NIP-58](https://github.com/nostr-protocol/nips/blob/master/58.md) badge awards
identify recipients through public `p` tags. That creates a stable subject and
does not satisfy the Fleet privacy goal.

### NIP-85 Trusted Assertions

[NIP-85](https://github.com/nostr-protocol/nips/blob/master/85.md) assertions
place the subject pubkey in an addressable event. A Fleet-wide assertion pubkey
would become a linkable reputation identity.

### Self-Signed Fleet Claims

A Fleet can sign its own tier, but that proves only control of the Fleet key.
The owner can fabricate the underlying history.

### Revealing Signed Receipts

Coordinator signatures make receipts objective, but presenting 6, 11, or 31
receipts leaks more information than the tier itself. Private credentials must
remain hidden behind the proof.

### Coordinator-Calculated Global Reputation

A coordinator cannot calculate a cross-coordinator tier without learning which
robots belong to the Fleet. A central reputation service would introduce the
same linkage and become another trusted backend.

## Security Boundaries

The design deliberately accepts two limitations.

First, the Fleet key is bearer recovery material. Someone who obtains it can
recover the robots and their reputation. Preventing reputation transfer would
require a persistent real-world or hardware-backed identity, which conflicts
with RoboSats portability and privacy.

Second, successful self-trades can farm credentials. Bonds, coordinator fees,
and routing costs make farming non-free but do not make it impossible.
Mitigating it reliably would require coordinator-side abuse analysis and would
expand the scope beyond objective successful-trade counting.

## Delivery Plan

An incremental implementation can keep the financial protocol unchanged:

1. Freeze the credential schema and cryptographic profile.
2. Implement capability discovery and optional buyer commitments.
3. Add idempotent credential issuance and authenticated recovery.
4. Deliver credentials through the existing private Nostr channel.
5. Add encrypted Fleet reputation records and cross-device convergence tests.
6. Implement and audit the tier proof.
7. Add private order-bound presentation and verification.
8. Enable the badge experimentally for supporting coordinators.

The coordinator patch remains intentionally narrow. Coordinators certify one
fact they already know: a particular private buyer commitment completed a
successful trade. Fleet aggregation, synchronization, tier calculation, and
private disclosure remain client responsibilities.
