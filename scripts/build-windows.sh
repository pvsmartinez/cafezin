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
#   ./scripts/build-windows.sh --tag v0.2.0 --wait
#
# Requirements:
#   gh (GitHub CLI) — brew install gh && gh auth login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="pvsmartinez/cafezin"
TAG=""
WAIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) shift; TAG="${1:-}" ;;
    --tag=*) TAG="${1#--tag=}" ;;
    --wait) WAIT=true ;;
  esac
  shift
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
PRE_IDS="$(gh run list --workflow release.yml --repo "$REPO" --limit 20 --json databaseId --jq '.[].databaseId' 2>/dev/null | tr '\n' ' ')"
gh workflow run release.yml \
  --repo "$REPO" \
  --ref main \
  --field tag="$TAG"

RUN_ID=""
for _ in {1..30}; do
  CANDIDATE="$(gh run list --workflow release.yml --repo "$REPO" --limit 10 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [[ -n "$CANDIDATE" && " $PRE_IDS " != *" $CANDIDATE "* ]]; then
    RUN_ID="$CANDIDATE"
    break
  fi
  sleep 2
done

echo ""
echo "✓ Workflow disparado."
echo "  Acompanhe: https://github.com/$REPO/actions"
echo "  Quando terminar, os installers estarão em:"
echo "  https://github.com/$REPO/releases/tag/$TAG"
[[ -n "$RUN_ID" ]] && echo "  Run ID: $RUN_ID"
if [[ "$WAIT" == "true" && -n "$RUN_ID" ]]; then
  echo ""
  echo "▸ Aguardando workflow terminar…"
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status
  echo "✓ Windows release finalizado. latest.json deve ter sido atualizado pelo workflow."
fi
echo ""
