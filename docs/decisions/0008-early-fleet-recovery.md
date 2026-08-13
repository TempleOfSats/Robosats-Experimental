# ADR-0008: Early Fleet recovery with safe relay reconciliation

- Status: Accepted
- Date: 2026-08-13

## Context

Recovery waited for every relay, so one offline coordinator delayed a usable
Fleet. Returning early without tracking unread relays could overwrite newer
remote records.

## Decision

Recovery accepts the first usable, fully paginated relay result after real EOSE,
then allows 1.5 seconds for other fast replies. It cancels remaining foreground
queries and leaves further attempts to the explicit **Retry** action.

The encrypted local envelope records all targets and completed relays before the
Fleet opens. Normal synchronization fully reads each remaining relay before it
may receive restored publications. This barrier survives restart.

## Consequences

- Offline relays no longer hold successful recovery open.
- One relay can bootstrap the Fleet without claiming global completeness.
- The existing sync engine performs the remaining safe reconciliation.
