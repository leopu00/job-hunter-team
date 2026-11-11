"""`jht integration` on Windows (P9): scripts/jht-integration.ps1 under the PowerShell it is meant for (5.1 and 7).

The library is dot-sourced the way the wrapper does it, with stand-ins for what the wrapper and the engine give it (a `docker`
function, Invoke-Compose that records, the lookup of the running container). Same contract as tests/test_integration_command.py:
closed list of ids, state from the engine and the host markers, add/remove only as asked, purge only with --yes.

Run with: pytest tests/test_integration_command_windows.py -v   (needs PowerShell: pwsh off Windows)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import powershell_argv

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "scripts" / "jht-integration.ps1"
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"

CASE = r"""
$ErrorActionPreference = 'Stop'
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
function Write-Info { param([string]$Msg) [Console]::Error.WriteLine($Msg) }
$RuntimeDir = $env:T_RUNTIME
$ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$Container = 'jht'; $TelegramContainer = 'jht-telegram'; $BrokerContainer = 'jht-broker'
$BrokerMadeMarker = Join-Path $RuntimeDir '.broker-made'
$ExtrasImageDigest = $env:T_EXTRAS
$JhtHome = $env:T_JHT_HOME
function Test-ProtectedRuntimeNode {
  param([string]$Path, [switch]$Directory)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $false }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  return ([bool]$Directory -eq [bool]$item.PSIsContainer)
}
function Publish-JhtFile { param([string]$Destination, [byte[]]$Bytes) [IO.File]::WriteAllBytes($Destination, $Bytes) }
function Get-ComposeProjectName { return 'jht' }
function Test-DockerReachable { return ($env:T_ENGINE_DOWN -ne '1') }
function Require-Docker { if ($env:T_ENGINE_DOWN -eq '1') { exit 1 } }
function Ensure-Up { }
function Confirm-TelegramLifecycle { param([string]$Operation) return 0 }
function Get-RunningComposeServiceId {
  param([string]$Service)
  $script:ServiceLookupReason = ''
  if ($env:T_AMBIGUOUS -eq '1') { $script:ServiceLookupReason = 'two running containers of x'; return $null }
  if (@(Get-Content -LiteralPath $env:T_RUNNING) -contains $Service) { return 'aaaaaaaaaaaa' }
  $script:ServiceLookupReason = 'compose ps listed no running container of project jht (exit 0)'
  return $null
}
function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] $Rest)
  Add-Content -LiteralPath $env:T_LOG -Value ('COMPOSE ' + (@($Rest) -join ' '))
  if ($env:JHT_EXTRAS_IMAGE) { Add-Content -LiteralPath $env:T_LOG -Value ('EXTRAS_IMAGE ' + $env:JHT_EXTRAS_IMAGE) }
  if ($env:JHT_EXTRAS_DIGEST) { Add-Content -LiteralPath $env:T_LOG -Value ('EXTRAS_DIGEST ' + $env:JHT_EXTRAS_DIGEST) }
  $global:LASTEXITCODE = 0
  if ($env:T_COMPOSE_FAIL -eq '1') { $global:LASTEXITCODE = 1; return }
  $words = @($Rest); $service = $words[$words.Count - 1]
  $running = @(Get-Content -LiteralPath $env:T_RUNNING)
  if ($words -contains 'up') { $running += $service }
  if ($words -contains 'stop') { $running = @($running | Where-Object { $_ -ne $service }) }
  [IO.File]::WriteAllLines($env:T_RUNNING, [string[]]$running)
}
# the step that makes the broker (tests/test_broker_on_request_windows.py)
function Ensure-Broker { param([switch]$Quiet) Invoke-Compose '--profile' 'broker' up '-d' $BrokerContainer | Out-Null; return $LASTEXITCODE }
function docker {
  Add-Content -LiteralPath $env:T_LOG -Value ('DOCKER ' + ($args -join ' '))
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'volume' -and $args[1] -eq 'ls') { Get-Content -LiteralPath $env:T_VOLUMES; return }
  if ($args[0] -eq 'volume' -and $args[1] -eq 'rm') {
    $name = $args[2]
    [IO.File]::WriteAllLines($env:T_VOLUMES, [string[]]@(Get-Content -LiteralPath $env:T_VOLUMES | Where-Object { $_ -ne $name }))
    return
  }
  if ($args[0] -eq 'exec' -and $env:T_EXEC_FAIL -eq '1') { $global:LASTEXITCODE = 1; 'No matching distribution found for gspread' }
}
. $env:T_LIBRARY
# Windows PowerShell 5.1 hands an array over as ONE object; the pipeline makes it the elements, as 7 does
$argv = @(ConvertFrom-Json -InputObject $env:T_ARGS | ForEach-Object { $_ })
$done = @(Invoke-IntegrationCommand ([string[]]$argv))
exit ([int]$done[$done.Count - 1])
"""


@pytest.fixture
def host(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text(
        "services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n  jht-telegram:\n    profiles: [telegram]\n    image: x\n", encoding="utf-8")
    for name in ("log", "volumes", "running"):
        (tmp_path / name).write_text("", encoding="utf-8")
    script = tmp_path / "case.ps1"
    script.write_text(CASE, encoding="utf-8-sig")

    class H:
        pass

    h = H()
    h.tmp, h.runtime, h.script = tmp_path, runtime, script
    h.log, h.volumes, h.running = tmp_path / "log", tmp_path / "volumes", tmp_path / "running"
    h.argv = powershell_argv()
    return h


def run(host, args: list[str], **extra: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "T_RUNTIME": str(host.runtime), "T_LOG": str(host.log), "T_VOLUMES": str(host.volumes),
           "T_RUNNING": str(host.running), "T_LIBRARY": str(LIBRARY), "T_ARGS": json.dumps(args),
           "T_JHT_HOME": str(host.tmp / "jht-home"), **extra}
    return subprocess.run([*host.argv, "-File", str(host.script)], env=env, capture_output=True, text=True, timeout=120)


def rows(result) -> dict:
    return {row["id"]: row for row in json.loads(result.stdout)["integrations"]}


def log(host) -> str:
    return host.log.read_text(encoding="utf-8")


def test_list_json_nothing_added_and_one_not_available_yet(host):
    result = run(host, ["list", "--json"])
    assert result.returncode == 0, result.stderr
    found = rows(result)
    assert list(found) == ["google", "telegram", "mail", "linkedin-login", "screen", "media"]
    assert {found[i]["state"] for i in ("google", "telegram", "mail", "screen", "media")} == {"not_installed"}
    assert found["linkedin-login"] == {"id": "linkedin-login", "state": "not_installed", "reason": "non disponibile ancora"}


def test_state_is_running_ready_error_from_the_engine(host):
    host.running.write_text("jht-broker\n", encoding="utf-8")
    host.volumes.write_text("jht_jht-telegram-state\njht_other\n", encoding="utf-8")
    found = rows(run(host, ["list", "--json"]))
    assert found["mail"]["state"] == "running" and found["telegram"]["state"] == "ready"
    ambiguous = rows(run(host, ["list", "--json"], T_AMBIGUOUS="1"))
    assert ambiguous["mail"]["state"] == "error" and ambiguous["telegram"]["state"] == "error"
    down = rows(run(host, ["list", "--json"], T_ENGINE_DOWN="1"))
    assert down["mail"]["state"] == "error" and down["google"]["state"] == "not_installed"


def test_a_volume_of_another_project_is_not_the_integration(host):
    host.volumes.write_text("other_jht-telegram-state\n", encoding="utf-8")
    assert rows(run(host, ["list", "--json"]))["telegram"]["state"] == "not_installed"


def test_add_telegram_starts_the_profile_and_reports_running(host):
    result = run(host, ["add", "telegram", "--json"])
    assert result.returncode == 0, result.stderr
    answer = json.loads(result.stdout)
    assert answer["ok"] is True and answer["state"] == "running"
    assert "COMPOSE --profile telegram up -d jht-telegram" in log(host)
    assert not (host.runtime / "integrations" / "telegram.pending").exists()


def test_add_google_runs_the_fixed_text_and_a_failure_is_kept_one_line(host):
    ok = run(host, ["add", "google", "--json"])
    assert ok.returncode == 0, ok.stderr
    assert json.loads(ok.stdout)["state"] == "ready"
    executed = [line for line in log(host).splitlines() if line.startswith("DOCKER exec")]
    assert len(executed) == 1 and "python3 -c import sys;" in executed[0] and "GOOGLE_SHEETS" in executed[0]
    assert '"' not in executed[0]          # Windows PowerShell 5.1 drops a double quote inside a native argument
    host.runtime.joinpath("integrations", "google.ok").unlink()
    failed = run(host, ["add", "google", "--json"], T_EXEC_FAIL="1")
    assert failed.returncode == 1
    answer = json.loads(failed.stdout)
    assert answer["ok"] is False and answer["state"] == "error" and "No matching distribution" in answer["reason"]
    assert rows(run(host, ["list", "--json"]))["google"]["state"] == "error"


def test_what_is_not_available_yet_is_refused_with_its_own_code(host):
    for action in ("add", "remove"):
        result = run(host, [action, "linkedin-login", "--json"])
        assert result.returncode == 3, (action, result.stderr)
        assert json.loads(result.stdout)["reason"] == "non disponibile ancora"
    assert log(host) == ""


@pytest.mark.parametrize("hostile", ["google;touch HIT", "../x", "$(Get-Date)", "Google", "all", "-x", "`ls`"])
def test_an_id_outside_the_closed_list_stops_before_any_engine_call(host, hostile):
    result = run(host, ["add", hostile])
    assert result.returncode == 2
    assert log(host) == ""


@pytest.mark.parametrize("args", [[], ["frob"], ["list", "google"], ["add"], ["add", "google", "mail"], ["add", "google", "--purge"],
                                  ["remove", "telegram", "--yes"], ["remove", "telegram", "--purge"], ["list", "--nope"]])
def test_wrong_use_is_a_usage_error(host, args):
    assert run(host, args).returncode == 2


def test_remove_keeps_the_data_unless_the_person_purges_with_yes(host):
    host.running.write_text("jht-telegram\n", encoding="utf-8")
    host.volumes.write_text("jht_jht-telegram-secrets\njht_jht-telegram-state\njht_jht-telegram-inbox\njht_jht-telegram-sock\njht_jht-secrets\n", encoding="utf-8")
    assert run(host, ["remove", "telegram", "--json"]).returncode == 0
    assert "volume rm" not in log(host)
    assert "COMPOSE --profile telegram stop jht-telegram" in log(host) and "COMPOSE --profile telegram rm -f jht-telegram" in log(host)
    purged = run(host, ["remove", "telegram", "--purge", "--yes", "--json"])
    assert purged.returncode == 0, purged.stderr
    assert host.volumes.read_text(encoding="utf-8").split() == ["jht_jht-telegram-sock", "jht_jht-secrets"]


def test_the_mail_broker_is_not_removable_while_jht_up_starts_it(host):
    assert run(host, ["remove", "mail", "--json"]).returncode == 3
    compose = host.runtime / "docker-compose.yml"
    compose.write_text(compose.read_text(encoding="utf-8").replace("  jht-broker:\n", "  jht-broker:\n    profiles: [broker]\n"), encoding="utf-8")
    (host.runtime / ".broker-made").write_text("", encoding="utf-8")
    assert run(host, ["remove", "mail", "--json"]).returncode == 0
    assert "COMPOSE --profile broker stop jht-broker" in log(host)
    assert not (host.runtime / ".broker-made").exists()  # `jht up` does not bring it back


def test_purging_the_mail_broker_leaves_the_volume_of_all_the_portal_credentials(host):
    compose = host.runtime / "docker-compose.yml"
    compose.write_text(compose.read_text(encoding="utf-8").replace("  jht-broker:\n", "  jht-broker:\n    profiles: [broker]\n"), encoding="utf-8")
    host.volumes.write_text("jht_jht-secrets\njht_jht-broker-state\njht_jht-broker-sock\n", encoding="utf-8")
    result = run(host, ["remove", "mail", "--purge", "--yes", "--json"])
    assert result.returncode == 0, result.stderr
    assert host.volumes.read_text(encoding="utf-8").split() == ["jht_jht-secrets", "jht_jht-broker-sock"]
    assert "jht reset --scope creds" in json.loads(result.stdout)["reason"]


def test_a_run_in_progress_reads_downloading_and_a_dead_one_is_ignored(host):
    folder = host.runtime / "integrations"
    folder.mkdir()
    (folder / "google.pending").write_text(f"{os.getpid()}\n", encoding="utf-8")
    assert rows(run(host, ["list", "--json"]))["google"]["state"] == "downloading"
    (folder / "google.pending").write_text("999999\n", encoding="utf-8")
    assert rows(run(host, ["list", "--json"]))["google"]["state"] == "not_installed"


# ---- static: the wrapper, the installer and the enabler agree on the helper ----
def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_wrapper_installer_enabler_and_library_agree_on_the_helper():
    wrapper, installer, enabler = _text(WRAPPER), _text(INSTALLER), _text(ENABLER)
    assert "$RuntimeHelpers = @('jht-integration.ps1', 'jht-tools.ps1', 'configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')" in wrapper
    assert "$JHT_INTEGRATION_PROTOCOL = 1\n" in wrapper
    assert re.search(r"'integration' \{\n    Require-ComposeFile\n", wrapper)
    assert "$mayFetch = $Rest.Count -gt 0" in wrapper                      # only add/remove fetch a missing helper
    assert "'integration', 'tools'," in wrapper                            # its help is the local one, and so is the one of tools
    assert "jht-integration.ps1" in installer and "scripts/jht-integration.ps1" in installer
    assert "jht-integration.ps1=$integrationHash" in enabler and "'.runtime-helpers'" in enabler
    assert "$integrationHash" not in next(l for l in enabler.splitlines() if l.startswith('$manifest = "version=1'))   # the main manifest is the app's
    assert _text(LIBRARY).count("\n# JHT_RUNTIME_HELPER=1\n") == 1
    assert (ROOT / "web" / "public" / "install.ps1").read_bytes() == INSTALLER.read_bytes()


def test_the_library_passes_nothing_the_person_typed_to_a_native_command():
    code = "\n".join(line for line in _text(LIBRARY).splitlines() if not line.lstrip().startswith("#"))
    assert not re.search(r"\b(Invoke-Expression|iex)\b|&\s*\$", code)
    assert len(re.findall(r"docker exec", code)) == 1 and "$IntegrationGoogleCode" in code


# ---- media: the extras image by the digest the wrapper carries, then the `media` profile ----
DIGEST = "sha256:" + "e" * 64
REF = f"ghcr.io/leopu00/jht@{DIGEST}"


def test_media_without_an_extras_image_says_not_available_yet_and_pulls_nothing(host):
    done = run(host, ["add", "media", "--json"])
    assert done.returncode == 3 and json.loads(done.stdout)["reason"] == "non disponibile ancora"
    assert "pull" not in log(host)


@pytest.mark.parametrize("digest", ["sha256:xyz", "sha256:e;touch HIT", "sha256:" + "e" * 64 + " --privileged", "sha256:" + "e" * 63])
def test_a_digest_that_is_not_one_is_not_used(host, digest):
    done = run(host, ["add", "media", "--json"], T_EXTRAS=digest)
    assert done.returncode == 3 and "pull" not in log(host)


def test_add_media_pulls_by_digest_and_starts_only_the_media_profile_with_that_image(host):
    done = run(host, ["add", "media", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["state"] == "running"
    lines = log(host).splitlines()
    assert f"DOCKER pull {REF}" in lines
    assert "COMPOSE --profile media up -d jht-media" in lines and f"EXTRAS_IMAGE {REF}" in lines
    assert lines.index(f"DOCKER pull {REF}") < lines.index("COMPOSE --profile media up -d jht-media")


def test_media_states_running_ready_when_off_and_not_installed_after_remove(host):
    assert rows(run(host, ["list", "--json"]))["media"]["state"] == "not_installed"
    run(host, ["add", "media", "--json"], T_EXTRAS=DIGEST)
    assert rows(run(host, ["list", "--json"]))["media"]["state"] == "running"
    host.running.write_text("", encoding="utf-8")
    ready = rows(run(host, ["list", "--json"]))["media"]
    assert ready["state"] == "ready" and "jht integration add media" in ready["reason"]
    run(host, ["remove", "media", "--json"], T_EXTRAS=DIGEST)
    assert rows(run(host, ["list", "--json"]))["media"]["state"] == "not_installed"


def test_the_folders_every_jht_up_makes_do_not_make_media_added(host):
    host.volumes.write_text("jht_jht-media-in\njht_jht-media-out\n", encoding="utf-8")
    assert rows(run(host, ["list", "--json"]))["media"]["state"] == "not_installed"


def test_remove_media_takes_the_container_and_the_image_and_never_the_folders_of_jht(host):
    run(host, ["add", "media", "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", "media", "--purge", "--yes", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = log(host).splitlines()
    assert "COMPOSE --profile media stop jht-media" in lines and "COMPOSE --profile media rm -f jht-media" in lines
    assert f"DOCKER rmi {REF}" in lines
    assert not any(line.startswith("DOCKER volume rm") for line in lines)
    assert "restano" in json.loads(done.stdout)["reason"]


def test_add_screen_pulls_fills_the_browser_volume_and_only_then_starts_only_the_screen_profile(host):
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["state"] == "running"
    lines = log(host).splitlines()
    populate = "COMPOSE --profile playwright run --rm --no-deps -T jht-playwright-populate"
    start = "COMPOSE --profile screen up -d jht-screen"
    assert lines.index(f"DOCKER pull {REF}") < lines.index(populate) < lines.index(start)
    assert f"EXTRAS_DIGEST {DIGEST}" in lines[lines.index(populate):lines.index(start)], "the one-shot is told the digest it copies for"
    assert not any(line.startswith("EXTRAS_DIGEST") for line in lines[lines.index(start):]), "and nobody else"
    assert (host.tmp / "jht-home" / "live-screen").is_dir()


def test_screen_states_running_ready_when_off_and_not_installed_after_remove(host):
    assert rows(run(host, ["list", "--json"]))["screen"]["state"] == "not_installed"
    run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    running = rows(run(host, ["list", "--json"]))["screen"]
    assert running["state"] == "running" and "sola vista" in running["reason"]
    host.running.write_text("", encoding="utf-8")
    ready = rows(run(host, ["list", "--json"]))["screen"]
    assert ready["state"] == "ready" and "jht screen on" in ready["reason"]
    run(host, ["remove", "screen", "--json"], T_EXTRAS=DIGEST)
    assert rows(run(host, ["list", "--json"]))["screen"]["state"] == "not_installed"


def test_remove_screen_takes_the_container_and_the_image_and_purge_only_the_display_volume(host):
    run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    host.volumes.write_text("jht_jht-x11\njht_jht-playwright\n", encoding="utf-8")
    done = run(host, ["remove", "screen", "--purge", "--yes", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = log(host).splitlines()
    assert "COMPOSE --profile screen stop jht-screen" in lines and "COMPOSE --profile screen rm -f jht-screen" in lines
    assert f"DOCKER rmi {REF}" in lines
    assert [line for line in lines if line.startswith("DOCKER volume rm")] == ["DOCKER volume rm jht_jht-x11"]
