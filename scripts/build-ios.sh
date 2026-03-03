#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-ios.sh  —  Wrapper: build release IPA and upload to TestFlight
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/build-ios.sh              # build + upload to TestFlight
#   ./scripts/build-ios.sh --skip-upload  # build IPA only, no upload
#
# Delegates to upload-testflight.sh which handles all the heavy lifting.
# Run this from the repo root or from anywhere — paths are resolved.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔════════════════════════════════════╗"
echo "║   Cafezin  — iOS / TestFlight      ║"
echo "╚════════════════════════════════════╝"
echo ""

exec "$SCRIPT_DIR/upload-testflight.sh" "$@"
