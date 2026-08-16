# Coming from the classic RoboSats frontend

[Guide home](README.md) | **Classic frontend transition** | [Standard Garage](standard-garage-guide.md) | [Pro Mode](pro-mode-guide.md)

If you already know RoboSats, the protocol will feel familiar. RoboSats Exp. changes how the client organizes robots and presents slow Tor work; it does not turn the trade into a different custody model.

## What has not changed

- A robot token still controls one RoboSats identity.
- Makers publish offers and takers accept them.
- Coordinators host orders and remain authoritative for trade state.
- Both sides lock fidelity bonds.
- The seller locks the trade amount in Lightning escrow.
- The buyer sends fiat and supplies the Lightning payout destination.
- Exact payment details belong in encrypted peer chat.
- Tokens remain portable to compatible RoboSats frontends.

## Where familiar actions moved

| Familiar task | RoboSats Exp. location |
| --- | --- |
| Create or restore a robot | **Garage** |
| Inspect the public orderbook | **Offers** |
| Use a guided offer search | **Offers > Guided trade**, or **Find an offer** in the Garage |
| Publish an offer | **Create** |
| Continue the selected order | **Trade** |
| Inspect coordinators | **Settings > Coordinators** |
| Configure one robot | **Robot settings** |
| Manage several robots | **Settings > Pro Mode**, then **Pro Desk** |
| Read public market aggregates | **Offers > Statistics** |

The navigation item **Trade** is unavailable until the current workspace has an order to open. Create or take an offer first.

## Standard Garage is the closest familiar path

The Standard Garage keeps one selected robot in a focused workspace.

![Standard Garage showing robot state and next actions](assets/tutorial/screenshots/garage-home.png)

1. Find an offer without manually filtering the whole orderbook.
2. Create an offer with complete control over its terms.
3. Open robot settings, backups, keys, and notifications.

Use the [Standard Garage guide](standard-garage-guide.md) when you want the classic one-robot mental model.

## Pro Mode is separate, not a migration

Enabling Pro Mode creates or restores a **Robot Fleet**. It does not import, delete, or silently merge Standard Garage robots.

- Turn Pro Mode off and Standard Garage robots appear again.
- Turn it on and Fleet robots return.
- Every Fleet robot is still a normal RoboSats robot with its own token and one-order limit.
- You do not need to move an old Standard token into a Fleet.

![A Robot Fleet with independent robot controls highlighted](assets/pro-guide/04-add-robots.png)

Pro Mode adds organization: one desk for several orders, offer presets, encrypted cross-device Fleet recovery, and locally observed completed-trade history.

## Status can remain visible while Tor refreshes

The client often keeps a usable cached state on screen instead of replacing the whole page with a spinner.

- **Ready** means no known order currently occupies the robot.
- **Checking coordinators** means a refresh is running; it does not erase the last useful state.
- **Waiting for coordinators** means no coordinator request has completed yet.
- **Status unavailable** is reserved for attempted requests that all failed.
- A Nostr hint can request a fast refresh, but the coordinator API still confirms the state.

For a payment or order-changing action, wait for the action's visible result before trying again.

## OpenPGP and Nostr

The client uses both, for different jobs:

- **OpenPGP** protects peer chat and signs selected coordinator protocol values.
- **Nostr** carries the public orderbook when selected, private order-change hints, ratings, and encrypted Fleet records.

Neither replaces the robot token or coordinator API. See [Robot identity, OpenPGP, and Nostr](identity-and-privacy.md) for the complete model.

## Your first session checklist

- [ ] Recover an existing token or generate and back up a fresh one.
- [ ] Open **Settings > Coordinators** and let the reachability checks settle.
- [ ] Confirm **Buy BTC** or **Sell BTC** before accepting an offer.
- [ ] Pay each bond or escrow invoice once.
- [ ] Keep payment details inside encrypted chat.
- [ ] Try Pro Mode only if several independent robots would genuinely help.
- [ ] Keep a Fleet open until **Fleet synced** after an important Fleet change.

The [full Standard Garage guide](standard-garage-guide.md) covers the complete buyer and seller paths. The [Pro Mode guide](pro-mode-guide.md) focuses on multi-robot daily work and recovery.

---

[Guide home](README.md) | Next: [Standard Garage](standard-garage-guide.md)
