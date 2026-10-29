"""TEST 19i, A3: `jht setup` ran host-setup.sh as uid 1000 over a ~/.jht that belongs to the container's uid 1001, mode 700, and it died on
«host.env: Permission denied»: it is skipped when this user cannot write there."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


# ── A3 ──────────────────────────────────────────────────────────────────────

def can_write(tmp_path: Path, *, folder_mode: int | None, file_mode: int | None = None) -> int:
    home = tmp_path / "home"
    folder = home / ".jht"
    if folder_mode is not None:
        folder.mkdir(parents=True)
        if file_mode is not None:
            (folder / "host.env").write_text("JHT_LANG=en\n", encoding="utf-8")
            (folder / "host.env").chmod(file_mode)
        folder.chmod(folder_mode)
    body = re.search(r"^host_setup_can_write\(\) \{\n.*?^\}\n", WRAPPER.read_text(encoding="utf-8"), re.S | re.M).group(0)
    try:
        return subprocess.run(["bash", "-c", f'HOST_ENV_FILE="{folder}/host.env"\n{body}\nhost_setup_can_write'],
                              capture_output=True, text=True, timeout=30).returncode
    finally:
        if folder.exists():
            folder.chmod(0o700)


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere: the case is a normal user")
def test_a_folder_this_user_cannot_write_skips_host_setup(tmp_path):
    assert can_write(tmp_path, folder_mode=0o500, file_mode=0o400) == 1       # what the container's uid owns looks like this to uid 1000


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere: the case is a normal user")
def test_a_writable_folder_with_a_file_this_user_cannot_write_skips_it_too(tmp_path):
    assert can_write(tmp_path, folder_mode=0o700, file_mode=0o400) == 1


def test_a_writable_folder_runs_host_setup(tmp_path):
    assert can_write(tmp_path, folder_mode=0o700, file_mode=0o600) == 0
    assert can_write(tmp_path / "second", folder_mode=0o700) == 0            # no host.env yet


def test_a_missing_folder_runs_host_setup_it_makes_the_folder(tmp_path):
    assert can_write(tmp_path, folder_mode=None) == 0


def test_the_setup_command_skips_it_only_through_that_check_and_says_why():
    source = WRAPPER.read_text(encoding="utf-8")
    arm = source[source.index("  setup)\n"):]
    arm = arm[:arm.index("    ensure_up")]
    assert 'host_setup_can_write' in arm and 'bash "$HOST_SETUP_SCRIPT"' in arm
    assert arm.index("host_setup_can_write") < arm.index('bash "$HOST_SETUP_SCRIPT"')
    assert "uid 1001" in arm and "lo salto" in arm
