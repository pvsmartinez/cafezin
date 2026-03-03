#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-mac.sh   –   Build Cafezin as a native macOS app + DMG
# Usage:
#   ./scripts/build-mac.sh              # build .app + .dmg
#   ./scripts/build-mac.sh --install    # build + install to ~/Applications
#   ./scripts/build-mac.sh --dmg        # build .dmg only
#   ./scripts/build-mac.sh --release    # build + upload .dmg to GitHub Releases
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/app"
BUILD_DMG=true
DO_INSTALL=false
DO_RELEASE=false

for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=true ;;
    --dmg)     BUILD_DMG=true ;;
    --release) DO_RELEASE=true; BUILD_DMG=true ;;
  esac
done

# ── Load .env.local ──────────────────────────────────────────────────────────
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a; source "$ROOT_DIR/.env.local"; set +a
fi

# ── Ensure Rust toolchain is on PATH ────────────────────────────────────────
if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

if ! command -v rustc &>/dev/null; then
  echo "Error: rustc not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

# ── Move into the app directory ──────────────────────────────────────────────
cd "$APP_DIR"

echo ""
echo "╔════════════════════════════════════╗"
echo "║   Cafezin  — macOS app build       ║"
echo "╚════════════════════════════════════╝"
echo ""
echo "▸ Installing npm dependencies…"
npm install --legacy-peer-deps

echo ""
BUNDLES="app"
[[ "$BUILD_DMG" == "true" ]] && BUNDLES="dmg"
echo "▸ Running Tauri production build (bundles: $BUNDLES)…"
npm run tauri build -- --bundles "$BUNDLES"

# ── Locate the built bundle ──────────────────────────────────────────────────
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
APP_PATH=""
DMG_PATH=""

APP_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)"
DMG_PATH="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -1)"

if [[ -z "$APP_PATH" && -z "$DMG_PATH" ]]; then
  echo ""
  echo "⚠  Build completed but no bundle was found in:"
  echo "   $BUNDLE_DIR"
  exit 1
fi

echo ""
echo "✓  Build successful!"
[[ -n "$APP_PATH" ]] && echo "   .app: $APP_PATH"
[[ -n "$DMG_PATH" ]] && echo "   .dmg: $DMG_PATH"

# ── Optionally install into ~/Applications ───────────────────────────────────
if [[ "$DO_INSTALL" == "true" && -n "$APP_PATH" ]]; then
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
  DEST="$INSTALL_DIR/$(basename "$APP_PATH")"
  echo ""
  echo "▸ Installing to ~/Applications…"
  rm -rf "$DEST"
  cp -R "$APP_PATH" "$DEST"
  echo "✓  Installed to $DEST"
fi

# ── Optionally upload DMG to GitHub Releases ─────────────────────────────────
if [[ "$DO_RELEASE" == "true" && -n "$DMG_PATH" ]]; then
  if ! command -v gh &>/dev/null; then
    echo ""
    echo "  ⚠ GitHub CLI not found — skipping release upload."
    echo "  Install: brew install gh && gh auth login"
  else
    VERSION="$(python3 -c "import json; print(json.load(open('$APP_DIR/src-tauri/tauri.conf.json'))['version'])")"
    TAG="v$VERSION"
    cp "$DMG_PATH" "$ROOT_DIR/Cafezin.dmg"
    echo ""
    echo "▸ Uploading Cafezin.dmg to GitHub Releases ($TAG)…"
    cd "$ROOT_DIR"
    # Create or update release and attach the DMG
    gh release upload "$TAG" Cafezin.dmg --clobber 2>/dev/null || \
      gh release create "$TAG" Cafezin.dmg \
        --title "Cafezin $TAG" \
        --generate-notes
    rm -f Cafezin.dmg
    echo "✓  Uploaded to https://github.com/pvsmartinez/cafezin/releases/tag/$TAG"
  fi
fi
