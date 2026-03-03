#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-all.sh  —  Build + publish Cafezin para todas as plataformas
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/build-all.sh --tag v0.2.0  # build completo: macOS + iOS local, Windows no CI
#   ./scripts/build-all.sh --mac-only    # só macOS (local)
#   ./scripts/build-all.sh --ios-only    # só iOS/TestFlight (local)
#
# Onde cada plataforma roda:
#   macOS   → local (este Mac)         → gh release upload
#   iOS     → local (este Mac + Xcode) → TestFlight via upload-testflight.sh
#   Windows → GitHub Actions CI        → gh workflow run release.yml --field tag=
#   Android → local (este Mac + SDK)   → usar build-android.sh separado
#
# Downloads:
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin.dmg
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin_setup.msi
#   https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin_setup.exe
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

  echo "── [2/3] Windows — GitHub Actions CI ───────────────────────────────"
  "$SCRIPT_DIR/build-windows.sh" --tag "$TAG"
  echo ""

  echo "── [3/3] iOS — TestFlight ───────────────────────────────────────────"
  "$SCRIPT_DIR/build-ios.sh"

  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  ✓ Release $TAG iniciada!"
  echo ""
  echo "  • macOS DMG → GitHub Releases"
  echo "  • Windows   → CI rodando (acompanhe: https://github.com/pvsmartinez/cafezin/actions)"
  echo "  • iOS       → processando no TestFlight"
  echo ""
  echo "  Release: https://github.com/pvsmartinez/cafezin/releases/tag/$TAG"
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

# ── Default: sem --tag, exige --mac-only ou --ios-only ───────────────────────
echo "  Para um release completo, use --tag:"
echo "  ./scripts/build-all.sh --tag v0.2.0"
echo ""
echo "  Opções disponíveis:"
echo "    --tag v0.2.0   macOS local + Windows CI + iOS TestFlight"
echo "    --mac-only     só macOS .dmg local"
echo "    --ios-only     só iOS / TestFlight"
echo ""
echo "  Windows standalone:"
echo "    ./scripts/build-windows.sh --tag v0.2.0"
echo ""
