#!/usr/bin/env bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="aarch64-apple-ios"
DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-16.0}"
TOOLS_ROOT="$IOS_ROOT/build/xtool-tools"

for command in swift rustup cargo clang; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required build tool: $command" >&2
    exit 2
  fi
done

if ! swift sdk list 2>/dev/null | grep -qx 'darwin'; then
  echo "The xtool Darwin SDK is not installed. Run 'xtool sdk install /path/to/Xcode.xip' first." >&2
  exit 2
fi

SDK_CONFIGURATION="$(swift sdk configure darwin "$TARGET" --show-configuration)"
SDK_ROOT="$(awk -F': ' '/^sdkRootPath: / { print $2; exit }' <<<"$SDK_CONFIGURATION")"
SWIFT_RESOURCES="$(awk -F': ' '/^swiftResourcesPath: / { print $2; exit }' <<<"$SDK_CONFIGURATION")"

if [[ -z "$SDK_ROOT" || -z "$SWIFT_RESOURCES" || ! -d "$SDK_ROOT" ]]; then
  echo "Could not resolve the iPhoneOS SDK from the installed Darwin Swift SDK." >&2
  exit 2
fi

SDK_BUNDLE="$SWIFT_RESOURCES"
for _ in {1..6}; do
  SDK_BUNDLE="$(dirname "$SDK_BUNDLE")"
done

LD64="$SDK_BUNDLE/toolset/bin/ld64.lld"
if [[ ! -x "$LD64" ]]; then
  echo "Darwin linker not found at $LD64" >&2
  exit 2
fi

mkdir -p "$TOOLS_ROOT"
LINKER="$TOOLS_ROOT/ios-clang"
printf '#!/usr/bin/env bash\nexec %q --target=arm64-apple-ios%s -isysroot %q -fuse-ld=%q "$@"\n' \
  "$(command -v clang)" "$DEPLOYMENT_TARGET" "$SDK_ROOT" "$LD64" >"$LINKER"
chmod +x "$LINKER"

AR_TOOL="$(command -v llvm-ar || true)"
RANLIB_TOOL="$(command -v llvm-ranlib || true)"
if [[ -z "$AR_TOOL" || -z "$RANLIB_TOOL" ]]; then
  echo "llvm-ar and llvm-ranlib are required to build the Arti archive." >&2
  exit 2
fi

rustup target add "$TARGET"

export SDKROOT="$SDK_ROOT"
export IPHONEOS_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET"
export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER="$LINKER"
export CC_aarch64_apple_ios="$LINKER"
export AR_aarch64_apple_ios="$AR_TOOL"
export RANLIB_aarch64_apple_ios="$RANLIB_TOOL"

cargo build \
  --manifest-path "$IOS_ROOT/tor-native/Cargo.toml" \
  --target "$TARGET" \
  --release

ARCHIVE="$IOS_ROOT/tor-native/target/$TARGET/release/libarti_mobile.a"
test -f "$ARCHIVE"
echo "Arti archive: $ARCHIVE"
