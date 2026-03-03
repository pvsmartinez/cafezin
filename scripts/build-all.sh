#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-all.sh  —  Build + publish Cafezin for all platforms
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/build-all.sh              # build macOS + iOS, trigger CI for Windows + Android
#   ./scripts/build-all.sh --tag v0.2.0 # push version tag → CI builds everything
#   ./scripts/build-all.sh --mac-only   # macOS only (local)
#   ./scripts/build-all.sh --ios-only   # iOS/TestFlight only (local)
#
# What runs where:
#   macOS  → runs locally (requires this Mac)
#   iOS    → runs locally (requires this Mac + Xcode)
#   Windows → runs on GitHub Actions CI (windows-latest runner)
#   Android → runs on GitHub Actions CI (ubuntu-latest runner with SDK)
#
# To trigger a full release for all platforms:
#   ./scripts/build-all.sh --tag v0.2.0
# This pushes a git tag, which triggers .github/workflows/release.yml
# which builds macOS, Windows, and Android in parallel and publishes a
# GitHub Release with all installers attached.
#
# Files are available at:
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin.dmg
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin_setup.msi
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin_setup.exe
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin.apk
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG=""
MAC_ONLY=false
IOS_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --tag=*) TAG="${arg#--tag=}" ;;
    --tag)   shift; TAG="${1:-}" ;;
    --mac-only) MAC_ONLY=true ;;
    --ios-only) IOS_ONLY=true ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Cafezin  — Full Release Build          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Tag-based full release ────────────────────────────────────────────────────
if [[ -n "$TAG" ]]; then
  echo "  Mode: VERSION TAG ($TAG)"
  echo "  This will:"
  echo "    1. Build macOS .dmg locally"
  echo "    2. Upload macOS .dmg to GitHub Release $TAG"
  echo "    3. Push tag → CI builds Windows + Android automatically"
  echo "    4. Upload iOS to TestFlight via upload-testflight.sh"
  echo ""
  read -r -p "  Proceed? (y/N): " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy] ]] || exit 0
  echo ""

  echo "── [1/4] macOS build + GitHub Release ──────────────────────────────"
  "$SCRIPT_DIR/build-mac.sh" --release
  echo ""

  echo "── [2/4] Windows + Android — triggering CI ─────────────────────────"
  "$SCRIPT_DIR/build-windows.sh" --tag "$TAG"
  echo ""

  echo "── [3/4] iOS — TestFlight ───────────────────────────────────────────"
  "$SCRIPT_DIR/build-ios.sh"

  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  ✓ Release $TAG in progress!"
  echo ""
  echo "  • macOS DMG uploaded to GitHub Releases"
  echo "  • Windows + Android building on GitHub Actions"
  echo "  • iOS processing on TestFlight"
  echo ""
  echo "  Track CI: https://github.com/pvsmartinez/cafezin/actions"
  echo "  Release:  https://github.com/pvsmartinez/cafezin/releases"
  echo "═══════════════════════════════════════════════════"
  exit 0
fi

# ── Selective local builds ────────────────────────────────────────────────────
if [[ "$MAC_ONLY" == "true" ]]; then
  echo "── macOS build ──────────────────────────────────────────────────────"
  "$SCRIPT_DIR/build-mac.sh" --dmg
  exit 0
fi

if [[ "$IOS_ONLY" == "true" ]]; then
  echo "── iOS / TestFlight ─────────────────────────────────────────────────"
  "$SCRIPT_DIR/build-ios.sh"
  exit 0
fi

# ── Default: local builds (macOS + iOS) + trigger CI (Windows + Android) ─────
echo "  Mode: LOCAL (macOS + iOS) + CI (Windows + Android)"
echo ""

echo "── [1/3] macOS .dmg ─────────────────────────────────────────────────"
"$SCRIPT_DIR/build-mac.sh" --dmg

echo ""
echo "── [2/3] iOS / TestFlight ───────────────────────────────────────────"
"$SCRIPT_DIR/build-ios.sh"

echo ""
echo "── [3/3] Windows + Android (GitHub Actions) ─────────────────────────"
"$SCRIPT_DIR/build-windows.sh"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Local builds complete. CI triggered."
echo "  Track: https://github.com/pvsmartinez/cafezin/actions"
echo "═══════════════════════════════════════════════════"
