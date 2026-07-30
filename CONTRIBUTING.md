# Contributing

RoboSats Exp. is a privacy-sensitive, multi-platform client. Keep changes
focused, explicit, and easy to debug over slow or partially unavailable Tor
connections.

## Requirements

- Node.js 22.12 or newer in the Node 22 release line;
- npm with lockfile support;
- Rust 1.94.1 for native bridge work;
- Java 17, Android SDK 36, and NDK 27.0.12077973 for Android work;
- Xcode and XcodeGen, or xtool on Linux, for iOS work.

Install JavaScript dependencies from the repository root:

```bash
npm ci
```

Read `ARCHITECTURE.md` before changing module ownership, persistence,
transport, Nostr, Fleet state, or a native bridge. Coding agents must also
follow `AGENTS.md`.

## Change workflow

### 1. Find the owner

Identify the existing domain that owns the behavior and read its tests. Keep
business rules in plain TypeScript, UI in the owning feature, HTTP and Tor
details in transport, and persistence in a domain-owned adapter.

Do not add an abstraction for a single implementation. Wait for at least two
real consumers, and preferably three when the stable contract is not yet
obvious.

### 2. Build and test

Implement the smallest coherent change. Add regression tests for behavior
fixes and cover offline, timeout, stale-result, or recovery behavior whenever
the change affects coordinator or relay communication.

Run the portable gate before every meaningful commit or before ending a
coding session:

```bash
./scripts/check
```

It runs, in order:

1. Prettier on changed files;
2. Oxlint and UI token checks;
3. TypeScript strict type checking;
4. unit tests;
5. cross-domain integration tests;
6. dependency-boundary and cycle checks;
7. complexity and duplication ratchets;
8. Knip dead-code analysis;
9. the high-severity dependency audit.

The formatter is intentionally incremental: existing source predates the
formatter baseline. New files and files already on that baseline are enforced;
legacy files are reported and skipped until they are deliberately migrated.
This avoids a repository-wide formatting-only rewrite. Run `npm run format`
to format eligible files in the current change.

### 3. Run platform checks when relevant

The portable gate cannot replace SDK-dependent checks:

| Change                          | Additional verification                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| Production web or asset loading | `npm run build`, `npm run check:production-build`, `npm run check:web-csp` |
| Live Tor journey                | `npm run audit:journeys` against a production preview                      |
| Desktop Rust or Tauri           | `npm run check:desktop`                                                    |
| Android bridge or packaging     | `npm run build:android:debug` and `cd android && ./gradlew lintDebug`      |
| iOS configuration               | `npm run check:ios:config`                                                 |
| iOS Rust bridge                 | `npm run check:ios:rust`                                                   |
| Release metadata or signing     | the relevant release script tests and `maintainers/releasing.md`           |

CI runs the portable gate and the applicable platform jobs.

### 4. Use a separate maintainer review

Do not use the builder session as the sole approval of its own work. A
separate reviewer or AI session should use this prompt:

> Review this change as a skeptical long-term maintainer.
>
> Do not redesign the whole application.
>
> Find unnecessary abstractions, duplicated responsibilities, weakened module
> boundaries, hidden state or side effects, difficult debugging paths, missing
> tests, code that should be deleted, and the simplest safe refactoring.
>
> Distinguish between fix now, monitor, and acceptable trade-off. Prefer
> deletion and simplification over introducing new patterns.

Resolve `fix now` findings or document why they are intentionally deferred.

## Architecture decisions

Add a short ADR under `docs/decisions/` when a change alters:

- allowed dependency direction;
- ownership of shared state or long-running side effects;
- a persistence, encryption, or recovery format;
- the API, Nostr, Tor, or native bridge strategy;
- a cross-platform contract.

An ADR should state context, decision, consequences, and rejected simpler
options. Routine refactors and local UI choices do not need one.

When architecture changes, the pull request must list dependency changes, new
abstractions, and why a simpler implementation was insufficient.

## Periodic simplification

After roughly three to five feature changes, schedule a small maintenance pass:

- remove dead and superseded code;
- merge duplicated concepts rather than adding adapters between them;
- rename unclear modules;
- split only files with genuinely mixed ownership;
- reduce cross-domain dependencies;
- strengthen tests around fragile behavior;
- lower complexity baselines when code improves;
- update `ARCHITECTURE.md`.

Avoid speculative future-proofing and large rewrites.

## Pull requests and repository hygiene

Keep pull requests focused. Explain changes to authentication, PGP keys, Nostr
events, Tor routing, coordinator requests, persistence, payments, and native
bridges explicitly.

Do not commit `dist`, `build`, `target`, generated mobile web assets, signing
keys, provisioning profiles, robot tokens, invoices, coordinator credentials,
or Tor state. Never place live trade data or secrets in an issue, fixture,
screenshot, test, or log.

Dependency updates must keep lockfiles synchronized and pass dependency review.
Do not suppress an advisory without a narrow written rationale and a removal
condition.
