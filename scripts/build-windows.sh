#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-windows.sh  —  Trigger Windows build via GitHub Actions CI
# ─────────────────────────────────────────────────────────────────────────────
# Windows builds CANNOT be cross-compiled from macOS with Tauri.
# This script dispatches the GitHub Actions release workflow which runs on
# a windows-latest runner and publishes the .msi + .exe to GitHub Releases.
#
# Usage:
#   ./scripts/build-windows.sh            # trigger CI workflow dispatch
#   ./scripts/build-windows.sh --tag v0.2.0  # tag push (creates real release)
#
# Requirements:
#   gh (GitHub CLI) — brew install gh && gh auth login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REPO="pvsmartinez/cafezin"
TAG=""

for arg in "$@"; do
  case "$arg" in
    --tag) shift; TAG="${1:-}" ;;
    --tag=*) TAG="${arg#--tag=}" ;;
  esac
done

echo ""
echo "╔════════════════════════════════════╗"
echo "║   Cafezin  — Windows build (CI)    ║"
echo "╚════════════════════════════════════╝"
echo ""

if ! command -v gh &>/dev/null; then
  echo "  ERROR: GitHub CLI not found."
  echo "  Install: brew install gh && gh auth login"
  echo ""
  exit 1
fi

if [[ -n "$TAG" ]]; then
  # Push a real version tag — triggers the full release workflow
  echo "▸ Pushing tag $TAG to trigger release workflow…"
  cd "$ROOT"
  git tag "$TAG"
  git push origin "$TAG"
  echo ""
  echo "✓ Tag $TAG pushed."
  echo "  GitHub Actions will build macOS, Windows and Android in parallel."
  echo "  Track progress: https://github.com/$REPO/actions"
else
  # Workflow dispatch (pre-release / test build)
  echo "▸ Dispatching workflow on GitHub Actions (pre-release)…"
  gh workflow run release.yml \
    --repo "$REPO" \
    --ref main \
    --field tag=""
  echo ""
  echo "✓ Workflow dispatched."
  echo "  Track progress: https://github.com/$REPO/actions"
  echo ""
  echo "  When complete, download Windows installers from:"
  echo "  https://github.com/$REPO/releases"
fi
