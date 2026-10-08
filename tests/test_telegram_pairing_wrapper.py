"""Host pairing keeps the new Telegram token outside the agent container."""

from __future__ import annotations

import errno
import os
import pty
import re
import select
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SECRET = "987654:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"
DIGEST = "a" * 64

FAKE_DOCKER = r"""#!/bin/sh
printf 'ARGV %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = exec ] || exit 0
shift
while [ $# -gt 0 ]; do
  case "$1" in -i|-it) shift ;; -u|--user) shift 2 ;; *) break ;; esac
done
target="$1"; shift
case "$target:$*" in
  agent-id:*"jht-telegram-legacy.py inventory assistente") printf '%s\n' "$FAKE_DIGEST" ;;
  agent-id:*"jht-telegram-legacy.py remove assistente") printf 'REMOVED\n' >> "$FAKE_LOG" ;;
  agent-id:*"jht-telegram-legacy.py remaining") exit "${FAKE_REMAINING_RC:-0}" ;;
  telegram-id:"jht-telegram-admin cutover status") printf '{"ok":true,"cutover":{"enabled":false}}\n' ;;
  telegram-id:"jht-telegram-admin bots pair assistente --legacy-digest "*)
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


def pair_script() -> str:
    return (
        'err() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\n'
        'info() { echo "info: $*" >&2; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        + functions("telegram_admin", "telegram_legacy", "telegram_pair")
        + '\ntelegram_pair assistente\n'
    )


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
    assert SECRET not in "\n".join(line for line in calls.splitlines() if "agent-id" in line)
    assert "REMOVED" in calls
    assert "COMPOSE restart jht-telegram" in calls
    assert "COMPOSE restart jht" in calls


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
