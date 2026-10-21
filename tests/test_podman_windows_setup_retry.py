"""Windows runtime setup: the egress proxies are awaited and checked one by one.

On a fresh Windows profile `configure-podman-windows-network.ps1` failed its proxy checks right
after systemd printed «changed on disk, run daemon-reload» for the new units: a Type=simple
service was still starting, and the check was one silent `&&` chain. Never a reload in Podman's
WSL machine (it hung systemd on 09/10, see test_windows_desktop_local_runtime): a unit systemd
says needs one (NeedDaemonReload=yes) takes the machine restart; the proxies are awaited until
they listen; each check prints what it asked and what came back; any failure is ONE stable code,
podman_network_unready, exit 23.
"""

from __future__ import annotations

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

