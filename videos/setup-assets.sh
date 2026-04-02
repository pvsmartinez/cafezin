#!/usr/bin/env bash
# Setup Remotion public/ assets from existing project files.
# Run once before: npm run start  OR  remotion render

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VIDEOS="$SCRIPT_DIR"
LANDING="$VIDEOS/../landing"
SCREENSHOTS="$VIDEOS/../../pedrin/fastlane/screenshots/cafezin"

mkdir -p "$VIDEOS/public/screenshots" "$VIDEOS/public/desktop"

# iOS screenshots (portrait)
for i in 1 2 3 4; do
  num=$((3395 + i))
  src="$SCREENSHOTS/IMG_${num}.PNG"
  dst="$VIDEOS/public/screenshots/0${i}.png"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "✓ screenshots/0${i}.png"
  else
    echo "✗ missing: $src"
  fi
done

# Desktop screenshots (landscape)
for name in editor canvas settings; do
  src="$LANDING/screen-${name}.png"
  dst="$VIDEOS/public/desktop/${name}.png"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "✓ desktop/${name}.png"
  else
    echo "✗ missing: $src"
  fi
done

echo ""
echo "Assets ready. Run: npm run start"
