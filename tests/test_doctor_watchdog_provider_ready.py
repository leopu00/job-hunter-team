"""The Dottore's watchdog waits for the provider to be set up before it schedules the Dottore and the Mantenitore. Its check knew only the
sign-in files of the CLIs: a team on Pi with a GLM key has none, so it stayed «provider not authenticated yet» for ever (and said it
even with the key accepted and the credit out). It now follows the rule of config_ready() in agent-watchdog.sh; this keeps the two
together on the same configurations. Keys and files are synthetic."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _snippet(script: str) -> str:
    text = (ROOT / ".launcher" / script).read_text(encoding="utf-8")
    start = text.index("config_ready() {")
    body = text[start:]
    return re.search(r"<<'PYEOF'\n(.*?)\nPYEOF", body, re.S).group(1)


def _ready(script: str, home: Path, config: dict) -> bool:
    (home / "jht.config.json").write_text(json.dumps(config))
    done = subprocess.run([sys.executable, "-c", _snippet(script), str(home / "jht.config.json"), str(home)],
                          capture_output=True, text=True, timeout=30, env={"PATH": "/usr/bin:/bin"})
    return done.returncode == 0


def _cases(home: Path):
    key = home / "glm.key"
    key.write_text("synthetic\n")
    (home / ".codex").mkdir()
    (home / ".codex" / "auth.json").write_text("{}")
    return {
        "glm on pi, key file there": ({"active_provider": "glm", "harness": "pi", "providers": {"glm": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": str(key)}}}}, True),
        "glm on pi, key file gone": ({"active_provider": "glm", "harness": "pi", "providers": {"glm": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": str(home / "nope.key")}}}}, False),
        "glm on pi, env reference": ({"active_provider": "glm", "harness": "pi", "providers": {"glm": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "env", "id": "ZAI_API_KEY"}}}}, True),
        "glm on pi, no key": ({"active_provider": "glm", "harness": "pi", "providers": {"glm": {"auth_method": "api_key"}}}, False),
        # claude and openai on pi with an API key: the key is the whole of it, no subscription sign-in (giro Windows 15/11: after
        # the switch onto the full image the team on Claude was never respawned)
        "claude on pi, key file there": ({"active_provider": "claude", "harness": "pi", "providers": {"claude": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": str(key)}}}}, True),
        "claude on pi, key file gone": ({"active_provider": "claude", "harness": "pi", "providers": {"claude": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": str(home / "nope.key")}}}}, False),
        "openai on pi, key file there": ({"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": str(key)}}}}, True),
        "claude on pi, no key": ({"active_provider": "claude", "harness": "pi", "providers": {"claude": {"auth_method": "api_key"}}}, False),
        "codex signed in": ({"active_provider": "openai", "providers": {"openai": {}}}, True),
        "openai on pi without pi's login": ({"active_provider": "openai", "harness": "pi", "providers": {"openai": {}}}, False),
        "no provider": ({"providers": {}}, False),
    }


@pytest.mark.parametrize("name", ["glm on pi, key file there", "glm on pi, key file gone", "glm on pi, env reference", "glm on pi, no key",
                                  "claude on pi, key file there", "claude on pi, key file gone", "openai on pi, key file there",
                                  "claude on pi, no key",
                                  "codex signed in", "openai on pi without pi's login", "no provider"])
def test_the_doctor_watchdog_and_the_agent_watchdog_agree(tmp_path, name):
    config, expected = _cases(tmp_path)[name]
    assert _ready("doctor-watchdog.sh", tmp_path, config) is expected
    assert _ready("agent-watchdog.sh", tmp_path, config) is expected


def test_the_line_of_a_provider_not_set_up_does_not_say_authenticated():
    text = (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    assert "provider not authenticated yet" not in text
    assert "provider not set up yet (no sign-in, or no API key in the configuration)" in text


def test_the_doctor_is_not_started_while_the_spending_brake_or_the_quota_holds_the_team(tmp_path):
    """Pause of the pace (Linux 12b): the Dottore was started three times, the gate held its first message and the person read
    «DOTTORE non riesce a partire». The loop waits for the flag to go."""
    import re
    import subprocess
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    text = (root / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    flags = re.search(r'^DAILY_HALT_FLAGS=.*$', text, re.M).group(0)
    fn = re.search(r'^daily_halt_active\(\) \{.*\}$', text, re.M).group(0)
    code = 'JHT_HOME="%s"\n%s\n%s\ndaily_halt_active && echo yes || echo no\n' % (tmp_path, flags, fn)

    def held():
        return subprocess.run(["bash", "-c", code], capture_output=True, text=True, timeout=30, check=True).stdout.strip() == "yes"

    assert held() is False
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "daily-halt.flag").write_text("{}", encoding="utf-8")
    assert held() is True
    (tmp_path / "logs" / "daily-halt.flag").unlink()
    (tmp_path / ".daily-halt.flag").write_text("{}", encoding="utf-8")
    assert held() is True
    assert "|| daily_halt_active || setup_open || standby_active; then" in text, "the loop must stop on it before the spawn"


def test_a_pause_takes_the_old_failure_of_the_roles_out_of_the_status():
    """After an update the notice «cannot start» of a start that failed before the pause stayed 47 minutes (giro Linux 18/11)."""
    text = Path(__file__).resolve().parents[1].joinpath(".launcher", "doctor-watchdog.sh").read_text(encoding="utf-8")
    gate = text[text.index("|| daily_halt_active || setup_open || standby_active; then"):]
    gate = gate[: gate.index("finish_tick")]
    assert "spawn_failed dottore ok" in gate and "spawn_failed mantenitore ok" in gate
