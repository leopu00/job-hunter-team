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
from windows_native_fakes import WINDOWS, git_bash, install_fake, powershell_argv

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "scripts" / "jht-integration.ps1"
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"

FAKE_PODMAN = """#!/bin/sh
echo "PODMAN $*" >> "$T_LOG"
case "$1" in
  system)
    echo 'jht-podman ssh://user@127.0.0.1:49650/run/user/1000/podman/podman.sock default=true'
    echo 'work-server ssh://admin@buildhost:22/run/podman/podman.sock default=false' ;;
  machine) echo 'jht-podman running=true starting=false port=49650 lastup=2 minutes ago' ;;
esac
"""

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
$ContainerRuntime = if ($env:T_RUNTIME_KIND) { $env:T_RUNTIME_KIND } else { 'docker' }
$script:IntegrationRuntimeLogPath = $env:T_RT_LOG
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
  # compose's own progress lines, on the REAL stderr of a native program as docker compose writes them; T_PROGRESS is the exit code
  if ($env:T_PROGRESS -and (($words -contains 'up') -or ($words -contains 'run'))) {
    if ($env:OS -eq 'Windows_NT') { & cmd /c "echo Container $service Creating 1>&2" } else { & sh -c "echo 'Container $service Creating' >&2" }
    $global:LASTEXITCODE = [int]$env:T_PROGRESS
    if ($global:LASTEXITCODE -ne 0) { return }
  }
  # what Podman does for a service that is not there: a line on the REAL stderr of a native program, and exit 0
  if ($env:T_NOISY_STDERR -eq '1' -and (($words -contains 'rm') -or ($words -contains 'stop'))) {
    if ($env:OS -eq 'Windows_NT') { & cmd /c 'echo No stopped containers 1>&2' } else { & sh -c 'echo No stopped containers >&2' }
    $global:LASTEXITCODE = 0
  }
  if ($words -contains 'run' -and $env:T_SWAP_LINK) {
    $folder = Join-Path $JhtHome 'live-screen'
    Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType SymbolicLink -Path $folder -Target $env:T_SWAP_LINK | Out-Null
  }
  # the first `up` of a tool that finds its connection gone, as Podman words it
  if ($env:T_UP_FAILS -and ($words -contains 'up')) {
    $seen = Get-Content -LiteralPath $env:T_UP_COUNTER -ErrorAction SilentlyContinue | Select-Object -First 1
    $tries = 1 + $(if ($seen) { [int]$seen } else { 0 })
    Set-Content -LiteralPath $env:T_UP_COUNTER -Value $tries
    if ($tries -le [int]$env:T_UP_FAILS) {
      [Console]::Error.WriteLine('Error: get machine connection URI: could not find a matching machine for connection "ssh://user@127.0.0.1:49649/run/user/1000/podman/podman.sock"')
      $global:LASTEXITCODE = 1; return
    }
  }
  # the copy of the browser (`run`) that finds its connection gone, the same way
  if ($env:T_RUN_FAILS -and ($words -contains 'run')) {
    $seen = Get-Content -LiteralPath $env:T_RUN_COUNTER -ErrorAction SilentlyContinue | Select-Object -First 1
    $tries = 1 + $(if ($seen) { [int]$seen } else { 0 })
    Set-Content -LiteralPath $env:T_RUN_COUNTER -Value $tries
    if ($tries -le [int]$env:T_RUN_FAILS) {
      [Console]::Error.WriteLine('Error: get machine connection URI: could not find a matching machine for connection "ssh://user@127.0.0.1:49649/run/user/1000/podman/podman.sock"')
      $global:LASTEXITCODE = 1; return
    }
  }
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
$IntegrationRetryWaitSeconds = 0
if ($env:T_SLOW) { $IntegrationSlowSeconds = [int]$env:T_SLOW }
# Windows PowerShell 5.1 hands an array over as ONE object; the pipeline makes it the elements, as 7 does
$argv = @(ConvertFrom-Json -InputObject $env:T_ARGS | ForEach-Object { $_ })
$done = @(Invoke-IntegrationCommand ([string[]]$argv))
exit ([int]$done[$done.Count - 1])
"""


# The library runs compose through the wrapper's Invoke-ComposeQuiet (its lines out of sight unless the step fails): the real one, read
# from the wrapper, calling the stand-in Invoke-Compose above.
_QUIET = re.search(r"function Invoke-ComposeQuiet \{.*?\n\}\n", WRAPPER.read_text(encoding="utf-8"), flags=re.S).group(0)
assert "\n. $env:T_LIBRARY\n" in CASE
CASE = CASE.replace("\n. $env:T_LIBRARY\n", "\n" + _QUIET + ". $env:T_LIBRARY\n", 1)


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
    # the program podman.exe of the engine, found on the PATH like the real one (not a function of the profile)
    h.bin = tmp_path / "bin"
    h.bin.mkdir()
    install_fake(h.bin, "podman.exe", FAKE_PODMAN)
    return h


def run(host, args: list[str], **extra: str) -> subprocess.CompletedProcess:
    # On Windows the fake podman.exe is a launcher that starts its .sh with the bash named by JHT_FAKE_BASH: without it the launcher has no file to start
    # and the engine question of the state in the log answers an error of .NET instead of the connections the test gives it.
    fake_bash = {"JHT_FAKE_BASH": str(git_bash())} if WINDOWS else {}
    env = {**os.environ, **fake_bash, "T_RUNTIME": str(host.runtime), "T_LOG": str(host.log), "T_VOLUMES": str(host.volumes),
           "T_RUNNING": str(host.running), "T_LIBRARY": str(LIBRARY), "T_ARGS": json.dumps(args),
           "T_JHT_HOME": str(host.tmp / "jht-home"), "PATH": f"{host.bin}{os.pathsep}{os.environ['PATH']}", **extra}
    return subprocess.run([*host.argv, "-File", str(host.script)], env=env, capture_output=True, text=True, timeout=120)


def rows(result) -> dict:
    return {row["id"]: row for row in json.loads(result.stdout)["integrations"]}


def log(host) -> str:
    return host.log.read_text(encoding="utf-8")


def test_list_json_nothing_added_and_the_login_says_how_it_is_switched_on(host):
    result = run(host, ["list", "--json"])
    assert result.returncode == 0, result.stderr
    found = rows(result)
    assert list(found) == ["google", "telegram", "mail", "linkedin-login", "screen", "media"]
    assert {found[i]["state"] for i in ("google", "telegram", "mail", "screen", "media")} == {"not_installed"}
    assert found["linkedin-login"] == {"id": "linkedin-login", "state": "not_installed", "reason": "si accende con: jht linkedin login"}


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


def test_the_sign_in_to_linkedin_is_not_added_it_is_switched_on_by_its_own_command_and_add_touches_nothing(host):
    result = run(host, ["add", "linkedin-login", "--json"])
    assert result.returncode == 3, result.stderr
    assert "jht linkedin login" in json.loads(result.stdout)["reason"]
    assert not [line for line in log(host).splitlines() if line.startswith("COMPOSE")], "nothing is started by an add"


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
    assert "'integration', 'screen', 'linkedin', 'tools'," in wrapper                          # its help is the local one, and so is the one of tools
    assert "jht-integration.ps1" in installer and "scripts/jht-integration.ps1" in installer
    assert "jht-integration.ps1=$integrationHash" in enabler and "'.runtime-helpers'" in enabler
    assert "$integrationHash" not in next(l for l in enabler.splitlines() if l.startswith('$manifest = "version=1'))   # the main manifest is the app's
    assert _text(LIBRARY).count("\n# JHT_RUNTIME_HELPER=1\n") == 1
    assert (ROOT / "web" / "public" / "install.ps1").read_bytes() == INSTALLER.read_bytes()


def test_the_library_passes_nothing_the_person_typed_to_a_native_command():
    code = "\n".join(line for line in _text(LIBRARY).splitlines() if not line.lstrip().startswith("#"))
    assert not re.search(r"\b(Invoke-Expression|iex)\b|&\s*\$", code)
    # the docker exec are fixed texts: the Google one, and the two questions to the view of the login, on the id the wrapper attested
    execs = re.findall(r"docker exec[^\n]*", code)
    assert len(execs) == 3 and sum("$IntegrationGoogleCode" in e for e in execs) == 1
    assert sum(bool(re.search(r"docker exec (?:-i )?\$(?:id|Id) python3 /app/shared/login/login_view\.py (grant|status) 2>\$null", e)) for e in execs) == 2


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


def test_remove_media_takes_the_container_and_never_the_image_or_the_folders_of_jht(host):
    run(host, ["add", "media", "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", "media", "--purge", "--yes", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = log(host).splitlines()
    assert "COMPOSE --profile media stop jht-media" in lines and "COMPOSE --profile media rm -f jht-media" in lines
    assert not any(line.startswith("DOCKER rmi") for line in lines), "the image stays on the disk: it goes with --remove-image or the uninstall"
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


def test_remove_screen_takes_the_container_and_purge_only_the_display_volume_never_the_image(host):
    run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    host.volumes.write_text("jht_jht-x11\njht_jht-playwright\n", encoding="utf-8")
    done = run(host, ["remove", "screen", "--purge", "--yes", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = log(host).splitlines()
    assert "COMPOSE --profile screen stop jht-screen" in lines and "COMPOSE --profile screen rm -f jht-screen" in lines
    assert not any(line.startswith("DOCKER rmi") for line in lines), "the image stays on the disk: it goes with --remove-image or the uninstall"
    assert [line for line in lines if line.startswith("DOCKER volume rm")] == ["DOCKER volume rm jht_jht-x11"]


@pytest.mark.parametrize("tool", ["screen", "media", "telegram"])
def test_removing_a_tool_that_is_not_there_lets_no_stderr_of_the_engine_through(host, tool):
    done = run(host, ["remove", tool, "--json"], T_EXTRAS=DIGEST, T_NOISY_STDERR="1")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "No stopped containers" not in done.stdout + done.stderr
    assert f"COMPOSE --profile {tool} rm -f jht-{tool}" in log(host).splitlines()


def _link_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("this machine does not let the test make a symbolic link")


def test_a_link_in_place_of_the_screen_password_folder_is_refused_and_never_followed(host):
    target = host.tmp / "somewhere-else"
    target.mkdir()
    home = host.tmp / "jht-home"
    home.mkdir()
    _link_or_skip(home / "live-screen", target)
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 1 and "non e' una cartella normale" in json.loads(done.stdout)["reason"], done.stdout + done.stderr
    assert "up -d" not in log(host) and "run --rm" not in log(host)
    assert list(target.iterdir()) == []


def test_a_link_put_there_while_the_browser_was_copied_stops_the_run_before_the_screen_starts(host):
    target = host.tmp / "elsewhere"
    target.mkdir()
    try:
        (host.tmp / "probe-link").symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("this machine does not let the test make a symbolic link")
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_SWAP_LINK=str(target))
    assert done.returncode == 1 and "non e' una cartella normale" in json.loads(done.stdout)["reason"], done.stdout + done.stderr
    assert "run --rm" in log(host) and "up -d" not in log(host)


# ---- the engine: the state of a failed `up` is written down, and the `up` is tried once more ----
@pytest.mark.parametrize("tool", ["screen", "media"])
def test_a_first_up_that_loses_the_podman_connection_leaves_the_state_in_the_log_and_is_tried_again(host, tool):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_UP_FAILS="1", T_UP_COUNTER=str(host.tmp / "ups"),
               T_RT_LOG=str(rt_log), CONTAINER_CONNECTION="jht-podman")
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout)["state"] == "running"
    assert log(host).count(f"COMPOSE --profile {tool} up -d jht-{tool}") == 2
    text = rt_log.read_text(encoding="utf-8")
    assert f"integration_engine_failed: tool={tool} exit=1" in text and f"integration_engine_retried: tool={tool} exit=0" in text
    assert "connection_used=jht-podman" in text and "port=49650" in text and "ssh://user@127.0.0.1:49650" in text
    assert "PODMAN system connection list" in log(host) and "PODMAN machine list" in log(host)
    # names, ports and running state: never an identity file or a key
    assert "identity" not in text.lower() and "BEGIN" not in text
    # the person's connections to other hosts stay out of it
    assert "work-server" not in text and "buildhost" not in text


def test_a_failure_that_lasts_all_the_tries_ends_the_command_and_says_where_the_state_is(host):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_UP_FAILS="3", T_UP_COUNTER=str(host.tmp / "ups"),
               T_RT_LOG=str(rt_log))
    assert done.returncode == 1
    assert json.loads(done.stdout)["reason"] == "il container dello schermo non parte"
    assert str(rt_log) in done.stderr
    text = rt_log.read_text(encoding="utf-8")
    assert "integration_engine_retried: tool=screen exit=1" in text and "tries=3" in text
    # three tries and no more
    assert log(host).count("COMPOSE --profile screen up -d jht-screen") == 3


@pytest.mark.parametrize("tool", ["screen", "media"])
def test_a_connection_that_is_lost_twice_in_a_row_is_found_again_at_the_third_try(host, tool):
    # Podman answers «could not find a matching machine» when the question of the state of the machine fails, and that happens while the machine
    # is busy with the pull and the copy of the browser: one more try after 5 s was not always enough
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_UP_FAILS="2", T_UP_COUNTER=str(host.tmp / "ups"),
               T_RT_LOG=str(rt_log))
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout)["state"] == "running"
    assert log(host).count(f"COMPOSE --profile {tool} up -d jht-{tool}") == 3
    text = rt_log.read_text(encoding="utf-8")
    assert f"integration_engine_retried: tool={tool} exit=0" in text and "tries=3" in text
    # the state of the engine is written once, at the first failure
    assert text.count("integration_engine_failed") == 1


def test_the_copy_of_the_browser_that_loses_the_connection_is_tried_again_like_the_start(host):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_RUN_FAILS="1", T_RUN_COUNTER=str(host.tmp / "runs"),
               T_RT_LOG=str(rt_log))
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout)["state"] == "running"
    assert log(host).count("COMPOSE --profile playwright run --rm --no-deps -T jht-playwright-populate") == 2
    assert "integration_engine_failed: tool=screen-browser exit=1" in rt_log.read_text(encoding="utf-8")
    # the start is not tried more than once: it did not fail
    assert log(host).count("up -d jht-screen") == 1


def test_a_copy_of_the_browser_that_fails_every_time_ends_with_its_own_reason(host):
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_RUN_FAILS="3", T_RUN_COUNTER=str(host.tmp / "runs"),
               T_RT_LOG=str(host.tmp / "logs" / "runtime.log"))
    assert done.returncode == 1
    assert json.loads(done.stdout)["reason"] == "il browser del closer non si copia nel volume"
    assert "up -d" not in log(host)


@pytest.mark.parametrize("tool", ["screen", "media"])
def test_a_slow_start_writes_where_the_time_went(host, tool):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_RT_LOG=str(rt_log), T_SLOW="0")
    assert done.returncode == 0, done.stdout + done.stderr
    text = rt_log.read_text(encoding="utf-8")
    assert f"integration_engine_slow: tool={tool} exit=0" in text
    assert re.search(r"total=\d+s", text) and re.search(r"pull=\d+s", text) and re.search(r"up=\d+s", text)
    assert ("browser=" in text) == (tool == "screen")
    # only a time, no state of the engine, and no engine asked
    assert "connection_used" not in text and "PODMAN" not in log(host)


def test_a_slow_start_with_another_engine_writes_nothing(host):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_RT_LOG=str(rt_log), T_SLOW="0")
    assert done.returncode == 0, done.stdout + done.stderr
    assert not rt_log.exists()


def test_a_good_first_up_writes_nothing_and_asks_the_engine_nothing(host):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_RUNTIME_KIND="podman", T_RT_LOG=str(rt_log))
    assert done.returncode == 0, done.stdout + done.stderr
    assert not rt_log.exists() and "PODMAN" not in log(host)
    assert log(host).count("up -d jht-screen") == 1


def test_without_a_podman_machine_a_failed_up_is_not_repeated_and_nothing_is_written(host):
    rt_log = host.tmp / "logs" / "runtime.log"
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_UP_FAILS="1", T_UP_COUNTER=str(host.tmp / "ups"), T_RT_LOG=str(rt_log))
    assert done.returncode == 1
    assert log(host).count("up -d jht-screen") == 1 and not rt_log.exists() and "PODMAN" not in log(host)


@pytest.mark.parametrize("tool", ["screen", "media", "telegram"])
def test_compose_progress_lines_stay_out_of_sight_when_the_tool_starts(host, tool):
    # `jht screen on` on Windows printed «Container jht-screen Creating/Created/Starting/Started» (giro Windows on package 33)
    done = run(host, ["add", tool], T_EXTRAS=DIGEST, T_PROGRESS="0")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "Container " not in done.stdout + done.stderr
    assert f"COMPOSE --profile {tool} up -d jht-{tool}" in log(host)


def test_compose_progress_lines_are_shown_whole_when_the_start_fails(host):
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST, T_PROGRESS="1")
    assert done.returncode == 1
    assert "Container jht-playwright-populate Creating" in done.stderr
