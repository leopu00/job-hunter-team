"""The code in front of an error or a warning of the wrappers («podman_rootless_unavailable: …») is for the desktop app.

The app reads the wrapper through a pipe and keeps the line as the cause; a person at a terminal read «error: compose_up_failed:
podman-compose up e' uscito con 1…», a word that means nothing to them. err/warn (sh) and Write-Err/Write-Warn (ps1) now leave the
code out when a person reads (JHT_MACHINE_OUTPUT=0, or stdout a terminal when the wrapper started) and keep it for the app
(JHT_MACHINE_OUTPUT=1, or a pipe). A code is lower case, digits and _ with at least one _: «uso: jht …» and «reset: …» stay.
The exit codes do not change. The functions are taken from the real scripts.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")


def _sh_function(name: str) -> str:
    match = re.search(rf"^{name}\(\) *\{{\n.*?^\}}\n", SH, re.S | re.M)
    assert match, name
    return match.group(0)


LINES = ["compose_up_failed: podman-compose up e' uscito con 1.", "uso: jht apply request|cancel <id>",
         "reset: ricerca del volume x non riuscita.", "Bad_Code: stays", "plain sentence"]


@pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")
@pytest.mark.parametrize("machine,start,with_code", [("1", "terminal", True), ("0", "pipe", False), ("", "terminal", False), ("", "pipe", True)])
def test_sh_err_and_warn(machine, start, with_code):
    script = "RED='' YELLOW='' RESET=''\n" + _sh_function("err") + _sh_function("warn")
    script += "".join(f"err {subprocess.list2cmdline([line])}\nwarn {subprocess.list2cmdline([line])}\n" for line in LINES)
    env = {"PATH": "/usr/bin:/bin", "JHT_STDOUT_AT_START": start, **({"JHT_MACHINE_OUTPUT": machine} if machine else {})}
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)
    lines = done.stderr.splitlines()
    first = "error: compose_up_failed: podman-compose up e' uscito con 1." if with_code else "error: podman-compose up e' uscito con 1."
    assert lines[0] == first, lines
    assert lines[1] == "warn:  " + first[len("error: "):], lines
    for line in LINES[1:]:
        assert f"error: {line}" in lines and f"warn:  {line}" in lines, (line, lines)


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if not found:
        pytest.skip("pwsh not installed")
    return found


def _ps_function(name: str) -> str:
    start = PS1.index(f"function {name} {{")
    return PS1[start:PS1.index("\n}\n", start) + 3]


@pytest.mark.parametrize("machine,with_code", [("1", True), ("0", False)])
def test_ps1_write_err_and_write_warn(machine, with_code):
    script = _ps_function("Write-Err") + _ps_function("Write-Warn")
    script += "".join(f"Write-Err '{line.replace(chr(39), chr(39) * 2)}'\nWrite-Warn '{line.replace(chr(39), chr(39) * 2)}'\n" for line in LINES)
    env = {**os.environ, "JHT_MACHINE_OUTPUT": machine}
    done = subprocess.run([_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, env=env, timeout=60)
    lines = done.stdout.splitlines()
    first = "compose_up_failed: podman-compose up e' uscito con 1." if with_code else "podman-compose up e' uscito con 1."
    assert lines[0] == "error: " + first and lines[1] == "warn:  " + first, lines
    for line in LINES[1:]:
        assert f"error: {line}" in lines, (line, lines)
