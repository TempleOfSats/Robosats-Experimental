#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT

export GNUPGHOME="$workspace/source-keyring"
mkdir -m 700 "$GNUPGHOME"
passphrase="release-signing-test"
gpg \
  --batch \
  --pinentry-mode loopback \
  --passphrase "$passphrase" \
  --quick-generate-key \
  "RoboSats Release Test <release-test@localhost>" \
  ed25519 \
  sign \
  1d
private_key="$(
  gpg \
    --batch \
    --pinentry-mode loopback \
    --passphrase "$passphrase" \
    --armor \
    --export-secret-keys
)"

mkdir "$workspace/assets"
printf 'appimage\n' > "$workspace/assets/robosats.AppImage"
printf 'apk\n' > "$workspace/assets/robosats.apk"

unset GNUPGHOME
RELEASE_GPG_PRIVATE_KEY="$private_key" \
RELEASE_GPG_PASSPHRASE="$passphrase" \
  "$root/scripts/sign-release-assets.sh" "$workspace/assets"

test -s "$workspace/assets/robosats.AppImage.asc"
test -s "$workspace/assets/robosats.apk.asc"
test -s "$workspace/assets/SHA256SUMS.asc"
test -s "$workspace/assets/robosats-exp-release-key.asc"

export GNUPGHOME="$workspace/verify-keyring"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --import "$workspace/assets/robosats-exp-release-key.asc"
gpg --batch --verify \
  "$workspace/assets/robosats.AppImage.asc" \
  "$workspace/assets/robosats.AppImage"
(
  cd "$workspace/assets"
  sha256sum --check SHA256SUMS
)

printf 'tampered\n' >> "$workspace/assets/robosats.AppImage"
if gpg --batch --verify \
  "$workspace/assets/robosats.AppImage.asc" \
  "$workspace/assets/robosats.AppImage" 2>/dev/null; then
  echo "A modified release asset passed signature verification." >&2
  exit 1
fi
