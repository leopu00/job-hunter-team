"""Host pairing keeps the new Telegram token outside the agent container."""

from __future__ import annotations

import errno
import os
import pty
import re
import select
import shutil
import subprocess
import termios
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")
SECRET = "987654:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"
DIGEST = "a" * 64

FAKE_DOCKER = r"""#!/bin/sh
printf 'ARGV %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = run ] && {
  case "$*" in
    *"jht-telegram-legacy.py inventory assistente") [ -z "$FAKE_DIGEST" ] || printf '%s\n' "$FAKE_DIGEST" ;;
    *"jht-telegram-legacy.py remove assistente") printf 'REMOVED\n' >> "$FAKE_LOG" ;;
    *"jht-telegram-legacy.py remaining") exit "${FAKE_REMAINING_RC:-0}" ;;
    *) exit 96 ;;
  esac
  exit 0
}
[ "$1" = exec ] || exit 0
shift
interactive=0
while [ $# -gt 0 ]; do
  case "$1" in -i|-it) interactive=1; shift ;; -u|--user) shift 2 ;; *) break ;; esac
done
target="$1"; shift
case "$target:$*" in
  telegram-id:"jht-telegram-admin legacy remember assistente")
    value=$(cat)
    [ "$value" = "$FAKE_DIGEST" ] || { printf 'LEGACY_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 99; }
    printf '{"ok":true,"legacy":"assistente","state":"remembered"}\n' ;;
  telegram-id:"jht-telegram-admin cutover status")
    [ "$interactive" -eq 0 ] || cat >/dev/null
    printf '{"ok":true,"cutover":{"enabled":false}}\n' ;;
  telegram-id:"jht-telegram-admin bots pair assistente"*)
    value=$(cat)
    [ "$value" = "$EXPECTED_PAYLOAD" ] || { printf 'TELEGRAM_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 98; }
    printf 'TELEGRAM_STDIN_OK\n' >> "$FAKE_LOG"
    printf '{"ok":true,"bot":"assistente","state":"present","rotation":"rotated"}\n' ;;
  telegram-id:"jht-telegram-admin cutover enable") printf '{"ok":true,"cutover":"enabled"}\n' ;;
  *) exit 97 ;;
esac
"""


def functions(*names: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    found = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        found.append(match.group(0))
    return "\n".join(found)


def powershell_functions(*names: str) -> str:
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    found = []
    for name in names:
        match = re.search(rf"^function {name} \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        found.append(match.group(0))
    return "\n".join(found)


def pair_script() -> str:
    return (
        'set -u\nerr() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\n'
        'info() { echo "info: $*" >&2; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        'CONTAINER_RUNTIME=docker\nHOME=/host-home\n'
        + functions("telegram_admin", "telegram_admin_input", "telegram_legacy", "telegram_pair")
        + '\ntelegram_image() { printf "fake-image\\n"; }\n'
        + '\ntelegram_pair assistente\n'
    )


def prepare_inventory_script(*, inventory_fails: bool = False) -> str:
    legacy = "return 42" if inventory_fails else ":"
    return (
        "set -u\n"
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'telegram_admin() { return 1; }\n'
        'telegram_admin_input() { value=$(cat); printf "REMEMBER %s bytes=%s\\n" "$*" "${#value}" >> "$FAKE_LOG"; }\n'
        'telegram_legacy() { ' + legacy + '; }\n'
        'read_only_container_id() { return 3; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        + functions("telegram_prepare_legacy_inventory")
        + "\ntelegram_prepare_legacy_inventory\n"
    )


def test_empty_legacy_inventory_is_persisted_before_agent_start(tmp_path: Path) -> None:
    log = tmp_path / "calls.log"
    done = subprocess.run(
        ["bash", "-c", prepare_inventory_script()],
        capture_output=True,
        text=True,
        env={**os.environ, "FAKE_LOG": str(log)},
    )

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8").splitlines() == [
        "COMPOSE up -d jht-telegram",
        "REMEMBER legacy remember assistente bytes=0",
        "REMEMBER legacy remember capitano bytes=0",
        "REMEMBER legacy remember mentor bytes=0",
    ]


def test_legacy_inventory_read_failure_still_fails_closed(tmp_path: Path) -> None:
    log = tmp_path / "calls.log"
    done = subprocess.run(
        ["bash", "-c", prepare_inventory_script(inventory_fails=True)],
        capture_output=True,
        text=True,
        env={**os.environ, "FAKE_LOG": str(log)},
    )

    assert done.returncode != 0
    assert "REMEMBER" not in log.read_text(encoding="utf-8")


def test_pairing_sends_new_token_only_to_isolated_admin(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = pair_script()
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["bash", "-c", script],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls
    assert SECRET not in calls
    assert "agent-id" not in calls
    assert calls.index("COMPOSE stop jht") < calls.index("jht-telegram-legacy.py inventory assistente")
    assert calls.index("jht-telegram-legacy.py inventory assistente") < calls.index("legacy remember assistente")
    assert "REMOVED" in calls
    assert "COMPOSE restart jht-telegram" in calls
    assert "COMPOSE restart jht" in calls
    status = next(line for line in calls.splitlines() if "cutover status" in line)
    assert " -i " not in f" {status} "
    pair = next(line for line in calls.splitlines() if "bots pair" in line)
    assert " -i " in f" {pair} "


def test_pairing_does_not_cut_over_while_another_legacy_bot_remains(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = pair_script()
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["bash", "-c", script],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "FAKE_REMAINING_RC": "1",
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0
    calls = log.read_text(encoding="utf-8")
    assert "cutover enable" not in calls
    assert "COMPOSE restart" not in calls


def test_pairing_with_empty_inventory_works_under_bash_3_2_and_nounset(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["/bin/bash", "-c", pair_script()],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": "",
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    pair = next(line for line in log.read_text(encoding="utf-8").splitlines() if "bots pair" in line)
    assert "--legacy-digest" not in pair


def _read_pty_until(fd: int, wanted: bytes, timeout: float = 5) -> bytes:
    output = b""
    deadline = time.monotonic() + timeout
    while wanted not in output and time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        try:
            output += os.read(fd, 4096)
        except OSError as exc:
            if exc.errno == errno.EIO:
                break
            raise
    assert wanted in output, output.decode(errors="replace")
    return output


def _wait_pty_no_echo(fd: int, timeout: float = 5) -> None:
    """Wait until Bash has entered ``read -s``, not just printed its prompt."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not termios.tcgetattr(fd)[3] & termios.ECHO:
            return
        time.sleep(0.01)
    raise AssertionError("the pairing prompt never disabled terminal echo")


def test_interactive_pairing_never_echoes_or_persists_the_token(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    environment = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_DIGEST": DIGEST,
        "EXPECTED_PAYLOAD": payload,
    }
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bash", "-c", pair_script()],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=environment,
        close_fds=True,
    )
    os.close(slave)
    try:
        output = _read_pty_until(master, b"Token del bot (input nascosto): ")
        _wait_pty_no_echo(master)
        os.write(master, (SECRET + "\n").encode())
        output += _read_pty_until(master, b"Chat ID dell'utente: ")
        os.write(master, b"42\n")
        while process.poll() is None:
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try:
                    output += os.read(master, 4096)
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
        process.wait(timeout=5)
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
    assert process.returncode == 0, output.decode(errors="replace")
    assert SECRET.encode() not in output
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls and SECRET not in calls
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert SECRET not in path.read_text(encoding="utf-8", errors="ignore")


def test_both_wrappers_document_safe_interactive_and_noninteractive_pairing() -> None:
    shell = WRAPPER.read_text(encoding="utf-8")
    powershell = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
    shell_pair = functions("telegram_pair")
    ps_pair = re.search(r"function Invoke-TelegramPair \{\n.*?\n\}", powershell, re.S)
    assert ps_pair
    assert "read -rs token" in shell_pair
    assert "Read-Host 'Token del bot (input nascosto)' -AsSecureString" in ps_pair.group(0)
    assert "[Console]::IsInputRedirected" in ps_pair.group(0)
    assert "mktemp" not in shell_pair
    assert all(word not in ps_pair.group(0) for word in ("Set-Content", "Add-Content", "New-Item"))
    assert "bot.json" not in shell + powershell
    for source in (shell, powershell):
        assert "non salvare il token in ~/.jht" in source
        assert "JSON su stdin" in source


def test_only_pairing_admin_calls_keep_interactive_stdin() -> None:
    shell = WRAPPER.read_text(encoding="utf-8")
    powershell = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
    assert 'docker exec "$telegram_id" jht-telegram-admin' in shell
    assert 'docker exec -i "$telegram_id" jht-telegram-admin' in shell
    ps_admin = re.search(r"function Invoke-TelegramAdmin \{\n.*?\n\}", powershell, re.S)
    assert ps_admin
    assert "docker exec -i $telegramId" in ps_admin.group(0)
    assert "docker exec $telegramId" in ps_admin.group(0)


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
def test_powershell_status_query_cannot_drain_automation_json(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    script = tmp_path / "pair.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Write-Info { param([string]$Message) }\n"
        "function Write-Warn { param([string]$Message) }\n"
        "function Get-RunningComposeServiceId { param([string]$Service) if ($Service -eq 'jht-telegram') { 'telegram-id' } }\n"
        "function Test-ContainerUp { return $false }\n"
        "function Invoke-Compose { param([Parameter(ValueFromRemainingArguments)] $Args) }\n"
        "$TelegramContainer = 'jht-telegram'\n$Container = 'jht'\n"
        + powershell_functions("Invoke-TelegramAdmin", "Invoke-TelegramPair")
        + "\nfunction Invoke-TelegramLegacy {\n"
        + "  param([string]$Command, [string]$Role = '')\n"
        + "  if ($Command -eq 'inventory') { if ($env:FAKE_DIGEST) { Write-Output $env:FAKE_DIGEST }; return }\n"
        + "  & docker legacy $Command $Role | Out-Null\n"
        + "}\n"
        + "$code = Invoke-TelegramPair 'assistente'\nexit $code\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls
    status = next(line for line in calls.splitlines() if "cutover status" in line)
    assert " -i " not in f" {status} "
