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

import os
import re
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"


def _proxy_check() -> str:
    source = NETWORK.read_text(encoding="utf-8")
    start = source.index("$proxyCheck = @'\n") + len("$proxyCheck = @'\n")
    return source[start : source.index("\n'@", start)] + "\n"


# A fake curl: the answer for "<port> <url>" from the table, else 000 and exit 7.
FAKE_CURL = r"""#!/bin/sh
port=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --proxy) port="${2##*:}"; shift 2 ;;
    --output|--max-time|--write-out) shift 2 ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done
answer="$(awk -v key="$port $url" '$1" "$2 == key { print $3; exit }' "$CURL_TABLE")"
if [ -z "$answer" ]; then printf 000; exit 7; fi
printf %s "$answer"
case "$answer" in 403) exit 56 ;; esac
exit 0
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

    def answers(agent_ghcr=401, broker_ghcr=401, telegram=200, agent_imap=403, broker_http=403, telegram_other=403):
        rows = [
            (ports[0], "https://ghcr.io/v2/", agent_ghcr), (ports[1], "https://ghcr.io/v2/", broker_ghcr),
            (ports[2], "https://api.telegram.org/", telegram), (ports[0], "https://example.com:993/", agent_imap),
            (ports[1], "http://example.com/", broker_http), (ports[2], "https://example.com/", telegram_other),
        ]
        table.write_text("".join(f"{p} {u} {a}\n" for p, u, a in rows if a is not None), encoding="utf-8")

    def run(ready_seconds=5, check_ports=None):
        env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "CURL_TABLE": str(table), "JHT_PROXY_READY_SECONDS": str(ready_seconds)}
        started = time.monotonic()
        done = subprocess.run(["bash", "-s", "--", *map(str, check_ports or ports)], input=_proxy_check(),
                              capture_output=True, text=True, env=env, timeout=60)
        return done, time.monotonic() - started

    answers()
    yield type("Machine", (), {"ports": ports, "answers": answers, "run": run, "sockets": sockets})
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
    restart_flag = code.index("then units_changed=1; fi; done", need)
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
    assert "podman_version_mismatch:" in block and "exit 24" in block


def test_already_installed_for_another_user_is_installed_for_this_one_or_its_own_code():
    enabler = _code(ENABLER)
    block = enabler[enabler.index("if ($InstallDependencies) {") :]
    block = block[: block.index("$Podman = Find-Podman")]
    find = enabler[enabler.index("function Find-Podman {") :]
    find = find[: find.index("\n}\n")]
    # the MSI's two folders and the folder it registers, after PATH
    for where in ("'HKCU:\\SOFTWARE\\Podman', 'HKLM:\\SOFTWARE\\Podman'", "-Name 'InstallDir'",
                  "Join-Path $env:ProgramFiles 'Podman\\podman.exe'"):
        assert find.index("Get-Application 'podman.exe'") < find.index(where), where
    # still one winget command (inside the consent guard), its second pass for this user only
    assert block.count("& winget install") == 1
    assert "$scope = if ($forThisUser) { @('--scope', 'user', '--force') } else { @() }" in block
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

PWSH = shutil.which("pwsh")


def _enabler_install_block() -> str:
    source = ENABLER.read_text(encoding="utf-8")
    functions = "".join(
        source[source.index(f"function {name} {{") :].split("\n}\n", 1)[0] + "\n}\n"
        for name in ("Update-ProcessPath", "Get-Application", "Find-Podman", "Get-PodmanVersion")
    )
    block = source[source.index("$WingetUpdateNotApplicable = ") : source.index("$Podman = Find-Podman")]
    return functions + block


# PowerShell off Windows: a fake podman.exe can be a shell script there, and PowerShell reads the
# installer's «Programs\Podman\podman.exe» with \ as a separator (Join-Path gives
# Programs/Podman/podman.exe), so the fake goes in real Programs/Podman folders.
@pytest.mark.skipif(PWSH is None or os.name == "nt", reason="needs PowerShell off Windows")
@pytest.mark.parametrize(("installed", "winget_code", "expected_exit", "expected_line"), [
    ("6.0.2", None, 0, None),                                  # already there: winget is not even run
    (None, 0, 0, None),                                        # first install
    ("6.0.2-late", 0x8A15002B - 2**32, 0, None),               # a Try again: already installed, the right one
    ("5.4.0", 0x8A15002B - 2**32, 24, "podman_version_mismatch: Podman 5.4.0"),
    (None, 0x8A150006 - 2**32, 21, "podman_not_installable: winget install Podman.CLI 6.0.2 exited with"),
])
def test_the_install_block_with_a_fake_winget(tmp_path, installed, winget_code, expected_exit, expected_line):
    calls = tmp_path / "winget-calls"
    script = tmp_path / "block.ps1"
    # «6.0.2-late»: Podman appears only once winget ran (what PATH did not show before)
    present_before = installed is not None and not installed.endswith("-late")
    version = (installed or "6.0.2").replace("-late", "")
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    podman_body = f"#!/bin/sh\necho 'podman version {version}'\n"
    if present_before:
        fake_podman.write_text(podman_body, encoding="utf-8")
        fake_podman.chmod(0o755)
    winget = (
        "function winget {\n"
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        + (f"  Set-Content -LiteralPath '{fake_podman}' -Value \"#!/bin/sh`necho 'podman version {version}'\"\n"
           f"  & chmod 755 '{fake_podman}'\n")
        + f"  $global:LASTEXITCODE = {winget_code if winget_code is not None else 0}\n"
        "}\n"
    )
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        f"$LocalAppData = '{tmp_path}'\n$PodmanCliVersion = '6.0.2'\n$InstallDependencies = $true\n"
        "function Write-JhtPhase { }\n" + winget + _enabler_install_block() + "\nexit 0\n",
        encoding="utf-8",
    )
    done = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", str(script)], capture_output=True,
                          text=True, timeout=60, env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)})
    assert done.returncode == expected_exit, done.stdout + done.stderr
    if expected_line:
        assert expected_line in done.stderr
    assert calls.exists() == (winget_code is not None)


def _run_block(tmp_path, winget_body, extra=""):
    script = tmp_path / "block.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        f"$LocalAppData = '{tmp_path}'\n$PodmanCliVersion = '6.0.2'\n$InstallDependencies = $true\n"
        "function Write-JhtPhase { }\n" + extra + "function winget {\n" + winget_body + "}\n"
        + _enabler_install_block() + "\nexit 0\n",
        encoding="utf-8",
    )
    return subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", str(script)], capture_output=True,
                          text=True, timeout=60, env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)})


ALREADY = 0x8A15002B - 2**32


# winget says «already installed» on its first pass and podman.exe is nowhere for this user; the
# second pass (for this user) installs it, or does not.
@pytest.mark.skipif(PWSH is None or os.name == "nt", reason="needs PowerShell off Windows")
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
    install = (f"    Set-Content -LiteralPath '{fake_podman}' -Value \"#!/bin/sh`necho 'podman version 6.0.2'\"\n"
               f"    & chmod 755 '{fake_podman}'\n") if second_installs else ""
    winget = (
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        "  if ($args -contains '--scope') {\n" + install + f"    $global:LASTEXITCODE = {second_code}\n"
        f"  }} else {{ $global:LASTEXITCODE = {ALREADY} }}\n"
    )
    done = _run_block(tmp_path, winget)
    assert done.returncode == expected_exit, done.stdout + done.stderr
    lines = calls.read_text().splitlines()
    assert len(lines) == 2
    assert "--scope" not in lines[0] and lines[1].endswith("--id Podman.CLI --scope user --force")
    assert lines[1].startswith("install --exact --source winget --version 6.0.2 --silent")
    if expected_exit == 25:
        assert "podman_other_user: winget reports Podman CLI as installed on this computer" in done.stderr
        assert f"(winget exited with {second_code})" in done.stderr
        assert "podman_not_installable" not in done.stderr
        assert not re.search(r"(?i)internet|network|connection", done.stderr)
    else:
        assert done.stderr == ""


@pytest.mark.skipif(PWSH is None or os.name == "nt", reason="needs PowerShell off Windows")
def test_already_installed_and_reachable_needs_no_second_pass(tmp_path):
    # the Try again after a later failure: «already installed», and this user's podman.exe is there
    calls = tmp_path / "winget-calls"
    fake_podman = tmp_path / "Programs" / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    winget = (
        f"  Add-Content -LiteralPath '{calls}' -Value ($args -join ' ')\n"
        f"  Set-Content -LiteralPath '{fake_podman}' -Value \"#!/bin/sh`necho 'podman version 6.0.2'\"\n"
        f"  & chmod 755 '{fake_podman}'\n"
        f"  $global:LASTEXITCODE = {ALREADY}\n"
    )
    done = _run_block(tmp_path, winget)
    assert done.returncode == 0, done.stdout + done.stderr
    assert len(calls.read_text().splitlines()) == 1


@pytest.mark.skipif(PWSH is None or os.name == "nt", reason="needs PowerShell off Windows")
def test_podman_installed_for_the_computer_is_found_without_winget(tmp_path):
    # the MSI's machine scope puts it in %ProgramFiles%\Podman, outside this user's PATH here
    calls = tmp_path / "winget-calls"
    program_files = tmp_path / "ProgramFiles"
    fake_podman = program_files / "Podman" / "podman.exe"
    fake_podman.parent.mkdir(parents=True)
    fake_podman.write_text("#!/bin/sh\necho 'podman version 6.0.2'\n", encoding="utf-8")
    fake_podman.chmod(0o755)
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
