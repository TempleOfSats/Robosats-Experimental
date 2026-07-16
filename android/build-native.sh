#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$SCRIPT_DIR/tor-native/build-android.sh"
bash "$SCRIPT_DIR/robo-identities-native/build-android.sh"
