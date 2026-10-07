"""`--probe-limits`: lettura una tantum dei limiti del provider per il desktop.

Il desktop la chiede prima di accendere il team, quando il bridge non gira
ancora. Qui contro le funzioni vere: il verdetto (sufficiente, esaurito con
l'ora in cui si libera, dato assente), il fatto che non escano mai token o
credenziali, che un errore diventi "unknown" e che la lettura non scriva nel
ritmo del team acceso (sentinel-data.jsonl).
"""
import importlib.util
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "sentinel-bridge.py"
NOW = 1_800_000_000
SECRET = "sk-ant-oat01-fixture-secret-token"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="il bridge gira nel container Linux"
)


@pytest.fixture
def home(tmp_path, monkeypatch):
    jht_home = tmp_path / "jht"
    jht_home.mkdir()
    monkeypatch.setenv("JHT_HOME", str(jht_home))
    return jht_home


@pytest.fixture
def bridge(home):
    spec = importlib.util.spec_from_file_location("sentinel_bridge_probe_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _parsed(usage, reset, weekly=None, weekly_reset=None):
    return {
        "usage": usage,
        "reset_at_unix": reset,
        "weekly_usage": weekly,
        "weekly_reset_at_unix": weekly_reset,
    }


def test_enough_room_is_ok(bridge):
    verdict = bridge.limits_verdict(_parsed(40, NOW + 3600, 60, NOW + 86400), NOW)
    assert verdict == {
        "status": "ok",
        "resets_at": None,
        "five_hour": {"used_pct": 40, "resets_at": NOW + 3600},
        "weekly": {"used_pct": 60, "resets_at": NOW + 86400},
    }


def test_an_exhausted_five_hour_window_says_when_it_frees(bridge):
    verdict = bridge.limits_verdict(_parsed(97, NOW + 1800, 50, NOW + 86400), NOW)
    assert verdict["status"] == "exhausted"
    assert verdict["resets_at"] == NOW + 1800


def test_an_exhausted_weekly_window_blocks_until_the_weekly_reset(bridge):
    verdict = bridge.limits_verdict(_parsed(10, NOW + 1800, 100, NOW + 3 * 86400), NOW)
    assert verdict["status"] == "exhausted"
    assert verdict["resets_at"] == NOW + 3 * 86400


def test_both_exhausted_frees_only_when_the_later_reset_passes(bridge):
    verdict = bridge.limits_verdict(_parsed(99, NOW + 1800, 96, NOW + 7200), NOW)
    assert verdict["resets_at"] == NOW + 7200


def test_the_threshold_is_the_one_constant(bridge):
    just_below = bridge.LIMITS_START_BLOCK_PCT - 1
    assert bridge.limits_verdict(_parsed(just_below, NOW + 60), NOW)["status"] == "ok"
    at = bridge.LIMITS_START_BLOCK_PCT
    assert bridge.limits_verdict(_parsed(at, NOW + 60), NOW)["status"] == "exhausted"


@pytest.mark.parametrize(
    "parsed",
    [
        None,
        "RATE_LIMIT",
        {},
        _parsed(None, NOW + 60),
        _parsed(True, NOW + 60),
        _parsed(50, None),
        # Reset gia' passato: il dato e' di una finestra chiusa.
        _parsed(99, NOW - 1),
    ],
)
def test_missing_or_stale_data_is_unknown_never_a_block(bridge, parsed):
    verdict = bridge.limits_verdict(parsed, NOW)
    assert verdict["status"] == "unknown"
    assert verdict["resets_at"] is None


def test_unknown_weekly_does_not_hide_a_known_five_hour_window(bridge):
    verdict = bridge.limits_verdict(_parsed(20, NOW + 60), NOW)
    assert verdict["status"] == "ok"
    assert verdict["weekly"] is None


def test_a_read_error_is_unknown_without_details(bridge, monkeypatch):
    def boom():
        raise RuntimeError(f"token {SECRET} at /private/path")

    monkeypatch.setattr(bridge, "fetch_kimi_api", boom)
    verdict = bridge.probe_limits("kimi", now=NOW)
    assert verdict["status"] == "unknown"
    assert SECRET not in json.dumps(verdict)
    assert "/private/path" not in json.dumps(verdict)


def test_claude_probe_returns_only_percentages_and_resets(bridge, home, monkeypatch):
    creds = home / ".claude" / ".credentials.json"
    creds.parent.mkdir()
    creds.write_text(json.dumps({"claudeAiOauth": {"accessToken": SECRET}}), encoding="utf-8")
    seen = {}

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def urlopen(request, timeout):
        seen["authorization"] = request.headers.get("Authorization")
        body = {
            "five_hour": {"utilization": 41.6, "resets_at": "2027-01-15T10:00:00+00:00"},
            "seven_day": {"utilization": 12, "resets_at": "2027-01-20T10:00:00+00:00"},
        }
        return Response(json.dumps(body).encode("utf-8"))

    monkeypatch.setattr(bridge.urllib.request, "urlopen", urlopen)
    verdict = bridge.probe_limits("claude", now=NOW)

    assert seen["authorization"] == f"Bearer {SECRET}"
    assert verdict["status"] == "ok"
    assert verdict["five_hour"]["used_pct"] == 42
    assert verdict["weekly"]["used_pct"] == 12
    assert SECRET not in json.dumps(verdict)
    assert set(verdict) == {"status", "resets_at", "five_hour", "weekly"}


def test_command_line_probe_prints_json_and_leaves_the_team_rhythm_alone(home, tmp_path):
    (home / "jht.config.json").write_text(
        json.dumps({"active_provider": "codex"}), encoding="utf-8"
    )
    rollout = home / ".codex" / "sessions" / "2027" / "rollout-fixture.jsonl"
    rollout.parent.mkdir(parents=True)
    event = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "rate_limits": {
                "primary": {"used_percent": 98.0, "window_minutes": 300,
                            "resets_at": int(time.time()) + 1200},
                "secondary": {"used_percent": 30.0, "window_minutes": 10080,
                              "resets_at": int(time.time()) + 86400},
            },
        },
    }
    rollout.write_text((json.dumps(event) + "\n") * 8, encoding="utf-8")
    env = {**os.environ, "JHT_HOME": str(home)}

    result = subprocess.run(
        [sys.executable, str(BRIDGE_PATH), "--probe-limits"],
        env=env, capture_output=True, text=True, timeout=30, check=False,
    )

    assert result.returncode == 0, result.stderr
    verdict = json.loads(result.stdout)
    assert verdict["status"] == "exhausted"
    assert verdict["five_hour"]["used_pct"] == 98
    assert verdict["resets_at"] == verdict["five_hour"]["resets_at"]
    logs = home / "logs"
    assert not (logs / "sentinel-data.jsonl").exists()
    assert not (logs / "sentinel-bridge-state.json").exists()
    assert not (logs / "bridge-mailbox.jsonl").exists()
