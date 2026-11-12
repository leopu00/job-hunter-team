"""At the start of the Podman machine the team's unit waits for the rootless Podman API before it starts jht.

jht-rootless-podman.service is Type=simple: systemd calls it started when it forks, about a second before `podman system service`
listens on its socket. jht-container.service ran in that second, `podman --remote start jht` found no socket (exit 125, measured
in the journal of a Windows 10 machine) and the team stayed down after every start of the machine. Its ExecStartPre now asks the
API until it answers, at most 60 times a second apart, and fails the unit with a sentence if it never does.

The shell of ExecStartPre is read from the real unit in enable-podman-windows-runtime.ps1 and run with a stand-in podman.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the unit's shell runs in the Linux machine")


def _unit() -> str:
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    return re.search(r"\$containerUnit = @'\n(.*?)\n'@", source, re.S).group(1)


def _pre_shell() -> str:
    line = next(line for line in _unit().splitlines() if line.startswith("ExecStartPre="))
    command = re.fullmatch(r"ExecStartPre=/bin/sh -c '(.*)'", line).group(1)
    return command.replace("$$", "$")  # systemd turns $$ into $


def _wait(tmp_path, answers_after: int):
    fake = tmp_path / "podman"
    count = tmp_path / "count"
    fake.write_text(
        "#!/bin/sh\n"
        f'n=$(cat "{count}" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "{count}"\n'
        f'[ "$*" = "--remote --url unix:///run/user/1000/podman/podman.sock info" ] || exit 97\n'
        f'[ "$n" -gt {answers_after} ]\n',
        encoding="utf-8",
    )
    fake.chmod(0o755)
    shell = _pre_shell().replace("/usr/bin/podman", str(fake)).replace("sleep 1", "sleep 0")
    done = subprocess.run(["/bin/sh", "-c", shell], capture_output=True, text=True, timeout=60)
    return done, int(count.read_text())


def test_the_unit_waits_before_it_starts_jht_and_has_the_time_for_it():
    unit = _unit()
    assert unit.index("ExecStartPre=") < unit.index("ExecStart=/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock start")
    timeout = int(re.search(r"^TimeoutStartSec=(\d+)$", unit, re.M).group(1))
    assert timeout >= 60 + 90, "the wait, then the start and the Telegram step as before"
    assert "After=jht-rootless-podman.service" in unit and "Requires=jht-rootless-podman.service" in unit


def test_an_api_that_answers_at_once_is_asked_once(tmp_path):
    done, asked = _wait(tmp_path, answers_after=0)
    assert done.returncode == 0 and asked == 1, done.stderr


def test_an_api_that_is_still_coming_up_is_waited_for(tmp_path):
    # the journal: the unit asked one second before the socket existed
    done, asked = _wait(tmp_path, answers_after=3)
    assert done.returncode == 0 and asked == 4, done.stderr


def test_an_api_that_never_answers_fails_the_unit_with_a_sentence_after_60_tries(tmp_path):
    done, asked = _wait(tmp_path, answers_after=10_000)
    assert done.returncode == 1 and asked == 60
    assert "the rootless Podman API did not answer in 60 seconds" in done.stderr
