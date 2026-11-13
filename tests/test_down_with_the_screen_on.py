"""`jht down` with the live screen on: the tools' containers go first, so the team stops for good, with no raw line.

Measured on a Mac with Podman (package 27, 3 times out of 3): with jht-screen running, podman-compose's down printed «cannot remove
container … as it is running», «jht_default has associated containers», and the team's container came back up a few seconds later
(«Il team non si è fermato… Rilancia 'jht down'», rc 1). With `jht screen off` first it was clean. Now `jht down` stops and removes
the tools' containers (screen, media, sign-in) first, each by the id the attestation gives; nothing unattested is touched.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from test_podman_compose_exact_version_boundary import WRAPPER, _wrapper_functions

SCREEN_ID = "b" * 64


def _tools_first(tmp_path: Path, *, listed: str, attested: str, attest_rc: int = 0):
    log = tmp_path / "calls.log"
    script = f"""
set -u
SCREEN_SERVICE=jht-screen MEDIA_SERVICE=jht-media LOGIN_VIEW_SERVICE=jht-login-view LOGIN_PROXY_SERVICE=jht-login-proxy
LOGIN_SERVICE=jht-login PLAYWRIGHT_POPULATE_SERVICE=jht-playwright-populate
docker() {{
  echo "docker $*" >> "{log}"
  [ "$1" = ps ] && printf '%s\\n' {listed}
  return 0
}}
read_only_service_id() {{
  echo "attest $*" >> "{log}"
  [ "$1" = jht-screen ] || return 3
  [ {attest_rc} -eq 0 ] || return {attest_rc}
  printf '%s\\n' "{attested}"
}}
{_wrapper_functions("container_down_tools_first")}
container_down_tools_first; echo "rc=$?"
"""
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    return result, (log.read_text(encoding="utf-8").splitlines() if log.exists() else [])


def test_a_running_screen_is_stopped_and_removed_by_its_attested_id_first(tmp_path: Path):
    result, calls = _tools_first(tmp_path, listed="jht jht-screen", attested=SCREEN_ID)
    assert "rc=0" in result.stdout
    assert calls == ["docker ps -a --format {{.Names}}", "attest jht-screen any-config",
                     f"docker stop -t 10 {SCREEN_ID}", f"docker rm -f {SCREEN_ID}"]


def test_no_tool_container_means_no_attestation_and_nothing_stopped(tmp_path: Path):
    _, calls = _tools_first(tmp_path, listed="jht jht-broker", attested=SCREEN_ID)
    assert calls == ["docker ps -a --format {{.Names}}"]


@pytest.mark.parametrize("rc", [1, 3])
def test_a_screen_that_cannot_be_attested_is_never_touched(tmp_path: Path, rc: int):
    result, calls = _tools_first(tmp_path, listed="jht-screen", attested=SCREEN_ID, attest_rc=rc)
    assert "rc=0" in result.stdout
    assert not [c for c in calls if c.startswith(("docker stop", "docker rm"))]


def test_an_id_that_is_not_an_id_is_never_used(tmp_path: Path):
    _, calls = _tools_first(tmp_path, listed="jht-screen", attested="jht-screen; rm -rf /")
    assert not [c for c in calls if c.startswith(("docker stop", "docker rm"))]


def test_down_runs_it_before_the_project_is_taken_down():
    text = WRAPPER.read_text(encoding="utf-8")
    down = text[text.index("container_down() {"):]
    down = down[:down.index("\n}\n")]
    assert down.index("container_down_tools_first") < down.index("compose_stdout_quiet down")
    ps1 = WRAPPER.with_name("jht-wrapper.ps1").read_text(encoding="utf-8")
    branch = ps1[ps1.index("{ $_ -in @('down', 'stop-container') } {"):]
    branch = branch[:branch.index("\n  }\n")]
    assert branch.index("Stop-JhtToolContainersFirst") < branch.index("Invoke-ComposeQuiet")


# --- Windows: the same rule in jht-wrapper.ps1 (the harness of test_windows_podman_wsl_branches, with PowerShell 5.1 and 7) ---

PS_STAND_INS = r"""
function docker { Add-Content -LiteralPath $env:FAKE_LOG -Value ('docker ' + ($args -join ' ')); if ($args[0] -eq 'ps') { $env:FAKE_NAMES -split ' ' }; $global:LASTEXITCODE = 0 }
function Get-RunningComposeServiceId { param([string]$Service) Add-Content -LiteralPath $env:FAKE_LOG -Value ('attest ' + $Service); if ($Service -eq 'jht-screen') { return $env:FAKE_ID }; return $null }
Stop-JhtToolContainersFirst
[Console]::Out.WriteLine('went on')
"""


def _ps_tools_first(tmp_path: Path, names: str, screen_id: str):
    from test_windows_podman_wsl_branches import WRAPPER as PS_WRAPPER, _run
    (tmp_path / "bin").mkdir(exist_ok=True)
    return _run(tmp_path, PS_WRAPPER, ["Stop-JhtToolContainersFirst"], PS_STAND_INS,
                {"FAKE_NAMES": names, "FAKE_ID": screen_id})


def test_windows_a_running_screen_is_stopped_and_removed_by_its_attested_id_first(tmp_path: Path):
    result, calls = _ps_tools_first(tmp_path, "jht jht-screen", SCREEN_ID)
    assert "went on" in result.stdout, result.stderr
    assert calls == ["docker ps --format {{.Names}}", "attest jht-screen", f"docker stop -t 10 {SCREEN_ID}", f"docker rm -f {SCREEN_ID}"]


@pytest.mark.parametrize("names,screen_id", [("jht jht-broker", SCREEN_ID), ("jht-screen", ""), ("jht-screen", "jht-screen; whoami")])
def test_windows_nothing_absent_or_unattested_is_touched(tmp_path: Path, names: str, screen_id: str):
    result, calls = _ps_tools_first(tmp_path, names, screen_id)
    assert "went on" in result.stdout, result.stderr
    assert not [c for c in calls if c.startswith(("docker stop", "docker rm"))]
