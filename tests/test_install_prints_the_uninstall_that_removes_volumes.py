"""TEST 19i, A2: the uninstall the installer prints left the ten host-runtime_jht-* volumes (broker, secrets, deps…): it now prints
`jht uninstall --confirm`, which removes the project's containers, networks and volumes, the runtime, the PATH lines and itself."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


# ── A2 ──────────────────────────────────────────────────────────────────────

def final_message(tmp_path: Path, *, runtime_choice: str) -> str:
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
        f'USE_DOCKER=1; RUNTIME_CHOICE="{runtime_choice}"; OS=linux; BIN_DIR="{tmp_path}/bin"; '
        f'RUNTIME_DIR="{tmp_path}/host-runtime"; IMAGE="example.invalid/jht@sha256:{"1" * 64}"\n'
        "final_message\n"
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
                          env={**os.environ, "HOME": str(tmp_path), "NO_COLOR": "1"})
    assert done.returncode == 0, done.stderr
    return re.sub(r"\x1b\[[0-9;]*m", "", done.stdout)


def test_the_docker_uninstall_the_installer_prints_removes_the_volumes_too(tmp_path):
    out = final_message(tmp_path, runtime_choice="")
    assert "jht uninstall --confirm && docker rmi example.invalid/jht@sha256:" in out
    assert "jht down &&" not in out and "rm -rf " + str(tmp_path / "host-runtime") not in out
    assert "mail password and the Telegram tokens" in out


def test_the_data_folders_are_still_kept_by_that_uninstall_and_listed_for_the_other_command(tmp_path):
    out = final_message(tmp_path, runtime_choice="")
    assert "keeps your data in ~/.jht and ~/Documents/Job Hunter Team" in out
    assert f'rm -rf {tmp_path}/.jht "{tmp_path}/Documents/Job Hunter Team"' in out


def test_the_uninstall_command_exists_in_the_wrapper_and_removes_volumes_by_label():
    source = WRAPPER.read_text(encoding="utf-8")
    assert "JHT_UNINSTALL_PROTOCOL=1" in source
    assert 'UNINSTALL_PROJECTS="jht host-runtime"' in source          # the project the Linux Docker compose is named after
    assert 'volume) "$docker_bin" volume rm' in source
