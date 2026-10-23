#!/usr/bin/env python3
"""Exercise release routing with stub scripts, never real builds or publishing."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class BuildEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(Path(__file__).with_name("build-all.sh"), self.root / "build-all.sh")
        self.calls = self.root / "calls"
        for name in ("release-all.sh", "build-ios.sh", "build-mac.sh"):
            (self.root / name).write_text(
                '#!/usr/bin/env bash\n'
                'printf "%s\\n" "${0##*/} $*" >> "$(dirname "$0")/calls"\n'
            )

    def run_build(self, *args):
        return subprocess.run(
            ["bash", str(self.root / "build-all.sh"), *args],
            input="y\n", text=True, capture_output=True, check=False,
        )

    def test_default_release_is_desktop_only(self):
        result = self.run_build("--tag", "v0.2.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls.read_text(), "release-all.sh --tag v0.2.0\n")

    def test_mobile_release_requires_opt_in(self):
        result = self.run_build("--tag=v0.2.0", "--with-ios")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.calls.read_text(),
            "release-all.sh --tag v0.2.0\nbuild-ios.sh \n",
        )

    def test_single_platform_modes_remain_supported(self):
        for mode, call in (("--mac-only", "build-mac.sh --dmg"),
                           ("--ios-only", "build-ios.sh ")):
            with self.subTest(mode=mode):
                self.calls.unlink(missing_ok=True)
                self.assertEqual(self.run_build(mode).returncode, 0)
                self.assertEqual(self.calls.read_text(), call + "\n")

    def test_invalid_arguments_do_not_build(self):
        for args in (("--tag",), ("--unknown",), ("--mac-only", "--ios-only"),
                     ("--tag", "v0.2.0", "--mac-only")):
            with self.subTest(args=args):
                self.assertNotEqual(self.run_build(*args).returncode, 0)
                self.assertFalse(self.calls.exists())


if __name__ == "__main__":
    unittest.main()
