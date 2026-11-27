# RoboSats Exp. 0.3.1-alpha.9 Release Notes

**This is an alpha release. Please back up both ordinary robot tokens and the Pro Fleet key before testing.**

## Signed Coordinator Actions, Bound to the Coordinator

- Timed action signatures now embed the target coordinator's short alias (`action:alias:timestamp`), binding each signature to the coordinator it is sent to — matching upstream (RoboSats PR 2955) replay protection across federated coordinators
- Order, offer and Pro-workspace flows pass the alias end to end, with updated garage/maker/order/review test coverage

## Carried Over From 0.3.1-alpha.8

- Signed coordinator actions with robot keys and clear key-recovery errors
- `url` security update in all native Tor stacks
- Chat mirrored as NIP-17 gift wraps; desktop Tor engine on arti 0.48

**Note:** As always on alpha builds, export your robot tokens and Fleet vault before upgrading, and report regressions to the development coordinator.
