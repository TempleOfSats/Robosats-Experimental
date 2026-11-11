# ADR-0012: Mirror chat sends for upstream Nostr readers

Upstream enabled NIP-17 chat in commit `156a4b26`. That reader displays relay
messages, not the coordinator's PGP history. Our API/WebSocket-only sends
therefore remain invisible to these peers even when the coordinator stores them.
Upstream `c49fe077` separately fixes its API polling and fractional-offset bug.

For trades with both participants' Nostr public keys, send kind-14 gift wraps
to the peer and sender through the existing coordinator relay pool alongside
the legacy PGP send. Validate the sender key against the local robot identity.
Load the wrapping code on demand, keep plaintext out of persistence and logs,
bound relay acknowledgements, and report partial delivery without silently
retrying the coordinator POST. Image JSON uses the same kind-14 format which
upstream also accepts. Pre-chat and legacy robots retain their existing path.

Receiving remains API/WebSocket-based: current upstream mirrors text and image
messages there. This does not add relay-only receive/history recovery or recover
messages older upstream clients failed to submit. API offsets remain coordinator
message indexes, never Nostr timestamps.
