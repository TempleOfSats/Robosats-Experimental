# Decision 0013: hold the lint/analysis toolchain at its known-good versions

## Context

The npm `minor-patch` dependency group (November 2026) resolved two analysis
tools forward inside their declared ranges:

- `oxlint` 1.75.0 to 1.95.0. Across twenty minors the `correctness` category
  grew the React Compiler-era rules (`set-state-in-effect`, render-time `refs`
  access, render purity), which report dozens of findings in long-standing
  screens. None of them is a defect introduced by the bump, and each fix
  changes rendering behaviour in a screen that ships.
- `dependency-cruiser` 18.1.0 to 18.9.0. The new version refuses to analyse
  with TypeScript 7.0 (its supported floor is 7.1), so the architecture check
  stops covering TypeScript sources.

While main carries these findings the portable maintenance gate fails for
every pull request, so the bumps cannot stay as they are.

## Decision

Pin `oxlint` to exactly `1.75.0` and `dependency-cruiser` to exactly `18.1.0`
in `package.json` and keep the resolved versions in `package-lock.json`. The
rest of the group's updates stay. The alternative — switching individual new
rules off, or letting the architecture check degrade — was rejected: each
further minor would silently add more findings to an already-excempt
`correctness` category or quietly shrink coverage, which is a weakening rather
than a named exception.

## Review triggers

- A dedicated render-hygiene pass: fix the oxlint findings (`setState` in
  effects, refs accessed during render, impure calls in render), then widen the
  pin again in one deliberate step.
- A TypeScript move to 7.1+ (or the tool shipping TypeScript 7.0 support)
  for dependency-cruiser.
- Any React upgrade or React Compiler adoption.
- Dependabot pull requests bumping either tool: they are the standing
  reminder and should be merged only after the matching pass, with the CI
  gate proving it.
