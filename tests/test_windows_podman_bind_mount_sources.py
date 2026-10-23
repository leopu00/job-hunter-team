"""Under Podman the compose's bind-mount sources exist before the containers are created (T83).

docker-compose.yml mounts ${HOME}/.jht and ${HOME}/Documents/Job Hunter Team. Docker creates a
missing bind-mount source by itself; Podman refuses the container instead («statfs …/Documents/Job
Hunter Team: no such file or directory»). On a new Windows user the documents folder is not there:
install.ps1 under Windows PowerShell 5.1 with the real Podman stopped at the creation of the jht
container (hand test of push 12, 23/10).

jht.ps1 prepares the compose's mounts in Repair-MountOwnership, which up, upgrade and recreate call
before compose: the function is run here as the wrapper defines it, under Podman, in an empty home,
and every ${HOME} source of the compose must be a folder afterwards.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
COMPOSE = ROOT / "docker-compose.yml"


def _shell() -> str | None:
    # The shell under test: JHT_TEST_SHELL on the Windows gate (5.1 or 7), else any PowerShell.
    name = os.environ.get("JHT_TEST_SHELL")
    if name:
        return shutil.which(name)
    return shutil.which("pwsh") or shutil.which("powershell")


def _function(text: str, name: str) -> str:
    # From its own line to the next top-level function: the wrapper defines one per block.
    match = re.search(rf"^function {re.escape(name)} \{{\n.*?(?=^function |\Z)", text, re.S | re.M)
    assert match, name
    return match.group(0)


def _home_sources() -> list[str]:
    sources = re.findall(r"^\s*- \$\{HOME\}/([^:]+):/", COMPOSE.read_text(encoding="utf-8"), re.M)
    assert ".jht" in sources and "Documents/Job Hunter Team" in sources, sources
    return sources


def _ps_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def test_the_compose_mounts_two_folders_of_the_home():
    # If the compose gains or loses a ${HOME} mount, the test below follows it.
    assert _home_sources() == [".jht", "Documents/Job Hunter Team"]


@pytest.mark.skipif(_shell() is None, reason="needs PowerShell (pwsh or powershell)")
def test_under_podman_the_mount_preparation_creates_every_home_source(tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    sources = _home_sources()
    function = _function(WRAPPER.read_text(encoding="utf-8"), "Repair-MountOwnership")
    checks = "\n".join(
        f"if (-not (Test-Path -LiteralPath (Join-Path $env:HOME {_ps_literal(s)}) -PathType Container)) "
        f"{{ [Console]::Out.WriteLine('MISSING ' + {_ps_literal(s)}) }}"
        for s in sources
    )
    script = tmp_path / "case.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "$ContainerRuntime = 'podman'\n"
        f"$env:HOME = {_ps_literal(str(home))}\n"
        f"{function}\n"
        "$ready = Repair-MountOwnership -Image 'ghcr.io/leopu00/jht:test'\n"
        "[Console]::Out.WriteLine('READY ' + $ready)\n"
        f"{checks}\n",
        encoding="utf-8-sig",
    )
    done = subprocess.run(
        [_shell(), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        capture_output=True, text=True, timeout=60, check=False,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    assert "READY True" in done.stdout, done.stdout + done.stderr
    missing = [line for line in done.stdout.splitlines() if line.startswith("MISSING ")]
    assert missing == [], (
        "under Podman nothing creates these bind-mount sources, and Podman refuses a container "
        f"whose source is missing: {missing}"
    )
