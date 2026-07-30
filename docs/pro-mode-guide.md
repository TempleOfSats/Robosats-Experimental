# Pro Mode and Robot Fleet guide

[Guide home](README.md) | [Standard Garage](standard-garage-guide.md) | **Pro Mode** | [Identity and privacy](identity-and-privacy.md)

Pro Mode is for traders who want several independent robot identities without keeping separate browser profiles or manually rebuilding the same offers.

It adds:

- A **Robot Fleet** of up to six active robots.
- One **Pro Desk** for their live orders.
- Reusable **offer presets**.
- Encrypted cross-device Fleet recovery.
- Private history for completed trades and collaborative cancellations observed by the client.

The trade protocol does not change. Every Fleet member is still a standard RoboSats robot with its own token, keys, and one-order limit.

> **The Fleet key controls the whole collection.** Treat it like a wallet seed. Never paste it into a website, peer chat, support ticket, issue report, or screenshot.

The screenshots below contain demonstration robots and orders. They do not contain real keys, tokens, invoices, or trades.

## Is Pro Mode right for you?

| Standard Garage | Pro Mode |
| --- | --- |
| One selected robot | Up to six active, independent robots |
| One focused order workflow | Combined view of several orders |
| Back up one robot token | Back up one Fleet key, plus optional individual tokens |
| Enter offer terms each time | Save and reuse presets |
| Recover one identity | Recover synchronized Fleet records across devices |

You do not need Pro Mode to make a normal trade. Use it when these organizational features save real effort.

## Part 1: Quick setup

### 1. Enable Pro Mode

Open **Settings** and turn on **Pro Mode**.

![Pro Mode setting highlighted](assets/pro-guide/01-enable-pro-mode.png)

1. The toggle changes the active workspace; it does not move or delete existing Standard Garage robots.

Turn Pro Mode off later and Standard Garage robots return as they were. Fleet robots remain in their own workspace.

### 2. Create or restore a Fleet

![New Fleet and Restore Fleet choices highlighted](assets/pro-guide/02-set-up-fleet.png)

1. **Set up a new Fleet** creates a new Fleet key and an empty collection.
2. **Restore Fleet** queries coordinator relays using a Fleet key you already backed up.

Choose **Keep standard Garage** when you do not want to enable Pro Mode yet.

**You should now see:** a Fleet-key backup step for a new Fleet, or a recovery progress panel for an existing one.

### 3. Back up the Fleet key

![Fleet key and locked Continue action highlighted](assets/pro-guide/03-back-up-fleet-key.png)

1. Copy or download the Fleet key and store it privately.
2. **Continue to Trade Desk** becomes available after the backup is acknowledged.

Keep two private copies in different places. A password manager plus an offline backup is a reasonable starting point.

Restoring synchronized records requires:

1. The exact Fleet key.
2. At least one reachable coordinator relay retaining those encrypted records.

An individual robot token remains useful. It can recover that robot directly in another compatible RoboSats frontend even if the complete Fleet cannot be reached.

### 4. Add independent robots

Open **Robot Fleet**.

![Robot Fleet controls for adding, managing, and backing up robots](assets/pro-guide/04-add-robots.png)

1. **Add Robots** creates another independent robot, up to the six-robot limit.
2. Each row has actions for its token, Telegram setup, offer creation, and removal.
3. Fleet-level controls back up the key, open presets, or abandon the local Fleet.

Each robot has:

- Its own standard RoboSats token.
- Its own nickname and avatar.
- Its own OpenPGP keypair.
- Its own Nostr keypair.
- One coordinator order slot.

One robot can wait for a taker while another continues an active trade. Their identities do not become one shared coordinator account.

**You should now see:** each newly generated robot marked **Ready** immediately, followed by background coordinator checks that preserve the useful status on screen.

## Part 2: Daily use

### 5. Know the three Pro Desk tabs

#### Trades

Shows current action-required, active, public, and renewable orders. Select a row to open the complete Trade page.

#### Robot Fleet

Shows identities, lifecycle status, and robot-specific actions.

#### History

Shows completed trades and collaborative cancellations observed and archived by this client.

The information icons beside each tab give the same short explanation inside the client.

### 6. Choose an available robot

When you create or take an offer, Pro Mode asks which robot should own it.

![Available robots in the robot selector](assets/pro-guide/05-choose-a-robot.png)

1. Only robots that are available for a new order can be selected.

A public, paused, renewable, or active order occupies the robot's one order slot. The selector prevents that robot from starting a second trade.

Prefer a fresh robot when practical. If a robot was used before, the client shows a reuse warning because repeated activity can weaken separation between trades.

After an offer is created or taken, the client opens its Trade page so the next protocol action is visible.

If the coordinator supports the optional [early message](standard-garage-guide.md#optional-early-message), either side can leave one encrypted preparation note during setup. In Pro Mode, that message belongs only to the selected Fleet robot and its current order; it is not shared across the Fleet.

### 7. Create or take an offer

#### Create from Pro Desk

1. Select **Create offer**.
2. Choose an available robot.
3. Enter or load the terms.
4. Choose a current coordinator.
5. Review and publish.

#### Take from the orderbook

1. Open **Offers** or **Guided trade**.
2. Review the offer and exact amount.
3. Select **Take offer**.
4. Choose an available Fleet robot.
5. Continue on the Trade page.

The coordinator is chosen for every new offer. It is not permanently saved in a preset because availability, fees, and limits can change.

### 8. Save and reuse offer presets

Open **Offer presets** from the bottom of Pro Desk.

![Reusable presets for different trading routines](assets/pro-guide/06-offer-presets.png)

A preset stores recurring offer parameters, including the normal and advanced fields exposed by the creation form:

- Buy or sell direction.
- Currency.
- Fixed amount or range.
- Payment methods.
- Premium.
- Bond percentage.
- Expiry.
- Other selected offer options.

It does **not** publish an offer, reserve a robot, or permanently choose a coordinator.

#### Practical examples

| Preset | Example terms | Why it helps |
| --- | --- | --- |
| Weekly DCA | Buy `100-250 EUR`, Instant SEPA or Revolut, `+1.5%`, `3%` bond | Reuse a regular purchase range |
| Freelance income | Sell `400 USD`, Wise or CashApp, `+2%`, `3%` bond | Convert recurring income consistently |
| Local cash | Sell `20,000-50,000 JPY`, Cash F2F, `-1%`, `4%` bond | Reuse terms while choosing a fresh meeting area |

#### Use a preset

1. Select **Use**.
2. Choose an available robot.
3. Review every populated field.
4. Choose the coordinator.
5. Reconfirm the Cash F2F area when applicable.
6. Publish only when the review is correct.

![Robot selection while using a saved preset](assets/pro-guide/06-use-preset.png)

**You should now see:** the normal offer form with the preset values already populated. A preset remains an editable starting point, not a standing instruction.

### 9. Read the four trade categories

The summary strip places every order in one primary category:

- **Needs action:** the next protocol step belongs to you.
- **Active trades:** a peer is involved and the trade is in progress.
- **Public offers:** published offers waiting for a taker.
- **Renewable:** paused, expired, or otherwise resumable offers.

![A Pro Desk containing needs-action, active, public, paused, and renewable examples](assets/pro-guide/07-monitor-trades.png)

The same order is not counted twice. Select a category to filter the table.

| Status | Meaning | What to do |
| --- | --- | --- |
| Lock your bond | A maker offer is not public yet | Open it and pay the current bond invoice |
| Submit payout info | The buyer must provide a payout destination | Open it and submit a valid invoice |
| Lock trade escrow | The seller must lock the bitcoin amount | Open it and pay the escrow invoice once |
| Active trade | A peer is involved | Open it and continue the trade |
| Your order is public | It is visible in the orderbook | Pause or cancel from the row when desired |
| Your order is paused | It is hidden but still attached to the robot | Resume when ready |
| The order has expired | Its terms can be recreated | Open it and select **Renew offer** |

Only safe list-level actions appear as buttons. For every other action, select the row and use the full Trade page.

### 10. Understand robot status

| Robot Fleet label | Meaning |
| --- | --- |
| Ready | No known order blocks a new one |
| Ongoing trade | Select the label to open its active trade |
| Renewable trade | The robot owns a resumable order |
| Waiting for coordinators | No coordinator request has completed yet |
| Status unavailable | Coordinator requests were attempted and all failed |

A background refresh should not make a previously usable robot row unclickable. The client keeps the last useful lifecycle visible while checking.

### 11. Configure alerts per robot

Telegram enrollment belongs to one robot at one coordinator.

1. Open **Robot Fleet**.
2. Select the paper-plane action for that robot.
3. Choose a coordinator that offers Telegram setup.
4. Follow its bot link or QR code.

Installed Android and desktop apps can also expose native notifications. Read the illustrated [notifications guide](notifications-guide.md) before connecting a Telegram identity.

## Part 3: Recovery and records

### 12. Read Fleet syncing

The compact status beside **Pro Desk** has two states:

- **Fleet syncing:** a local Fleet change is waiting to be published.
- **Fleet synced:** no local Fleet change is waiting to be published.

This covers encrypted Fleet records, not live trade status. Coordinators are checked separately for current orders.

After adding or removing a robot, changing a preset, or archiving history, keep the client open until **Fleet synced** appears.

### 13. Use private completed history

![Completed and collaboratively cancelled entries in Fleet history](assets/pro-guide/08-history-and-sync.png)

Select an entry for the saved summary.

![A completed trade summary retained in Fleet history](assets/pro-guide/08-history-detail.png)

History contains:

- Completed trades observed by the client.
- Collaborative cancellations observed by the client.
- Limited order and settlement fields needed for the summary.

History deliberately omits banking details, peer identity, and chat. It is an encrypted convenience record, not coordinator proof or a complete accounting ledger.

When settlement data is available:

- A buyer entry can retain the payout invoice supplied to receive sats.
- A seller entry can retain the escrow invoice paid to lock sats.

The client archives an entry when it observes the terminal coordinator state. Keep it open long enough to receive that update and then wait for **Fleet synced**. A much older trade that this client never saw complete cannot always be reconstructed.

### 14. Restore the Fleet on another device

1. Enable Pro Mode.
2. Select **Restore Fleet**.
3. Enter the exact Fleet key.
4. Leave the recovery panel open while relays are queried.
5. Verify the robot, preset, and history counts.
6. Continue to Pro Desk and let coordinator checks refresh live status.

![Fleet restore reporting four robots and three presets](assets/pro-guide/09-restore-fleet.png)

**You should now see:** the expected robots, presets, and history first; live order labels may continue updating as coordinators answer.

Recovery can take one or two minutes over Tor. A first attempt may be incomplete when a relay holding the newest record is temporarily unreachable. Keep the key, check the connection, and retry.

Do not erase the first device until the restored one shows the expected contents and **Fleet synced**.

### 15. Know what returns and what is rechecked

| Restored from encrypted Fleet records | Rechecked from coordinators |
| --- | --- |
| Robot entries and identity metadata | Live order and trade status |
| Offer presets | Current deadlines and next actions |
| Synchronized theme | Coordinator-side order records |
| Completed history | Current peer/trade lifecycle |

Private chat transcripts, peer banking details, and dispute results are not stored as Fleet backup.

### 16. Switch back to Standard Garage

Open **Settings** and turn off **Pro Mode**.

Standard Garage robots reappear as they were. Fleet robots remain separately stored and return when Pro Mode is enabled again. The two workspaces do not silently merge identities.

## Part 4: Technical and privacy model

### 17. The Fleet mental model

Think of a Fleet as a private keyring:

- The **Fleet key** opens the keyring and protects synchronized records.
- Each **robot** remains an independent RoboSats identity.
- The **Pro Desk** summarizes separate orders without merging identities.
- **Nostr relays** store encrypted Fleet records and carry hints.
- **Coordinator APIs** remain authoritative for actual trade state.

![Fleet key derivation, independent robots, encrypted Nostr records, and cross-device recovery](assets/pro-guide/fleet-identity.svg)

### 18. How synchronization uses Nostr

The client publishes encrypted NIP-78 kind `30078` records to coordinator relays:

- Record content is encrypted using NIP-44-derived conversation keys.
- Addresses are opaque values derived from Fleet secrets.
- Fleet robots, preferences, and completed history use separate signing domains.
- Relays store signed ciphertext and event metadata, not plaintext tokens, presets, or history.

Relays can still observe event size, timing, and the relay connection. Tor protects the network path; encryption protects record contents.

For key derivations, OpenPGP chat, operational Nostr identities, and observer boundaries, continue to [Robot identity, OpenPGP, and Nostr](identity-and-privacy.md).

## Troubleshooting

### A robot remains on Waiting for coordinators

No coordinator request has completed. Wait, refresh once, or inspect **Settings > Coordinators**. Do not remove the robot solely because a coordinator is temporarily offline.

### Fleet restore says no Fleet was found

Check for extra spaces in the key, confirm Tor connectivity, and retry. A retaining relay can be temporarily unreachable even when the key is valid.

### A robot is unavailable for a new order

Open its existing order from **Trades**. Public, paused, renewable, and active orders all occupy its one order slot.

### Fleet syncing does not finish

Keep the client open with Tor connected. Use Pro Desk refresh once and inspect coordinator availability. Do not create a replacement Fleet while the original key remains valid.

### History is missing a completed trade

Open or refresh the robot while its coordinator is reachable. History can be written only after this client observes the terminal state. Then wait for **Fleet synced**.

## Fleet safety checklist

- [ ] Fleet key stored in two private places.
- [ ] Important individual robot tokens also backed up.
- [ ] Busy and renewable robots not selected for a new order.
- [ ] Preset values reviewed before every publication.
- [ ] Cash F2F area reconsidered for every new offer.
- [ ] Fleet status returns to **Fleet synced** after important changes.
- [ ] Restored device verified before the old device is erased.

---

[Guide home](README.md) | Previous: [Standard Garage](standard-garage-guide.md) | Next: [Identity and privacy](identity-and-privacy.md)
