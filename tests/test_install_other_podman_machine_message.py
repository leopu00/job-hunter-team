"""install.sh with another Podman machine of the person running: exit 79, the machine named, and the line that says what to do.

Measured on a Mac (package 29): the installer printed «JHT_OTHER_MACHINE <name>», then «install.sh: line 881: err: command not
found» — the installer has no err() (the wrapper does), so the line that says how to stop the other machine never appeared. These
tests run that branch of the real install.sh, in Italian and in English, with a fake podman that lists the machines.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1] / "scripts" / "install.sh"
CONFLICT = "Error: unable to start \"jht-podman\": only one VM can be active at a time"


def _conflict(tmp_path: Path, machines: str, lang: str, error: str = CONFLICT):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    podman = bin_dir / "podman"
    podman.write_text(f"#!/bin/sh\n[ \"$1 $2\" = 'machine list' ] && printf '%b' '{machines}'\nexit 0\n", encoding="utf-8")
    podman.chmod(0o755)
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return subprocess.run(
        ["bash", "-c", f'. "{INSTALLER}"; if report_podman_machine_conflict "{podman}" "$CASE_ERROR"; then echo rc=0; else echo "rc=$?"; fi'],
        env={"HOME": str(home), "PATH": "/usr/bin:/bin", "LANG": lang, "JHT_INSTALLER_SOURCE_ONLY": "1", "CASE_ERROR": error},
        capture_output=True, text=True, timeout=20)


@pytest.mark.parametrize("lang,words", [
    ("it_IT.UTF-8", ["un'altra macchina Podman, personal-work, e' accesa", "rilancia l'installer", "non la spegne mai"]),
    ("en_US.UTF-8", ["another Podman machine, personal-work, is running", "run the installer again", "never stops it for you"]),
])
def test_the_other_machine_is_named_with_the_command_that_stops_it(tmp_path: Path, lang: str, words: list[str]):
    result = _conflict(tmp_path, "jht-podman false\\npersonal-work true\\n", lang)
    assert "command not found" not in result.stderr, result.stderr
    assert result.stdout == "JHT_OTHER_MACHINE personal-work\nrc=0\n"
    line = result.stderr.strip()
    assert line.count("\n") == 0 and "podman_other_machine_running: " in line
    assert "'podman machine stop personal-work'" in line
    assert "'podman machine stop" in line
    for word in words:
        assert word in line


@pytest.mark.parametrize("lang,stop", [("it_IT.UTF-8", "podman machine stop <nome>"), ("en_US.UTF-8", "podman machine stop <name>")])
def test_an_unnamed_machine_says_how_to_find_it(tmp_path: Path, lang: str, stop: str):
    result = _conflict(tmp_path, "jht-podman false\\nbad;name true\\n", lang)
    assert "command not found" not in result.stderr, result.stderr
    assert result.stdout == "rc=0\n"
    assert "podman machine list" in result.stderr and stop in result.stderr


def test_another_error_is_not_a_conflict(tmp_path: Path):
    result = _conflict(tmp_path, "personal-work true\\n", "en_US.UTF-8", error="Error: something else")
    assert result.stdout == "rc=1\n" and result.stderr == ""


def test_both_places_that_meet_the_conflict_exit_79():
    text = INSTALLER.read_text(encoding="utf-8")
    assert text.count('report_podman_machine_conflict "$podman_bin" "$start_error" && exit 79') == 1
    assert text.count('report_podman_machine_conflict "$podman_bin" "$init_error" && exit 79') == 1
