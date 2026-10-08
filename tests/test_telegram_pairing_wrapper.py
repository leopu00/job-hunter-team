"""Host pairing keeps the new Telegram token outside the agent container."""

from __future__ import annotations

import os
import re
import subprocess
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
    value=$(cat); printf 'TELEGRAM_STDIN %s\n' "$value" >> "$FAKE_LOG"
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


def test_pairing_sends_new_token_only_to_isolated_admin(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = (
        'err() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\n'
        'info() { echo "info: $*" >&2; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        + functions("telegram_admin", "telegram_legacy", "telegram_pair")
        + '\ntelegram_pair assistente\n'
    )
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
        },
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8")
    assert f"TELEGRAM_STDIN {payload}" in calls
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
    script = (
        'err() { :; }\nwarn() { :; }\ninfo() { :; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        + functions("telegram_admin", "telegram_legacy", "telegram_pair")
        + '\ntelegram_pair assistente\n'
    )
    done = subprocess.run(
        ["bash", "-c", script],
        input=f'{{"bot_token":"{SECRET}","chat_id":"42"}}',
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "FAKE_REMAINING_RC": "1",
        },
    )
    assert done.returncode == 0
    calls = log.read_text(encoding="utf-8")
    assert "cutover enable" not in calls
    assert "COMPOSE restart" not in calls
