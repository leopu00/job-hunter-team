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


def test_the_data_folders_are_still_kept_by_that_uninstall_and_the_other_command_deletes_them_too(tmp_path):
    """With Docker the data of a Linux computer belongs to the container (uid 1001, mode 700): the line for the data is
    `jht uninstall --confirm --purge`, which empties it through a one-shot container; a plain `rm -rf` from the user's
    account would fail on it."""
    out = final_message(tmp_path, runtime_choice="")
    assert "keeps your data in ~/.jht and ~/Documents/Job Hunter Team" in out
    assert "To also delete your data" in out
    assert "jht uninstall --confirm --purge && docker rmi example.invalid/jht@sha256:" in out
    assert "rm -rf" not in out.split("To also delete your data", 1)[1]


@pytest.mark.parametrize("runtime_choice", ["podman"])
def test_the_data_command_that_is_printed_expands_and_deletes_the_two_folders(tmp_path, runtime_choice):
    """TEST 19b: the line printed `rm -rf ~/.jht "~/Documents/Job Hunter Team"`, and a tilde inside quotes is not
    expanded. The command the person pastes must work as printed, even when HOME has a space in it."""
    out = final_message(tmp_path, runtime_choice=runtime_choice)
    line = next(l.strip() for l in out.splitlines() if l.strip().startswith("rm -rf") and ".jht" in l)
    assert line == 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'
    assert "~" not in line
    home = tmp_path / "home with space"
    (home / ".jht").mkdir(parents=True)
    (home / ".jht" / "a").write_text("x", encoding="utf-8")
    (home / "Documents" / "Job Hunter Team").mkdir(parents=True)
    (home / "Documents" / "Other").mkdir()
    done = subprocess.run(["sh", "-c", line], env={**os.environ, "HOME": str(home)}, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert not (home / ".jht").exists() and not (home / "Documents" / "Job Hunter Team").exists()
    assert (home / "Documents" / "Other").is_dir()


def test_no_printed_command_of_the_installer_carries_a_tilde_inside_quotes():
    """The regression of 19b, closed at the source: no printf of the installer builds an `rm` with a quoted tilde."""
    for path in (INSTALL, ROOT / "web" / "public" / "install.sh"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "rm -rf" in line and "printf" in line:
                assert '"~' not in line and "\\\"~" not in line and " ~/" not in line.split("rm -rf", 1)[1], (path.name, number, line)


def test_the_two_copies_of_the_installer_are_the_same_file():
    assert INSTALL.read_bytes() == (ROOT / "web" / "public" / "install.sh").read_bytes()


def test_the_uninstall_command_exists_in_the_wrapper_and_removes_volumes_by_label():
    source = WRAPPER.read_text(encoding="utf-8")
    assert "JHT_UNINSTALL_PROTOCOL=1" in source
    assert 'UNINSTALL_PROJECTS="jht host-runtime"' in source          # the project the Linux Docker compose is named after
    assert 'volume) "$docker_bin" volume rm' in source
