# Robot identity, OpenPGP, and Nostr

[Guide home](README.md) | [First trade](first-trade-quick-start.md) | [Standard Garage](standard-garage-guide.md) | [Pro Mode](pro-mode-guide.md) | **Identity and privacy**

A RoboSats robot looks friendly, but under the avatar it is a small cryptographic identity. The client uses that identity to return to coordinator orders, protect peer chat, receive private order-change hints, and keep separate robots separate.

You do not need to export or operate these keys manually. If you only remember three things, remember these:

1. **The robot token recovers one robot.**
2. **OpenPGP protects its peer chat.**
3. **Nostr carries signed events, private hints, public offers, and encrypted Fleet records.**

> **Keep the robot token secret and backed up.** It is the root credential for that robot.

The rest of this chapter explains how those layers fit together.

## The identity at a glance

When you create or recover a robot, the client works from one high-entropy token:

```text
Private robot token
        |
        +-- coordinator credential and stable robot ID
        |
        +-- deterministic Nostr secret/public key
        |
        +-- passphrase that unlocks this robot's OpenPGP private key
        |
        +-- nickname and avatar derived from the stable robot ID
```

These values serve different protocols. They are not interchangeable passwords, and exporting one key does not replace the robot-token backup.

## What the robot token does

The token is generated on your device. It is never meant to be memorable or shared.

From it, the client derives:

- A stable robot ID based on a double SHA-256 hash.
- The coordinator login credential based on SHA-256 and Base91 encoding.
- A deterministic Nostr secret key and public key.
- The passphrase used to decrypt the robot's OpenPGP private key.
- The same nickname and avatar on recovery.

Because the process is deterministic, entering the same token reproduces the same Nostr identity and coordinator credential.

The OpenPGP keypair is generated separately when needed. Its private half is encrypted with the robot token, and compatible coordinator state can return that encrypted key material during recovery.

## OpenPGP: private trade communication

Each robot has its own OpenPGP keypair:

- The **public key** can be shared so the peer can encrypt a message for this robot.
- The **private key** opens messages addressed to this robot and signs protocol values where required.
- The stored private key is encrypted with the robot token.

RoboSats Exp. generates a version 4 ECC OpenPGP key using the Curve25519-compatible profile expected by current coordinators. The key's user ID contains the stable, double-hashed robot ID rather than a personal name or email address.

### How chat encryption works

1. The two robots exchange their OpenPGP public keys through the coordinator chat channel.
2. A message is encrypted for the peer's public key.
3. The encrypted message is transported by the coordinator.
4. The receiving client uses its token to unlock its OpenPGP private key.
5. Decryption happens in the client.

The coordinator handles delivery, but does not need the plaintext message.

OpenPGP is also used to sign selected values, such as invoices in protocol actions that require proof from the robot identity.

### Why every robot has a different PGP identity

A message encrypted for Robot A cannot be opened with Robot B's private key. This is a useful isolation boundary, and it is one reason not to mix up tokens or manually move key files between robots.

## Nostr: signed events, private hints, and relay transport

Each robot token also deterministically derives a secp256k1 Nostr keypair:

- The public form can be exported as an `npub`.
- The private form can be exported as an `nsec`.
- The coordinator receives the robot's public key as part of authenticated requests.

RoboSats Exp. uses this identity for functions that benefit from signed or encrypted Nostr events, including:

- Receiving NIP-44-encrypted order-change hints addressed to the robot.
- Signing coordinator-rating events after a completed trade.
- Participating in Nostr-backed client features supported by the coordinator.

The order-change hint is intentionally only a prompt to refresh. It does not replace the coordinator API response as the authoritative trade state.

The public orderbook also travels over coordinator Nostr relays when **Settings > Public offers > Nostr** is selected. Those public order events are coordinator-published orderbook data; they are separate from the robot's private identity.

## OpenPGP and Nostr have different jobs

| Question | OpenPGP | Nostr |
| --- | --- | --- |
| Main purpose here | Encrypt peer chat and sign selected coordinator protocol values | Sign events and receive encrypted relay hints |
| Per robot? | Yes | Yes |
| Public key shareable? | Yes | Yes, as `npub` |
| Private key sensitive? | Yes, stored encrypted with the token | Yes, exportable as `nsec` |
| Recreated directly from token? | The token unlocks/recoverably associates the generated keypair | Yes, deterministically |
| Replaces the robot token? | No | No |

The safest backup remains the robot token. Export raw keys only for a specific interoperability or diagnostic need.

## Inspect your robot's keys

Open the robot settings and select **PGP / NOSTR keys**.

### Nostr tab

The tab shows:

- The robot's public `npub`.
- The sensitive private `nsec`.
- A JSON export option.

Do not publish or paste the `nsec`. Anyone holding it can sign as that Nostr identity and decrypt events addressed to it.

### OpenPGP tab

The tab shows:

- The armored public key.
- The armored encrypted private key.
- The robot token as the private-key passphrase.
- A JSON export option.

The encrypted private key is safer than an unencrypted private key, but it should still be treated as sensitive backup material. Do not publish it alongside the token.

## Fleet identity is an additional layer

A Robot Fleet has its own key and its own Nostr-derived synchronization domains. Those Fleet signing identities are separate from every robot's operational Nostr identity.

![Diagram showing the Fleet key, independent robot identities, encrypted records, and recovery](assets/pro-guide/fleet-identity.svg)

The Fleet key protects three independently addressed record families:

- Robot Fleet entries.
- Preferences and offer presets.
- Completed-trade history.

The client encrypts the record content with NIP-44-derived conversation keys and publishes NIP-78 kind `30078` events. Coordinator relays receive signed ciphertext and event metadata.

This separation matters: observing one Fleet record address does not reveal the plaintext robot tokens, preset terms, or history contents, and the operational Nostr key of one robot is not reused as the Fleet history signer.

## What different parties can still observe

Encryption reduces disclosure, but it does not make all activity invisible.

| Party | Can generally observe | Does not receive from the encrypted record |
| --- | --- | --- |
| Coordinator handling a trade | Its own order state, robot credential, timing, and protocol messages it must route | Fleet key or other coordinators' private Fleet plaintext |
| Nostr relay | Event kind, size, timing, signing public key, tags, and ciphertext | Decrypted Fleet contents or robot token |
| Peer | The robot identity and messages involved in that trade | Other Fleet robots or Fleet key |
| Someone with the robot token | That robot's derived identity and recoverable coordinator access | Other independent robots, unless they also possess the Fleet key or tokens |
| Someone with the Fleet key | Synchronized Fleet records and derived robot entries | Coordinator records that were never synchronized as Fleet data |

Tor protects where network connections originate. Encryption protects content. Separate robots reduce cross-trade identity reuse. All three boundaries matter.

## Recovery scenarios

### I have the robot token

Recover the robot in the Standard Garage or as an individual compatible robot. The client recreates its derived identity and asks coordinators for its orders and encrypted key material.

### I have the Fleet key

Restore Pro Mode. The client fetches encrypted Fleet records, rebuilds the synchronized robots, presets, and history, then checks coordinators for live status.

### I have an offline Robot Fleet backup

Open **Advanced recovery** and choose **Choose Fleet backup**. The saved robot manifest restores without relays; live
status and other Fleet data reconnect afterward. Refresh the backup after changing the Fleet.

### I exported PGP or Nostr keys but lost the robot token

The exported keys do not fully replace the coordinator credential and complete robot recovery flow. Preserve the robot token.

### I lost every copy of the secret

There is no account administrator or password-reset email. The identity cannot be reliably recovered.

## Practical privacy habits

- Create a new robot when convenient instead of reusing one indefinitely.
- Keep Standard Garage robots and Fleet robots in their intended workspaces.
- Never include tokens, Fleet keys, `nsec` values, or private-key passphrases in screenshots.
- Share exact Cash F2F meeting details only after encrypted trade chat opens.
- Treat Telegram enrollment as a privacy tradeoff, not merely a notification switch.
- Keep Tor Browser or the installed app's Tor transport active.
- Wait for **Fleet synced** after important Pro Mode changes.

## Technical derivation summary

For readers auditing interoperability, the current client uses these high-level derivations:

```text
stable robot ID       = SHA256(SHA256(robot token))
coordinator credential = Base91(SHA256(robot token))
Nostr secret key       = SHA256(SHA512(UTF-8 robot token))
Nostr public key       = secp256k1 public key from that secret
OpenPGP key user ID    = stable robot ID
OpenPGP private key    = generated ECC key encrypted with robot token
```

Do not use this summary to invent short or human-readable tokens. The security of every derived value depends on the token having enough entropy.

---

[Guide home](README.md) | Previous: [Pro Mode](pro-mode-guide.md) | Next: [Cash F2F map](f2f-map-guide.md)
