"""Real stat contracts; the GNU fast path requires an actual Linux host."""
import os
import platform
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import podman_machine_fixture as fixture


@unittest.skipUnless(os.name == "posix", "The stat adapter is a POSIX host fixture")
class StatAdapterSemantics(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="jht-stat-semantics-")
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.home = self.root / "home"
        self.home.mkdir(mode=0o700)
        (self.bin / "python3").symlink_to(sys.executable)
        self.env = {"PATH": f"{self.bin}:/usr/bin:/bin", "LC_ALL": "C",
                    "HOME": str(self.home), "JHT_HOME": str(self.home / ".jht"),
                    "PYTHONNOUSERSITE": "1"}

    def tearDown(self):
        self.temporary.cleanup()

    def run_stat(self, *args, env=None):
        return subprocess.run([str(self.bin / "stat"), *map(str, args)], cwd=self.root,
                              env=self.env if env is None else env,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)

    def assert_uid_mode(self, path, env=None):
        metadata = os.lstat(self.root / path)
        expected = f"{metadata.st_uid} {metadata.st_mode & 0o777:o}\n"
        for style, format_ in (("-f", "%u %Lp"), ("-c", "%u %a")):
            with self.subTest(path=str(path), style=style):
                result = self.run_stat(style, format_, path, env=env)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, expected, ""))

    def assert_identity(self, path):
        metadata = os.lstat(self.root / path)
        expected = (f"{metadata.st_size} {int(metadata.st_mtime)} "
                    f"{metadata.st_ino} {int(metadata.st_ctime)}\n")
        result = self.run_stat("-f", "%z %m %i %c", path)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, expected, ""))

    def assert_unknown_and_missing(self):
        args = ["--definitely-unknown-adapter-option", "missing path"]
        native = subprocess.run(["stat", *args], executable="/usr/bin/stat", env=self.env,
                                cwd=self.root, text=True, capture_output=True, timeout=10)
        adapted = self.run_stat(*args)
        self.assertEqual((adapted.returncode, adapted.stdout, adapted.stderr),
                         (native.returncode, native.stdout, native.stderr))
        for style, format_ in (("-f", "%u %Lp"), ("-c", "%u %a"), ("-f", "%z %m %i %c")):
            missing = self.run_stat(style, format_, "missing path")
            self.assertNotEqual(missing.returncode, 0)
            self.assertEqual(missing.stdout, "")
            self.assertIn("FileNotFoundError", missing.stderr)

    def test_python_contract_preserves_identity_errors_and_host_override(self):
        # A Darwin actual host emulating GNU keeps the original Python behavior,
        # even when the fixture's host_kernel override asks for different tools.
        with mock.patch.object(fixture.platform, "system", return_value="Darwin"):
            fixture.write_linux_host_tools(self.bin, host_kernel="Darwin")
        path = self.root / " - spaced file "
        path.write_bytes(b"synthetic")
        path.chmod(0o4751)
        os.utime(path, ns=(-1_250_000_000, -250_000_000))
        self.assertLess(os.lstat(path).st_mtime, 0)
        self.assertGreater(os.lstat(path).st_mtime, -1)
        self.assert_uid_mode(path.name)
        self.assert_identity(path.name)
        link = self.root / "link with spaces"
        link.symlink_to(path.name)
        self.assert_uid_mode(link.name)
        self.assert_identity(link.name)
        path.write_bytes(b"longer replacement at the same path")
        path.chmod(0o2640)
        self.assert_uid_mode(path.name)
        self.assert_identity(path.name)
        self.assert_unknown_and_missing()

    @unittest.skipUnless(platform.system() == "Linux", "Real GNU stat semantics require Linux")
    def test_native_linux_uid_modes_symlinks_and_mutations_match_lstat(self):
        fixture.write_macos_host_tools(self.bin)
        # No Python is available here: these probes must be served by native stat.
        native_env = {**self.env, "PATH": "/nonexistent"}
        for name in (" spaced file ", "-leading-dash", "line\nbreak", "-"):
            path = self.root / name
            path.write_bytes(b"synthetic")
            for mode in (0o000, 0o640, 0o4751, 0o2750, 0o1777):
                path.chmod(mode)
                self.assert_uid_mode(name, env=native_env)
            path.write_bytes(b"mutated data at the same path")
            path.chmod(0o600)
            self.assert_uid_mode(name, env=native_env)
        (self.root / "-").unlink()
        for style, format_ in (("-f", "%u %Lp"), ("-c", "%u %a")):
            missing = self.run_stat(style, format_, "-")
            self.assertNotEqual(missing.returncode, 0)
            self.assertEqual(missing.stdout, "")
            self.assertIn("FileNotFoundError", missing.stderr)
        target = self.root / "target"
        target.write_bytes(b"target")
        target.chmod(0o000)
        link = self.root / "- link "
        link.symlink_to(target.name)
        self.assert_uid_mode(link.name, env=native_env)
        self.assert_identity(link.name)
        target.unlink()
        self.assert_uid_mode(link.name, env=native_env)
        self.assert_identity(link.name)
        os.utime(self.root / "-leading-dash", ns=(-1_250_000_000, -250_000_000))
        self.assert_identity("-leading-dash")
        self.assert_unknown_and_missing()

    def test_native_failure_uses_python_without_leaking_output(self):
        native = self.root / "failing native stat"
        calls = self.root / "native calls"
        native.write_text("#!/bin/sh\nprintf 'called\\n' >> " + shlex.quote(str(calls))
                          + "\nprintf 'native noise\\n'\nprintf 'native error\\n' >&2\nexit 7\n")
        native.chmod(0o700)
        with mock.patch.object(fixture.platform, "system", return_value="Linux"), \
                mock.patch.object(fixture, "_NATIVE_STAT", str(native)):
            fixture.write_macos_host_tools(self.bin, host_kernel="Linux")
        path = self.root / "- fallback path "
        path.write_bytes(b"synthetic fallback")
        path.chmod(0o6750)
        os.utime(path, ns=(-1_250_000_000, -250_000_000))
        self.assert_uid_mode(path.name)
        self.assertEqual(calls.read_text().splitlines(), ["called", "called"])
        before = calls.read_bytes()
        self.assert_identity(path.name)
        unknown = ["--definitely-unknown-adapter-option", path.name]
        expected = subprocess.run(["stat", *unknown], executable="/usr/bin/stat", cwd=self.root,
                                  env=self.env, text=True, capture_output=True, timeout=10)
        actual = self.run_stat(*unknown)
        self.assertEqual((actual.returncode, actual.stdout, actual.stderr),
                         (expected.returncode, expected.stdout, expected.stderr))
        self.assertEqual(calls.read_bytes(), before)
        self.assert_unknown_and_missing()


if __name__ == "__main__":
    unittest.main(verbosity=2)
