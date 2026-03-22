#!/usr/bin/env bash
# release-version.sh  —  bump semver + sync manifests + trigger full release
#
# Usage:
#   ./scripts/release-version.sh              # bump patch + macOS + Windows + iOS
#   ./scripts/release-version.sh minor        # bump minor + trigger full release
#   ./scripts/release-version.sh major        # bump major + trigger full release
#   ./scripts/release-version.sh 1.2.3        # set explicit version + trigger full release
#   ./scripts/release-version.sh patch --no-ios
#   ./scripts/release-version.sh patch --no-wait-windows
#
# Notes:
#   - Must be run on branch main.
#   - If the worktree is dirty, the script creates a checkpoint commit first.
#   - Then it creates and pushes a dedicated version-bump commit.
#   - macOS + Windows are delegated to release-all.sh.
#   - iOS/TestFlight runs afterwards so its build-number bump does not interfere
#     with the git commit/push performed by the macOS release flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/app"

BUMP="patch"
RUN_IOS=true
WAIT_WINDOWS=true
POSITIONAL_SET=false

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-version.sh [patch|minor|major|x.y.z] [options]

Options:
  --no-ios             Skip iOS/TestFlight
  --no-wait-windows    Trigger Windows build but do not wait for completion
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major)
      if [[ "$POSITIONAL_SET" == "true" ]]; then
        echo "ERROR: only one version argument is allowed." >&2
        exit 1
      fi
      BUMP="$1"
      POSITIONAL_SET=true
      shift
      ;;
    [0-9]*.[0-9]*.[0-9]*)
      if [[ "$POSITIONAL_SET" == "true" ]]; then
        echo "ERROR: only one version argument is allowed." >&2
        exit 1
      fi
      BUMP="$1"
      POSITIONAL_SET=true
      shift
      ;;
    --no-ios)
      RUN_IOS=false
      shift
      ;;
    --no-wait-windows)
      WAIT_WINDOWS=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 1
  fi
}

require_clean_worktree() {
  local status
  status="$(git -C "$ROOT_DIR" status --porcelain)"
  if [[ -n "$status" ]]; then
    echo ""
    echo "── [0/5] Dirty worktree checkpoint ─────────────────────────────────"
    echo "Working tree has local changes. Creating checkpoint commit first..."
    echo "" >&2
    echo "$status"
    echo ""
    git -C "$ROOT_DIR" add -A
    git -C "$ROOT_DIR" commit -m "chore: checkpoint before release"
    git -C "$ROOT_DIR" push origin main
    echo "✓ Checkpoint committed and pushed"
    echo ""
  fi
}

read_cargo_version() {
  node -e "
    const fs = require('fs');
    const cargo = fs.readFileSync(process.argv[1], 'utf8');
    const match = cargo.match(/\\[package\\][\\s\\S]*?^version = \\\"([^\\\"]+)\\\"/m);
    if (!match) process.exit(2);
    console.log(match[1]);
  " "$APP_DIR/src-tauri/Cargo.toml"
}

require_matching_versions() {
  local package_version tauri_version cargo_version
  package_version="$(node -p "require('$APP_DIR/package.json').version")"
  tauri_version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$APP_DIR/src-tauri/tauri.conf.json', 'utf8')).version)")"
  cargo_version="$(read_cargo_version)"

  if [[ "$package_version" != "$tauri_version" || "$package_version" != "$cargo_version" ]]; then
    echo "ERROR: version mismatch detected before bump." >&2
    echo "  package.json:    $package_version" >&2
    echo "  tauri.conf.json: $tauri_version" >&2
    echo "  Cargo.toml:      $cargo_version" >&2
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd npm
require_cmd gh

CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: release-version.sh must run on branch main. Current branch: $CURRENT_BRANCH" >&2
  exit 1
fi

require_clean_worktree
require_matching_versions

CURRENT_VERSION="$(node -p "require('$APP_DIR/package.json').version")"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Cafezin  — Semantic Release                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Current version: $CURRENT_VERSION"
echo "  Requested bump:  $BUMP"
echo "  iOS enabled:     $RUN_IOS"
echo "  Wait Windows:    $WAIT_WINDOWS"
echo ""

echo "── [1/5] Bump app/package.json ─────────────────────────────────────"
cd "$APP_DIR"
npm version "$BUMP" --no-git-tag-version
NEW_VERSION="$(node -p "require('./package.json').version")"
TAG="v$NEW_VERSION"
echo "✓ New version: $NEW_VERSION"

echo ""
echo "── [2/5] Sync Tauri manifests ──────────────────────────────────────"
NEW_VERSION="$NEW_VERSION" APP_DIR="$APP_DIR" node <<'NODE'
const fs = require('fs');
const path = require('path');

const appDir = process.env.APP_DIR;
const version = process.env.NEW_VERSION;

if (!appDir || !version) {
  throw new Error('APP_DIR and NEW_VERSION are required');
}

const tauriPath = path.join(appDir, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(appDir, 'src-tauri', 'Cargo.toml');

const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauri.version = version;
fs.writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

const cargoBefore = fs.readFileSync(cargoPath, 'utf8');
const cargoAfter = cargoBefore.replace(
  /(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
  `$1${version}$3`,
);

if (cargoBefore === cargoAfter) {
  throw new Error('Could not update Cargo.toml package version');
}

fs.writeFileSync(cargoPath, cargoAfter);
NODE

PACKAGE_VERSION="$(node -p "require('$APP_DIR/package.json').version")"
TAURI_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$APP_DIR/src-tauri/tauri.conf.json', 'utf8')).version)")"
CARGO_VERSION="$(read_cargo_version)"

if [[ "$PACKAGE_VERSION" != "$NEW_VERSION" || "$TAURI_VERSION" != "$NEW_VERSION" || "$CARGO_VERSION" != "$NEW_VERSION" ]]; then
  echo "ERROR: version sync failed." >&2
  echo "  package.json:    $PACKAGE_VERSION" >&2
  echo "  tauri.conf.json: $TAURI_VERSION" >&2
  echo "  Cargo.toml:      $CARGO_VERSION" >&2
  exit 1
fi

echo "✓ package.json    → $PACKAGE_VERSION"
echo "✓ tauri.conf.json → $TAURI_VERSION"
echo "✓ Cargo.toml      → $CARGO_VERSION"

echo ""
echo "── [3/5] Commit and push version bump ──────────────────────────────"
cd "$ROOT_DIR"
git add app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/src-tauri/tauri.conf.json
git commit -m "chore: release $TAG"
git push origin main
echo "✓ Version bump committed and pushed"

echo ""
echo "── [4/5] Trigger platform releases ─────────────────────────────────"
if [[ "$WAIT_WINDOWS" == "true" ]]; then
  bash "$SCRIPT_DIR/release-all.sh" --tag "$TAG"
else
  bash "$SCRIPT_DIR/release-all.sh" --tag "$TAG" --no-wait-windows
fi

if [[ "$RUN_IOS" == "true" ]]; then
  echo ""
  echo "── [5/5] iOS / TestFlight ──────────────────────────────────────────"
  bash "$SCRIPT_DIR/build-ios.sh"
fi

echo ""
echo "═════════════════════════════════════════════════════════════════════"
echo "✓ Full release flow finished for $TAG"
echo "  Release: https://github.com/pvsmartinez/cafezin/releases/tag/$TAG"
if [[ "$RUN_IOS" == "true" ]]; then
  echo "  iOS: submitted via TestFlight flow"
fi
echo "═════════════════════════════════════════════════════════════════════"
