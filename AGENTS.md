# Maintenance Rules

These rules apply to coding agents and human contributors working in this
repository.

## Before changing code

1. Inspect the current branch, worktree, responsible module, and nearby tests.
2. Preserve unrelated staged, unstaged, and untracked work.
3. Extend an existing pattern before introducing a framework or abstraction.
4. Keep domain logic independent from UI, persistence, and network adapters.
5. Do not create an abstraction for one implementation. Require two real use
   cases, preferably three when the contract is unclear.
6. Do not introduce circular dependencies or bypass a domain's owning store.
7. Add or update tests for changed behavior, including failure and recovery
   paths when relevant.
8. Remove superseded code instead of retaining parallel implementations.
9. Run `./scripts/check` before declaring meaningful work complete.
10. When native, packaging, or release files change, also run every applicable
    platform check listed in `CONTRIBUTING.md`. The portable gate does not
    replace SDK-dependent Android, iOS, desktop, or live Tor verification.

Read `ARCHITECTURE.md` before changing module ownership, persistence,
transport, Nostr, Fleet encryption, or native bridges. Record significant
structural decisions in `docs/decisions/`.

## Builder mode

The builder implements the requested behavior with the smallest coherent
change. The builder reports:

- the responsible module and behavior changed;
- tests added or updated;
- dependency changes and new abstractions, if any;
- why a simpler implementation was insufficient when architecture changed;
- verification that was run, including applicable platform checks.

The builder does not approve its own architecture review.

## Maintainer mode

Use a separate person or AI session after implementation. Review the diff as a
skeptical long-term maintainer without redesigning the whole application.

Find:

1. unnecessary abstractions;
2. duplicated responsibilities;
3. weakened module boundaries;
4. hidden state or side effects;
5. difficult debugging paths;
6. missing tests;
7. code that should be deleted;
8. the simplest safe refactoring.

Classify each item as `fix now`, `monitor`, or `acceptable trade-off`. Prefer
deletion and simplification over introducing a new pattern.

## Safety and privacy

Never add live robot tokens, Fleet keys, private keys, invoices, chat content,
coordinator credentials, onion browsing history, or Tor state to source,
fixtures, logs, screenshots, or documentation. Do not weaken Tor routing,
encryption, CSP, or secret storage to simplify a test.
