# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting feature under **Security > Advisories > Report a
vulnerability**.

Include the affected version, platform, impact, and minimal reproduction. Do
not include real robot tokens, private keys, invoices, chat messages, onion
service credentials, or active order data. Test only with identities and funds
you control.

The project will acknowledge a complete report, assess affected releases, and
coordinate a fix and disclosure. Alpha builds receive security fixes on the
current release line; old prereleases are not maintained after a replacement
is published.

## Accepted upstream advisory

The Android and iOS Arti lockfiles currently ignore
`RUSTSEC-2023-0071` in automated audits. Arti 2.5.0 depends on `rsa` 0.9.10,
and RustSec lists no fixed release. RoboSats Exp. uses that dependency as a Tor
client and does not use it to decrypt application data with a private RSA key.
The exception is limited to this advisory; all new RustSec vulnerabilities
still fail the audit. Remove the exception as soon as Arti provides a fixed
dependency graph.

Review this exception on every Arti update and no later than 2026-10-16.

## Release verification

GitHub releases include SHA-256 checksums. Public-repository builds also carry
GitHub artifact attestations.
