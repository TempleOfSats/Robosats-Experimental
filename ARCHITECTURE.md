# Architecture

This document records the boundaries that keep RoboSats Exp. understandable as
the web, Android, iOS, and desktop clients evolve. It describes the current
repository, not a future framework.

## Dependency direction

Dependencies point inward toward reusable behavior and outward only at
composition boundaries.

| Area                    | Path                           | May depend on                                                                   |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| Application composition | `src/main.tsx`, `src/app/`     | app shell, UI primitives, and domain entry points                               |
| App shell               | `src/components/app/`          | UI primitives and the minimum domain state needed for navigation                |
| Feature domains         | `src/domains/<feature>/`       | `src/lib/`, UI primitives, infrastructure, and explicit neighboring domain APIs |
| UI primitives           | `src/components/ui/`           | React, third-party visual libraries, and `src/lib/`                             |
| Shared utilities        | `src/lib/`                     | platform APIs and small third-party utilities only                              |
| Infrastructure          | `src/domains/transport/`       | transport internals, diagnostics, and cryptographic header helpers              |
| Platform adapters       | `android/`, `ios/`, `desktop/` | their platform SDK and native bridge implementation                             |

The enforced rules are in `.dependency-cruiser.cjs`:

- no circular dependencies;
- production code cannot import test modules;
- domains cannot depend on `src/app/` or `src/components/app/`;
- UI primitives and shared utilities remain domain-free;
- transport cannot import product feature behavior;
- `src/main.tsx` remains an entry point.

Cross-domain imports are allowed when one domain genuinely consumes another
domain's public behavior. They must not be used to reach incidental component
state or bypass the owning store. If several domains need the same behavior,
first identify its actual owner; do not create a generic `common`, `manager`,
or `service` module by default.

## Responsibility placement

### Business rules

Business rules belong in framework-independent `.ts` modules beside their
feature:

- order lifecycle and actions: `src/domains/orders/`;
- orderbook normalization and filtering: `src/domains/orderbook/`;
- coordinator selection and health: `src/domains/coordinators/`;
- Fleet encryption, reconciliation, and history: `src/domains/pro/`;
- chat encryption and safety: `src/domains/chat/`;
- payment calculations and expiry: `src/domains/payments/`.

React pages may compose rules and render their results. They must not become
the only implementation of an order transition, validation rule, encryption
decision, or persistence format. Extract such logic into a named domain
function and test it.

### UI

Feature-specific UI stays in its domain. Reusable visual primitives stay in
`src/components/ui/` and must not know about robots, orders, coordinators, or
Fleet state. `src/components/app/` owns navigation and application chrome, not
trade behavior.

### API, Nostr, and infrastructure

Coordinator HTTP calls go through the typed API modules and
`src/domains/transport/`. Request scheduling, timeout profiles, Tor recovery,
and native bridge selection stay in transport.

Nostr connection pooling and relay behavior stay in `src/domains/nostr/`.
Feature domains may ask that layer for events or subscriptions; they must not
create independent relay pools. API and Nostr responses are normalized at
their boundary before being stored or rendered.

Native code exposes narrow bridge operations. It must not duplicate order
lifecycle or UI state decisions already owned by TypeScript.

### Persistence and secrets

There is no server-side database in this repository. Browser storage,
IndexedDB, native secure storage, and cached files are persistence adapters:

- a feature store owns its schema, migration, and serialization;
- general key/value access goes through
  `src/domains/transport/systemClient.ts`;
- Fleet secrets go through
  `src/domains/pro/garageSecretStore.ts` and native secure storage;
- pages may persist only non-secret, page-local disclosure or acknowledgement
  preferences;
- tokens, private keys, invoices, chat plaintext, and coordinator credentials
  must never enter fixtures, logs, screenshots, or unencrypted general
  storage.

Changing a persisted schema requires migration behavior and a regression test.

## Shared state and side effects

Use the smallest state scope that works:

1. component state for temporary visual interaction;
2. a domain Zustand store for state shared across routes or workflows;
3. a domain-owned persistence adapter for state that survives restart;
4. a module-level singleton only for a deliberate process-wide resource such
   as a relay pool, request scheduler, or in-flight request deduplicator.

Stores expose actions and selectors. Components should not mutate another
domain's internal objects. Derived data should be computed in a pure selector
or model function instead of copied into several stores.

Every long-running side effect needs an owner, cancellation or stale-result
protection, and a testable trigger. Background work must respect Tor request
budgets and must not compete with interactive order actions.

## Errors and diagnostics

- Transport failures use `RoboSatsApiError` or retain the original typed error
  until the UI boundary.
- User-facing text is produced with `toUserMessage`; raw response bodies,
  exception names, and transport details are not rendered.
- Expected offline, timeout, abort, and stale-response paths are states, not
  unhandled exceptions.
- Development-only console output must be gated by `import.meta.env.DEV`.
- Durable diagnostics record bounded, redacted metadata. Coordinator origins
  are hashed; secrets, onion addresses, tokens, invoices, and chat content are
  never logged.
- Do not catch an error only to ignore it. Either recover deliberately,
  translate it at the boundary, or let the owning error boundary handle it.

## Abstraction rules

Prefer a direct function and an explicit data type. Do not introduce an
abstraction until at least two concrete use cases demonstrate the same
responsibility; three are preferable when the API is still unclear.

Discouraged without a recorded reason:

- dependency-injection containers;
- generic repositories over one storage implementation;
- global event buses when a store action or typed event already has an owner;
- `Manager`, `Service`, `Helper`, or `Common` modules with mixed
  responsibilities;
- wrappers that only rename a third-party API;
- parallel old and new implementations kept "just in case";
- speculative extension points and inheritance hierarchies.

An abstraction is justified when it removes repeated policy, contains a
platform boundary, or gives several real consumers a smaller stable contract.
Delete superseded code in the same change.

## Testing and maintenance

Pure domain behavior receives unit tests next to the implementation.
Cross-domain API fixture compatibility lives under `src/test/` and is run as
the integration suite. Changes to Tor transport, persistence, encryption,
order actions, or platform bridges require regression coverage for failure and
recovery paths.

`./scripts/check` is the portable local quality gate. Platform builds and live
Tor journeys remain extended checks because they need SDKs, native libraries,
or running services. See `CONTRIBUTING.md`.

The complexity baseline is a ratchet, not an endorsement. Existing exceptions
cannot grow; new functions must remain at complexity 20 or below. Duplication
is limited to one percent and should still be reviewed when it represents
duplicated policy rather than harmless markup.

After roughly three to five feature changes, perform a simplification pass:
remove dead code, merge duplicate concepts, reduce dependencies, clarify
ownership, improve fragile tests, and update this document if reality changed.
Prefer these small passes over a large rewrite.

## Architecture decisions

Significant structural choices use short Architecture Decision Records in
`docs/decisions/`. Add an ADR when changing dependency direction, shared-state
ownership, persistence or encryption formats, transport strategy, or a
cross-platform contract. Do not create an ADR for routine implementation
details.
