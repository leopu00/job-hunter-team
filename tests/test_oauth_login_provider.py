"""`jht oauth-login` opens the login of the provider the team has chosen, and of none when it has chosen none."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from test_desktop_chat_wrapper import _runtime

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
NO_PROVIDER = "nessun provider attivo"


def _login(tmp_path: Path, provider: str | None) -> tuple[subprocess.CompletedProcess, list[str]]:
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    if provider is not None:
        env["JHT_TEST_ACTIVE_PROVIDER"] = provider
    done = subprocess.run(
        [str(wrapper), "oauth-login"], env=env, text=True, capture_output=True, timeout=20, check=False
    )
    return done, log.read_text(encoding="utf-8").splitlines()


def _logins(calls: list[str]) -> list[str]:
    return [line for line in calls if re.search(r"\b(codex|claude|kimi)\b", line) and "docker exec" in line]


@pytest.mark.parametrize(
    ("provider", "expected"),
    (
        ("openai", "codex login --device-auth"),
        ("codex", "codex login --device-auth"),
        ("OpenAI", "codex login --device-auth"),
        ("kimi", "kimi --yolo"),
        ("claude", "claude --dangerously-skip-permissions"),
        ("anthropic", "claude --dangerously-skip-permissions"),
    ),
)
def test_a_chosen_provider_gets_its_own_login(tmp_path: Path, provider: str, expected: str):
    done, calls = _login(tmp_path, provider)
    logins = _logins(calls)
    assert done.returncode == 0, done.stderr
    assert len(logins) == 1 and logins[0].endswith(expected), logins


def test_no_provider_opens_no_login_and_says_which_command_chooses_one(tmp_path: Path):
    # the read answers nothing for a config that is not there yet or has no active_provider
    done, calls = _login(tmp_path, "")
    assert done.returncode == 1, (done.returncode, done.stderr)
    assert NO_PROVIDER in done.stderr and "jht providers use openai" in done.stderr
    assert _logins(calls) == [], "no CLI is started when no provider is chosen"
    assert "command not found" not in done.stderr


def test_an_unknown_provider_is_refused_by_the_wrapper_not_by_the_shell(tmp_path: Path):
    done, calls = _login(tmp_path, "somebody-else")
    assert done.returncode == 1, (done.returncode, done.stderr)
    assert "provider attivo non riconosciuto: somebody-else" in done.stderr
    assert "command not found" not in done.stderr
    assert _logins(calls) == []


def test_the_powershell_wrapper_has_the_same_cases():
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    start = text.index("{ $_ -in @('oauth-login', 'claude-login') }")
    block = text[start : text.index("'setup' {", start)]
    # claude only by name: the empty provider is not among its patterns
    assert "{ $_ -in @('claude', 'anthropic') }" in block
    assert re.search(r"\{ \$_ -in @\([^)]*''", block) is None
    empty = re.search(r"^\s*'' \{ throw \"([^\"]+)\" \}", block, re.M)
    assert empty is not None and NO_PROVIDER in empty.group(1) and "jht providers use openai" in empty.group(1)
    assert block.index("'' { throw") < block.index("default {")


# «Cancel» of the sign-in: killing the window's end of `docker exec` does not end the login in the container when there
# is no terminal (Linux with a pipe), so the app asks the wrapper to end it.
def test_stop_ends_the_device_login_in_the_container_and_starts_no_login(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_ACTIVE_PROVIDER"] = "openai"
    done = subprocess.run(
        [str(wrapper), "oauth-login", "--stop"], env=env, text=True, capture_output=True, timeout=20, check=False
    )
    calls = log.read_text(encoding="utf-8").splitlines()
    assert done.returncode == 0, done.stderr
    stops = [line for line in calls if "docker exec" in line and "--device-auth" in line and "process.kill" in line]
    assert len(stops) == 1, calls
    # only the device login of Codex is looked for, by its command line: the team's agents are never named
    assert "'login'" in stops[0] and "'--device-auth'" in stops[0] and "SIGTERM" in stops[0]
    assert not any(re.search(r"codex login --device-auth$", line) for line in calls), "no login is started by --stop"
    assert not any(" claude " in line or "kimi --yolo" in line for line in calls)


def test_the_powershell_wrapper_has_the_stop_too():
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    start = text.index("{ $_ -in @('oauth-login', 'claude-login') }")
    block = text[start : text.index("'setup' {", start)]
    stop = block.index("-eq '--stop'")
    assert "process.kill" in block[stop:] and "--device-auth" in block[stop:]
    # before the provider is read: a stop never starts a login
    assert stop < block.index("$Provider =")
