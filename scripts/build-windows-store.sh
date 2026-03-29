#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-windows-store.sh  —  Trigger Microsoft Store MSIX build via GitHub Actions
# ─────────────────────────────────────────────────────────────────────────────
# Runs on a windows-latest GitHub Actions runner — no Windows machine required.
# Uses a self-signed certificate generated in CI (no Authenticode cert to buy).
# Microsoft re-signs the MSIX when you submit it via Partner Center.
#
# First run (development/testing):
#   ./scripts/build-windows-store.sh --tag v0.2.0
#
# After registering on Partner Center and noting your Identity Name + Publisher:
#   ./scripts/build-windows-store.sh --tag v0.2.0 \
#     --identity "12345AbcDef.Cafezin" \
#     --publisher "CN=Pedro Martinez, O=PedroMartinez, ..."
#
# Requirements:
#   gh (GitHub CLI) — brew install gh && gh auth login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="pvsmartinez/cafezin"
TAG=""
IDENTITY=""
PUBLISHER=""
WAIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)       shift; TAG="${1:-}" ;;
    --tag=*)     TAG="${1#--tag=}" ;;
    --identity)  shift; IDENTITY="${1:-}" ;;
    --identity=*) IDENTITY="${1#--identity=}" ;;
    --publisher) shift; PUBLISHER="${1:-}" ;;
    --publisher=*) PUBLISHER="${1#--publisher=}" ;;
    --wait)      WAIT=true ;;
  esac
  shift
done

echo ""
echo "============================================"
echo "Cafezin - Windows Store MSIX build (CI)"
echo "============================================"
echo ""

if ! command -v gh &>/dev/null; then
  echo "  ERROR: GitHub CLI não encontrado."
  echo "  Instale: brew install gh && gh auth login"
  echo ""
  exit 1
fi

if [[ -z "$TAG" ]]; then
  echo "  ERROR: tag obrigatória."
  echo "  Uso: ./scripts/build-windows-store.sh --tag v0.2.0"
  echo ""
  exit 1
fi

echo "Triggering Windows Store MSIX workflow for tag ${TAG}..."
PRE_IDS="$(gh run list --workflow windows-store.yml --repo "$REPO" --limit 20 --json databaseId --jq '.[].databaseId' 2>/dev/null | tr '\n' ' ')"

EXTRA_FIELDS=()
[[ -n "$IDENTITY" ]]  && EXTRA_FIELDS+=(--field "identity_name=${IDENTITY}")
[[ -n "$PUBLISHER" ]] && EXTRA_FIELDS+=(--field "publisher_cn=${PUBLISHER}")

gh workflow run windows-store.yml \
  --repo "$REPO" \
  --ref main \
  --field tag="$TAG" \
  "${EXTRA_FIELDS[@]}"

RUN_ID=""
for _ in {1..30}; do
  CANDIDATE="$(gh run list --workflow windows-store.yml --repo "$REPO" --limit 10 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [[ -n "$CANDIDATE" && " $PRE_IDS " != *" $CANDIDATE "* ]]; then
    RUN_ID="$CANDIDATE"
    break
  fi
  sleep 2
done

echo ""
echo "✓ Workflow disparado."
echo "  Acompanhe: https://github.com/$REPO/actions"
echo "  Artifact: windows-store-msix  →  Cafezin.msix"
[[ -n "$RUN_ID" ]] && echo "  Run ID: $RUN_ID"
if [[ "$WAIT" == "true" && -n "$RUN_ID" ]]; then
  echo ""
  echo "Waiting for workflow to finish..."
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status
  echo "✓ MSIX gerado. Baixe o artifact 'windows-store-msix' no Actions e submeta no Partner Center."
fi
echo ""