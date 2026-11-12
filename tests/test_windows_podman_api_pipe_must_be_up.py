"""The Podman machine's pipe must exist before the setup goes on: said at once, not at the very end by compose.

`podman machine start` leaves with 0 when its win-sshproxy.exe did not start, and Podman's own calls keep working over ssh: the setup
went on with the network and the pulls and failed only at `jht up`, where compose reaches the machine by its pipe («Impossibile
trovare il file»), with «Run the same install command again». The cause is in Podman's win-sshproxy (gvisor-tap-vsock 0.8.x, Podman
6.0.2 to 6.1.3): its first step is to open the Windows event log, and it leaves with 1 («Error setting up logging: Accesso negato»)
when that is refused, as it is to a logon without a desktop of the person (an ssh login, a service, a scheduled task); the same
program lives from the desktop of the same user. Podman 6.1.4 and newer go on without the log.

Now: a logon that may not write to the event log, with an old Podman and no pipe yet, stops BEFORE the machine is touched (exit 26,
`podman_api_forwarding_unavailable`, «run it from the Windows desktop»); with the pipe missing after the start there is one stop and
start of the machine (only when this run started it or it holds no container) and then the same stop with the cause Windows logged.

The functions are read from the real scripts (the harness of test_windows_podman_wsl_branches), with stand-ins for what Windows says.
"""
from __future__ import annotations

import re

import pytest

from test_windows_podman_wsl_branches import (
    ENABLER,
    INSTALLER,
    INFO,
    INIT,
    MACHINE_BLOCK_BODY,
    PODMAN_CASES,
    ROOT,
    START,
    WELCOME,
    _fake,
    _machines,
    _phases,
    _run,
)

STOP = "machine stop jht-podman"
LIST = "machine list --format json"
PS = "--connection jht-podman ps --quiet"


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _block(tmp_path, *, machines: str, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    return _run(tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase", "Get-JhtPodmanPipeAdvice", "Wait-JhtPodmanPipe",
                                    "Get-JhtPodmanPipeWaitMilliseconds", "Get-JhtApiForwardingFailure", "Test-JhtWinSshProxyNeedsEventLog"],
                MACHINE_BLOCK_BODY, {
        "FAKE_PODMAN": str(bin_dir / "podman.exe"), "FAKE_MACHINES": machines, "INITIALIZE": "1", "FAKE_FAIL": "",
        "WELCOME": WELCOME, "JHT_PIPE_WAIT_SECONDS": "1", "FAKE_PS": "", **env,
    })


STOPPED = _machines(("jht-podman", False))
RUNNING = _machines(("jht-podman", True))


def test_a_pipe_that_is_there_after_the_start_changes_nothing(tmp_path):
    result, calls = _block(tmp_path, machines=STOPPED, FAKE_PIPE="connected")
    assert result.returncode == 0, result.stderr
    assert calls == [LIST, START, INFO]


def test_a_pipe_missing_after_the_start_gets_one_stop_and_start_and_then_goes_on(tmp_path):
    # the second `machine start` brings the forwarding up
    result, calls = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_PIPE_AFTER_STARTS="2")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [LIST, START, INFO, STOP, START, INFO]
    assert "restarting the machine once" in result.stdout
    # the restart is not a phase of its own: the phases the app counts stay what they were
    assert _phases(result.stdout) == ["podman_machine_start"]


def test_a_pipe_still_missing_after_the_one_restart_stops_with_exit_26_and_the_cause_windows_logged(tmp_path):
    result, calls = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_REASON="Error setting up proxies: boom", FAKE_SESSION="1")
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 26, result.stdout + err
    assert calls == [LIST, START, INFO, STOP, START, INFO], "one restart, never a second"
    first = err.strip().splitlines()[0]
    assert first.startswith("podman_api_forwarding_unavailable: Podman's connection for Docker tools (win-sshproxy.exe) did not start for the machine jht-podman")
    assert "(the machine was restarted once and it did not start again)" in first
    assert "Windows says: Error setting up proxies: boom" in first
    assert "session 0" not in first
    assert err.isascii()


def test_without_a_reason_in_the_log_it_says_where_to_look(tmp_path):
    result, _ = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_REASON="")
    assert result.returncode == 26
    assert 'Windows did not say why: Event Viewer > Windows Logs > Application, source ".NET Runtime".' in result.stderr


def test_from_session_0_the_stop_says_to_run_it_from_the_desktop(tmp_path):
    result, _ = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_SESSION="0")
    assert result.returncode == 26
    assert "session 0 (an ssh login, a service or a scheduled task)" in result.stderr
    assert "Windows desktop of this user, not from ssh" in result.stderr


def test_a_running_machine_with_containers_is_never_stopped_for_the_pipe(tmp_path):
    result, calls = _block(tmp_path, machines=RUNNING, FAKE_PIPE="absent", FAKE_PS="abc123\ndef456")
    assert result.returncode == 26, result.stdout + result.stderr
    assert calls == [LIST, INFO, PS], calls
    assert "restarted" not in result.stderr


def test_a_running_machine_with_no_container_may_be_restarted_once(tmp_path):
    result, calls = _block(tmp_path, machines=RUNNING, FAKE_PIPE="absent", FAKE_PS="", FAKE_PIPE_AFTER_STARTS="1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [LIST, INFO, PS, STOP, START, INFO]


def test_when_the_containers_cannot_be_listed_the_machine_is_left_as_it_is(tmp_path):
    result, calls = _block(tmp_path, machines=RUNNING, FAKE_PIPE="absent", FAKE_FAIL="ps")
    assert result.returncode == 26
    assert STOP not in calls


@pytest.mark.parametrize("pipe", ["unknown", "busy", "connected"])
def test_a_pipe_that_cannot_be_told_or_answers_is_not_a_reason_to_stop(tmp_path, pipe):
    result, calls = _block(tmp_path, machines=STOPPED, FAKE_PIPE=pipe)
    assert result.returncode == 0, result.stdout + result.stderr
    assert STOP not in calls


# ── a logon that may not write to the event log, before anything is touched ──


@pytest.mark.parametrize("machines", [_machines(), STOPPED, RUNNING], ids=["no-machine-yet", "stopped", "running"])
def test_a_logon_without_the_event_log_stops_before_the_machine_is_created_or_started(tmp_path, machines):
    result, calls = _block(tmp_path, machines=machines, FAKE_PIPE="absent", FAKE_EVENTLOG="denied")
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 26, result.stdout + err
    assert calls == [], f"nothing is run, not even the list of machines: {calls}"
    first = err.strip().splitlines()[0]
    assert first.startswith("podman_api_forwarding_unavailable: Podman's connection for Docker tools (win-sshproxy.exe) cannot start for the machine jht-podman")
    assert "may not write to the Windows event log" in first and "ssh login, a service or a scheduled task" in first
    assert "Run the installer from the Windows desktop of this user (Start menu, Windows PowerShell), not from ssh." in first
    assert err.isascii()


def test_a_pipe_that_is_already_there_is_not_refused_for_the_event_log(tmp_path):
    # the machine was started from the desktop earlier: this ssh run only reuses it
    result, calls = _block(tmp_path, machines=RUNNING, FAKE_PIPE="connected", FAKE_EVENTLOG="denied")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [LIST, INFO]


@pytest.mark.parametrize("version", ["6.1.4", "6.2.0", "7.0.0"])
def test_a_podman_whose_win_sshproxy_goes_on_without_the_log_is_not_refused(tmp_path, version):
    result, calls = _block(tmp_path, machines=STOPPED, FAKE_PIPE="connected", FAKE_EVENTLOG="denied", FAKE_PODMAN_VERSION=version)
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [LIST, START, INFO]


def test_a_logon_that_may_write_or_that_cannot_be_asked_is_not_refused(tmp_path):
    for answer in ("writable", "unknown"):
        folder = tmp_path / answer
        folder.mkdir()
        result, _ = _block(folder, machines=STOPPED, FAKE_PIPE="connected", FAKE_EVENTLOG=answer)
        assert result.returncode == 0, (answer, result.stdout + result.stderr)


def test_the_final_stop_does_not_blame_the_logon_when_it_may_write_to_the_log(tmp_path):
    result, _ = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_EVENTLOG="writable")
    assert result.returncode == 26
    assert "may not write to the Windows event log" not in result.stderr


def test_nor_with_a_podman_whose_win_sshproxy_does_not_need_the_log(tmp_path):
    result, _ = _block(tmp_path, machines=STOPPED, FAKE_PIPE="absent", FAKE_EVENTLOG="denied", FAKE_PODMAN_VERSION="6.2.0", FAKE_REASON="x")
    assert result.returncode == 26
    assert "may not write to the Windows event log" not in result.stderr and "Windows says: x" in result.stderr


# ── the pieces ──


def _pieces(tmp_path, body: str, imports: list[str], env: dict | None = None):
    (tmp_path / "bin").mkdir()
    result, _ = _run(tmp_path, ENABLER, imports, body, env or {})
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.replace("\r\n", "\n")


@pytest.mark.parametrize(("version", "needs"), [
    ("6.0.2", True), ("6.1.0", True), ("6.1.3", True), ("6.1.4", False), ("6.1.10", False), ("6.2.0", False), ("7.0.0", False),
    ("", True), ("garbage", True),
])
def test_the_podman_versions_whose_win_sshproxy_needs_the_log(tmp_path, version, needs):
    out = _pieces(tmp_path, "[Console]::Out.WriteLine('NEEDS=' + [string](Test-JhtWinSshProxyNeedsEventLog -PodmanVersion $env:V))",
                  ["Test-JhtWinSshProxyNeedsEventLog"], {"V": version})
    assert f"NEEDS={needs}" in out


@pytest.mark.parametrize(("seconds", "milliseconds"), [("", 5000), ("1", 1000), ("30", 30000), ("31", 5000), ("x", 5000), ("-1", 5000), ("0", 0)])
def test_the_wait_for_the_pipe_is_a_few_seconds_and_only_digits_change_it(tmp_path, seconds, milliseconds):
    out = _pieces(tmp_path, "[Console]::Out.WriteLine('MS=' + (Get-JhtPodmanPipeWaitMilliseconds -Seconds $env:S))",
                  ["Get-JhtPodmanPipeWaitMilliseconds"], {"S": seconds})
    assert f"MS={milliseconds}" in out


def test_the_wait_answers_at_once_for_anything_but_absent_and_gives_up_on_absent(tmp_path):
    # one PowerShell for the four states: a start of Windows PowerShell 5.1 costs seconds on the gate's runner
    body = """
function Get-JhtPodmanPipeState { param([string]$MachineName) return $script:State }
foreach ($script:State in 'connected', 'denied', 'unknown', 'absent') {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $state = Wait-JhtPodmanPipe -MachineName 'jht-podman' -Milliseconds 600
  [Console]::Out.WriteLine('STATE=' + $state + ' MS=' + $watch.ElapsedMilliseconds)
}
"""
    out = _pieces(tmp_path, body, ["Wait-JhtPodmanPipe", "Get-JhtPodmanPipeWaitMilliseconds"])
    elapsed = {state: int(ms) for state, ms in re.findall(r"^STATE=(\w+) MS=(\d+)$", out, re.M)}
    assert set(elapsed) == {"connected", "denied", "unknown", "absent"}, out
    assert elapsed["absent"] >= 600, "absent is asked again until the wait is over"
    for state in ("connected", "denied", "unknown"):
        assert elapsed[state] < elapsed["absent"], (state, elapsed)


FAKE_EVENTS = r"""
function New-JhtFakeEvent { param([string]$Text, [bool]$AsProperty = $true)
  $properties = if ($AsProperty) { @([pscustomobject]@{ Value = $Text }) } else { @() }
  [pscustomobject]@{ Properties = $properties; Message = "The description for Event ID 1000 cannot be found. The following information was included: $Text" } }
function Get-WinEvent { param($FilterHashtable, $ErrorAction)
  if ($env:EVENTS_THROW) { throw 'The Event log is not readable' }
  $script:FilterSeen = $FilterHashtable
  switch ($env:EVENTS) {
    'none' { return @() }
    'mixed' {
      return @(
        (New-JhtFakeEvent '[info ] jht-podman-other: Listening on: \\.\pipe\podman-other'),
        (New-JhtFakeEvent '[error] jht-podman-other: Error setting up proxies: someone elses'),
        (New-JhtFakeEvent ("[error] jht-podman-ab12cd34: Error setting up proxies: error listening on socket: Access is denied" + [char]0x00E8 + "`nsecond line")),
        (New-JhtFakeEvent '[error] jht-podman-ab12cd34: older line'))
    }
    'message' { return @((New-JhtFakeEvent '[warning] jht-podman-ab12cd34: from the message' $false)) }
    'long' { return @((New-JhtFakeEvent ('[error] jht-podman-ab12cd34: ' + ('x' * 500)))) }
    'unrelated' { return @((New-JhtFakeEvent 'Application: something.exe crashed')) }
  }
}
"""


def _reason(tmp_path, events: str, **env):
    body = FAKE_EVENTS + "[Console]::Out.WriteLine('REASON=<' + (Get-JhtWinSshProxyReason -MachineName 'jht-podman-ab12cd34') + '>')\n[Console]::Out.WriteLine('LOG=' + $script:FilterSeen.LogName + '|' + $script:FilterSeen.ProviderName)"
    out = _pieces(tmp_path, body, ["Get-JhtWinSshProxyReason"], {"EVENTS": events, **env})
    return re.search(r"^REASON=<(.*)>$", out, re.M).group(1), out


def test_the_reason_is_the_newest_line_of_this_machine_in_the_dot_net_runtime_log(tmp_path):
    reason, out = _reason(tmp_path, "mixed")
    # another machine's lines and the older line are not it; the first line only; ASCII
    assert reason == "Error setting up proxies: error listening on socket: Access is denied?"
    assert "LOG=Application|.NET Runtime" in out


def test_the_reason_is_found_in_the_message_when_there_is_no_insertion_string(tmp_path):
    assert _reason(tmp_path, "message")[0] == "from the message"


def test_the_reason_is_short(tmp_path):
    assert len(_reason(tmp_path, "long")[0]) == 300


@pytest.mark.parametrize("events", ["none", "unrelated"])
def test_no_line_of_this_machine_is_no_reason(tmp_path, events):
    assert _reason(tmp_path, events)[0] == ""


def test_a_log_that_cannot_be_read_is_no_reason_and_no_error(tmp_path):
    assert _reason(tmp_path, "mixed", EVENTS_THROW="1")[0] == ""


def test_the_probe_of_the_event_log_answers_unknown_where_there_is_no_windows(tmp_path):
    out = _pieces(tmp_path, "[Console]::Out.WriteLine('ANSWER=' + (Test-JhtEventLogWritable))", ["Test-JhtEventLogWritable"])
    assert re.search(r"^ANSWER=(writable|denied|unknown)$", out, re.M)


# ── what the person and the app are told ──


def test_the_order_in_the_enabler_is_the_early_question_then_the_machine_then_the_pipe_then_everything_else():
    source = ENABLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    # the machine block: from its flag to the network script that comes after it
    start = source.index("$machineCreatedHere = $false")
    block = source[start:source.index("configure-podman-windows-network.ps1", start)]
    early = block.index("Test-JhtEventLogWritable) -ceq 'denied'")
    assert block.index("$pipeAtStart = Get-JhtPodmanPipeState") < early < block.index("'machine' 'init'")
    assert block.index("'machine' 'init'") < block.index("'machine' 'start'") < block.index("'--connection' $MachineName 'info'")
    assert block.index("'--connection' $MachineName 'info'") < block.index("$pipeState = Wait-JhtPodmanPipe")
    assert source.count("exit 26") == 1 and "-clike 'podman_api_forwarding_unavailable: *'" in source


def test_the_installer_says_what_to_do_for_exit_26():
    source = INSTALLER.read_text(encoding="utf-8").replace("\r\n", "\n")
    block = source[source.index("    26 {"):]
    block = block[:block.index("    default {")]
    assert "win-sshproxy.exe" in block and "Windows desktop of this user" in block and "not from ssh" in block
    assert "Run the same install command again" not in block and "$again" in block
    # from the desktop the install passes without a restart or `wsl --shutdown` (measured): a restart is only the last resort
    assert block.index("$again") < block.index("restart Windows") and "Only if it stops here again from the desktop" in block


def test_the_app_names_the_code_and_says_the_same_thing():
    rust = (ROOT / "desktop" / "src-tauri" / "src" / "windows_runtime.rs").read_text(encoding="utf-8")
    assert '26 => Some("podman_api_forwarding_unavailable")' in rust
    catalog = (ROOT / "desktop" / "src" / "lib" / "error-catalog.ts").read_text(encoding="utf-8")
    start = catalog.index("  podman_api_forwarding_unavailable: copy(")
    entry = catalog[start:catalog.index("\n  ),", start)]
    assert "win-sshproxy.exe" in entry and "SSH" in entry and "desktop di Windows" in entry and "Windows desktop" in entry
    locales = (ROOT / "desktop" / "src" / "lib" / "error-catalog.locales.ts").read_text(encoding="utf-8")
    english = "Podman started the machine, but its connection for Docker tools (win-sshproxy.exe) did not start, so the team cannot be started."
    assert f'podman_api_forwarding_unavailable: translated("{english}")' in locales
    block = locales[locales.index(f'"{english}": {{'):]
    block = block[:block.index("\n  },")]
    assert [line.split(":")[0].strip() for line in block.splitlines()[1:]] == ["de", "es", "fr", "hu", "pt"]


# ── `jht up` with the machine stopped: the same checks in the bridge ──

UP_MACHINE = "jht-podman-ab12cd34"
UP_CASES = f'''  "--connection {UP_MACHINE} info") [ -f "$FAKE_STATE" ] && exit 0; echo 'Error: not running' >&2; exit 125 ;;
  "machine start --update-connection=false {UP_MACHINE}") : > "$FAKE_STATE"; exit 0 ;;
  "machine stop {UP_MACHINE}") rm -f "$FAKE_STATE"; exit 0 ;;
  "--version") echo "podman version ${{FAKE_PODMAN_VERSION:-6.0.2}}"; exit 0 ;;'''

UP_BODY = rf"""
. $env:JHT_PODMAN_BRIDGE
function Get-JhtPodmanPipeState {{
  param([string]$MachineName)
  $starts = @(Get-Content -LiteralPath $env:FAKE_LOG | Where-Object {{ $_ -like 'machine start *' }}).Count
  if ($env:FAKE_PIPE_AFTER_STARTS -and $starts -ge [int]$env:FAKE_PIPE_AFTER_STARTS) {{ return 'connected' }}
  if ($env:FAKE_PIPE) {{ return $env:FAKE_PIPE }}
  return 'connected'
}}
function Get-JhtWinSshProxyReason {{ param([string]$MachineName) return [string]$env:FAKE_REASON }}
function Get-JhtWindowsSessionId {{ if ($env:FAKE_SESSION) {{ return [int]$env:FAKE_SESSION }}; return 1 }}
function Test-JhtEventLogWritable {{ if ($env:FAKE_EVENTLOG) {{ return $env:FAKE_EVENTLOG }}; return 'writable' }}
Start-JhtPodmanMachineForUp -Runtime podman -Connection '{UP_MACHINE}'
[Console]::Out.WriteLine('UP_DONE')
"""


def _up(tmp_path, *, running: bool = False, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", UP_CASES)
    if running:
        (tmp_path / "state").write_text("", encoding="utf-8")
    bridge = ENABLER.parent / "podman-machine-bridge.ps1"
    result, calls = _run(tmp_path, bridge, [], UP_BODY, {"JHT_PODMAN_BRIDGE": str(bridge), "JHT_PIPE_WAIT_SECONDS": "1", **env})
    return result, [call for call in calls if call != "--version"]


UP_INFO = f"--connection {UP_MACHINE} info"
UP_START = f"machine start --update-connection=false {UP_MACHINE}"
UP_STOP = f"machine stop {UP_MACHINE}"


def test_jht_up_with_a_pipe_that_comes_up_changes_nothing(tmp_path):
    result, calls = _up(tmp_path, FAKE_PIPE="connected")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UP_DONE" in result.stdout and UP_STOP not in calls and calls.count(UP_START) == 1


def test_jht_up_restarts_a_machine_it_started_once_when_the_pipe_is_missing(tmp_path):
    result, calls = _up(tmp_path, FAKE_PIPE="absent", FAKE_PIPE_AFTER_STARTS="2")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UP_DONE" in result.stdout
    assert calls.count(UP_START) == 2 and calls.count(UP_STOP) == 1


def test_jht_up_stops_with_exit_26_and_the_cause_when_the_pipe_never_comes(tmp_path):
    result, calls = _up(tmp_path, FAKE_PIPE="absent", FAKE_REASON="Error setting up proxies: boom", FAKE_SESSION="0")
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 26, result.stdout + err
    assert "UP_DONE" not in result.stdout
    assert calls.count(UP_START) == 2 and calls.count(UP_STOP) == 1, "one restart, never a second"
    assert err.startswith("podman_api_forwarding_unavailable: ") and "(the machine was restarted once and it did not start again)" in err
    assert "Windows says: Error setting up proxies: boom" in err
    assert "This jht command runs in Windows session 0" in err and "installer" not in err


def test_jht_up_does_not_even_start_the_machine_for_a_logon_without_the_event_log(tmp_path):
    result, calls = _up(tmp_path, FAKE_PIPE="absent", FAKE_EVENTLOG="denied", FAKE_PODMAN_VERSION="6.0.2")
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 26, result.stdout + err
    assert calls == [UP_INFO], calls
    assert "cannot start for the machine" in err and "Run the jht command from the Windows desktop of this user" in err
    assert "installer" not in err


def test_jht_up_does_not_refuse_a_podman_that_goes_on_without_the_log(tmp_path):
    result, calls = _up(tmp_path, FAKE_PIPE="connected", FAKE_EVENTLOG="denied", FAKE_PODMAN_VERSION="6.2.0")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls.count(UP_START) == 1


def test_jht_up_leaves_a_machine_that_already_answers_alone(tmp_path):
    # nothing is started by this call: whatever runs in it is not touched, and no pipe is asked about
    result, calls = _up(tmp_path, running=True, FAKE_PIPE="absent", FAKE_EVENTLOG="denied")
    assert result.returncode == 0, result.stdout + result.stderr
    assert calls == [UP_INFO]


def test_the_wrapper_and_the_bridge_say_the_same_words():
    bridge = (ENABLER.parent / "podman-machine-bridge.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    up = bridge[bridge.index("function Start-JhtPodmanMachineForUp"):]
    assert "-BeforeStart $beforeStart" in up and "exit 26" in up and "-What 'jht command'" in up
    assert bridge.count("function Get-JhtApiForwardingFailure") == 1


def test_the_before_start_check_is_no_closure_because_the_wrapper_dot_sources_the_bridge_inside_a_function():
    # `. $PodmanMachineBridgePath` runs inside Start-PodmanMachineForUp: its functions live in that scope, which a closure (a
    # dynamic module) does not see. The test harness dot-sources the bridge at script level and would not show it.
    bridge = (ENABLER.parent / "podman-machine-bridge.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    up = bridge[bridge.index("function Start-JhtPodmanMachineForUp"):]
    assert "GetNewClosure" not in up.replace("# No .GetNewClosure()", "")
    wrapper = (ENABLER.parent / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    start = wrapper[wrapper.index("function Start-PodmanMachineForUp"):]
    assert start.index(". $PodmanMachineBridgePath") < start.index("Start-JhtPodmanMachineForUp -Runtime")
