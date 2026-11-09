"""`jht` typed in PowerShell with the default execution policy (Restricted on a client Windows).

PowerShell finds `jht.ps1` before `jht.cmd` in the same folder and then refuses to run it, so a user who types `jht` as the
installer says gets an error, while the same word in cmd.exe works. PowerShell looks folder by folder, in PATH order, and
takes the first folder that has a match: a folder BEFORE the one with `jht.ps1` that holds only `jht.cmd` makes `jht` the
command shim in PowerShell 5.1 and 7, with the policy left as it is (the shim itself starts the wrapper with Bypass for its one
process). Windows only: it needs the real command lookup.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import WINDOWS, powershell

pytestmark = pytest.mark.skipif(not WINDOWS, reason="the command lookup of PowerShell on Windows")


def _bin(root: Path, name: str, with_script: bool) -> Path:
    folder = root / name
    folder.mkdir()
    (folder / "jht.cmd").write_text("@echo CMD-SHIM\r\n", encoding="ascii")
    if with_script:
        (folder / "jht.ps1").write_text("'PS1-WRAPPER'\r\n", encoding="ascii")
    return folder


def _type_jht(path_entries: list[Path]) -> subprocess.CompletedProcess:
    system = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    env = {**os.environ, "PATH": ";".join([*map(str, path_entries), str(system / "System32"), str(system)])}
    return subprocess.run(
        [powershell(), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Restricted", "-Command", "jht"],
        env=env, capture_output=True, text=True, timeout=60, check=False,
    )


def test_with_the_script_and_the_shim_in_one_folder_the_default_policy_blocks_jht(tmp_path):
    both = _bin(tmp_path, "both", with_script=True)
    done = _type_jht([both])
    assert "CMD-SHIM" not in done.stdout and done.returncode != 0, (done.stdout, done.stderr)


def test_a_folder_with_only_the_shim_before_the_script_makes_jht_work(tmp_path):
    both = _bin(tmp_path, "both", with_script=True)
    shim = _bin(tmp_path, "shim", with_script=False)
    done = _type_jht([shim, both])
    assert done.returncode == 0 and "CMD-SHIM" in done.stdout and "PS1-WRAPPER" not in done.stdout, (done.stdout, done.stderr)
