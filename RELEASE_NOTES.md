# RoboSats Exp. 0.3.1-alpha.6 Release Notes

**This is an alpha release. Please back up both ordinary robot tokens and the Pro Fleet key before testing.**

## Chat Image Reliability

- Encrypted chat images recover gracefully when a media load fails, with actionable error feedback instead of a dead frame
- Image preparation hardening before upload (size/format handling)
- Trade and garage layouts polish image and error states

## Clearer Coordinator Errors

- Coordinator validation payloads (per-field errors, `non_field_errors`, nested details) are now surfaced as human-readable messages instead of generic failures
- Maker API errors propagate structured details into the create-offer flow
- Order and garage views show friendlier load/error states wired to the new extraction
- Android bridge classifies HTTP request failures with dedicated unit tests

## Security Updates

- Patched `source-map-js` (high: event-loop DoS) and `react-router`/`react-router-dom` (high: RSC-mode CSRF) via semver-safe lockfile updates
- Patched `@vitest/mocker`/`vitest` (moderate: path traversal) and `smol-toml` (moderate: quadratic parse)
- The temporary React Router audit allowlist entry is removed now that the package is patched; dependency audits pass at `moderate` and `high`

## Carried Over From 0.3.1-alpha.5

- Encrypted chat images via coordinator Blossom with federation updates
- Improved Tor startup and recovery reliability

**Note:** As always on alpha builds, export your robot tokens and Fleet vault before upgrading, and report regressions to the development coordinator.
