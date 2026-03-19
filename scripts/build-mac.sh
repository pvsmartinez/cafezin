#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-mac.sh   –   Build Cafezin as a native macOS app + updater artifacts
# Usage:
#   ./scripts/build-mac.sh              # build local bundle
#   ./scripts/build-mac.sh --install    # build + install to ~/Applications
#   ./scripts/build-mac.sh --dmg        # build .dmg only
#   ./scripts/build-mac.sh --release    # build signed updater bundle + upload to GitHub Releases
#                                         and update update/latest.json with .app.tar.gz + .sig
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

# ── Fallback to canonical workspace secrets for signing ─────────────────────
PEDRIN_ENV="/Users/pedromartinez/Dev/pmatz/pedrin/.env"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -f "$PEDRIN_ENV" ]]; then
  PEDRIN_TAURI_PASSWORD="$(grep '^TAURI_SIGNING_PRIVATE_KEY_PASSWORD=' "$PEDRIN_ENV" | head -1 | cut -d= -f2- || true)"
  if [[ -n "$PEDRIN_TAURI_PASSWORD" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PEDRIN_TAURI_PASSWORD"
  fi
fi

# ── Ensure Rust toolchain is on PATH ────────────────────────────────────────
if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

if ! command -v rustc &>/dev/null; then
  echo "Error: rustc not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

# ── Load signing key for release builds ─────────────────────────────────────
SIGNING_KEY_FILE="$HOME/.tauri/cafezin.key"
if [[ "$DO_RELEASE" == "true" ]]; then
  if [[ -f "$SIGNING_KEY_FILE" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$SIGNING_KEY_FILE")"
    echo "▸ Signing key loaded from $SIGNING_KEY_FILE"
    if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
      echo "▸ Signing key password loaded from environment"
    else
      # Do NOT set TAURI_SIGNING_PRIVATE_KEY_PASSWORD when empty — Tauri handles
      # no-password keys better when the var is UNSET (None) vs set to "" (Some(""))
      unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
  else
    echo "⚠  No signing key at $SIGNING_KEY_FILE — build will not be signed."
    echo "   Generate one with: npx tauri signer generate -w $SIGNING_KEY_FILE"
  fi
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

if [[ "$DO_RELEASE" == "true" ]]; then
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    SIGNING_KEY_FILE="$HOME/.tauri/cafezin.key"
    if [[ -f "$SIGNING_KEY_FILE" ]]; then
      export TAURI_SIGNING_PRIVATE_KEY="$(cat "$SIGNING_KEY_FILE")"
      echo "✓ Loaded signing key from $SIGNING_KEY_FILE"
      if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
        echo "✓ Loaded signing key password from environment"
      else
        unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      fi
    fi
  fi

  echo "▸ Cleaning previous updater artifacts..."
  find "$APP_DIR/src-tauri/target/release/bundle/macos" -maxdepth 1 \( -name '*.tar.gz' -o -name '*.tar.gz.sig' \) -delete 2>/dev/null || true

  echo "▸ Running Tauri production build (bundles: app) for fresh updater artifacts..."
  npm run tauri build -- --bundles app

  echo "▸ Running Tauri production build (bundles: dmg) for installer..."
  npm run tauri build -- --bundles dmg
else
  echo "▸ Running Tauri production build (bundles: $BUNDLES)..."
  npm run tauri build -- --bundles "$BUNDLES"
fi

# ── Locate the built bundle ──────────────────────────────────────────────────
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
APP_PATH=""
DMG_PATH=""
TARGZ_PATH=""
TARGZ_SIG_PATH=""

APP_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)"
DMG_PATH="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -1)"
TARGZ_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.tar.gz' 2>/dev/null | head -1)"
TARGZ_SIG_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.tar.gz.sig' 2>/dev/null | head -1)"

if [[ -z "$APP_PATH" && -z "$DMG_PATH" ]]; then
  echo ""
  echo "⚠  Build completed but no bundle was found in:"
  echo "   $BUNDLE_DIR"
  exit 1
fi

echo ""
echo "✓  Build successful!"
[[ -n "$APP_PATH" ]]      && echo "   .app:        $APP_PATH"
[[ -n "$DMG_PATH" ]]      && echo "   .dmg:        $DMG_PATH"
[[ -n "$TARGZ_PATH" ]]    && echo "   .tar.gz:     $TARGZ_PATH"
[[ -n "$TARGZ_SIG_PATH" ]] && echo "   .tar.gz.sig: $TARGZ_SIG_PATH"

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

# ── Optionally upload DMG + updater bundle to GitHub Releases ────────────────
if [[ "$DO_RELEASE" == "true" && -n "$DMG_PATH" ]]; then
  if ! command -v gh &>/dev/null; then
    echo ""
    echo "  ERROR: GitHub CLI not found — cannot publish release artifacts."
    echo "  Install: brew install gh && gh auth login"
    exit 1
  else
    VERSION="$(python3 -c "import json; print(json.load(open('$APP_DIR/src-tauri/tauri.conf.json'))['version'])")"
    TAG="v$VERSION"

    # Detect architecture
    ARCH="$(uname -m)"
    if [[ "$ARCH" == "arm64" ]]; then
      PLATFORM="darwin-aarch64"
      DMG_DEST="Cafezin_${VERSION}_aarch64.dmg"
      TARGZ_DEST="Cafezin_${VERSION}_aarch64.app.tar.gz"
      SIG_DEST="Cafezin_${VERSION}_aarch64.app.tar.gz.sig"
    else
      PLATFORM="darwin-x86_64"
      DMG_DEST="Cafezin_${VERSION}_x64.dmg"
      TARGZ_DEST="Cafezin_${VERSION}_x64.app.tar.gz"
      SIG_DEST="Cafezin_${VERSION}_x64.app.tar.gz.sig"
    fi

    cp "$DMG_PATH" "$ROOT_DIR/$DMG_DEST"
    FILES="$ROOT_DIR/$DMG_DEST"

    # ── Fallback: if tauri build didn't produce .sig, sign the .tar.gz manually ──
    # With createUpdaterArtifacts:true, tauri build should handle this automatically.
    # This block covers edge cases where the auto-sign failed.
    if [[ -z "$TARGZ_SIG_PATH" && -n "$TARGZ_PATH" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
      echo ""
      echo "▸ Signing updater archive (fallback)..."
      TARGZ_SIG_PATH="${TARGZ_PATH}.sig"
      # Use Python script to sign (handles rsign2 key format with no password)
      python3 "$ROOT_DIR/scripts/sign-updater.py" "$TARGZ_PATH" "" 2>&1 \
        && echo "✓  Signed ${TARGZ_PATH##*/}" \
        || { echo "⚠  Signing failed — update/latest.json will not be updated."; TARGZ_SIG_PATH=""; }
    fi

    # ── If still no .tar.gz, create one from the .app and sign it ──
    if [[ -z "$TARGZ_PATH" && -n "$APP_PATH" && -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
      echo ""
      echo "▸ Creating updater archive..."
      APP_BASENAME="$(basename "$APP_PATH")"
      TARGZ_PATH="$BUNDLE_DIR/macos/${APP_BASENAME}.tar.gz"
      TARGZ_SIG_PATH="${TARGZ_PATH}.sig"
      (cd "$BUNDLE_DIR/macos" && tar czf "$TARGZ_PATH" "$APP_BASENAME")
      python3 "$ROOT_DIR/scripts/sign-updater.py" "$TARGZ_PATH" "" 2>&1 \
        && echo "✓  Created ${TARGZ_PATH##*/} + .sig" \
        || { echo "⚠  Signing failed — update/latest.json will not be updated."; TARGZ_SIG_PATH=""; }
    fi

    if [[ -z "$TARGZ_PATH" || -z "$TARGZ_SIG_PATH" ]]; then
      echo ""
      echo "ERROR: macOS release requires updater artifacts (.app.tar.gz + .sig)."
      echo "       Refusing to publish a release that only has the pretty installer (.dmg)."
      echo ""
      echo "       Expected:"
      echo "         tar.gz: ${TARGZ_PATH:-<missing>}"
      echo "         sig:    ${TARGZ_SIG_PATH:-<missing>}"
      exit 1
    fi

    cp "$TARGZ_PATH" "$ROOT_DIR/$TARGZ_DEST"
    cp "$TARGZ_SIG_PATH" "$ROOT_DIR/$SIG_DEST"
    FILES="$FILES $ROOT_DIR/$TARGZ_DEST $ROOT_DIR/$SIG_DEST"

    echo ""
    echo "▸ Uploading to GitHub release ${TAG}..."
    cd "$ROOT_DIR"
    gh release upload "$TAG" $FILES --clobber 2>/dev/null || \
      gh release create "$TAG" $FILES \
        --title "Cafezin $TAG" \
        --generate-notes

    echo "✓  Uploaded to https://github.com/pvsmartinez/cafezin/releases/tag/$TAG"

    # ── Update update/latest.json with macOS entry ────────────────────────
    MAC_SIG="$(cat "$ROOT_DIR/$SIG_DEST")"
    BASE="https://github.com/pvsmartinez/cafezin/releases/download/${TAG}"
    python3 -c "
import json, os
from datetime import datetime, timezone

with open('$ROOT_DIR/update/latest.json', 'r') as f:
    data = json.load(f)

platform = '$PLATFORM'
base     = '$BASE'
sig      = '$MAC_SIG'
version  = '$VERSION'

data['version']  = version
data['pub_date'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
data.setdefault('platforms', {})
data['platforms'][platform] = {
    'url':       f'{base}/$TARGZ_DEST',
    'signature': sig,
}

with open('$ROOT_DIR/update/latest.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
print('✓  Updated update/latest.json for', platform)
"
    cd "$ROOT_DIR"
    git add update/latest.json
    git diff --staged --quiet || git commit -m "chore: update latest.json for $TAG macOS"
    git push
    echo "✓  Pushed update/latest.json"

    rm -f "$ROOT_DIR/$DMG_DEST" "$ROOT_DIR/$TARGZ_DEST" "$ROOT_DIR/$SIG_DEST"
  fi
fi
