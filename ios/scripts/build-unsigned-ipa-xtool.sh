#!/usr/bin/env bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$(cd "$IOS_ROOT/.." && pwd)"
BUILD_ROOT="$IOS_ROOT/build"
OUTPUT_IPA="$BUILD_ROOT/RoboSatsExp-unsigned.ipa"
XTOOL_BIN="${XTOOL:-}"

if [[ -z "$XTOOL_BIN" ]]; then
  if command -v xtool >/dev/null 2>&1; then
    XTOOL_BIN="$(command -v xtool)"
  elif [[ -x "$HOME/.local/bin/xtool" ]]; then
    XTOOL_BIN="$HOME/.local/bin/xtool"
  else
    echo "xtool is not installed or available through XTOOL." >&2
    exit 2
  fi
fi

for command in file swift rustup npm unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required build tool: $command" >&2
    exit 2
  fi
done

if ! swift sdk list 2>/dev/null | grep -qx 'darwin'; then
  echo "The xtool Darwin SDK is not installed. Run '$XTOOL_BIN sdk install /path/to/Xcode.xip' first." >&2
  exit 2
fi

cd "$APP_ROOT"
node "$IOS_ROOT/scripts/check-build-config.mjs"
npm run build:ios:web
"$IOS_ROOT/scripts/build-rust-xtool.sh"

cd "$IOS_ROOT"
rm -rf xtool "$OUTPUT_IPA"
"$XTOOL_BIN" dev build --configuration release --ipa

SOURCE_IPA="$(find "$IOS_ROOT/xtool" -maxdepth 2 -type f -name '*.ipa' -print -quit)"
if [[ -z "$SOURCE_IPA" ]]; then
  echo "xtool completed without producing an IPA." >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT"
cp "$SOURCE_IPA" "$OUTPUT_IPA"

CONTENTS_FILE="$BUILD_ROOT/RoboSatsExp-unsigned.contents"
unzip -Z1 "$OUTPUT_IPA" >"$CONTENTS_FILE"
if ! grep -q '^Payload/RoboSatsExp.app/' "$CONTENTS_FILE"; then
    echo "The generated archive does not contain Payload/RoboSatsExp.app." >&2
    exit 1
fi
if grep -Eq '/_CodeSignature/|/embedded\.mobileprovision$' "$CONTENTS_FILE"; then
    echo "The generated IPA unexpectedly contains signing material." >&2
    exit 1
fi

EXECUTABLE_FILE="$BUILD_ROOT/RoboSatsExp.arm64"
unzip -p "$OUTPUT_IPA" Payload/RoboSatsExp.app/RoboSatsExp >"$EXECUTABLE_FILE"
if ! file "$EXECUTABLE_FILE" | grep -q 'Mach-O 64-bit arm64 executable'; then
    echo "The generated application executable is not an ARM64 Mach-O binary." >&2
    exit 1
fi
rm -f "$EXECUTABLE_FILE"
rm -f "$CONTENTS_FILE"

echo "Unsigned IPA: $OUTPUT_IPA"
