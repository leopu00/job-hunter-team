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
    assert "host_setup_skip_note" in arm


# ── what is said when it is skipped ─────────────────────────────────────────

def note(tmp_path: Path, content: str | None, *, mode: int = 0o644) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    # The type of host is the one the wrapper loaded at its start (the values file of the runtime, or host.env the first time):
    # the functions that load it run first, as they do in the wrapper.
    functions = "\n".join(re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M).group(0)
                          for name in ("jht_host_env_value_valid", "jht_read_host_env_value", "runtime_stat", "runtime_node_safe",
                                       "jht_host_values_trusted", "jht_host_values_log", "jht_a_mac_is_never_a_vps",
                                       "jht_load_host_values", "host_setup_skip_note"))
    host_env = tmp_path / "host.env"
    if content is not None:
        host_env.write_text(content, encoding="utf-8")
        host_env.chmod(mode)
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700, exist_ok=True)
    script = (f'HOST_ENV_FILE="{host_env}"\nHOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"; RUNTIME_DIR="{runtime}"; HOST_VALUES_FILE="{runtime}/host-values"\n'
              f'info() {{ echo "INFO: $*"; }}\nwarn() {{ echo "WARN: $*"; }}\n{functions}\njht_load_host_values\nhost_setup_skip_note')
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30).stdout


def test_it_says_the_preflight_is_done_when_host_env_says_the_type_of_host(tmp_path):
    out = note(tmp_path, "JHT_LANG=en\nJHT_HOST_TYPE=local\n")
    assert out.startswith("INFO:") and "gia' fatto" in out and "uid 1001" in out


@pytest.mark.parametrize("content", [None, "JHT_LANG=en\n", "JHT_HOST_TYPE=server\n", ""])
def test_it_does_not_say_done_when_host_env_is_missing_has_no_type_or_a_bad_one(tmp_path, content):
    out = note(tmp_path, content)
    assert out.startswith("WARN:") and "gia' fatto" not in out
    assert "non si legge o non dice il tipo di host" in out and "'unknown'" in out and "uid 1001" in out


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads any file: the case is a normal user")
def test_it_does_not_say_done_when_host_env_cannot_be_read(tmp_path):
    out = note(tmp_path, "JHT_HOST_TYPE=local\n", mode=0o000)
    assert out.startswith("WARN:") and "gia' fatto" not in out
