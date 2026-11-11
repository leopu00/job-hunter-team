"""TEST 19i, A2: the uninstall the installer prints left the ten host-runtime_jht-* volumes (broker, secrets, deps…): it now prints
`jht uninstall --confirm`, which removes the project's containers, networks and volumes, the runtime, the PATH lines and itself.
With a container engine that is the only thing printed, with `--purge` for the data: no `docker rmi`, no `podman rmi`, no
`rm -rf` and no `sudo` for the person to type (install.ps1 says the same)."""

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

def raw_final_message(tmp_path: Path, *, runtime_choice: str, os_name: str = "linux", use_docker: int = 1,
                      colours: bool = False) -> str:
    """The message as the terminal gets it. `colours` sets the variables the way the installer sets them when stdout is a
    terminal (the single-quoted backslash sequences), which a piped test run never does."""
    palette = "DIM='\\033[2m'; RESET='\\033[0m'; BOLD='\\033[1m'\n" if colours else ""
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n{palette}'
        f'USE_DOCKER={use_docker}; RUNTIME_CHOICE="{runtime_choice}"; OS={os_name}; BIN_DIR="{tmp_path}/bin"; '
        f'RUNTIME_DIR="{tmp_path}/host-runtime"; IMAGE="example.invalid/jht@sha256:{"1" * 64}"\n'
        "final_message\n"
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
                          env={**os.environ, "HOME": str(tmp_path), "NO_COLOR": "1"})
    assert done.returncode == 0, done.stderr
    return done.stdout


def final_message(tmp_path: Path, *, runtime_choice: str, os_name: str = "linux", use_docker: int = 1) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", raw_final_message(tmp_path, runtime_choice=runtime_choice, os_name=os_name,
                                                              use_docker=use_docker))



ENGINES = [("", "linux"), ("", "macos"), ("podman", "linux"), ("podman", "macos")]


def test_the_docker_uninstall_the_installer_prints_removes_the_volumes_too(tmp_path):
    out = final_message(tmp_path, runtime_choice="")
    assert "jht uninstall --confirm\n" in out
    assert "jht down &&" not in out and "rm -rf " + str(tmp_path / "host-runtime") not in out
    assert "mail password and the Telegram tokens" in out


def data_section(out: str) -> str:
    return out.split("To also delete your data", 1)[1]


def test_the_data_folders_are_kept_by_that_uninstall_and_the_purge_command_deletes_them_too(tmp_path):
    """With Docker the data of a Linux computer belongs to the container (uid 1001, mode 700): the line for the data is
    `jht uninstall --confirm --purge`, which empties it through a one-shot container; a plain `rm -rf` from the user's
    account would fail on it, and the message does not ask for a `sudo` either."""
    out = final_message(tmp_path, runtime_choice="")
    assert "keeps your data in ~/.jht and ~/Documents/Job Hunter Team" in out
    assert "To also delete your data" in out
    section = [l.strip() for l in data_section(out).splitlines() if l.strip()]
    assert section[1] == "jht uninstall --confirm --purge"          # section[0] is the end of the heading line
    assert "empties ~/.jht and ~/Documents/Job Hunter Team" in section[2]


@pytest.mark.parametrize("runtime_choice,os_name", ENGINES)
def test_a_container_engine_prints_only_the_two_jht_uninstall_commands_and_no_rmi_rm_or_sudo(tmp_path, runtime_choice, os_name):
    out = final_message(tmp_path, runtime_choice=runtime_choice, os_name=os_name)
    commands = [l.strip() for l in out.splitlines() if l.strip().startswith("jht uninstall")]
    assert commands == ["jht uninstall --confirm", "jht uninstall --confirm --purge"], out
    for word in ("rmi", "rm -rf", "sudo", "jht down", "example.invalid/jht@sha256:"):
        assert word not in out, (word, out)


def test_the_native_mode_keeps_the_plain_rm_because_jht_has_no_uninstall_there_and_the_folders_are_the_persons(tmp_path):
    out = final_message(tmp_path, runtime_choice="", use_docker=0)
    section = data_section(out)
    assert "jht uninstall" not in section and "sudo" not in section
    assert 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"' in section


def test_the_rm_command_that_is_printed_in_native_mode_expands_and_deletes_the_two_folders(tmp_path):
    """TEST 19b: the line printed `rm -rf ~/.jht "~/Documents/Job Hunter Team"`, and a tilde inside quotes is not
    expanded. The command the person pastes must work as printed, even when HOME has a space in it."""
    out = final_message(tmp_path, runtime_choice="", use_docker=0)
    line = next(l.strip() for l in out.splitlines() if "rm -rf" in l and '"$HOME/.jht"' in l)
    assert line == 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'
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


@pytest.mark.parametrize("runtime_choice,use_docker,command", [
    ("podman", 1, "jht uninstall --confirm --purge"),
    ("", 1, "jht uninstall --confirm --purge"),
    ("", 0, 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'),
])
def test_with_colours_the_data_line_has_real_escapes_not_the_printed_backslash_sequence(tmp_path, runtime_choice, use_docker, command):
    """TEST ritest Linux B3: with colours a line came out as `\\033[2m  <command>\\033[0m` in plain text, and a copy of it started
    with a word that is not a command. The text of the line must start at the command, whatever the colours."""
    out = raw_final_message(tmp_path, runtime_choice=runtime_choice, use_docker=use_docker, colours=True)
    assert "\\033" not in out and "[2m" not in out.replace("\x1b[2m", "") and "[0m" not in out.replace("\x1b[0m", "")
    line = next(l for l in out.splitlines() if re.sub(r"\x1b\[[0-9;]*m", "", l).strip() == command)
    assert "\x1b[2m" in line and line.rstrip().endswith("\x1b[0m"), "the colour is a real escape"
