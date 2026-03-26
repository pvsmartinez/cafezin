#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# upload-testflight.sh  —  Build a release IPA and upload to TestFlight
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/upload-testflight.sh
#   ./scripts/upload-testflight.sh --skip-upload   # build only, no upload
#
# One-time setup (see README below for full instructions):
#   1. Create an App Store Connect API key:
#      https://appstoreconnect.apple.com/access/integrations/api
#      → Keys tab → "+" → name it, role "Developer" is enough for TestFlight
#      → Copy the Key ID and Issuer ID
#      → Download AuthKey_XXXXXXXXX.p8 (you only get one chance!)
#      → Move it to:  mkdir -p ~/.private_keys && mv AuthKey_*.p8 ~/.private_keys/
#
#   2. Create .env.local in the repo root (never committed):
#      APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX   # 10-char team ID, developer.apple.com
#      APPLE_API_KEY_ID=XXXXXXXXXX         # Key ID from step 1
#      APPLE_API_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
#   3. Make sure your Mac keychain has a valid "Apple Distribution" certificate.
#      (Xcode → Settings → Accounts → Manage Certificates → "+" → Apple Distribution)
#
# Requirements: Xcode CLI, Tauri CLI (npx tauri), node/npm
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
APP_DIR="$ROOT/app"
APPLE_DIR="$APP_DIR/src-tauri/gen/apple"
EXPORT_OPTS="$APP_DIR/src-tauri/ios/ExportOptions-AppStore.plist"
SKIP_UPLOAD=false

# Parse args
for arg in "$@"; do
  [[ "$arg" == "--skip-upload" ]] && SKIP_UPLOAD=true
done

# ── Load secrets ──────────────────────────────────────────────────────────────
if [[ -f "$ROOT/.env.local" ]]; then
  set -a; source "$ROOT/.env.local"; set +a
  echo "✓ Loaded .env.local"
fi

# ── Validate required vars ────────────────────────────────────────────────────
MISSING=()
[[ -z "${APPLE_DEVELOPMENT_TEAM:-}" ]] && MISSING+=("APPLE_DEVELOPMENT_TEAM")
if [[ "$SKIP_UPLOAD" == "false" ]]; then
  [[ -z "${APPLE_API_KEY_ID:-}" ]]    && MISSING+=("APPLE_API_KEY_ID")
  [[ -z "${APPLE_API_ISSUER_ID:-}" ]] && MISSING+=("APPLE_API_ISSUER_ID")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "  ERROR: Missing required environment variables:"
  for v in "${MISSING[@]}"; do echo "    • $v"; done
  echo ""
  echo "  Add them to .env.local in the repo root."
  echo "  See the header of this script for setup instructions."
  echo ""
  exit 1
fi

# Validate API key file exists (altool looks in ~/.private_keys/)
if [[ "$SKIP_UPLOAD" == "false" ]]; then
  KEY_FILE="$HOME/.private_keys/AuthKey_${APPLE_API_KEY_ID}.p8"
  if [[ ! -f "$KEY_FILE" ]]; then
    echo ""
    echo "  ERROR: API key file not found at:"
    echo "    $KEY_FILE"
    echo ""
    echo "  Download AuthKey_${APPLE_API_KEY_ID}.p8 from App Store Connect and place it there:"
    echo "    mkdir -p ~/.private_keys && mv ~/Downloads/AuthKey_*.p8 ~/.private_keys/"
    echo ""
    exit 1
  fi
fi

export APPLE_DEVELOPMENT_TEAM
export VITE_TAURI_MOBILE=true

PYTHON_BIN="python3.11"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi

# ── Renew Apple Sign In client secret ────────────────────────────────────────
# The Apple JWT expires in ~6 months. We regenerate on every submission so it
# never expires in production. Generating a new token does NOT invalidate the
# previous one — both are valid until their own expiry.
echo "→ Renovando Apple Sign In client secret…"
APPLE_SIWA_PY="$(dirname "$SCRIPT_DIR")/../pedrin/secrets/apple-signin/gen_apple_secret.py"
SUPABASE_PAT="$(grep '^SUPABASE_PAT=' "$(dirname "$SCRIPT_DIR")/../pedrin/.env" | cut -d'=' -f2- | tr -d '[:space:]')"

if [[ -f "$APPLE_SIWA_PY" && -n "$SUPABASE_PAT" ]]; then
  APPLE_JWT=""
  if APPLE_JWT="$("$PYTHON_BIN" "$APPLE_SIWA_PY" --token-only 2>/dev/null)"; then
    if [[ -n "$APPLE_JWT" ]]; then
      PATCH_RESULT="$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
        "https://api.supabase.com/v1/projects/dxxwlnvemqgpdrnkzrcr/config/auth" \
        -H "Authorization: Bearer $SUPABASE_PAT" \
        -H "Content-Type: application/json" \
        -d "{\"external_apple_secret\": \"$APPLE_JWT\"}")"
      if [[ "$PATCH_RESULT" == "200" ]]; then
        echo "✓ Apple Sign In secret renovado no Supabase"
      else
        echo "  ⚠ Falha ao renovar Apple secret (HTTP $PATCH_RESULT) — continuando mesmo assim"
      fi
    else
      echo "✓ Apple Sign In secret ainda está válido — renovação desnecessária"
    fi
  else
    echo "  ⚠ Não foi possível gerar Apple JWT com $PYTHON_BIN — continuando mesmo assim"
  fi
else
  echo "  ⚠ gen_apple_secret.py ou SUPABASE_PAT não encontrado — pulando renovação"
fi

# ── Patch ExportOptions with real team ID ────────────────────────────────────
# Our source plist lives in app/src-tauri/ios/ (committed).
# Tauri reads from gen/apple/ExportOptions.plist — copy ours there.
/usr/libexec/PlistBuddy -c "Set :teamID $APPLE_DEVELOPMENT_TEAM" "$EXPORT_OPTS" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :teamID string $APPLE_DEVELOPMENT_TEAM" "$EXPORT_OPTS"

# Ensure gen/apple/ exists (created by `tauri ios init`)
if [[ ! -d "$APPLE_DIR" ]]; then
  echo "  iOS project not initialized yet. Running tauri ios init --ci…"
  cd "$APP_DIR" && VITE_TAURI_MOBILE=true npx tauri ios init --ci
fi

cp "$EXPORT_OPTS" "$APPLE_DIR/ExportOptions.plist"
echo "✓ ExportOptions patched (method: app-store-connect)"

# ── Auto-increment build number (sequential, stored in ios/build-number.txt) ──────
BUILD_NUM_FILE="$APP_DIR/src-tauri/ios/build-number.txt"
if [[ -f "$BUILD_NUM_FILE" ]]; then
  BUILD_NUM="$(( $(cat "$BUILD_NUM_FILE" | tr -d '[:space:]') + 1 ))"
else
  BUILD_NUM=1
fi
echo "$BUILD_NUM" > "$BUILD_NUM_FILE"

# Read marketing version from tauri.conf.json
MARKETING_VER="$(python3 -c "import json; print(json.load(open('$APP_DIR/src-tauri/tauri.conf.json'))['version'])")"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  cafezin  →  TestFlight upload"
echo "  Version: $MARKETING_VER  Build: $BUILD_NUM"
echo "  Team:    $APPLE_DEVELOPMENT_TEAM"
if [[ "$SKIP_UPLOAD" == "false" ]]; then
  echo "  Key ID:  $APPLE_API_KEY_ID"
fi
echo "═══════════════════════════════════════════════════════"
echo ""

# Tauri's generated iOS target still reads CFBundleVersion from the generated
# Info.plist, so we stamp both version fields there before building.
INFO_PLIST="$APPLE_DIR/app_iOS/Info.plist"
if [[ -f "$INFO_PLIST" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUM" "$INFO_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD_NUM" "$INFO_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $MARKETING_VER" "$INFO_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $MARKETING_VER" "$INFO_PLIST"
  echo "✓ Info.plist version fields set to $MARKETING_VER ($BUILD_NUM)"
else
  echo "  ⚠ Info.plist not found — run 'npx tauri ios init' first"
fi

# ── Patch project.yml (sets CFBundleVersion before xcodegen runs) ─────────────
# Tauri does NOT regenerate project.yml on each build (only on `tauri ios init`),
# so patching it here is safe and survives the build.
PROJECT_YML="$APPLE_DIR/project.yml"
if [[ -f "$PROJECT_YML" ]]; then
  # Replace CFBundleVersion value (quoted or unquoted) with the new build number
  sed -i '' "s/CFBundleVersion: .*/CFBundleVersion: \"$BUILD_NUM\"/" "$PROJECT_YML"
  if grep -q '^[[:space:]]*CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION:' "$PROJECT_YML"; then
    sed -i '' 's/^\([[:space:]]*CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION:\).*/\1 YES/' "$PROJECT_YML"
  else
    sed -i '' '/ENABLE_BITCODE: false/a\
        CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION: YES
' "$PROJECT_YML"
  fi
  if ! grep -q '^[[:space:]]*- sdk: libiconv\.tbd' "$PROJECT_YML"; then
    sed -i '' '/- framework: libapp.a/a\
      - sdk: libiconv.tbd\
      - sdk: libz.tbd
' "$PROJECT_YML"
  fi
  echo "✓ project.yml CFBundleVersion set to $BUILD_NUM"
  if command -v xcodegen >/dev/null 2>&1; then
    (cd "$APPLE_DIR" && xcodegen generate >/dev/null)
    echo "✓ Xcode project regenerated"
  fi
else
  echo "  ⚠ project.yml not found — run 'npx tauri ios init' first"
fi

# ── Build the release IPA ──────────────────────────────────────────────────
echo ""
echo "▶ Building release IPA…"
cd "$APP_DIR"

# Remove stale debug libapp.a artifacts that cause "Multiple commands produce" error
# when both debug and release versions exist in Externals simultaneously
find "$APPLE_DIR/Externals" -name "libapp.a" -delete 2>/dev/null || true

npx tauri ios build --ci --build-number "$BUILD_NUM"

echo ""
echo "▶ Locating IPA…"

# Tauri v2 puts the exported IPA here (falls back to a broader find)
IPA_PATH=""

# Common Tauri output locations
for candidate in \
  "$APPLE_DIR/build/arm64/release/app.ipa" \
  "$APPLE_DIR/build/aarch64/release/app.ipa" \
  "$APP_DIR/target/release/bundle/ios/app.ipa"; do
  if [[ -f "$candidate" ]]; then
    IPA_PATH="$candidate"
    break
  fi
done

# Broader search as fallback (look in last-modified .ipa within 2 minutes)
if [[ -z "$IPA_PATH" ]]; then
  IPA_PATH="$(find "$ROOT" -name "*.ipa" -newer "$EXPORT_OPTS" -not -path "*/node_modules/*" 2>/dev/null | head -1)"
fi

if [[ -z "$IPA_PATH" ]]; then
  echo ""
  echo "  ERROR: Could not find the exported .ipa file."
  echo "  Check the build output above for the xcodebuild export location."
  echo ""
  exit 1
fi

echo "✓ IPA: $IPA_PATH"
IPA_SIZE="$(du -sh "$IPA_PATH" | cut -f1)"
echo "  Size: $IPA_SIZE"

# ── Strip static libraries from IPA (Apple rejects bundles with .a files) ────
echo ""
echo "▶ Stripping .a files from IPA…"
WORK_DIR="$(mktemp -d)"
cp "$IPA_PATH" "$WORK_DIR/app.ipa"
pushd "$WORK_DIR" > /dev/null
unzip -q app.ipa
A_FILES="$(find . -name "*.a" 2>/dev/null)"
if [[ -n "$A_FILES" ]]; then
  echo "$A_FILES" | while read -r f; do echo "  removing: $f"; done
  find . -name "*.a" -delete
  zip -qr cleaned.ipa Payload/
  IPA_PATH="$WORK_DIR/cleaned.ipa"
  echo "✓ Cleaned IPA"
else
  echo "  (no .a files found)"
fi
popd > /dev/null

IPA_INFO_PLIST="$(find "$WORK_DIR/Payload" -path '*.app/Info.plist' 2>/dev/null | head -1 || true)"
if [[ -n "$IPA_INFO_PLIST" ]]; then
  IPA_CF_BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$IPA_INFO_PLIST" 2>/dev/null || true)"
  IPA_CF_SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$IPA_INFO_PLIST" 2>/dev/null || true)"
  echo "✓ IPA metadata: version $IPA_CF_SHORT_VERSION ($IPA_CF_BUNDLE_VERSION)"
  # Tauri ios build --build-number N may produce "MARKETING_VER.N" (e.g. 0.1.5.50)
  # instead of a bare "N". Accept both formats.
  EXPECTED_LONG="${MARKETING_VER}.${BUILD_NUM}"
  if [[ "$IPA_CF_BUNDLE_VERSION" != "$BUILD_NUM" && "$IPA_CF_BUNDLE_VERSION" != "$EXPECTED_LONG" ]]; then
    echo ""
    echo "  ERROR: IPA bundle version mismatch."
    echo "  Expected CFBundleVersion: $BUILD_NUM"
    echo "  Actual CFBundleVersion:   ${IPA_CF_BUNDLE_VERSION:-<missing>}"
    echo ""
    exit 1
  fi
else
  echo "  ⚠ Could not inspect IPA Info.plist before upload"
fi

if [[ "$SKIP_UPLOAD" == "true" ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Build complete (--skip-upload was set, not uploading)"
  echo "  IPA: $IPA_PATH"
  echo "═══════════════════════════════════════════════════════"
  exit 0
fi

# ── Upload to TestFlight ──────────────────────────────────────────────────────
echo ""
echo "▶ Uploading to App Store Connect (TestFlight)…"

ALTOOL_LOG="$(mktemp)"
set +e
xcrun altool \
  --upload-app \
  -f "$IPA_PATH" \
  -t ios \
  --apiKey  "$APPLE_API_KEY_ID" \
  --apiIssuer "$APPLE_API_ISSUER_ID" \
  --verbose 2>&1 | tee "$ALTOOL_LOG"
ALTOOL_STATUS=${PIPESTATUS[0]}
set -e

if [[ $ALTOOL_STATUS -eq 0 ]] \
  && ! rg -q 'status code: 409|Failed to upload package|ENTITY_ERROR|ERROR: \[altool\]' "$ALTOOL_LOG"; then
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  ✓ Upload complete!"
  echo "  Version $MARKETING_VER ($BUILD_NUM) is now processing."
  echo "  Check TestFlight status at:"
  echo "  https://appstoreconnect.apple.com/apps"
  echo ""
  echo "  TestFlight usually takes 5–15 minutes before testers"
  echo "  can install. You'll get an email when it's ready."
  echo "═══════════════════════════════════════════════════════"
else
  echo ""
  echo "  ERROR: Upload failed."
  echo "  Review the altool output above."
  echo ""
  exit 1
fi
