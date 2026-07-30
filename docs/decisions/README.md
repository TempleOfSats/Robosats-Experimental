# Architecture decisions

Architecture Decision Records explain significant structural choices without
turning implementation history into a design manual.

## Index

- [ADR-0001: Feature-domain dependency direction](0001-feature-domain-dependency-direction.md)
- [ADR-0002: Domain-owned shared state and side effects](0002-domain-owned-state-and-side-effects.md)
- [ADR-0003: One portable maintenance gate](0003-portable-maintenance-gate.md)
- [ADR-0004: Explicit Tor reconnect](0004-explicit-tor-reconnect.md)

## Adding a decision

Copy `template.md`, assign the next number, and keep the record short. Use an
ADR for dependency direction, shared-state ownership, persistence or
encryption formats, transport strategy, and cross-platform contracts. Do not
use one for routine implementation details.
