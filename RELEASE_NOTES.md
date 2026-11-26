# RoboSats Exp. 0.3.1-alpha.8 Release Notes

**This is an alpha release. Please back up both ordinary robot tokens and the Pro Fleet key before testing.**

## Signed Coordinator Actions

- Order, review and garage actions are now signed with the robot's key (timed `action:timestamp` payloads), matching the signed-actions scheme adopted upstream (RoboSats PR 2955) — required by coordinators that enforce it
- Robots missing their signing key get a clear recovery instruction instead of an opaque failure
- README documents the coordinator alias used in action signatures (federation short alias; for external coordinators, `COORDINATOR_ALIAS` lowercased with spaces removed)
- Coverage: garage, maker, order and review API tests exercise the signing path

## Carried Over From 0.3.1-alpha.7

- Chat mirrored as NIP-17 gift wraps so upstream-enabled peers see messages in real time
- Desktop Tor engine on arti 0.48 (vendored patch crate removed)
- Security updates incl. the November RustSec batch, zod and happy-dom

**Note:** As always on alpha builds, export your robot tokens and Fleet vault before upgrading, and report regressions to the development coordinator.
