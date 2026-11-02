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


def test_the_docker_uninstall_the_installer_prints_removes_the_volumes_too(tmp_path):
    out = final_message(tmp_path, runtime_choice="")
    assert "jht uninstall --confirm && docker rmi example.invalid/jht@sha256:" in out
    assert "jht down &&" not in out and "rm -rf " + str(tmp_path / "host-runtime") not in out
    assert "mail password and the Telegram tokens" in out


def data_section(out: str) -> str:
    return out.split("To also delete your data", 1)[1]


def test_the_data_folders_are_still_kept_by_that_uninstall_and_the_other_command_deletes_them_too(tmp_path):
    """With Docker the data of a Linux computer belongs to the container (uid 1001, mode 700): the line for the data is
    `jht uninstall --confirm --purge`, which empties it through a one-shot container; a plain `rm -rf` from the user's
    account would fail on it."""
    out = final_message(tmp_path, runtime_choice="")
    assert "keeps your data in ~/.jht and ~/Documents/Job Hunter Team" in out
    assert "To also delete your data" in out
    assert "jht uninstall --confirm --purge && docker rmi example.invalid/jht@sha256:" in out


@pytest.mark.parametrize("runtime_choice,os_name,rmi", [
    ("", "linux", "docker rmi"),
    ("", "macos", "docker rmi"),
    ("podman", "linux", "podman rmi"),
    ("podman", "macos", None),
])
def test_every_engine_prints_the_purge_first_and_the_rm_only_as_the_last_line_with_sudo(tmp_path, runtime_choice, os_name, rmi):
    """Linux gate: the `rm -rf ~/.jht ...` printed for Podman got "Permission denied" (folders 1001:1001, mode 700). The command
    printed first, for Docker and for Podman alike, is `jht uninstall --confirm --purge`; the `rm -rf` is the last line, only
    for when jht is gone, and declares its sudo."""
    out = final_message(tmp_path, runtime_choice=runtime_choice, os_name=os_name)
    lines = [l.strip() for l in data_section(out).splitlines() if l.strip()]
    commands = [l for l in lines if "rm -rf" in l or "jht uninstall" in l]
    assert commands[0].startswith("jht uninstall --confirm --purge")
    if rmi:
        assert commands[0].endswith(f"{rmi} example.invalid/jht@sha256:{'1' * 64}")
    else:
        assert commands[0] == "jht uninstall --confirm --purge"
    assert len(commands) == 2
    assert commands[1] == 'sudo rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'
    assert lines.index(commands[1]) == len(lines) - 1          # the last line of the message
    assert "jht down" not in data_section(out)


def test_the_native_mode_keeps_the_plain_rm_because_jht_has_no_uninstall_there_and_the_folders_are_the_persons(tmp_path):
    out = final_message(tmp_path, runtime_choice="", use_docker=0)
    section = data_section(out)
    assert "jht uninstall" not in section and "sudo" not in section
    assert 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"' in section


@pytest.mark.parametrize("runtime_choice,use_docker", [("podman", 1), ("", 0)])
def test_the_rm_command_that_is_printed_expands_and_deletes_the_two_folders(tmp_path, runtime_choice, use_docker):
    """TEST 19b: the line printed `rm -rf ~/.jht "~/Documents/Job Hunter Team"`, and a tilde inside quotes is not
    expanded. The command the person pastes must work as printed, even when HOME has a space in it (the `sudo` of the
    container case is not run here: without it the same words delete the two folders of an account that owns them)."""
    out = final_message(tmp_path, runtime_choice=runtime_choice, use_docker=use_docker)
    line = next(l.strip() for l in out.splitlines() if "rm -rf" in l and '"$HOME/.jht"' in l)
    assert line in ('rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"',
                    'sudo rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"')
    assert "~" not in line
    line = line.removeprefix("sudo ")
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


@pytest.mark.parametrize("runtime_choice,use_docker,rm_line", [
    ("podman", 1, 'sudo rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'),
    ("", 1, 'sudo rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'),
    ("", 0, 'rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"'),
])
def test_with_colours_the_fallback_line_has_real_escapes_not_the_printed_backslash_sequence(tmp_path, runtime_choice, use_docker, rm_line):
    """TEST ritest Linux B3: with colours the last-resort line came out as `\\033[2m  sudo rm -rf ...\\033[0m` in plain text, and a
    copy of it started with a word that is not a command. The text of the line must start at the command, whatever the colours."""
    out = raw_final_message(tmp_path, runtime_choice=runtime_choice, use_docker=use_docker, colours=True)
    assert "\\033" not in out and "[2m" not in out.replace("\x1b[2m", "") and "[0m" not in out.replace("\x1b[0m", "")
    line = next(l for l in out.splitlines() if "rm -rf" in l and '"$HOME/.jht"' in l)
    assert "\x1b[2m" in line and line.rstrip().endswith("\x1b[0m"), "the colour is a real escape"
    assert re.sub(r"\x1b\[[0-9;]*m", "", line).strip() == rm_line
