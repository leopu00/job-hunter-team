"""Live Docker/Podman check that host pairing preserves redirected stdin.

The first admin query deliberately runs before ``bots pair``.  If it regains
``exec -i``, it drains the JSON supplied to this shell and the real admin in
the second call fails with ``input_not_json``.

Podman outside Linux only on JHT_PODMAN_TEST_CONNECTION (tests/live_engines.py).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from live_engines import engine_argv, engine_env, live_engines


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "docker.io/library/python:3.11-slim-bookworm"
TOKEN = "987654:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"


ENGINES = live_engines()
pytestmark = pytest.mark.skipif(not ENGINES, reason="needs Linux with Docker or Podman (runs in CI)")


def run(engine: str, *args: str, check: bool = True, input: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [*engine_argv(engine), *args], capture_output=True, text=True, timeout=300, input=input,
    )
    if check and result.returncode != 0:
        raise AssertionError(f"{engine} {' '.join(args)} -> {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result


def _function(name: str) -> str:
    source = (ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
    assert match
    return match.group(0)


@pytest.mark.parametrize("engine", ENGINES)
def test_real_container_pair_gets_stdin_after_status_query(engine: str) -> None:
    tag = uuid.uuid4().hex[:8]
    secrets = f"jhttg-secrets-{tag}"
    state = f"jhttg-state-{tag}"
    container = f"jhttg-admin-{tag}"
    userns = ["--userns", "keep-id:uid=1001,gid=1001"] if engine == "podman" else []
    try:
        run(engine, "pull", IMAGE)
        run(engine, "volume", "create", secrets)
        run(engine, "volume", "create", state)
        run(
            engine, "run", "--rm", *userns, "--user", "0:0",
            "-v", f"{secrets}:/s", "-v", f"{state}:/t", IMAGE,
            "sh", "-c", "mkdir -p /s/bots && chown -R 1003:1003 /s /t && chmod 0700 /s /s/bots /t",
        )
        run(
            engine, "run", "-d", "--name", container, *userns, "--user", "1003:1003",
            "--network", "none", "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "-e", "PATH=/tmp/bin:/usr/local/bin:/usr/bin:/bin",
            "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-e", "JHT_TELEGRAM_SECRETS=/jht_telegram_secrets",
            "-e", "JHT_TELEGRAM_STATE=/jht_telegram_state",
            "-v", f"{ROOT / 'shared'}:/app/shared:ro",
            "-v", f"{secrets}:/jht_telegram_secrets", "-v", f"{state}:/jht_telegram_state",
            IMAGE, "python3", "-c",
            "import os,time; os.mkdir('/tmp/bin'); "
            "os.symlink('/app/shared/telegram_service/bin/jht-telegram-admin.py', "
            "'/tmp/bin/jht-telegram-admin'); time.sleep(300)",
        )
        script = (
            "set -euo pipefail\n"
            "docker() { \"$JHT_LIVE_ENGINE\" \"$@\"; }\n"
            "err() { printf '%s\\n' \"$*\" >&2; }\n"
            f"read_only_service_id() {{ printf '%s\\n' '{container}'; }}\n"
            "TELEGRAM_SERVICE=jht-telegram\n"
            + _function("telegram_admin")
            + _function("telegram_admin_input")
            + "printf '' | telegram_admin_input legacy remember assistente >/dev/null\n"
            + "telegram_admin cutover status >/dev/null\n"
            + "telegram_admin_input bots pair assistente\n"
        )
        paired = subprocess.run(
            ["/bin/bash", "-c", script],
            input=json.dumps({"bot_token": TOKEN}),
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, **engine_env(engine), "JHT_LIVE_ENGINE": shutil.which(engine) or engine},
        )
        # The container has no network, so the chat verification cannot reach
        # Telegram. That is the proof wanted here: the admin read the JSON
        # (a drained stdin would answer input_not_json) and got as far as
        # asking the Bot API who the bot is, after recording the token.
        assert paired.returncode == 1, paired.stderr
        assert json.loads(paired.stdout.strip()) == {"ok": False, "reason": "telegram_unreachable"}
        assert TOKEN not in paired.stdout + paired.stderr
    finally:
        run(engine, "rm", "-f", "-v", container, check=False)
        run(engine, "volume", "rm", "-f", secrets, check=False)
        run(engine, "volume", "rm", "-f", state, check=False)
