#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-android.sh  —  Build Cafezin for Android (APK + AAB)
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/build-android.sh            # build APK + AAB (release)
#   ./scripts/build-android.sh --apk      # APK only
#   ./scripts/build-android.sh --open     # open output folder in Finder
#
# Prerequisites (one-time setup):
#   1. Android Studio or SDK command-line tools
#      https://developer.android.com/studio
#
#   2. Set env vars (add to .env.local or shell profile):
#      ANDROID_HOME=/path/to/android/sdk   # e.g. ~/Library/Android/sdk
#      NDK_HOME=$ANDROID_HOME/ndk/<version>
#
#   3. Install Rust Android targets:
#      rustup target add aarch64-linux-android armv7-linux-androideabi \
#                        i686-linux-android x86_64-linux-android
#
#   4. Install cargo-ndk:
#      cargo install cargo-ndk
#
#   5. Initialize the Android project (first time only):
#      cd app && npx tauri android init
#
# For signing a release build (required for Google Play):
#   Add to .env.local:
#     ANDROID_KEYSTORE_PATH=/path/to/upload-key.jks
#     ANDROID_KEY_ALIAS=upload
#     ANDROID_STORE_PASSWORD=xxxx
#     ANDROID_KEY_PASSWORD=xxxx
#
# CI: handled by .github/workflows/release.yml
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT/app"
OPEN_AFTER=false

for arg in "$@"; do
  [[ "$arg" == "--open" ]] && OPEN_AFTER=true
done

# ── Load secrets ──────────────────────────────────────────────────────────────
if [[ -f "$ROOT/.env.local" ]]; then
  set -a; source "$ROOT/.env.local"; set +a
  echo "✓ Loaded .env.local"
fi

# ── Load Rust ──────────────────────────────────────────────────────────────────
if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

# ── Validate tools ────────────────────────────────────────────────────────────
MISSING=()
command -v rustc &>/dev/null || MISSING+=("rustc (https://rustup.rs)")
[[ -d "${ANDROID_HOME:-}" ]] || MISSING+=("ANDROID_HOME (set in .env.local)")
[[ -d "${NDK_HOME:-}" ]]     || MISSING+=("NDK_HOME (set in .env.local)")
command -v cargo-ndk &>/dev/null || MISSING+=("cargo-ndk (cargo install cargo-ndk)")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "  ERROR: Missing prerequisites:"
  for m in "${MISSING[@]}"; do echo "    • $m"; done
  echo ""
  echo "  See the header of this script for setup instructions."
  exit 1
fi

echo ""
echo "╔════════════════════════════════════╗"
echo "║   Cafezin  — Android build         ║"
echo "╚════════════════════════════════════╝"
echo ""
echo "  ANDROID_HOME: $ANDROID_HOME"
echo "  NDK_HOME:     $NDK_HOME"
echo ""

cd "$APP_DIR"

echo "▸ Installing npm dependencies…"
npm install --legacy-peer-deps

echo ""
echo "▸ Building Android APK + AAB (release)…"
VITE_TAURI_MOBILE=true npx tauri android build

# ── Locate outputs ────────────────────────────────────────────────────────────
GEN_DIR="$APP_DIR/src-tauri/gen/android"
APK="$(find "$GEN_DIR" -name "*.apk" -newer "$APP_DIR/package.json" 2>/dev/null | head -1)"
AAB="$(find "$GEN_DIR" -name "*.aab" -newer "$APP_DIR/package.json" 2>/dev/null | head -1)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ Android build complete!"
[[ -n "$APK" ]] && echo "  APK: $APK"
[[ -n "$AAB" ]] && echo "  AAB: $AAB"
echo ""
echo "  For Google Play: upload the .aab"
echo "  For direct install/sideload: use the .apk"
echo "═══════════════════════════════════════════════════════"
echo ""

if [[ "$OPEN_AFTER" == "true" ]]; then
  open "$GEN_DIR"
fi
