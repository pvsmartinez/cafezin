#!/usr/bin/env python3
"""Remove only allowlisted, untracked build outputs. Dry-run by default."""

import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = (
    "app/src-tauri/target",
    "app/src-tauri/gen/android/app/build",
    "app/src-tauri/gen/android/build",
    "app/src-tauri/gen/android/buildSrc/build",
    "app/src-tauri/gen/android/.gradle",
    "app/src-tauri/gen/apple/build",
    "app/dist",
    "app/dist-web",
    ".vercel/output",
)


def allocated_bytes(path: Path) -> int:
    """Measure allocated blocks without following links or counting hardlinks twice."""
    seen = set()
    total = 0
    for item in (path, *path.rglob("*")):
        stat = item.lstat()
        key = (stat.st_dev, stat.st_ino)
        if key not in seen:
            seen.add(key)
            total += stat.st_blocks * 512
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="delete listed build outputs")
    args = parser.parse_args()
    tracked = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", "-z"], text=True
    ).split("\0")
    candidates = []
    for relative in OUTPUTS:
        path = ROOT / relative
        if not path.exists() and not path.is_symlink():
            continue
        # Refuse links in any parent as well as the output itself.
        if any(part.is_symlink() for part in (path, *path.parents) if part != ROOT.parent):
            raise SystemExit(f"Refusing symlink: {relative}")
        if not path.is_dir() or not path.resolve().is_relative_to(ROOT):
            raise SystemExit(f"Refusing unexpected path: {relative}")
        if any(name == relative or name.startswith(relative + "/") for name in tracked):
            raise SystemExit(f"Refusing tracked output: {relative}")
        candidates.append((path, allocated_bytes(path)))
    total = sum(size for _, size in candidates)
    for path, size in candidates:
        print(f"{size / 1024**3:6.2f} GiB  {path.relative_to(ROOT)}", flush=True)
    print(f"Total: {total / 1024**3:.2f} GiB", flush=True)
    if not args.apply:
        print("Dry-run. Stop build/dev processes, then rerun with --apply to delete.")
        return
    for path, _ in candidates:
        shutil.rmtree(path)
    print("Build outputs removed. The next native build will take longer.")


if __name__ == "__main__":
    main()
