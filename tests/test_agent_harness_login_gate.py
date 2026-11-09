"""The watchdog's readiness gate waits for the login of the program that drives the agents.

config_ready() in .launcher/agent-watchdog.sh answers "may the agents be respawned": the provider is
set and its login is there. With `harness: pi` the login that counts is Pi's (its own /login,
`.pi/agent/auth.json`), not Codex's; the boot gate in cli/src/commands/pid1.js asks the same through
loginMarkerOf (shared/runtime/agent-harness.js), covered in cli/tests/harness.test.mjs.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"


def _config_ready(home: Path, config: dict) -> int:
    path = home / "jht.config.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    source = WATCHDOG.read_text(encoding="utf-8")
    function = re.search(r"^config_ready\(\) \{.*?^PYEOF\n\}", source, re.S | re.M).group(0)
    return subprocess.run(
        ["bash", "-c", f'CONFIG="{path}"; JHT_HOME="{home}"\n{function}\nconfig_ready'],
        capture_output=True, text=True, check=False,
    ).returncode


def _login(home: Path, marker: str) -> None:
    target = home / marker
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("{}", encoding="utf-8")


@pytest.mark.parametrize(("harness", "marker"), [
    (None, ".codex/auth.json"),
    ("codex", ".codex/auth.json"),
    ("pi", ".pi/agent/auth.json"),
])
def test_the_gate_opens_on_the_login_of_the_harness(tmp_path: Path, harness, marker) -> None:
    config = {"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}}
    if harness:
        config["harness"] = harness
    assert _config_ready(tmp_path, config) == 1, "no login yet: closed"
    _login(tmp_path, marker)
    assert _config_ready(tmp_path, config) == 0


def test_a_codex_login_does_not_open_the_gate_of_a_pi_team(tmp_path: Path) -> None:
    config = {"active_provider": "openai", "harness": "pi"}
    _login(tmp_path, ".codex/auth.json")
    assert _config_ready(tmp_path, config) == 1


def test_a_pi_login_does_not_open_the_gate_of_a_codex_team(tmp_path: Path) -> None:
    config = {"active_provider": "openai"}
    _login(tmp_path, ".pi/agent/auth.json")
    assert _config_ready(tmp_path, config) == 1


def test_pi_in_the_config_changes_nothing_for_a_provider_that_pi_does_not_run(tmp_path: Path) -> None:
    _login(tmp_path, ".claude/.credentials.json")
    assert _config_ready(tmp_path, {"active_provider": "claude", "harness": "pi"}) == 0


@pytest.mark.parametrize("provider", ["glm", "kimi", "moonshot"])
def test_pi_with_an_api_provider_counts_only_the_login_of_pi(tmp_path: Path, provider: str) -> None:
    config = {"active_provider": provider, "harness": "pi"}
    _login(tmp_path, ".kimi/credentials/kimi-code.json")
    assert _config_ready(tmp_path, config) == 1, "the login of the Kimi program is not Pi's"
    _login(tmp_path, ".pi/agent/auth.json")
    assert _config_ready(tmp_path, config) == 0


def test_the_pane_command_of_a_pi_agent_is_not_a_zombie() -> None:
    text = WATCHDOG.read_text(encoding="utf-8")
    assert re.search(r"\[Kk\]imi\|claude\|Claude\|codex\|Codex\|pi\|node", text)
