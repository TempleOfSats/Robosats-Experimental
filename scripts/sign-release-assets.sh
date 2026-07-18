#!/usr/bin/env bash
set -euo pipefail

assets_directory="${1:?Release assets directory is required}"
: "${RELEASE_GPG_PRIVATE_KEY:?RELEASE_GPG_PRIVATE_KEY is required}"
: "${RELEASE_GPG_PASSPHRASE:?RELEASE_GPG_PASSPHRASE is required}"

if [[ ! -d "$assets_directory" ]]; then
  echo "Release assets directory does not exist: $assets_directory" >&2
  exit 1
fi

assets_directory="$(cd "$assets_directory" && pwd)"
gnupg_home="$(mktemp -d)"
trap 'rm -rf "$gnupg_home"' EXIT
export GNUPGHOME="$gnupg_home"
chmod 700 "$GNUPGHOME"

printf '%s\n' "$RELEASE_GPG_PRIVATE_KEY" | gpg --batch --quiet --import

mapfile -t fingerprints < <(
  gpg --batch --with-colons --list-secret-keys |
    awk -F: '$1 == "sec" { primary = 1; next } primary && $1 == "fpr" { print $10; primary = 0 }'
)
if (( ${#fingerprints[@]} != 1 )); then
  echo "The release key secret must contain exactly one primary secret key." >&2
  exit 1
fi

fingerprint="${fingerprints[0]}"
public_key="robosats-exp-release-key.asc"
rm -f "$assets_directory"/*.asc "$assets_directory/SHA256SUMS"
gpg --batch --armor --export "$fingerprint" > "$assets_directory/$public_key"

mapfile -d '' -t assets < <(
  find "$assets_directory" -maxdepth 1 -type f \
    ! -name "$public_key" \
    ! -name 'SHA256SUMS' \
    ! -name '*.asc' \
    -printf '%f\0' |
    sort -z
)
if (( ${#assets[@]} == 0 )); then
  echo "No release assets were found in $assets_directory." >&2
  exit 1
fi

(
  cd "$assets_directory"
  sha256sum -- "${assets[@]}" "$public_key" > SHA256SUMS
)

assets+=("SHA256SUMS")
for asset in "${assets[@]}"; do
  printf '%s' "$RELEASE_GPG_PASSPHRASE" |
    gpg \
      --batch \
      --yes \
      --pinentry-mode loopback \
      --passphrase-fd 0 \
      --local-user "$fingerprint" \
      --armor \
      --output "$assets_directory/$asset.asc" \
      --detach-sign "$assets_directory/$asset"
  gpg --batch --verify "$assets_directory/$asset.asc" "$assets_directory/$asset"
done

printf 'Signed release assets with %s\n' "$fingerprint"
