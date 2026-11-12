"""A PowerShell script that runs `jht doctor 2>&1 | ...` goes on after it.

`jht` from PowerShell is jht.ps1, run in the caller's own process. jht.ps1 sets $ErrorActionPreference = 'Stop' and hands most
commands to the container with `docker exec`; the container's CLI writes its notes on stderr. When the caller merges the streams
(`2>&1`, `*>&1`), Windows PowerShell 5.1 turns each stderr line into an error record, and under 'Stop' the first one ended jht.ps1
and, with it, the caller's script (seen on Windows 10 with `jht doctor`: no line after it ran). Every `docker exec` of the wrapper
now runs with 'Continue'; the exit code is still the container's.

The wrapping is read from the real jht-wrapper.ps1; a stand-in docker writes a note on stderr and leaves with 1.
"""
from __future__ import annotations

import re

import pytest

from test_windows_podman_wsl_branches import WRAPPER, _fake, _run

WRAP = "& { $ErrorActionPreference = 'Continue'; & docker exec @ExecFlags"


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _source() -> str:
    return WRAPPER.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_every_docker_exec_of_the_wrapper_runs_with_continue():
    source = _source()
    code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
    plain = [line.strip() for line in code.splitlines() if "& docker exec @ExecFlags" in line and WRAP not in line]
    assert plain == [], plain
    assert code.count(WRAP) >= 11
    assert "$ErrorActionPreference = 'Stop'" in source, "the rest of the wrapper keeps stopping on its own errors"


BODY = r"""
$ErrorActionPreference = 'Continue'
$child = Join-Path $env:HOME 'child.ps1'
$wrap = $env:WRAP_LINE
Set-Content -LiteralPath $child -Encoding UTF8 -Value @(
  "`$ErrorActionPreference = 'Stop'",
  "`$ExecFlags = @('-i')",
  ($wrap + ' jht node cli doctor }'),
  'exit $LASTEXITCODE'
)
& { & $child } 2>&1 | ForEach-Object { [Console]::Out.WriteLine('LINE ' + [string]$_) }
[Console]::Out.WriteLine('AFTER ' + $LASTEXITCODE)
"""


def test_a_caller_that_merges_the_streams_sees_the_note_and_goes_on(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", '''  "exec -i jht node cli doctor") echo 'Check 7 ok, 1 problem: No configuration yet' >&2; exit 1 ;;''')
    result, calls = _run(tmp_path, WRAPPER, [], BODY, {"WRAP_LINE": WRAP})
    out = result.stdout.replace("\r\n", "\n")
    assert result.returncode == 0, out + result.stderr
    assert calls == ["exec -i jht node cli doctor"]
    assert re.search(r"^LINE .*1 problem: No configuration yet", out, re.M), out
    assert re.search(r"^AFTER 1$", out, re.M), "the caller goes on and reads the container's exit code"
