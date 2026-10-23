#!/usr/bin/env python3
"""Safety regression tests for clean-builds.py (no real workspace deletion)."""

from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "clean_builds", Path(__file__).with_name("clean-builds.py")
)
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)


class CleanBuildsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / "app/src-tauri/target"
        self.output.mkdir(parents=True)
        (self.output / "build.bin").write_bytes(b"build output")
        self.root_patch = patch.object(cleaner, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def run_cleaner(self, apply=False, tracked=""):
        args = ["clean-builds.py"] + (["--apply"] if apply else [])
        with patch("sys.argv", args), patch.object(
            cleaner.subprocess, "check_output", return_value=tracked
        ), redirect_stdout(io.StringIO()):
            cleaner.main()

    def test_dry_run_preserves_outputs(self):
        self.run_cleaner()
        self.assertTrue((self.output / "build.bin").exists())

    def test_apply_preserves_source_and_non_allowlisted_outputs(self):
        paths = [
            "app/src-tauri/gen/android/app/src/main/MainActivity.kt",
            "app/src-tauri/ios/build-number.txt",
            "app/node_modules/package/index.js",
            "videos/out/demo.mp4",
            "books/chapter.md",
        ]
        for name in paths:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("keep")
        self.run_cleaner(apply=True)
        self.assertFalse(self.output.exists())
        for name in paths:
            self.assertEqual((self.root / name).read_text(), "keep")

    def test_tracked_output_refuses_entire_cleanup(self):
        with self.assertRaisesRegex(SystemExit, "tracked output"):
            self.run_cleaner(apply=True, tracked="app/src-tauri/target/build.bin\0")
        self.assertTrue(self.output.exists())

    def test_symlink_parent_is_refused(self):
        external = self.root / "external"
        (external / "output").mkdir(parents=True)
        (self.root / "linked").symlink_to(external, target_is_directory=True)
        with patch.object(cleaner, "OUTPUTS", ("linked/output",)):
            with self.assertRaisesRegex(SystemExit, "symlink"):
                self.run_cleaner(apply=True)
        self.assertTrue((external / "output").exists())


if __name__ == "__main__":
    unittest.main()
