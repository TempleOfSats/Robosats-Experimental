#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-/opt/android-sdk/ndk/27.0.12077973}"

if ! command -v cargo-ndk >/dev/null 2>&1; then
  echo "cargo-ndk is required: cargo install cargo-ndk" >&2
  exit 1
fi

mkdir -p "$ANDROID_DIR/app/src/main/jniLibs"
find "$ANDROID_DIR/app/src/main/jniLibs" -name 'libarti_android.so' -delete

cd "$SCRIPT_DIR"
cargo ndk \
  --platform 26 \
  -t arm64-v8a \
  -t x86_64 \
  -o "$ANDROID_DIR/app/src/main/jniLibs" \
  build --release --locked

find "$ANDROID_DIR/app/src/main/jniLibs" -name 'libarti_android.so' -print
