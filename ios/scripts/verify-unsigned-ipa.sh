#!/usr/bin/env bash
set -euo pipefail

IPA_PATH="${1:-}"
if [[ -z "$IPA_PATH" || ! -f "$IPA_PATH" ]]; then
  echo "Usage: $0 /path/to/RoboSatsExp-unsigned.ipa" >&2
  exit 2
fi

for command in file unzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required IPA verification tool: $command" >&2
    exit 2
  fi
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/robosats-ipa.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

unzip -qq "$IPA_PATH" -d "$WORK_DIR"
APP_PATH="$WORK_DIR/Payload/RoboSatsExp.app"
EXECUTABLE="$APP_PATH/RoboSatsExp"

if [[ ! -d "$APP_PATH" ]]; then
  echo "The IPA does not contain Payload/RoboSatsExp.app." >&2
  exit 1
fi
EXECUTABLE_DESCRIPTION="$(file "$EXECUTABLE" 2>/dev/null || true)"
if [[ ! -f "$EXECUTABLE" ||
      "$EXECUTABLE_DESCRIPTION" != *"Mach-O 64-bit"* ||
      "$EXECUTABLE_DESCRIPTION" != *"arm64"* ||
      "$EXECUTABLE_DESCRIPTION" != *"executable"* ]]; then
  echo "The application executable is not an ARM64 Mach-O binary." >&2
  exit 1
fi
if find "$APP_PATH" \( -type d -name '_CodeSignature' -o -type f -name 'embedded.mobileprovision' \) | awk 'NR == 1 { found = 1 } END { exit !found }'; then
  echo "The IPA unexpectedly contains signing material." >&2
  exit 1
fi

WEB_ROOT=""
for candidate in \
  "$APP_PATH/WebApp" \
  "$APP_PATH/RoboSatsExp_RoboSatsExp.bundle/WebApp"; do
  if [[ -f "$candidate/index.html" ]]; then
    WEB_ROOT="$candidate"
    break
  fi
done

if [[ -z "$WEB_ROOT" ]]; then
  echo "The IPA does not contain the bundled frontend at WebApp/index.html." >&2
  exit 1
fi

for extension in js css wasm; do
  if ! find "$WEB_ROOT" -type f -name "*.$extension" | awk 'NR == 1 { found = 1 } END { exit !found }'; then
    echo "The bundled frontend does not contain a .$extension asset." >&2
    exit 1
  fi
done

WEB_FILE_COUNT="$(find "$WEB_ROOT" -type f | wc -l | tr -d ' ')"
WEB_SIZE_KB="$(du -sk "$WEB_ROOT" | awk '{ print $1 }')"
if (( WEB_FILE_COUNT < 50 || WEB_SIZE_KB < 1024 )); then
  echo "The bundled frontend is incomplete (${WEB_FILE_COUNT} files, ${WEB_SIZE_KB} KiB)." >&2
  exit 1
fi

if [[ ! -f "$APP_PATH/RoboSatsMark.png" &&
      ! -f "$APP_PATH/RoboSatsExp_RoboSatsExp.bundle/RoboSatsMark.png" ]]; then
  echo "The IPA does not contain RoboSatsMark.png." >&2
  exit 1
fi

echo "Verified unsigned IPA: ${WEB_FILE_COUNT} web files, ${WEB_SIZE_KB} KiB"
