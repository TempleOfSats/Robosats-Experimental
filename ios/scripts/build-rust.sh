#!/usr/bin/env bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="aarch64-apple-ios"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "The Apple SDK is unavailable. Build the iOS Arti library on macOS with Xcode installed." >&2
  exit 2
fi

rustup target add "$TARGET"
cargo build \
  --manifest-path "$IOS_ROOT/tor-native/Cargo.toml" \
  --target "$TARGET" \
  --release
