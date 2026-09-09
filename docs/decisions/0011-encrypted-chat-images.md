# Encrypted chat images through coordinator Blossom

Status: proposed; implementation requires separate maintainer review.

## Decision

Use upstream RoboSats' `/blossom/upload` and `/blossom/<ciphertext-sha256>`
endpoints with kind-24242 Nostr upload authorization and XChaCha20-Poly1305.
Send the upstream `type: image` JSON envelope inside the existing signed PGP
coordinator chat. This client does not add a parallel NIP-59 chat transport.

Chat owns encryption and attachment UI; transport owns scheduling and binary
HTTP. Android and iOS extend their existing Tor bridge with an optional
`httpBinaryRequest` operation: bodies in both directions are base64 across
the bridge only. Existing JSON requests remain unchanged. Desktop continues
to use the Tor-proxied system webview's fetch, like its other HTTP requests.

## Constraints

- Explicit send and load actions; no automatic image downloads or retries.
- JPEG, PNG, WebP and GIF only, at most 10 MiB plus the authentication tag.
- Ignore the peer-supplied host for retrieval. Resolve the verified hash at
  the current trade coordinator, including when using a different gateway.
  Do not follow redirects to another destination.
- Verify ciphertext hash, authenticated encryption and optional original
  hash before displaying. Keep decryption metadata inside encrypted chat;
  do not persist plaintext images. Revoke display URLs when no longer used.
- Loading failures stay within the attachment; sending failures preserve
  an uploaded envelope for an explicit retry without uploading again.
- Large transfers use the existing request queue at foreground priority,
  below trade actions, with the action timeout and lifecycle cancellation.
  iOS retains its existing connection-pool cancellation on transport shutdown;
  per-request JS cancellation suppresses stale results but cannot yet interrupt
  an individual Swift HTTP read.

## Trade-offs

Direct webview fetch would bypass the Android/iOS Tor transport, and text
decoding would corrupt encrypted bytes. A binary bridge is therefore needed.
Adding another relay client is unnecessary for coordinator-chat compatibility.
Coordinators without Blossom remain text-only; upload failures explain this
without affecting chat. This intentionally does not implement arbitrary
third-party Blossom servers, SVGs, videos, or NIP-17-only messaging.

Image preparation is lazy and local, before encryption. Strip location and
descriptive metadata while preserving color profiles and orientation. Large
JPEGs use browser encoding at quality 0.9 with a 2560-pixel long-edge ceiling;
use the result only when at least 5% smaller than the cleaned original.
PNG screenshots, WebP and GIF retain their pixel data and animation. Reject
images exceeding 24 megapixels or a 16384-pixel edge before decoding.
The preview and upload share the same prepared file; the original filename
is not sent. Browser encoder restrictions fall back to the metadata-cleaned
original, never the untouched input. This reduces Tor transfer without
adding a codec dependency or processing work to ordinary text chat.
