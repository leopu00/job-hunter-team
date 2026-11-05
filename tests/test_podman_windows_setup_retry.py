"""Windows runtime setup: the egress proxies are awaited and checked one by one, and a Try again
after a later failure gets past the Podman install.

On a fresh Windows profile `configure-podman-windows-network.ps1` failed its proxy checks right
after systemd printed «changed on disk, run daemon-reload» for the new units: a Type=simple
service was still starting, and the check was one silent `&&` chain. Never a reload in Podman's
WSL machine (it hung systemd on 09/10, see test_windows_desktop_local_runtime): a unit systemd
says needs one (NeedDaemonReload=yes) takes the machine restart; the proxies are awaited until
they listen; each check prints what it asked and what came back; any failure is ONE stable code,
podman_network_unready, exit 23.

On a Try again winget answered 0x8A15002B (already installed, no applicable update) because the
process did not see Podman in its PATH yet, and that was podman_not_installable: Podman is now
found first, the installed version decides, and another version is podman_version_mismatch, 24.

On a computer with two Windows users winget said «already installed» for the second one while
podman.exe sat only in the first one's profile: exit 21, podman_not_installable, and a text that
pointed at the network. Podman is now also looked for where its MSI installs it (this user's
Programs, the InstallDir it registers, Program Files); then winget runs once more for this user,
and if that leaves no podman.exe it is its own code, podman_other_user, 25.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path

import pytest

from windows_native_fakes import (
    ENGINE_CHECK, WINDOWS, assert_engine, expected_engine, git_bash, install_fake, launcher, powershell_argv, windows_env,
)

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
PWSH = shutil.which("pwsh")

# Off Windows these need pwsh; on Windows they run under JHT_TEST_SHELL (windows_native_fakes),
# where a missing shell fails instead of skipping.
needs_powershell = pytest.mark.skipif(not WINDOWS and PWSH is None, reason="needs PowerShell")


def _ps(tmp_path: Path, text: str, *, bin_dirs=(), extra=None, timeout=60) -> subprocess.CompletedProcess:
    """Runs `text` as a script under the PowerShell under test and checks the engine that ran it.
    On Windows the case gets windows_env and a PATH with only `bin_dirs`."""
    script = tmp_path / "case.ps1"
    engine = tmp_path / "engine.txt"
    engine.unlink(missing_ok=True)
    script.write_text(ENGINE_CHECK + text, encoding="utf-8")
    if WINDOWS:
        env = {**windows_env(tmp_path), "PATH": os.pathsep.join(map(str, bin_dirs))}
    else:
        env = {"PATH": os.pathsep.join([*map(str, bin_dirs), "/usr/bin", "/bin"])}
    env.update({"HOME": str(tmp_path), "JHT_ENGINE_FILE": str(engine), **(extra or {})})
    done = subprocess.run([*powershell_argv(), "-File", str(script)], capture_output=True, text=True,
                          timeout=timeout, env=env)
    assert_engine(engine, done.stderr)
    return done


def _ps_make_podman(path: Path, version: str) -> str:
    """PowerShell lines that put a fake podman.exe answering `--version` at `path` (what winget leaves)."""
    if not WINDOWS:
        return (f"  Set-Content -LiteralPath '{path}' -Value \"#!/bin/sh`necho 'podman version {version}'\"\n"
                f"  & chmod 755 '{path}'\n")
    # -NoNewline: 5.1's Set-Content would end the line with CRLF, and bash would print the \r too.
    return (f"  Copy-Item -LiteralPath '{launcher()}' -Destination '{path}'\n"
            f"  Set-Content -NoNewline -LiteralPath '{path.with_suffix('.sh')}' "
            f"-Value \"#!/bin/sh`necho 'podman version {version}'`n\"\n")


def _proxy_check() -> str:
    source = NETWORK.read_text(encoding="utf-8")
    start = source.index("$proxyCheck = @'\n") + len("$proxyCheck = @'\n")
    return source[start : source.index("\n'@", start)] + "\n"


# A fake curl that answers as curl does through an http proxy. For http:// the proxy answers the
# request itself: its code is http_code. For https:// curl first asks the proxy for a tunnel
# (CONNECT), and http_connect is the proxy's answer to that. The table gives, for "<port> <url>":
#   NNN          what came back (for https, through a tunnel the proxy opened: CONNECT 200)
#   connect-NNN  the proxy refused the CONNECT with NNN: http_code 000, exit 56, as curl does
#   (no row)     nothing answered: both 000, exit 7
# Until 22/10 the fake printed the refusal's 403 as http_code, which real curl never does: the
# check read http_code, stayed green here, and failed on every clean Windows PC.
FAKE_CURL = r"""#!/bin/sh
port=""; url=""; format=""
while [ $# -gt 0 ]; do
  case "$1" in
    --proxy) port="${2##*:}"; shift 2 ;;
    --write-out) format="$2"; shift 2 ;;
    --output|--max-time|--noproxy) shift 2 ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done
# every call is written down, to count the tries of a check; CURL_FAIL_FIRST=N makes the first N calls to
# api.telegram.org fail the way a reset TLS handshake does (exit 35, nothing printed but the zero codes)
printf '%s %s\n' "$port" "$url" >> "$CURL_TABLE.log"
if [ -n "${CURL_FAIL_FIRST:-}" ] && [ "$url" = "https://api.telegram.org/" ]; then
  calls="$(grep -c ' https://api.telegram.org/$' "$CURL_TABLE.log")"
  if [ "$calls" -le "$CURL_FAIL_FIRST" ]; then
    printf %s "$format" | sed -e "s/%{http_code}/000/" -e "s/%{http_connect}/000/"
    exit 35
  fi
fi
answer="$(awk -v key="$port $url" '$1" "$2 == key { print $3; exit }' "$CURL_TABLE")"
code=000; connect=000; rc=0
case "$answer" in
  "") rc=7 ;;
  connect-*) connect="${answer#connect-}"; rc=56 ;;
  *) code="$answer"; case "$url" in https://*) connect=200 ;; esac ;;
esac
printf %s "$format" | sed -e "s/%{http_code}/$code/" -e "s/%{http_connect}/$connect/"
exit $rc
"""

def _listen():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(16)
    return sock


@pytest.fixture()
def machine(tmp_path):
    """Three proxies listening, a fake curl, and the check run as the machine runs it."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "curl").write_text(FAKE_CURL, encoding="utf-8")
    (bin_dir / "curl").chmod(0o755)
    sockets = [_listen() for _ in range(3)]
    ports = [s.getsockname()[1] for s in sockets]
    table = tmp_path / "curl-table"

    # the two https refusals are refused CONNECTs; the http one is the proxy's own 403
    def answers(agent_ghcr=401, broker_ghcr=401, telegram=200, agent_imap="connect-403", broker_http=403,
                telegram_other="connect-403"):
        rows = [
            (ports[0], "https://ghcr.io/v2/", agent_ghcr), (ports[1], "https://ghcr.io/v2/", broker_ghcr),
            (ports[2], "https://api.telegram.org/", telegram), (ports[0], "https://example.com:993/", agent_imap),
            (ports[1], "http://example.com/", broker_http), (ports[2], "https://example.com/", telegram_other),
        ]
        table.write_text("".join(f"{p} {u} {a}\n" for p, u, a in rows if a is not None), encoding="utf-8")

    def run(ready_seconds=5, check_ports=None, extra_env=None):
        if WINDOWS:
            # Git's bash by path: `bash` on a Windows PATH can be WSL's. The fakes first, then Git's tools.
            bash = str(git_bash())
            env = {**windows_env(tmp_path), "PATH": os.pathsep.join([str(bin_dir), str(git_bash().parent)])}
        else:
            bash = "bash"
            env = {"PATH": f"{bin_dir}:/usr/bin:/bin"}
        # no pause between the tries of a check here: the test is about how many, not how long
        env.update({"CURL_TABLE": str(table), "JHT_PROXY_READY_SECONDS": str(ready_seconds), "JHT_PROXY_PAUSE": "0", **(extra_env or {})})
        (tmp_path / "curl-table.log").unlink(missing_ok=True)
        started = time.monotonic()
        done = subprocess.run([bash, "-s", "--", *map(str, check_ports or ports)], input=_proxy_check(),
                              capture_output=True, text=True, env=env, timeout=60)
        return done, time.monotonic() - started

    answers()
    def calls():
        log = tmp_path / "curl-table.log"
        return log.read_text(encoding="utf-8").splitlines() if log.exists() else []

    yield type("Machine", (), {"ports": ports, "answers": answers, "run": run, "sockets": sockets, "calls": calls})
    for sock in sockets:
        sock.close()


def _checks(stdout: str):
    return [line.split()[1:] for line in stdout.splitlines() if line.startswith("JHT_PROXY_CHECK ")]


def test_the_three_proxies_pass_and_every_check_says_what_it_asked_and_got(machine):
    done, _ = machine.run()
    assert done.returncode == 0, done.stdout + done.stderr
    agent, broker, telegram = map(str, machine.ports)
    assert _checks(done.stdout) == [
        ["agent", agent, "https://ghcr.io/v2/", "401", "401"],
        ["broker", broker, "https://ghcr.io/v2/", "401", "401"],
        ["telegram", telegram, "https://api.telegram.org/", "reachable", "200"],
        ["agent", agent, "https://example.com:993/", "403", "403"],
        ["broker", broker, "http://example.com/", "403", "403"],
        ["telegram", telegram, "https://example.com/", "403", "403"],
    ]


def test_a_moment_of_the_network_does_not_fail_the_check_but_a_proxy_that_stays_wrong_does(machine):
    # curl 35 on the telegram check in the first run of the Windows Podman job that got that far (T146): twice, then it answers
    machine.answers()
    done, _ = machine.run(extra_env={"CURL_FAIL_FIRST": "2"})
    assert done.returncode == 0, done.stdout + done.stderr
    telegram = str(machine.ports[2])
    assert ["telegram", telegram, "https://api.telegram.org/", "reachable", "200"] in _checks(done.stdout)
    assert [call for call in machine.calls() if call.endswith("https://api.telegram.org/")] == [f"{telegram} https://api.telegram.org/"] * 3
    # three in all and no more: a network that stays down is a red check, named
    done, _ = machine.run(extra_env={"CURL_FAIL_FIRST": "99"})
    assert done.returncode == 1
    assert ["telegram", telegram, "https://api.telegram.org/", "reachable", "curl-35"] in _checks(done.stdout)
    # three tries, then the diagnosis asks twice more (straight from the machine, and through the proxy again)
    assert len([call for call in machine.calls() if call.endswith("https://api.telegram.org/")]) == 3 + 2


def test_a_check_that_stays_red_says_what_the_machine_gets_straight_and_through_the_proxy(machine):
    machine.answers(telegram=None)
    done, _ = machine.run()
    assert done.returncode == 1
    diag = [line for line in done.stdout.splitlines() if line.startswith("JHT_PROXY_DIAG ")]
    assert [line.split()[1:3] for line in diag] == [["telegram", "direct"], ["telegram", "via-proxy"]], diag
    # nothing answers either way in this table: curl's exit 7 is what each line carries, not only the word
    assert all(" exit=7 " in line for line in diag), diag
    # the straight one is asked with --noproxy '*', so a proxy in the machine's environment cannot make it indirect
    source = NETWORK.read_text(encoding="utf-8")
    assert "--noproxy '*' --write-out '%{http_code}' \"$url\"" in source
    # a green check, and a refusal that is wrong, say nothing more: the diagnosis is for what leaves the machine
    machine.answers()
    done, _ = machine.run()
    assert "JHT_PROXY_DIAG" not in done.stdout
    machine.answers(agent_imap=403)
    done, _ = machine.run()
    assert done.returncode == 1 and "JHT_PROXY_DIAG" not in done.stdout


def test_a_refusal_is_asked_once_so_a_proxy_that_lets_the_wrong_thing_through_gets_no_second_look(machine):
    agent = str(machine.ports[0])
    machine.answers(agent_imap=403)  # the agent proxy opens the tunnel to the mail port instead of refusing it
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["agent", agent, "https://example.com:993/", "403", "200"] in _checks(done.stdout)
    assert machine.calls().count(f"{agent} https://example.com:993/") == 1
    # what leaves the machine and is wrong IS asked three times (ghcr.io answering nothing)
    machine.answers(agent_ghcr=None)
    done, _ = machine.run()
    assert done.returncode == 1
    # three tries, and the diagnosis asks through the proxy once more
    assert machine.calls().count(f"{agent} https://ghcr.io/v2/") == 3 + 1


def test_a_wrong_answer_is_named_with_its_proxy_and_the_other_checks_still_run(machine):
    machine.answers(broker_ghcr=None)  # the broker proxy cannot reach ghcr.io
    done, _ = machine.run()
    assert done.returncode == 1
    checks = _checks(done.stdout)
    assert ["broker", str(machine.ports[1]), "https://ghcr.io/v2/", "401", "000"] in checks
    assert len(checks) == 6  # no silent chain: every check is reported
    machine.answers(telegram=None)
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["telegram", str(machine.ports[2]), "https://api.telegram.org/", "reachable", "curl-7"] in _checks(done.stdout)


def test_an_https_refusal_is_the_proxys_answer_to_the_connect(machine):
    agent, broker, telegram = map(str, machine.ports)
    # no answer to the CONNECT (000 for both codes): not a refusal, a wrong answer
    machine.answers(telegram_other=None)
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["telegram", telegram, "https://example.com/", "403", "000"] in _checks(done.stdout)
    # the proxy opened the tunnel and the target itself said 403: the proxy did not refuse
    machine.answers(agent_imap=403)
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["agent", agent, "https://example.com:993/", "403", "200"] in _checks(done.stdout)
    # an http target is still read from http_code: the proxy's own 403 passes, a 200 does not
    machine.answers(broker_http=200)
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["broker", broker, "http://example.com/", "403", "200"] in _checks(done.stdout)
    # the positive https checks still read the target's answer through the tunnel
    machine.answers(agent_ghcr="connect-403")
    done, _ = machine.run()
    assert done.returncode == 1
    assert ["agent", agent, "https://ghcr.io/v2/", "401", "000"] in _checks(done.stdout)


def _network_check_block() -> str:
    """The trap and the check of configure-podman-windows-network.ps1, as PowerShell runs them."""
    source = NETWORK.read_text(encoding="utf-8")
    trap = source[source.index("trap {") :]
    trap = trap[: trap.index("\n}\n") + 3]
    # up to the check of the cgroup manager that follows it (T87), which needs `podman info`
    check = source[source.index("$proxyCheck = @'") : source.index("$hostInfo = ")]
    return trap + check


# The machine is a fake podman whose `machine ssh` runs the command with bash here, so the real
# base64 hand-off, the real check and the real parsing of its lines run end to end.
FAKE_PODMAN = r"""#!/bin/sh
[ "$1 $2" = "machine ssh" ] || exit 9
shift 3
exec bash -c "$1"
"""


@needs_powershell
@pytest.mark.parametrize(("change", "expected_exit", "expected_line"), [
    ({}, 0, None),
    ({"telegram_other": None}, 23,
     "podman_network_unready: the telegram proxy on 127.0.0.1:{telegram} answered 000 for https://example.com/, "
     "expected 403"),
    ({"agent_imap": 403}, 23,
     "podman_network_unready: the agent proxy on 127.0.0.1:{agent} answered 200 for https://example.com:993/, "
     "expected 403"),
])
def test_the_network_script_passes_a_refused_connect_and_names_a_missing_one(machine, tmp_path, change,
                                                                              expected_exit, expected_line):
    podman = install_fake(tmp_path / "bin", "podman", FAKE_PODMAN)
    agent, broker, telegram = machine.ports
    machine.answers(**change)
    done = _ps(
        tmp_path,
        "$ErrorActionPreference = 'Stop'\n"
        f"$Podman = '{podman}'\n$MachineName = 'jht-podman'\n"
        f"$Port = {agent}\n$BrokerPort = {broker}\n$TelegramPort = {telegram}\n"
        + _network_check_block() + "\nexit 0\n",
        bin_dirs=[tmp_path / "bin"],
        extra={"CURL_TABLE": str(tmp_path / "curl-table"), "JHT_PROXY_READY_SECONDS": "5"},
        timeout=120,
    )
    assert done.returncode == expected_exit, done.stdout + done.stderr
    if expected_line:
        assert expected_line.format(agent=agent, telegram=telegram) in done.stderr
    else:
        assert "JHT_PROXY_CHECK telegram" in done.stdout and done.stderr == ""


def test_a_proxy_that_starts_late_is_awaited_and_one_that_never_listens_is_named(machine):
    late = machine.sockets[2]
    port = late.getsockname()[1]
    late.close()

    def come_up():
        time.sleep(1.5)
        machine.sockets[2] = s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        s.listen(16)

    threading.Thread(target=come_up).start()
    done, took = machine.run(ready_seconds=10)
    assert done.returncode == 0, done.stdout
    assert took >= 1.0  # it waited instead of failing on «connection refused»

    machine.sockets[2].close()
    done, took = machine.run(ready_seconds=2)
    assert done.returncode == 3
    assert f"JHT_PROXY_UNREADY {port}" in done.stdout
    assert took < 10
    assert _checks(done.stdout) == []  # nothing is checked before every proxy listens


# ── the order and the contract, in the scripts themselves ──

def _code(path: Path) -> str:
    return "\n".join(line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))


def test_units_then_restart_when_systemd_asks_for_a_reload_then_start_then_readiness_then_checks():
    code = _code(NETWORK)
    install = code.index("$unitInstall +")
    enable = code.index("systemctl enable --no-reload $runtimeServices", install)
    need = code.index("systemctl show -p NeedDaemonReload --value", enable)
    restart_flag = code.index("in yes) units_changed=1;; esac; done", need)
    restart = code.index("echo JHT_MACHINE_RESTART", restart_flag)
    start = code.index("systemctl start $runtimeServices", restart)
    machine_restart = code.index("'machine' 'stop' $MachineName", start)
    checks = code.index("$proxyCheck = @'", machine_restart)
    run = code.index("base64 -d | bash -s -- $Port $BrokerPort $TelegramPort", checks)
    assert install < enable < need < restart_flag < restart < start < machine_restart < checks < run
    assert "daemon-reload" not in code and "daemon-reexec" not in code
    # the readiness wait comes before the first check, inside the check itself
    check = _proxy_check()
    assert check.index('/dev/tcp/127.0.0.1/$port') < check.index("check agent")


def test_every_failure_of_the_network_script_is_one_stable_code_and_the_enabler_passes_it_on():
    network = NETWORK.read_text(encoding="utf-8")
    trap = network[network.index("trap {") :]
    trap = trap[: trap.index("}") + 1]
    assert 'podman_network_unready: $($_.Exception.Message)' in trap and "exit 23" in trap
    assert network.index("trap {") < network.index("$Podman = (Get-Command podman.exe")
    assert network.rstrip().endswith("exit 0")
    enabler = _code(ENABLER)
    call = enabler.index("& (Join-Path $PSScriptRoot 'configure-podman-windows-network.ps1') -MachineName $MachineName")
    assert enabler[call:].split("\n", 2)[1].strip() == "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"


def test_a_try_again_finds_podman_before_winget_and_the_version_decides():
    enabler = _code(ENABLER)
    block = enabler[enabler.index("if ($InstallDependencies) {") :]
    block = block[: block.index("$Podman = Find-Podman")]
    # Podman is looked for (PATH refreshed, then winget's folder) BEFORE winget runs
    assert block.index("Get-PodmanVersion (Find-Podman)") < block.index("& winget install")
    find = enabler[enabler.index("function Find-Podman {") :]
    find = find[: find.index("\n}\n")]
    assert find.index("Update-ProcessPath") < find.index("Get-Application 'podman.exe'")
    assert "Programs\\Podman\\podman.exe" in find
    # 0x8A15002B, as PowerShell reads a native exit code
    assert re.search(r"\$WingetUpdateNotApplicable = (-?\d+)", enabler).group(1) == str(0x8A15002B - 2**32)
    assert "$wingetCode -ne 0 -and $wingetCode -ne $WingetUpdateNotApplicable" in block
    # after winget the installed version decides: another one is its own code, never «not installable»
    assert block.index("& winget install") < block.index("$installedVersion = Get-PodmanVersion (Find-Podman)")
    assert "Write-PodmanMismatch $installedVersion\n    exit 24" in block
    # JHT-T56: another major is refused before winget runs, so the person's Podman is never changed
    assert block.index("Write-PodmanMismatch $foundVersion\n    exit 24") < block.index("& winget install")
    mismatch = enabler[enabler.index("function Write-PodmanMismatch {") :]
    assert "podman_version_mismatch:" in mismatch[: mismatch.index("\n}\n")]


def test_already_installed_for_another_user_is_installed_for_this_one_or_its_own_code():
    enabler = _code(ENABLER)
    block = enabler[enabler.index("if ($InstallDependencies) {") :]
    block = block[: block.index("$Podman = Find-Podman")]
    find = enabler[enabler.index("function Find-Podman {") :]
    find = find[: find.index("\n}\n")]
    # the MSI's two folders and the folder it registers, after PATH
    defaults = enabler[enabler.index("$PodmanRegistryPaths = ") :].split("\n", 1)[0]
    assert "'HKCU:\\SOFTWARE\\Podman', 'HKLM:\\SOFTWARE\\Podman'" in defaults
    for where in ("foreach ($key in $RegistryPaths)", "-Name 'InstallDir'", "Join-Path $ProgramFilesPath 'Podman\\podman.exe'"):
        assert find.index("Get-Application 'podman.exe'") < find.index(where), where
    # still one winget command (inside the consent guard), its second pass for this user only
    assert block.count("& winget install") == 1
    # the MSI asked for this user (its dual scope), never winget's --scope: the manifest declares none
    assert ("$scope = if ($forThisUser) { @('--force', '--override', '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1') }"
            " else { @() }") in block
    assert "'--scope'" not in block
    assert block.index("if ($wingetCode -ne $WingetUpdateNotApplicable -or (Find-Podman)) { break }") > block.index("& winget install")
    # what the second pass leaves decides; then its own code, after the try and before the version check
    assert "if ($forThisUser) { $otherUser = -not (Find-Podman); break }" in block
    other = block[block.index("if ($otherUser) {") :]
    other = other[: other.index("}") + 1]
    assert "podman_other_user:" in other and "exit 25" in other
    assert block.index("} catch {") < block.index("if ($otherUser) {") < block.index("$installedVersion =")
    # not a download that failed: no network in the line the app keeps
    assert not re.search(r"(?i)internet|network|connection|download", other)


# ── the same block, run by PowerShell with a fake winget and a fake podman ──



def _enabler_functions() -> str:
    source = ENABLER.read_text(encoding="utf-8")
    registry_paths = source[source.index("$PodmanRegistryPaths = ") :].split("\n", 1)[0] + "\n"
    return registry_paths + "".join(
        source[source.index(f"function {name} {{") :].split("\n}\n", 1)[0] + "\n}\n"
        for name in ("Update-ProcessPath", "Get-Application", "Find-Podman", "Get-PodmanVersion", "Find-Winget", "Use-Winget")
    )


@needs_powershell
@pytest.mark.parametrize("source", ["machine-path", "user-path", "current-path", "local-app-data", "hkcu", "hklm", "program-files"])
def test_find_podman_reads_only_the_injected_sources(tmp_path, source):
    """The Windows cases do not see a Podman installed on the runner itself (T65)."""
    roots = {name: tmp_path / name for name in ("machine-path", "user-path", "current-path", "local-app-data", "hkcu", "hklm", "program-files")}
    if source in {"machine-path", "user-path", "current-path"}:
        executable = roots[source] / "podman.exe"
    elif source == "local-app-data":
        executable = roots[source] / "Programs" / "Podman" / "podman.exe"
    elif source in {"hkcu", "hklm"}:
        executable = roots[source] / "podman.exe"
    else:
        executable = roots[source] / "Podman" / "podman.exe"
    executable.parent.mkdir(parents=True)
    install_fake(executable.parent, "podman.exe", "#!/bin/sh\necho 'podman version 6.0.2'\n")

    registry = "function Get-ItemProperty { param($LiteralPath, $Name, $ErrorAction)\n"
    for name in ("hkcu", "hklm"):
        key = "HKCU:\\SOFTWARE\\Podman" if name == "hkcu" else "HKLM:\\SOFTWARE\\Podman"
        value = roots[name] if source == name else ""
        registry += f"  if ($LiteralPath -eq '{key}') {{ return [pscustomobject]@{{ InstallDir = '{value}' }} }}\n"
    registry += "  return $null\n}\n"

    paths = {name: str(roots[name]) if source == name else "" for name in ("machine-path", "user-path", "current-path")}
    local = roots["local-app-data"]
    program_files = roots["program-files"] if source == "program-files" else ""
    body = (
        "$ErrorActionPreference = 'Stop'\n"
        + registry
        + _enabler_functions()
        + "[Console]::Out.WriteLine('FOUND=' + (Find-Podman "
          f"-MachinePath '{paths['machine-path']}' -UserPath '{paths['user-path']}' -ProcessPath '{paths['current-path']}' "
          f"-LocalAppDataPath '{local}' -RegistryPaths @('HKCU:\\SOFTWARE\\Podman', 'HKLM:\\SOFTWARE\\Podman') "
          f"-ProgramFilesPath '{program_files}'))\n"
        + "exit 0\n"
    )
    done = _ps(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    expected = f"FOUND={executable}".replace("\\", "/")
    assert expected in done.stdout.replace("\\", "/"), done.stdout + done.stderr


def _enabler_install_block() -> str:
    source = ENABLER.read_text(encoding="utf-8")
    block = source[source.index("$WingetUpdateNotApplicable = ") : source.index("$Podman = Find-Podman")]
    return _enabler_functions() + block


@lru_cache(maxsize=1)
def _real_podman_seen() -> str:
    """On a real Windows Find-Podman also reads the Machine and User PATH and the registry's InstallDir,
    which no test can fake without a seam in the enabler: it is asked here, with no fake anywhere."""
    empty = Path(tempfile.mkdtemp(prefix="jht-no-podman-"))
    done = _ps(empty, "$LocalAppData = '" + str(empty) + "'\n" + _enabler_functions()
               + "[Console]::Out.WriteLine('FOUND=' + (Find-Podman))\n")
    found = re.findall(r"^FOUND=(.*)$", done.stdout, flags=re.MULTILINE)
    assert done.returncode == 0 and found, done.stdout + done.stderr
    return found[-1].strip()


def _install_block_is_isolated() -> None:
    """The install block cases see only their fakes off Windows. On Windows they run only where no real
    Podman is visible (a GitHub runner): there one is a failure, elsewhere (a PC with Podman) a skip."""
    if not WINDOWS:
        return
    seen = _real_podman_seen()
    if seen:
        message = f"a real Podman is visible to Find-Podman here ({seen}): the install block cases would find it"
        if os.environ.get("CI"):
            pytest.fail(message)
        pytest.skip(message)


# PowerShell off Windows: a fake podman.exe can be a shell script there, and PowerShell reads the
# installer's «Programs\Podman\podman.exe» with \ as a separator (Join-Path gives
# Programs/Podman/podman.exe), so the fake goes in real Programs/Podman folders.
@needs_powershell
@pytest.mark.parametrize(("installed", "winget_code", "expected_exit", "expected_line"), [
    ("6.0.2", None, 0, None),                                  # already there: winget is not even run
    (None, 0, 0, None),                                        # first install
    ("6.0.2-late", 0x8A15002B - 2**32, 0, None),               # a Try again: already installed, the right one
    ("5.4.0", None, 24, "podman_version_mismatch: Podman 5.4.0"),  # another major: left alone, winget not run
    (None, 0x8A150006 - 2**32, 21, "podman_not_installable: winget install Podman.CLI 6.0.2 exited with"),
])
def test_the_install_block_with_a_fake_winget(tmp_path, installed, winget_code, expected_exit, expected_line):
    _install_block_is_isolated()
    calls = tmp_path / "winget-calls"
    # «6.0.2-late»: Podman appears only once winget ran (what PATH did not show before)
    present_before = installed is not None and not installed.endswith("-late")
    version = (installed or "6.0.2").replace("-late", "")
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    podman_body = f"#!/bin/sh\necho 'podman version {version}'\n"
    if present_before:
        install_fake(fake_podman.parent, "podman.exe", podman_body)
    winget = (
        "function winget {\n"
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        + _ps_make_podman(fake_podman, version)
        + f"  $global:LASTEXITCODE = {winget_code if winget_code is not None else 0}\n"
        "}\n"
    )
    done = _ps(
        tmp_path,
        "$ErrorActionPreference = 'Stop'\n"
        f"$LocalAppData = '{tmp_path}'\n$PodmanCliVersion = '6.0.2'\n$InstallDependencies = $true\n"
        "function Write-JhtPhase { }\n" + winget + _enabler_install_block() + "\nexit 0\n",
    )
    assert done.returncode == expected_exit, done.stdout + done.stderr
    if expected_line:
        assert expected_line in done.stderr
    assert calls.exists() == (winget_code is not None)


# JHT-T56: the pin is what the app installs; a newer 6 is used with a warning, an older 6 is brought
# to the pin, another major is podman_version_mismatch without touching it.
@needs_powershell
@pytest.mark.parametrize(("before", "after", "expected_exit", "expected_line", "winget_runs"), [
    ("6.0.2", None, 0, None, False),
    ("6.1.4", None, 0, "JHT_WARNING podman_version_newer: Podman 6.1.4 is installed on this computer;", False),
    ("6.1.0-rc1", None, 0, "JHT_WARNING podman_version_newer: Podman 6.1.0-rc1", False),
    ("6.0.1", "6.0.2", 0, None, True),
    ("6.0.0", "6.0.0", 24, "podman_version_mismatch: Podman 6.0.0", True),   # winget could not bring it to the pin
    ("5.4.0", None, 24, "podman_version_mismatch: Podman 5.4.0 is installed on this computer, and JHT runs on Podman 6, from 6.0.2 on", False),
    ("7.0.0", None, 24, "podman_version_mismatch: Podman 7.0.0", False),
    ("6.x", None, 24, "podman_version_mismatch: Podman 6.x", False),       # a version it cannot read
])
def test_a_podman_of_another_version(tmp_path, before, after, expected_exit, expected_line, winget_runs):
    calls = tmp_path / "winget-calls"
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    install_fake(fake_podman.parent, "podman.exe", f"#!/bin/sh\necho 'podman version {before}'\n")
    winget = f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
    if after:
        winget += _ps_make_podman(fake_podman, after)
    winget += "  $global:LASTEXITCODE = 0\n"
    done = _run_block(tmp_path, winget)
    assert done.returncode == expected_exit, done.stdout + done.stderr
    if expected_line:
        assert expected_line in (done.stderr if expected_exit else done.stdout)
    if expected_exit == 0 and before != "6.0.2" and after is None:
        assert "podman_version_mismatch" not in done.stderr
    if before == "6.0.2" or after == "6.0.2":
        assert "JHT_WARNING" not in done.stdout
    assert calls.exists() == winget_runs
    if winget_runs:
        assert calls.read_text().startswith("install --exact --source winget --version 6.0.2 --silent")


def _run_block(tmp_path, winget_body, extra=""):
    _install_block_is_isolated()
    return _ps(
        tmp_path,
        "$ErrorActionPreference = 'Stop'\n"
        f"$LocalAppData = '{tmp_path}'\n$PodmanCliVersion = '6.0.2'\n$InstallDependencies = $true\n"
        "function Write-JhtPhase { }\n" + extra + "function winget {\n" + winget_body + "}\n"
        + _enabler_install_block() + "\nexit 0\n",
    )


ALREADY = 0x8A15002B - 2**32


# winget says «already installed» on its first pass and podman.exe is nowhere for this user; the
# second pass (for this user) installs it, or does not.
@needs_powershell
@pytest.mark.parametrize(("second_installs", "second_code", "expected_exit"), [
    (True, 0, 0),
    (False, 0x8A150006 - 2**32, 25),
    (False, 0, 25),  # winget says it worked and there is still no podman.exe: the files decide
])
def test_already_installed_for_another_user_with_a_fake_winget(tmp_path, second_installs, second_code,
                                                               expected_exit):
    calls = tmp_path / "winget-calls"
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    install = _ps_make_podman(fake_podman, "6.0.2") if second_installs else ""
    winget = (
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        # winget sees «installed» (the other user's Uninstall entry is in HKLM): without --force it does nothing
        "  if (($args -contains '--override') -and ($args -contains '--force')) {\n" + install + f"    $global:LASTEXITCODE = {second_code}\n"
        f"  }} else {{ $global:LASTEXITCODE = {ALREADY} }}\n"
    )
    done = _run_block(tmp_path, winget)
    assert done.returncode == expected_exit, done.stdout + done.stderr
    lines = calls.read_text().splitlines()
    assert len(lines) == 2
    assert "--override" not in lines[0]
    assert lines[1].endswith("--id Podman.CLI --force --override /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1")
    assert "--scope" not in lines[0] + lines[1]
    assert lines[1].startswith("install --exact --source winget --version 6.0.2 --silent")
    if expected_exit == 25:
        assert "podman_other_user: winget reports Podman CLI as installed on this computer" in done.stderr
        assert f"(winget exited with {second_code})" in done.stderr
        assert "podman_not_installable" not in done.stderr
        assert not re.search(r"(?i)internet|network|connection", done.stderr)
    else:
        assert done.stderr == ""


@needs_powershell
def test_already_installed_and_reachable_needs_no_second_pass(tmp_path):
    # the Try again after a later failure: «already installed», and this user's podman.exe is there
    calls = tmp_path / "winget-calls"
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    winget = (
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        + _ps_make_podman(fake_podman, "6.0.2")
        + f"  $global:LASTEXITCODE = {ALREADY}\n"
    )
    done = _run_block(tmp_path, winget)
    assert done.returncode == 0, done.stdout + done.stderr
    assert len(calls.read_text().splitlines()) == 1


@needs_powershell
def test_podman_installed_for_the_computer_is_found_without_winget(tmp_path):
    # the MSI's machine scope puts it in %ProgramFiles%\Podman, outside this user's PATH here
    calls = tmp_path / "winget-calls"
    program_files = tmp_path / "ProgramFiles"
    fake_podman = program_files / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    install_fake(fake_podman.parent, "podman.exe", "#!/bin/sh\necho 'podman version 6.0.2'\n")
    winget = f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n  $global:LASTEXITCODE = 0\n"
    done = _run_block(tmp_path, winget, extra=f"$env:ProgramFiles = '{program_files}'\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert not calls.exists()


# ── no «Welcome to WSL» window over the app ──

def test_the_wsl_welcome_is_marked_shown_before_podman_registers_its_distribution():
    # WSL opens wslsettings' welcome when a distribution of the user's gets registered, unless the
    # DWORD OOBEComplete under HKCU\...\Lxss is set (LxssUserSession::_LaunchOOBEIfNeeded).
    enabler = _code(ENABLER)
    skip = enabler[enabler.index("function Skip-WslWelcome {") :]
    skip = skip[: skip.index("\n}\n")]
    assert "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'" in skip
    # only when absent or 0, and only that value, as a DWORD 1
    assert skip.index("if ($current) { return }") < skip.index("New-ItemProperty")
    assert "-Name 'OOBEComplete' -PropertyType DWord -Value 1" in skip
    assert skip.count("New-ItemProperty") == 1 and "Remove-Item" not in skip
    # a failure costs the window, never the setup
    assert "catch {" in skip and "throw" not in skip
    # right before the machine is created, which registers the distribution
    init = enabler.index("Invoke-Checked $Podman 'machine' 'init'")
    assert enabler.rindex("Skip-WslWelcome", 0, init) > enabler.rindex("Write-JhtPhase podman_machine_init", 0, init)


# ── the pulled image's digest, as Podman 6 reports it, in the shell the app runs ──
# `podman image inspect --format '{{json .RepoDigests}}'` of an image pulled by its index digest:
# the index AND the platform manifest, no tag. The app runs the script with Windows PowerShell 5.1,
# whose ConvertFrom-Json gives a JSON array to the pipeline as ONE object; PowerShell 7 enumerates
# it. The 5.1 shape is reproduced here with ConvertFrom-Json -NoEnumerate, the switch 7 added to keep it.
INDEX = "sha256:" + "6c" * 32
PLATFORM = "sha256:" + "40" * 32
OTHER = "sha256:" + "77" * 32


def _image_check_block() -> str:
    source = ENABLER.read_text(encoding="utf-8")
    return source[source.index("Write-JhtPhase image_pull") : source.index("$env:JHT_IMAGE = $canonicalImage")]


WINDOWS_POWERSHELL_JSON = (
    "function ConvertFrom-Json {\n"
    "  param([Parameter(ValueFromPipeline = $true)]$InputObject)\n"
    "  process { , (Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject $InputObject -NoEnumerate) }\n"
    "}\n"
)


@needs_powershell
@pytest.mark.parametrize("shell", ["windows-powershell-5.1", "powershell-7"])
@pytest.mark.parametrize(("digests", "accepted"), [
    ([f"ghcr.io/leopu00/jht@{PLATFORM}", f"ghcr.io/leopu00/jht@{INDEX}"], True),   # Podman 6, by index
    ([f"ghcr.io/leopu00/jht@{INDEX}", f"ghcr.io/leopu00/jht@{PLATFORM}"], True),
    ([f"ghcr.io/leopu00/jht@{INDEX}"], True),
    ([f"ghcr.io/leopu00/jht@{OTHER}", f"ghcr.io/leopu00/jht@{PLATFORM}"], False),  # not the pinned image
    ([], False),
])
def test_the_pulled_image_is_found_by_its_digest_among_all_its_digests(tmp_path, shell, digests, accepted):
    inspect = json.dumps(digests) if digests else "null"
    # Under the real Windows PowerShell 5.1 the 5.1 shape is the engine's own (and -NoEnumerate does not exist).
    imitate = shell == "windows-powershell-5.1" and expected_engine() != "5.1"
    done = _ps(
        tmp_path,
        "$ErrorActionPreference = 'Stop'\n"
        + (WINDOWS_POWERSHELL_JSON if imitate else "")
        + "function Write-JhtPhase { }\n"
        "function Invoke-Checked { $global:LASTEXITCODE = 0 }\n"
        "function Invoke-PodmanPull { $global:LASTEXITCODE = 0 }\n"
        f"function fake-podman {{ $global:LASTEXITCODE = 0; '{inspect}' }}\n"
        "$Podman = 'fake-podman'; $MachineName = 'jht-podman'\n"
        f"$RuntimeImage = 'ghcr.io/leopu00/jht@{INDEX}'; $ExpectedImageDigest = '{INDEX}'\n"
        + _image_check_block()
        + "\n$canonicalImage\nexit 0\n",
    )
    if accepted:
        assert done.returncode == 0, done.stdout + done.stderr
        assert done.stdout.strip().splitlines()[-1] == f"ghcr.io/leopu00/jht@{INDEX}"
    else:
        assert done.returncode != 0
        assert "Pulled runtime image does not expose the expected repository digest" in done.stdout + done.stderr


@needs_powershell
def test_the_windows_powershell_shape_is_really_one_object(tmp_path):
    # the harness reproduces what it claims: in the 5.1 shape a two-digest array is one pipeline object.
    # Under the real 5.1 the engine itself is checked: that is the shape the imitation reproduces.
    if expected_engine() == "5.1":
        done = _ps(tmp_path, "@('[\"a\",\"b\"]' | ConvertFrom-Json).Count\n")
        assert done.stdout.split() == ["1"], done.stdout + done.stderr
        return
    probe = WINDOWS_POWERSHELL_JSON + "@('[\"a\",\"b\"]' | ConvertFrom-Json).Count; @('[\"a\",\"b\"]' | Microsoft.PowerShell.Utility\\ConvertFrom-Json).Count\n"
    done = _ps(tmp_path, probe)
    assert done.stdout.split() == ["1", "2"], done.stdout + done.stderr


# ── JHT-T184 WX1: winget is found where App Installer puts it for THIS user ──

WINGET_SOURCES = ["machine-path", "user-path", "current-path", "alias-of-this-user"]


@needs_powershell
@pytest.mark.parametrize("source", WINGET_SOURCES)
def test_find_winget_reads_the_path_and_the_alias_folder_of_this_user(tmp_path, source):
    """An account whose PATH names another user's WindowsApps folder still finds its own winget."""
    roots = {name: tmp_path / name for name in WINGET_SOURCES}
    other_users_folder = tmp_path / "other-user" / "AppData" / "Local" / "Microsoft" / "WindowsApps"
    other_users_folder.mkdir(parents=True)
    local = roots["alias-of-this-user"]
    folder = local / "Microsoft" / "WindowsApps" if source == "alias-of-this-user" else roots[source]
    folder.mkdir(parents=True)
    install_fake(folder, "winget.exe", "#!/bin/sh\necho v1.29.380\n")
    paths = {name: str(roots[name]) if source == name else "" for name in ("machine-path", "user-path", "current-path")}
    process = paths["current-path"] or str(other_users_folder)
    body = (
        "$ErrorActionPreference = 'Stop'\n"
        + _enabler_functions()
        + "[Console]::Out.WriteLine('FOUND=' + (Find-Winget "
          f"-MachinePath '{paths['machine-path']}' -UserPath '{paths['user-path']}' -ProcessPath '{process}' "
          f"-LocalAppDataPath '{local}'))\n"
        + "exit 0\n"
    )
    done = _ps(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    expected = f"FOUND={folder / 'winget.exe'}".replace("\\", "/")
    assert expected in done.stdout.replace("\\", "/"), done.stdout + done.stderr


@needs_powershell
def test_find_winget_finds_nothing_where_there_is_nothing_and_use_winget_says_so(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    body = (
        "$ErrorActionPreference = 'Stop'\n"
        + _enabler_functions()
        + f"[Console]::Out.WriteLine('FOUND=[' + (Find-Winget -MachinePath '' -UserPath '' -ProcessPath '{empty}' -LocalAppDataPath '{empty}') + ']')\n"
        # no folder of local data at all: nothing to look in, no error
        + f"[Console]::Out.WriteLine('NONE=[' + (Find-Winget -MachinePath '' -UserPath '' -ProcessPath '{empty}' -LocalAppDataPath '') + ']')\n"
        + f"[Console]::Out.WriteLine('NULL=[' + (Find-Winget -MachinePath '' -UserPath '' -ProcessPath '{empty}' -LocalAppDataPath $null) + ']')\n"
        + "function Find-Winget { return $null }\n"
        + "[Console]::Out.WriteLine('USED=' + (Use-Winget))\n"
        + "exit 0\n"
    )
    done = _ps(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "FOUND=[]" in done.stdout and "NONE=[]" in done.stdout and "NULL=[]" in done.stdout and "USED=False" in done.stdout, done.stdout + done.stderr


@needs_powershell
def test_use_winget_puts_the_folder_in_the_path_of_this_process_once(tmp_path):
    folder = tmp_path / "apps"
    folder.mkdir()
    install_fake(folder, "winget.exe", "#!/bin/sh\necho v1\n")
    body = (
        "$ErrorActionPreference = 'Stop'\n"
        + _enabler_functions()
        + f"function Find-Winget {{ return '{folder / 'winget.exe'}' }}\n"
        + "$first = Use-Winget; $second = Use-Winget\n"
        + f"$count = @($env:PATH -split [IO.Path]::PathSeparator | Where-Object {{ $_ -eq '{folder}' }}).Count\n"
        + "[Console]::Out.WriteLine(\"RESULT=$first,$second,$count\")\n"
        + "exit 0\n"
    )
    done = _ps(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "RESULT=True,True,1" in done.stdout, done.stdout + done.stderr


def test_the_enabler_looks_for_winget_in_this_users_alias_folder_before_it_runs_it():
    enabler = _code(ENABLER)
    block = enabler[enabler.index("if ($InstallDependencies) {") :]
    block = block[: block.index("$Podman = Find-Podman")]
    # the lookup is the function's, before the one command that runs winget; no bare Get-Command in the block
    assert "Get-Command winget" not in block
    assert block.index("Use-Winget") < block.index("& winget install")
    assert "Microsoft\\WindowsApps\\winget.exe" in enabler


# ── JHT-T184 WX2: a winget with an empty list of programs ──

SOURCE_DATA_MISSING = 0x8A15000F - 2**32


def test_the_empty_list_of_programs_is_recognised_updated_once_and_then_the_zip_takes_over():
    enabler = _code(ENABLER)
    assert re.search(r"\$WingetSourceDataMissing = (-?\d+)", enabler).group(1) == str(SOURCE_DATA_MISSING)
    block = enabler[enabler.index("if ($InstallDependencies) {") :]
    block = block[: block.index("$Podman = Find-Podman")]
    # one install command, asked again after ONE source update, never a loop
    assert block.count("& winget install") == 1 and block.count("& winget source update") == 1
    assert "foreach ($attempt in 1, 2)" in block
    assert block.index("& winget install") < block.index("& winget source update")
    # still empty: Podman from the official release for this user, not a stop
    assert "if ($wingetCode -eq $WingetSourceDataMissing) { $viaZip = $true; break }" in block
    assert block.index("& winget source update") < block.index("$viaZip = $true") < block.index("Install-PodmanForThisUser")


# ── JHT-T184 piece 3 (and JHT-T144): Podman for this user from the official release ──

ZIP_SHA256 = "2c055d363de03de917f79568a78b7d5902fc40453bbcc141ca18cf0a1fa1b78e"


def test_the_zip_is_the_pinned_release_checked_before_anything_is_read_out_of_it():
    enabler = _code(ENABLER)
    assert "$PodmanZipUrl = \"https://github.com/podman-container-tools/podman/releases/download/v$PodmanCliVersion/podman-remote-release-windows_amd64.zip\"" in enabler
    assert f"$PodmanZipSha256 = '{ZIP_SHA256}'" in enabler
    assert "$PodmanZipPrograms = @('podman.exe', 'gvproxy.exe', 'win-sshproxy.exe')" in enabler
    function = enabler[enabler.index("function Install-PodmanForThisUser {") :]
    function = function[: function.index("\n}\n")]
    # the digest first, then the archive is opened; the names come from the script, never from the archive
    assert function.index("Get-FileHash") < function.index("-ne $Sha256") < function.index("OpenRead")
    assert "GetEntry(\"podman-$Version/usr/bin/$name\")" in function
    assert "Expand-Archive" not in enabler and "ExtractToDirectory" not in enabler and "ExtractToFile" not in enabler
    assert "FullName" not in function and ".Name" not in function
    # written beside the final names, moved over them, the version asked of the result, and the folder is never a link
    assert function.index("CreateNew") < function.index("Move-Item") < function.index("Get-PodmanVersion")
    assert "ReparsePoint" in function
    # not run before it is checked and extracted: no podman.exe call before the digest
    assert function.index("Get-PodmanVersion") > function.index("-ne $Sha256")


def _zip(path: Path, entries: dict) -> str:
    import hashlib
    import zipfile
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _unit_script(tmp_path: Path, call: str) -> str:
    source = ENABLER.read_text(encoding="utf-8")
    parts = [source[source.index("$PodmanCliVersion = "): source.index("$PodmanZipPrograms = ")].split("\n", 1)[0] + "\n"]
    parts.append(source[source.index("$PodmanZipUrl = "): source.index("$ComposeProviderVersion")].replace("\n# JHT's own docker-compose", ""))
    functions = "".join(source[source.index(f"function {name} {{") :].split("\n}\n", 1)[0] + "\n}\n"
                        for name in ("Get-PodmanVersion", "Add-UserPathEntry", "Install-PodmanForThisUser"))
    return "$ErrorActionPreference = 'Stop'\n" + f"$LocalAppData = '{tmp_path}'\n" + "".join(parts) + functions + call


PODMAN_ENTRIES = {f"podman-6.0.2/usr/bin/{name}": b"program" for name in ("podman.exe", "gvproxy.exe", "win-sshproxy.exe")}


@needs_powershell
@pytest.mark.parametrize("case", ["wrong-digest", "missing-program", "empty-program"])
def test_a_zip_that_is_not_the_release_installs_nothing_and_leaves_nothing(tmp_path, case):
    entries = dict(PODMAN_ENTRIES)
    if case == "missing-program":
        del entries["podman-6.0.2/usr/bin/gvproxy.exe"]
    if case == "empty-program":
        entries["podman-6.0.2/usr/bin/podman.exe"] = b""
    archive = tmp_path / "release.zip"
    digest = _zip(archive, entries)
    pinned = "0" * 64 if case == "wrong-digest" else digest
    destination = tmp_path / "Podman"
    body = _unit_script(tmp_path, f"try {{ Install-PodmanForThisUser -Destination '{destination}' -Url '{archive}' -Sha256 '{pinned}' -NoPath; exit 0 }} catch {{ [Console]::Error.WriteLine('FAILED: ' + $_.Exception.Message); exit 3 }}\n")
    done = _ps(tmp_path, body)
    assert done.returncode == 3, done.stdout + done.stderr
    assert "FAILED:" in done.stderr
    assert case != "wrong-digest" or "has SHA-256" in done.stderr
    assert list(destination.iterdir()) == [], "no program, no half-written file, no download left"


@needs_powershell
def test_names_in_the_zip_that_try_to_leave_the_folder_are_never_used(tmp_path):
    entries = dict(PODMAN_ENTRIES)
    entries["podman-6.0.2/usr/bin/../../../evil.exe"] = b"x"
    entries["../escape.exe"] = b"x"
    entries["/rooted.exe"] = b"x"
    archive = tmp_path / "release.zip"
    digest = _zip(archive, entries)
    destination = tmp_path / "deep" / "Podman"
    body = _unit_script(tmp_path, f"try {{ Install-PodmanForThisUser -Destination '{destination}' -Url '{archive}' -Sha256 '{digest}' -NoPath }} catch {{ }}\nexit 0\n")
    done = _ps(tmp_path, body)
    assert done.returncode == 0, done.stdout + done.stderr
    names = sorted(path.name for path in tmp_path.rglob("*") if path.is_file())
    assert "evil.exe" not in names and "escape.exe" not in names and "rooted.exe" not in names, names


@pytest.mark.skipif(not WINDOWS, reason="the programs it takes out have to run, and the registry is Windows'")
def test_a_zip_with_the_programs_installs_them_for_the_user_and_puts_the_folder_in_the_path_once(tmp_path):
    destination = tmp_path / "Programs" / "Podman"
    destination.mkdir(parents=True)
    # the fake podman.exe is a launcher that runs the .sh beside it: the .sh is not in the zip, so it is already there
    (destination / "podman.sh").write_text("#!/bin/sh\necho 'podman version 6.0.2'\n", encoding="utf-8", newline="\n")
    launcher_bytes = launcher().read_bytes()
    entries = {f"podman-6.0.2/usr/bin/{name}": launcher_bytes if name == "podman.exe" else b"program" for name in ("podman.exe", "gvproxy.exe", "win-sshproxy.exe")}
    archive = tmp_path / "release.zip"
    digest = _zip(archive, entries)
    key = f"HKCU:\\Software\\JhtTest-{os.getpid()}"
    call = (
        f"New-Item -Path '{key}' -Force | Out-Null\n"
        f"Set-ItemProperty -LiteralPath '{key}' -Name 'Path' -Value '%SystemRoot%\\system32;C:\\Existing' -Type ExpandString\n"
        "try {\n"
        f"  Install-PodmanForThisUser -Destination '{destination}' -Url '{archive}' -Sha256 '{digest}' -NoPath\n"
        f"  Add-UserPathEntry -Folder '{destination}' -EnvironmentKey '{key}' -NoBroadcast\n"
        f"  Add-UserPathEntry -Folder '{destination}' -EnvironmentKey '{key}' -NoBroadcast\n"
        f"  $raw = (Get-Item -LiteralPath '{key}').GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)\n"
        f"  $kind = (Get-Item -LiteralPath '{key}').GetValueKind('Path')\n"
        "  [Console]::Out.WriteLine('RAW=' + $raw); [Console]::Out.WriteLine('KIND=' + $kind)\n"
        f"}} finally {{ Remove-Item -LiteralPath '{key}' -Recurse -Force -ErrorAction SilentlyContinue }}\n"
        "exit 0\n"
    )
    done = _ps(tmp_path, _unit_script(tmp_path, call))
    assert done.returncode == 0, done.stdout + done.stderr
    assert (destination / "gvproxy.exe").read_bytes() == b"program" and (destination / "win-sshproxy.exe").read_bytes() == b"program"
    assert not list(destination.glob("*.new-*")) and not list(destination.glob(".podman-*"))
    raw = re.search(r"^RAW=(.*)$", done.stdout, flags=re.MULTILINE).group(1)
    assert raw.startswith("%SystemRoot%\\system32;C:\\Existing;") and raw.count(str(destination)) == 1, raw
    assert "KIND=ExpandString" in done.stdout


def _block_with(tmp_path, winget_body, stubs):
    """The install block with `stubs` defined AFTER the real functions, so they win (the block's own functions come first)."""
    _install_block_is_isolated()
    source = ENABLER.read_text(encoding="utf-8")
    block = source[source.index("$WingetUpdateNotApplicable = ") : source.index("$Podman = Find-Podman")]
    return _ps(
        tmp_path,
        "$ErrorActionPreference = 'Stop'\n"
        f"$LocalAppData = '{tmp_path}'\n$PodmanCliVersion = '6.0.2'\n$InstallDependencies = $true\n"
        "function Write-JhtPhase { }\n" + "function winget {\n" + winget_body + "}\n"
        + _enabler_functions() + stubs + block + "\nexit 0\n",
    )


def _zip_stub(tmp_path, calls, creates, fails=""):
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True, exist_ok=True)
    body = f"  Add-Content -LiteralPath '{calls}' -Value 'ZIP'\n"
    if fails:
        body += f"  throw '{fails}'\n"
    elif creates:
        body += _ps_make_podman(fake_podman, "6.0.2")
    return "function Install-PodmanForThisUser {\n" + body + "}\n"


@needs_powershell
def test_without_winget_podman_comes_from_the_zip_and_winget_is_never_run(tmp_path):
    calls = tmp_path / "calls"
    done = _block_with(tmp_path, f"  Add-Content -LiteralPath '{calls}' -Value 'WINGET'\n  $global:LASTEXITCODE = 0\n",
                       "function Use-Winget { return $false }\n" + _zip_stub(tmp_path, calls, True))
    assert done.returncode == 0, done.stdout + done.stderr
    assert calls.read_text().split() == ["ZIP"]
    assert "was installed for this Windows user from the official release, without winget" in done.stdout


@needs_powershell
def test_a_zip_that_fails_without_winget_is_its_own_reason_and_not_the_other_users(tmp_path):
    calls = tmp_path / "calls"
    done = _block_with(tmp_path, "  $global:LASTEXITCODE = 0\n",
                       "function Use-Winget { return $false }\n" + _zip_stub(tmp_path, calls, False, fails="the Podman 6.0.2 download has SHA-256 abc, expected def"))
    assert done.returncode == 21, done.stdout + done.stderr
    assert "podman_not_installable: the Podman 6.0.2 download has SHA-256 abc, expected def" in done.stderr
    assert "podman_other_user" not in done.stderr


@needs_powershell
@pytest.mark.parametrize("zip_works", [True, False])
def test_podman_of_another_user_is_installed_for_this_one_from_the_zip_or_keeps_its_own_code(tmp_path, zip_works):
    calls = tmp_path / "calls"
    winget = (f"  Add-Content -LiteralPath '{calls}' -Value ('WINGET ' + $args[0])\n"
              f"  $global:LASTEXITCODE = {ALREADY}\n")
    stub = "function Use-Winget { return $true }\n" + (_zip_stub(tmp_path, calls, True) if zip_works else _zip_stub(tmp_path, calls, False, fails="the download failed"))
    done = _block_with(tmp_path, winget, stub)
    assert calls.read_text().split()[-1] == "ZIP"
    if zip_works:
        assert done.returncode == 0, done.stdout + done.stderr
        assert "podman_other_user" not in done.stderr
    else:
        assert done.returncode == 25, done.stdout + done.stderr
        assert "podman zip: the download failed" in done.stderr and "podman_other_user:" in done.stderr


@needs_powershell
def test_an_empty_list_of_programs_is_updated_once_and_then_the_zip_installs_podman(tmp_path):
    calls = tmp_path / "calls"
    winget = (f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
              f"  if ($args[0] -eq 'source') {{ $global:LASTEXITCODE = 0 }} else {{ $global:LASTEXITCODE = {SOURCE_DATA_MISSING} }}\n")
    done = _block_with(tmp_path, winget, "function Use-Winget { return $true }\n" + _zip_stub(tmp_path, calls, True))
    assert done.returncode == 0, done.stdout + done.stderr
    lines = calls.read_text().splitlines()
    assert [line.split(" ")[0] for line in lines] == ["install", "source", "install", "ZIP"], lines
    assert lines[1] == "source update --disable-interactivity"
