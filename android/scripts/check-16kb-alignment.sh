#!/usr/bin/env bash
set -euo pipefail

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$ANDROID_SDK_ROOT/ndk/27.0.12077973}"
ZIPALIGN="${ZIPALIGN:-$ANDROID_SDK_ROOT/build-tools/36.0.0/zipalign}"
READELF="${READELF:-$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf}"

if (($# == 0)); then
  set -- app/build/outputs/apk/debug/*.apk
fi

for tool in "$ZIPALIGN" "$READELF"; do
  if [[ ! -x "$tool" ]]; then
    echo "Required Android tool is missing: $tool" >&2
    exit 1
  fi
done

failed=0
checked=0

for apk in "$@"; do
  if [[ ! -f "$apk" ]]; then
    echo "APK not found: $apk" >&2
    failed=1
    continue
  fi

  checked=$((checked + 1))
  echo "Checking ZIP alignment: $apk"
  if ! "$ZIPALIGN" -c -P 16 4 "$apk"; then
    failed=1
    continue
  fi

  extract_dir="$(mktemp -d)"
  unzip -qq "$apk" 'lib/*/*.so' -d "$extract_dir"

  while IFS= read -r -d '' library; do
    relative="${library#"$extract_dir"/}"
    minimum_alignment=0x7fffffffffffffff
    load_count=0

    while read -r alignment; do
      [[ -z "$alignment" ]] && continue
      load_count=$((load_count + 1))
      value=$((alignment))
      if ((value < minimum_alignment)); then
        minimum_alignment=$value
      fi
    done < <("$READELF" -lW "$library" | awk '$1 == "LOAD" { print $NF }')

    if ((load_count == 0)); then
      echo "FAIL $relative has no ELF LOAD segments" >&2
      failed=1
    elif ((minimum_alignment < 0x4000)); then
      printf 'FAIL %s has minimum LOAD alignment 0x%x\n' "$relative" "$minimum_alignment" >&2
      failed=1
    else
      printf 'PASS %s has minimum LOAD alignment 0x%x\n' "$relative" "$minimum_alignment"
    fi
  done < <(find "$extract_dir/lib" -type f -name '*.so' -print0 | sort -z)

  rm -rf "$extract_dir"
done

if ((checked == 0 || failed != 0)); then
  echo "Android 16 KB alignment check failed." >&2
  exit 1
fi

echo "Android 16 KB ZIP and ELF alignment checks passed for $checked APK(s)."
