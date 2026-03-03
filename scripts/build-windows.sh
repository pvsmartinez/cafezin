#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-windows.sh  —  Trigger Windows build via GitHub Actions CI
# ─────────────────────────────────────────────────────────────────────────────
# Windows builds CANNOT be cross-compiled from macOS.
# Este script dispara o workflow do GitHub Actions manualmente (workflow_dispatch)
# que roda num runner windows-latest e publica o .msi + .exe na GitHub Release.
#
# Usage:
#   ./scripts/build-windows.sh --tag v0.2.0
#
# Requirements:
#   gh (GitHub CLI) — brew install gh && gh auth login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

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
  echo "  ERROR: GitHub CLI não encontrado."
  echo "  Instale: brew install gh && gh auth login"
  echo ""
  exit 1
fi

if [[ -z "$TAG" ]]; then
  echo "  ERROR: tag obrigatória."
  echo "  Uso: ./scripts/build-windows.sh --tag v0.2.0"
  echo ""
  exit 1
fi

echo "▸ Disparando workflow no GitHub Actions para tag $TAG…"
gh workflow run release.yml \
  --repo "$REPO" \
  --ref main \
  --field tag="$TAG"

echo ""
echo "✓ Workflow disparado."
echo "  Acompanhe: https://github.com/$REPO/actions"
echo "  Quando terminar, os installers estarão em:"
echo "  https://github.com/$REPO/releases/tag/$TAG"
echo ""
