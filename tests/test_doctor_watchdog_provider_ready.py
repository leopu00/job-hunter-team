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
        "codex signed in": ({"active_provider": "openai", "providers": {"openai": {}}}, True),
        "openai on pi without pi's login": ({"active_provider": "openai", "harness": "pi", "providers": {"openai": {}}}, False),
        "no provider": ({"providers": {}}, False),
    }


@pytest.mark.parametrize("name", ["glm on pi, key file there", "glm on pi, key file gone", "glm on pi, env reference", "glm on pi, no key",
                                  "codex signed in", "openai on pi without pi's login", "no provider"])
def test_the_doctor_watchdog_and_the_agent_watchdog_agree(tmp_path, name):
    config, expected = _cases(tmp_path)[name]
    assert _ready("doctor-watchdog.sh", tmp_path, config) is expected
    assert _ready("agent-watchdog.sh", tmp_path, config) is expected


def test_the_line_of_a_provider_not_set_up_does_not_say_authenticated():
    text = (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    assert "provider not authenticated yet" not in text
    assert "provider not set up yet (no sign-in, or no API key in the configuration)" in text
