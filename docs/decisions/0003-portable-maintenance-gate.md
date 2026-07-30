# ADR-0003: One portable maintenance gate

- Status: Accepted
- Date: 2026-07-30

## Context

The repository had strong but separate lint, test, build, and platform checks.
Contributors needed one reliable command before a commit, while full Android,
iOS, desktop, and live Tor checks cannot run on every workstation.

## Decision

`./scripts/check` is the portable gate. It runs formatting, linting, strict
types, unit and integration tests, dependency rules, maintainability ratchets,
dead-code detection, and dependency auditing in a fixed order.

Prettier adoption is incremental to avoid a formatting-only rewrite of the
entire unreleased client. Complexity above 20 is recorded as exact existing
debt: it cannot grow, and improvements must lower or remove the baseline.
Duplication is capped at one percent.

Platform packaging and live Tor journeys remain explicit extended checks and
CI jobs.

## Consequences

New files and already-formatted files stay on the formatter baseline. Legacy
files are migrated deliberately rather than producing incidental whole-file
rewrites. New dependency cycles, dead files, unnecessary packages, or
complexity regressions fail locally and in CI. Maintainers must update
ratchets downward when code improves.

## Alternatives

Running every platform build locally was rejected because it requires several
operating systems and SDKs. Ignoring current maintainability debt was rejected
because a threshold loose enough for the largest function would not protect
new code.
