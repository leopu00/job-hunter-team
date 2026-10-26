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
