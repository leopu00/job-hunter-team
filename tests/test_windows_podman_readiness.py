"""Joint bridge contract, exercised by real PowerShell and synthetic native children.

Prepared before the shared bridge lands. These cases are not claimed green or
merged alone: the T205 composition must supply the real module under test.
The existing engine harness enforces 5.1 or 7 and compiles native fake launchers
on Windows. No VM, real Podman, network or machine configuration is used.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from test_windows_podman_wsl_branches import SCRIPTS, _fake, _run
from windows_native_fakes import WINDOWS, expected_engine, launcher, powershell_argv, windows_env

BRIDGE = SCRIPTS / "podman-machine-bridge.ps1"
CONNECTION = "synthetic-machine"

PODMAN = r'''  "--connection synthetic-machine info")
    [ "$FAKE_MODE" = already-ready ] && exit 0
    [ -f "$FAKE_STATE" ] || exit 125
    [ "$FAKE_MODE" = probe-hangs ] && { sleep 30; exit 125; }
    [ "$FAKE_MODE" = never-ready ] && exit 125
    n=0
    [ -f "$FAKE_PROBES" ] && n=$(cat "$FAKE_PROBES")
    n=$((n + 1))
    printf '%s' "$n" > "$FAKE_PROBES"
    [ "$n" -ge 3 ] && exit 0
    exit 125 ;;
  "machine start --update-connection=false synthetic-machine")
    [ "$FAKE_MODE" = start-hangs ] && { sleep 30; exit 125; }
    : > "$FAKE_STATE"
    printf '%s\n' 'synthetic-private-child-output' >&2
    exit "$FAKE_START_EXIT" ;;
  *) echo 'unexpected synthetic command' >&2; exit 97 ;;'''

# Native Windows equivalent of PODMAN: no interpreter startup before the timed probe.
PODMAN_NATIVE = r'''
using System;
using System.IO;
using System.Threading;
public static class ReadinessFake {
    static string Env(string name) { return Environment.GetEnvironmentVariable(name); }
    public static int Main(string[] args) {
        string call = String.Join(" ", args), mode = Env("FAKE_MODE"), state = Env("FAKE_STATE");
        File.AppendAllText(Env("FAKE_LOG"), call + "\n");
        if (call == "--connection synthetic-machine info") {
            if (mode == "already-ready") return 0;
            if (!File.Exists(state)) return 125;
            if (mode == "probe-hangs") { Thread.Sleep(30000); return 125; }
            if (mode == "never-ready") return 125;
            string probes = Env("FAKE_PROBES");
            int n = File.Exists(probes) ? Int32.Parse(File.ReadAllText(probes)) : 0;
            File.WriteAllText(probes, (n + 1).ToString(System.Globalization.CultureInfo.InvariantCulture));
            return n + 1 >= 3 ? 0 : 125;
        }
        if (call == "machine start --update-connection=false synthetic-machine") {
            if (mode == "start-hangs") { Thread.Sleep(30000); return 125; }
            File.WriteAllText(state, "");
            Console.Error.WriteLine("synthetic-private-child-output");
            return Int32.Parse(Env("FAKE_START_EXIT"));
        }
        Console.Error.WriteLine("unexpected synthetic command"); return 97;
    }
}
'''


def install_podman_fake(directory: Path):
    if WINDOWS:
        shutil.copyfile(launcher(PODMAN_NATIVE), directory / "podman.exe")
    else:
        _fake(directory, "podman.exe", PODMAN)

CASE = r'''
. $env:JHT_PODMAN_BRIDGE
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
  $answer = Invoke-JhtPodmanReadiness -FilePath $env:FAKE_PODMAN -Connection 'synthetic-machine' -TimeoutMilliseconds ([int]$env:FAKE_BUDGET_MS) -LogPath $env:FAKE_RUNTIME_LOG
  [Console]::Out.WriteLine('READINESS ' + (@{ready=$answer.Ready;startExitCode=$answer.StartExitCode;elapsedMs=$clock.ElapsedMilliseconds} | ConvertTo-Json -Compress))
  exit 0
} catch {
  $code = [string]$_.Exception.Data['Code']
  $phase = [string]$_.Exception.Data['Phase']
  $startCode = $_.Exception.Data['StartExitCode']
  if (-not $code) { throw }
  [Console]::Out.WriteLine('READINESS ' + (@{code=$code;phase=$phase;startExitCode=$startCode;elapsedMs=$clock.ElapsedMilliseconds} | ConvertTo-Json -Compress))
  if ($code -eq 'podman_machine_unavailable') { exit 22 }
  if ($code -in @('podman_machine_timeout', 'podman_machine_cleanup_failed')) { exit 124 }
  throw
}
'''


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def run_case(tmp_path: Path, *, mode="delayed-ready", start_exit=0, budget_ms=3000):
    assert BRIDGE.is_file(), "compose the joint T205 bridge before running the readiness contract"
    binary = tmp_path / "bin"
    binary.mkdir()
    install_podman_fake(binary)
    result, calls = _run(tmp_path, BRIDGE, [], CASE, {
        "JHT_PODMAN_BRIDGE": str(BRIDGE), "FAKE_PODMAN": str(binary / "podman.exe"),
        "FAKE_MODE": mode, "FAKE_START_EXIT": str(start_exit),
        "FAKE_PROBES": str(tmp_path / "probes"), "FAKE_BUDGET_MS": str(budget_ms),
        "FAKE_RUNTIME_LOG": str(tmp_path / "runtime.log"),
    })
    rows = [json.loads(line.removeprefix("READINESS ")) for line in result.stdout.splitlines()
            if line.startswith("READINESS ")]
    assert len(rows) == 1, result.stdout + result.stderr
    return result, calls, rows[0]


@pytest.mark.parametrize("start_exit", [0, 125])
def test_delayed_ready_accepts_the_original_start_status_without_starting_twice(tmp_path, start_exit):
    # Exercise the production 30s success budget; the hung/never-ready proofs keep 1.5s.
    result, calls, row = run_case(tmp_path, start_exit=start_exit, budget_ms=30000)
    assert result.returncode == 0, result.stdout + result.stderr
    assert row["ready"] is True and row["startExitCode"] == start_exit
    assert row["elapsedMs"] < 30000
    assert calls.count("machine start --update-connection=false synthetic-machine") == 1
    assert calls.count("--connection synthetic-machine info") == 4
    assert all(call in ("machine start --update-connection=false synthetic-machine",
                        "--connection synthetic-machine info") for call in calls)
    assert not (tmp_path / "default-connection").exists()


def test_ready_machine_is_only_probed_without_a_start(tmp_path):
    result, calls, row = run_case(tmp_path, mode="already-ready")
    assert result.returncode == 0, result.stderr
    assert row["ready"] is True and row["startExitCode"] is None
    assert calls == ["--connection synthetic-machine info"]
    if WINDOWS:
        assert_native_job_lifecycle(tmp_path)


def assert_native_job_lifecycle(tmp_path):
    """The existing Windows case also runs the real nested-tree and success-helper proof."""
    done = subprocess.run(
        powershell_argv() + ["-File", str(SCRIPTS / "podman-machine-bridge-selftest.ps1"),
                            "-ExpectedMajor", expected_engine().split(".")[0]],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
        env=windows_env(tmp_path),
    )
    print(done.stdout)
    assert done.returncode == 0, done.stdout + done.stderr
    cases = [line for line in done.stdout.splitlines() if line.startswith("T205_CASE ")]
    assert len(cases) == 8 and all(line.endswith(" PASS") for line in cases), done.stdout
    assert all(any(f"action={action} " in line and "tree_stopped=true" in line for line in cases)
               for action in ("ssh", "start", "init")), done.stdout
    assert any("inherited_pipe_incomplete=true ssh_rejected=true" in line for line in cases)
    assert any("without_deadline_hangs=true outer_watchdog_stopped=true" in line for line in cases)
    assert "held_lock_rejected=true released=true sandbox_removed=true PASS" in done.stdout
    assert "T205_DEADLINE_SELFTEST engine=" in done.stdout


def test_completed_start_does_not_turn_an_unreachable_engine_into_success(tmp_path):
    result, calls, row = run_case(tmp_path, mode="never-ready", start_exit=125, budget_ms=1500)
    # A probe may consume the final residual; its own timeout stays distinct.
    assert (result.returncode, row["code"], row["phase"]) in (
        (22, "podman_machine_unavailable", "podman_machine_readiness"),
        (124, "podman_machine_timeout", "podman_machine_probe"),
    ), result.stderr
    assert row["startExitCode"] == 125
    assert row["elapsedMs"] < 10_000
    assert calls.count("machine start --update-connection=false synthetic-machine") == 1
    assert all(not call.startswith(("machine init", "machine stop", "system connection")) for call in calls)


@pytest.mark.parametrize("mode,phase", [("start-hangs", "podman_machine_start"),
                                        ("probe-hangs", "podman_machine_probe")])
def test_a_hung_child_keeps_the_process_timeout_phase_and_never_restarts(tmp_path, mode, phase):
    result, calls, row = run_case(tmp_path, mode=mode, start_exit=125, budget_ms=1500)
    assert result.returncode == 124, result.stderr
    expected = "podman_machine_timeout" if WINDOWS else "podman_machine_cleanup_failed"
    assert row["code"] == expected and row["phase"] == phase
    assert row["elapsedMs"] < 10_000
    assert calls.count("machine start --update-connection=false synthetic-machine") == 1
    if mode == "probe-hangs":
        assert row["startExitCode"] == 125


def test_readiness_log_retains_fixed_status_and_original_start_exit(tmp_path):
    assert BRIDGE.is_file(), "compose the joint T205 bridge before running its logger contract"
    (tmp_path / "bin").mkdir()
    body = r'''
. $env:JHT_PODMAN_BRIDGE
Write-JhtPodmanBridgeEvent -Phase podman_machine_readiness -Code podman_machine_unavailable -ElapsedMilliseconds 1500 -ExitCode 125 -LogPath $env:FAKE_RUNTIME_LOG
'''
    log = tmp_path / "runtime.log"
    result, calls = _run(tmp_path, BRIDGE, [], body, {
        "JHT_PODMAN_BRIDGE": str(BRIDGE), "FAKE_RUNTIME_LOG": str(log),
    })
    assert result.returncode == 0, result.stderr
    assert calls == []
    saved = log.read_text(encoding="utf-8-sig")
    assert "podman_machine_readiness" in saved and "podman_machine_unavailable" in saved
    assert "125" in saved and "synthetic-private-child-output" not in saved


@pytest.mark.parametrize("value,expected", [("1", 1000), ("30", 30000), ("031", 30000),
                                           ("0", 30000), ("999", 30000), ("٣", 30000), ("x", 30000)])
def test_only_ascii_digits_can_shorten_the_readiness_budget(tmp_path, value, expected):
    assert BRIDGE.is_file()
    (tmp_path / "bin").mkdir()
    body = r'''
. $env:JHT_PODMAN_BRIDGE
[Console]::Out.WriteLine('BUDGET ' + (Get-JhtPodmanReadinessBudget -Seconds $env:FAKE_SECONDS))
'''
    result, calls = _run(tmp_path, BRIDGE, [], body, {"JHT_PODMAN_BRIDGE": str(BRIDGE), "FAKE_SECONDS": value})
    assert result.returncode == 0, result.stderr
    assert f"BUDGET {expected}" in result.stdout and calls == []


@pytest.mark.parametrize("registered_scope", ["MachinePath", "UserPath"])
@pytest.mark.parametrize("without_refresh", [False, True], ids=["adapter-refreshes", "old-lookup-refused"])
def test_adapter_resolves_a_newly_registered_podman_from_a_stale_process_path(tmp_path, registered_scope, without_refresh):
    (tmp_path / "bin").mkdir()
    _fake(tmp_path / "bin", "docker.exe", '''  "--identity") printf '%s\\n' 'PRIVATE_SHIM'; exit 0 ;;''')
    registered = tmp_path / "registered Podman"
    registered.mkdir()
    install_podman_fake(registered)
    _fake(registered, "docker.exe", '''  "--identity") printf '%s\\n' 'FOREIGN_DOCKER'; exit 0 ;;''')
    source = BRIDGE.read_text(encoding="utf-8")
    needle = "\n  Update-ProcessPath -PreserveProcessFirst\n"
    assert source.count(needle) == 1, "mutate only the adapter's real refresh call"
    case_bridge = BRIDGE
    if without_refresh:
        case_bridge = tmp_path / "old-lookup-bridge.ps1"
        case_bridge.write_text(source.replace(needle, "\n", 1), encoding="utf-8")
    body = r'''
. $env:FAKE_CASE_BRIDGE
$PSDefaultParameterValues['Update-ProcessPath:MachinePath'] = ''
$PSDefaultParameterValues['Update-ProcessPath:UserPath'] = ''
$PSDefaultParameterValues['Update-ProcessPath:' + $env:FAKE_REGISTERED_SCOPE] = $env:FAKE_REGISTERED_PATH
if (Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue) { throw 'The stale process already sees Podman; this proof would be empty.' }
Start-JhtPodmanMachineForUp -Runtime podman -Connection 'synthetic-machine'
$selectedDocker = Get-Command docker.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$expectedDocker = (Get-Item -LiteralPath $env:FAKE_PRIVATE_DOCKER -ErrorAction Stop).FullName
if ($selectedDocker.Path -ne $expectedDocker) { throw "The registry PATH displaced the private runtime shim: selected=$($selectedDocker.Path); expected=$expectedDocker" }
$identity = & docker.exe --identity
if ($LASTEXITCODE -ne 0 -or $identity -ne 'PRIVATE_SHIM') { throw 'A foreign Docker command ran instead of the private shim.' }
[Console]::Out.WriteLine('ADAPTER_READY')
'''
    result, calls = _run(tmp_path, BRIDGE, [], body, {
        "FAKE_CASE_BRIDGE": str(case_bridge), "FAKE_REGISTERED_SCOPE": registered_scope,
        "FAKE_PRIVATE_DOCKER": str(tmp_path / "bin" / "docker.exe"),
        "FAKE_REGISTERED_PATH": str(registered), "FAKE_MODE": "delayed-ready",
        "FAKE_START_EXIT": "125", "FAKE_PROBES": str(tmp_path / "probes"),
    })
    if without_refresh:
        assert result.returncode == 21, result.stdout + result.stderr
        assert "podman_not_installable: podman.exe is unavailable." in result.stdout + result.stderr
        assert calls == [] and "ADAPTER_READY" not in result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert "ADAPTER_READY" in result.stdout
        assert calls.count("--identity") == 1
        assert calls.count("machine start --update-connection=false synthetic-machine") == 1
        assert calls.count("--connection synthetic-machine info") == 4
        assert not (tmp_path / "default-connection").exists()
