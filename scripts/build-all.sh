#!/usr/bin/env bash
# Desktop-first build entrypoint. Parked mobile targets require explicit opt-in.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG=""
MODE=""
WITH_IOS=false

usage() {
  printf '%s\n' \
    'Usage: ./scripts/build-all.sh --tag v0.2.0 [--with-ios]' \
    '       ./scripts/build-all.sh --mac-only' \
    '       ./scripts/build-all.sh --ios-only' \
    '' \
    'Default release: macOS locally + Windows CI (release-all.sh).' \
    'Mobile is parked: --with-ios or --ios-only explicitly includes TestFlight.' \
    'Android remains available separately through build-android.sh.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ $# -ge 2 && "$2" != --* ]] || { usage >&2; exit 1; }
      TAG="$2"; shift 2 ;;
    --tag=*) TAG="${1#--tag=}"; shift ;;
    --with-ios) WITH_IOS=true; shift ;;
    --mac-only|--ios-only)
      [[ -z "$MODE" ]] || { echo 'Choose only one build mode.' >&2; exit 1; }
      MODE="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -n "$MODE" ]]; then
  [[ -z "$TAG" && "$WITH_IOS" == false ]] || {
    echo 'Do not combine a single-platform mode with release options.' >&2; exit 1;
  }
  if [[ "$MODE" == --mac-only ]]; then
    bash "$SCRIPT_DIR/build-mac.sh" --dmg
  else
    bash "$SCRIPT_DIR/build-ios.sh"
  fi
  exit 0
fi

[[ -n "$TAG" ]] || { usage; exit 1; }
printf '\nRelease %s: macOS + Windows' "$TAG"
[[ "$WITH_IOS" == false ]] || printf ' + iOS/TestFlight'
printf '\n'
read -r -p 'Proceed? (y/N): ' CONFIRM
[[ "$CONFIRM" =~ ^[Yy] ]] || exit 0
bash "$SCRIPT_DIR/release-all.sh" --tag "$TAG"
if [[ "$WITH_IOS" == true ]]; then
  bash "$SCRIPT_DIR/build-ios.sh"
fi
