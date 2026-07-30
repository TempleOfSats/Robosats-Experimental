# ADR-0002: Domain-owned shared state and side effects

- Status: Accepted
- Date: 2026-07-30

## Context

Coordinator requests, relay subscriptions, Fleet synchronization, and order
polling can overlap on slow Tor circuits. Duplicated global state or hidden
side effects create stale UI and unnecessary network pressure.

## Decision

Use component state for temporary interaction and a domain Zustand store for
cross-route workflow state. The owning domain controls persistence and
long-running effects. Module-level singletons are limited to deliberate
process-wide resources such as the request scheduler, relay pool, and
in-flight deduplication maps.

Every long-running effect needs stale-result protection and a defined owner.
Interactive requests take priority over background refreshes.

## Consequences

Components call domain actions and selectors instead of mutating shared
objects. Persisted schemas and side-effect ownership require regression tests,
especially for cancellation, offline coordinators, and recovery.

## Alternatives

A global application store and a generic event bus were rejected because both
hide feature ownership and make request lifecycles harder to trace.
