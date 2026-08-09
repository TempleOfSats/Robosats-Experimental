# RoboSats Exp. user guide

Welcome. RoboSats Exp. lets you trade bitcoin through independent coordinators while using robot identities instead of accounts.

You do not need to understand the cryptography before your first trade. Start with the path that describes you, follow the checks on each screen, and return to the technical chapters when you want to understand what the client is protecting.

> **Alpha software:** start with an amount you are comfortable testing. Back up every secret the client asks you to keep, and verify amounts in your wallet or fiat account before confirming an action.

## Choose your path

| You are here because... | Start here |
| --- | --- |
| This is your first RoboSats trade | [First trade quick start](first-trade-quick-start.md) |
| You already used the classic RoboSats frontend | [Coming from the classic frontend](classic-frontend-transition.md) |
| You want one focused robot and one order at a time | [Standard Garage guide](standard-garage-guide.md) |
| You want several robots, reusable offers, and cross-device recovery | [Pro Mode and Robot Fleet guide](pro-mode-guide.md) |
| You prefer a screenshot-led walkthrough | [Beep & Bop visual guide](tutorial/index.html) |

The **Standard Garage** is the simplest workspace. **Pro Mode** is an organizational layer for experienced or frequent traders. The underlying coordinator protocol is the same in both.

## The complete guide

| Chapter | What it helps you do |
| --- | --- |
| [First trade quick start](first-trade-quick-start.md) | Reach a first trade safely without reading every advanced option |
| [Coming from the classic frontend](classic-frontend-transition.md) | Find familiar concepts and understand what moved or changed |
| [Standard Garage](standard-garage-guide.md) | Create or recover one robot and complete buyer or seller flows |
| [Pro Mode and Robot Fleet](pro-mode-guide.md) | Manage independent robots, presets, live orders, history, and Fleet recovery |
| [Beep & Bop visual guide](tutorial/index.html) | Follow Standard and Pro Mode through current, annotated app screens |
| [Robot identity, PGP, and Nostr](identity-and-privacy.md) | Understand robot tokens, encrypted chat, Nostr keys, and Fleet privacy |
| [Cash F2F map](f2f-map-guide.md) | Publish or find a face-to-face cash offer without exposing an exact venue |
| [Market statistics](market-statistics-guide.md) | Read live liquidity, completed volume, premiums, and public market activity |
| [Notifications](notifications-guide.md) | Enable Telegram or native alerts and understand their privacy tradeoffs |

## A trade in five stages

1. **Choose:** decide whether to buy or sell bitcoin, then check the amount, payment method, premium, coordinator, and bond.
2. **Publish or take:** publish your own terms as a maker, or accept an existing offer as a taker.
3. **Set up:** both traders lock a Lightning bond. The buyer supplies a payout invoice and the seller locks the trade amount in escrow.
4. **Exchange:** use encrypted chat, send fiat, verify its receipt, and release escrow.
5. **Finish:** receive the Lightning payout, download the overview if useful, and decide whether to reuse the robot.

## Five terms worth knowing

| Term | Plain-language meaning |
| --- | --- |
| **Robot** | A private trading identity represented by a nickname and avatar |
| **Robot token** | The secret that recovers one robot; there is no password reset |
| **Maker / taker** | The maker publishes an offer; the taker accepts it |
| **Bond / escrow** | A bond discourages abandonment; seller escrow holds the bitcoin being traded |
| **Coordinator** | An independent RoboSats server that hosts and enforces an order |

**Buy BTC** means you send fiat and receive bitcoin. **Sell BTC** means you lock bitcoin and receive fiat.

## Recognize the backups

| Backup | Restores | Used in |
| --- | --- | --- |
| Robot token | One robot, its keys, and access to that robot's coordinator orders | Standard Garage and Pro Mode |
| Fleet key | Synchronized Fleet robots, presets, preferences, and completed Fleet history | Pro Mode |
| Trade overview | A human-readable record downloaded from a completed trade | Either mode |

A Fleet key does not make individual robot-token backups useless. An individual token remains the direct recovery path for that robot in another compatible RoboSats frontend.

## Safety rules worth keeping nearby

- Never share a robot token, Fleet key, private `nsec`, or Lightning invoice meant for your own payout.
- Say the direction out loud before continuing: **buy bitcoin** or **sell bitcoin**.
- Check every Lightning amount in both the client and your wallet.
- Keep exact payment details and F2F meeting details inside encrypted trade chat.
- Do not treat screenshots or messages as proof that fiat arrived. Check the receiving account.
- Select **Confirm fiat sent** only after the payment was actually submitted.
- Release escrow only after the fiat funds are final and usable.
- If a coordinator is temporarily offline, keep the robot token and retry. Do not delete the identity to solve a connection delay.

## When should I keep the client open?

| Stage | Practical guidance |
| --- | --- |
| Creating a robot or Fleet | Back up the token or Fleet key before leaving |
| Paying a bond or escrow invoice | Stay nearby while the coordinator detects it; never pay twice |
| Waiting on a public offer | You may leave after the robot is backed up, but return before deadlines |
| Active fiat exchange | Stay available in encrypted chat until the trade is resolved |
| Completed trade | It is safe to leave after any overview you want has been downloaded |
| Fleet changed | Keep Pro Mode open until **Fleet synced** appears |

## A note about Tor

The web client is intended for Tor Browser. Installed apps use an embedded Tor transport for coordinator traffic. Tor protects network privacy, but a healthy request can still take noticeably longer than on the direct internet.

The client keeps useful cached state visible while refreshing in the background. **Checking coordinators**, **Fleet syncing**, or partial statistics coverage is not automatically an error. For a payment or state-changing action, wait for visible confirmation before trying again or closing the client.

## More RoboSats documentation

- [RoboSats Quick Start](https://robosats.org/docs/quick-start/)
- [RoboSats robot identities](https://robosats.org/docs/robots/)
- [RoboSats trade pipeline](https://robosats.org/docs/trade-pipeline/)
- [RoboSats fidelity bonds](https://robosats.org/docs/bonds/)
