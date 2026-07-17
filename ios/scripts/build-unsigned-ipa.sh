#!/usr/bin/env bash
set -euo pipefail

IOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$(cd "$IOS_ROOT/.." && pwd)"
BUILD_ROOT="$IOS_ROOT/build"
DERIVED_DATA="$BUILD_ROOT/DerivedData"
APP_PATH="$DERIVED_DATA/Build/Products/Release-iphoneos/RoboSatsExp.app"
MARKETING_VERSION="${ROBOSATS_IOS_VERSION:-$(node "$APP_ROOT/scripts/release-metadata.mjs" --value ios_version)}"
BUILD_NUMBER="${ROBOSATS_BUILD_NUMBER:-$(node "$APP_ROOT/scripts/release-metadata.mjs" --value build_number)}"

for command in xcodebuild xcodegen xcrun rustup; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required macOS build tool: $command" >&2
    exit 2
  fi
done

cd "$APP_ROOT"
node "$IOS_ROOT/scripts/check-build-config.mjs"
npm run build:ios:web
"$IOS_ROOT/scripts/build-rust.sh"

cd "$IOS_ROOT"
xcodegen generate --spec project.yml
rm -rf "$BUILD_ROOT/Payload" "$DERIVED_DATA" "$BUILD_ROOT/RoboSatsExp-unsigned.ipa"

xcodebuild \
  -project RoboSatsExp.xcodeproj \
  -scheme RoboSatsExp \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  MARKETING_VERSION="$MARKETING_VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  build

test -d "$APP_PATH"
mkdir -p "$BUILD_ROOT/Payload"
cp -R "$APP_PATH" "$BUILD_ROOT/Payload/"
cd "$BUILD_ROOT"
/usr/bin/zip -qry RoboSatsExp-unsigned.ipa Payload
"$IOS_ROOT/scripts/verify-unsigned-ipa.sh" "$BUILD_ROOT/RoboSatsExp-unsigned.ipa"
echo "Unsigned IPA: $BUILD_ROOT/RoboSatsExp-unsigned.ipa"
