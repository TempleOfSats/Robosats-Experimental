# ADR-0001: Feature-domain dependency direction

- Status: Accepted
- Date: 2026-07-30

## Context

The client composes many workflows across web and native shells. Unrestricted
imports would let UI, transport, and feature state become mutually dependent,
making Tor failures and startup behavior difficult to isolate.

## Decision

Keep product behavior in feature domains. Application code composes domains;
domains do not import the application shell. UI primitives and shared
utilities are leaves. Transport remains infrastructure and cannot import
product features. Automated dependency-cruiser rules reject cycles and these
reversed dependencies.

Cross-domain feature imports remain explicit and are allowed when ownership is
clear. A generic shared layer is not introduced preemptively.

## Consequences

Feature UI may live beside domain logic, but business rules must remain in
plain TypeScript. Moving ownership requires updating imports, tests,
`ARCHITECTURE.md`, and usually a new ADR.

## Alternatives

A global layered `services/repositories/controllers` structure was rejected
because it would separate code by technical label rather than by RoboSats
behavior and add abstractions without repeated use cases.
