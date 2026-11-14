"""At a real terminal (JHT_MACHINE_OUTPUT unset) a refusal or a warning is the sentence alone: no `code: ` in front of it, no marker.

The code is asked inside $( ), where stdout is the substitution's pipe: the installer and the wrapper keep what stdout was when they
started. Giro Mac 12 (package 38): «✗ team_running: …», «warn: config_changed_stopped: …» at a terminal.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

pty = pytest.importorskip("pty")

from test_desktop_chat_wrapper import _stale_stopped  # noqa: E402
from test_podman_compose_exact_version_boundary import _run_in_terminal  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"


def _plain(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)


def test_up_after_an_update_at_a_terminal_says_the_warning_without_its_code(tmp_path: Path):
    wrapper, env, _ = _stale_stopped(tmp_path)
    env.pop("JHT_MACHINE_OUTPUT", None)
    env["JHT_TEST_DOWN_NOISE"] = "1"
    code, out = _run_in_terminal(wrapper, env, "up")
    plain = _plain(out)
    assert code == 0, plain
    assert "i container del team, fermi, sono della versione di prima" in plain
    assert "config_changed_stopped" not in plain and "no container with" not in plain and "jht_default" not in plain


def test_the_installer_at_a_terminal_refuses_with_the_sentence_alone(tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (bin_dir / "podman").write_text("#!/bin/sh\nprintf 'jht\\n'\n", encoding="utf-8")
    (bin_dir / "podman").chmod(0o755)
    home = tmp_path / "home"
    home.mkdir()
    script = tmp_path / "case.sh"
    script.write_text(
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS=linux\nRUNTIME_CHOICE=podman\nDOCKER_CLI=docker\nDRY_RUN=0\nrefuse_running_team\n',
        encoding="utf-8")
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(home), "JHT_RUNTIME_DIR": str(runtime), "LANG": "it_IT.UTF-8"}
    master, slave = pty.openpty()
    try:
        process = subprocess.Popen(["bash", str(script)], env=env, stdout=slave, stderr=slave, stdin=subprocess.DEVNULL)
        os.close(slave)
        chunks = []
        while True:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        process.wait(timeout=30)
    finally:
        os.close(master)
    plain = _plain(b"".join(chunks).decode("utf-8", "replace"))
    assert process.returncode == 84, plain
    assert "Job Hunter Team e' acceso su questo computer (jht)" in plain
    assert "team_running" not in plain and "JHT_ERROR" not in plain
