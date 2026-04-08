#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release-all.sh  —  Local macOS release + trigger Windows release in CI
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/release-all.sh --tag v0.2.0
#   ./scripts/release-all.sh --tag v0.2.0 --no-wait-windows
#
# What it does:
#   1. Builds macOS locally on this Mac
#   2. Uploads macOS DMG + updater bundle (.app.tar.gz + .sig) to GitHub Release
#   3. Updates update/latest.json for macOS
#   4. Triggers the Windows GitHub Actions workflow
#   5. Optionally waits for the Windows workflow to finish
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG=""
WAIT_WINDOWS=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --tag=*)
      TAG="${1#--tag=}"
      shift
      ;;
    --no-wait-windows)
      WAIT_WINDOWS=false
      shift
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "ERROR: tag obrigatória. Uso: ./scripts/release-all.sh --tag v0.2.0" >&2
  exit 1
fi

PACKAGE_VERSION="$(node -p "require('/Users/pedromartinez/Dev/pmatz/cafezin/app/package.json').version")"
EXPECTED_TAG="v$PACKAGE_VERSION"
if [[ "$TAG" != "$EXPECTED_TAG" ]]; then
  echo "ERROR: tag $TAG não bate com a versão atual do app ($EXPECTED_TAG)." >&2
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "ERROR: GitHub CLI não encontrado. Instale com: brew install gh && gh auth login" >&2
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Cafezin  — Release All                    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  Tag:            $TAG"
echo "  Windows wait:   $WAIT_WINDOWS"
echo ""

echo "── [1/2] macOS local release ───────────────────────────────────────"
"$SCRIPT_DIR/build-mac.sh" --release
echo ""

echo "── [2/2] Windows release via GitHub Actions ───────────────────────"
if [[ "$WAIT_WINDOWS" == "true" ]]; then
  "$SCRIPT_DIR/build-windows.sh" --tag "$TAG" --wait
else
  "$SCRIPT_DIR/build-windows.sh" --tag "$TAG"
fi

echo ""
echo "═════════════════════════════════════════════════════════════════════"
echo "✓ Release orchestration finished for $TAG"
echo "  Feed:    https://raw.githubusercontent.com/pvsmartinez/cafezin/main/update/latest.json"
echo "  Release: https://github.com/pvsmartinez/cafezin/releases/tag/$TAG"
echo "═════════════════════════════════════════════════════════════════════"