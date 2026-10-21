"""`jht providers limits` con Codex: la finestra 5h e la settimanale non si confondono.

Su un piano Codex Pro la lettura mostrava `five_hour` e `weekly` identici
(stessa percentuale, stesso reset). Il rollout di Codex porta due finestre
(`primary`, `secondary`) o una sola, settimanale, nel `primary`: in quel caso il
bridge ricopiava la settimanale anche sull'asse 5h. Qui, con campioni anonimi
del rollout, si prova la lettura intera (`probe_limits`): le finestre vengono
riconosciute dalla durata dichiarata e una finestra che non c'e' resta assente.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "sentinel-bridge.py"
NOW = 1_800_000_000
FIVE_HOUR_RESET = NOW + 2 * 3600
WEEKLY_RESET = NOW + 4 * 86400

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="il bridge gira nel container Linux"
)


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    jht_home = tmp_path / "jht"
    jht_home.mkdir()
    monkeypatch.setenv("JHT_HOME", str(jht_home))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_codex_windows", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sessions = jht_home / ".codex" / "sessions" / "2027"
    sessions.mkdir(parents=True)
    monkeypatch.setattr(module, "CODEX_SESSIONS_DIR", jht_home / ".codex" / "sessions")
    module.sessions_for_test = sessions
    return module


def _rollout(bridge, rate_limits):
    event = {"timestamp": "2027-01-15T08:00:00.000Z", "payload": {"rate_limits": rate_limits}}
    path = bridge.sessions_for_test / "rollout-2027-01-15T08-00-00-fixture.jsonl"
    # il lettore scarta i file sotto i 512 byte
    path.write_text(("x" * 600) + "\n" + json.dumps(event) + "\n", encoding="utf-8")


def _limits(bridge):
    return bridge.probe_limits("codex", now=NOW)


def test_two_windows_that_differ_stay_apart(bridge):
    _rollout(bridge, {
        "primary": {"used_percent": 14.0, "window_minutes": 300, "resets_at": FIVE_HOUR_RESET},
        "secondary": {"used_percent": 41.0, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "plan_type": "pro",
    })
    verdict = _limits(bridge)
    assert verdict["status"] == "ok"
    assert verdict["five_hour"] == {"used_pct": 14, "resets_at": FIVE_HOUR_RESET}
    assert verdict["weekly"] == {"used_pct": 41, "resets_at": WEEKLY_RESET}


def test_windows_are_told_apart_by_duration_not_by_position(bridge):
    # Il payload porta la settimanale per prima: la durata dichiarata decide.
    _rollout(bridge, {
        "primary": {"used_percent": 41.0, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "secondary": {"used_percent": 14.0, "window_minutes": 300, "resets_at": FIVE_HOUR_RESET},
    })
    verdict = _limits(bridge)
    assert verdict["five_hour"] == {"used_pct": 14, "resets_at": FIVE_HOUR_RESET}
    assert verdict["weekly"] == {"used_pct": 41, "resets_at": WEEKLY_RESET}


def test_without_declared_durations_position_decides(bridge):
    _rollout(bridge, {
        "primary": {"used_percent": 14.0, "resets_at": FIVE_HOUR_RESET},
        "secondary": {"used_percent": 41.0, "resets_at": WEEKLY_RESET},
    })
    verdict = _limits(bridge)
    assert verdict["five_hour"] == {"used_pct": 14, "resets_at": FIVE_HOUR_RESET}
    assert verdict["weekly"] == {"used_pct": 41, "resets_at": WEEKLY_RESET}


def test_single_weekly_window_has_no_five_hour(bridge):
    _rollout(bridge, {
        "primary": {"used_percent": 14.0, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "secondary": None,
        "plan_type": "prolite",
    })
    verdict = _limits(bridge)
    assert verdict["status"] == "ok"
    assert verdict["five_hour"] is None
    assert verdict["weekly"] == {"used_pct": 14, "resets_at": WEEKLY_RESET}


def test_single_weekly_window_over_threshold_is_exhausted_until_its_reset(bridge):
    _rollout(bridge, {
        "primary": {"used_percent": 97.0, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "secondary": None,
    })
    verdict = _limits(bridge)
    assert verdict["status"] == "exhausted"
    assert verdict["resets_at"] == WEEKLY_RESET
    assert verdict["five_hour"] is None


def test_pacing_axes_keep_the_single_window_on_both(bridge):
    # Il ritmo del team continua a leggere `usage` come unico vincolo reale;
    # cambia solo cio' che si dichiara come finestra 5h.
    _rollout(bridge, {
        "primary": {"used_percent": 24.0, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "secondary": None,
    })
    parsed = bridge.fetch_codex_rollout()
    assert parsed["usage"] == 24
    assert parsed["weekly_usage"] == 24
    assert parsed["usage_is_weekly"] is True


def test_the_real_shape_of_a_single_window_plan_has_no_invented_five_hour(bridge):
    """Il payload di un piano a UNA finestra (plan_type "prolite"), con tutte le chiavi
    che Codex scrive: `primary` = 7 giorni, `secondary` null, nessuna finestra da 300."""
    _rollout(bridge, {
        "limit_id": "codex",
        "limit_name": None,
        "primary": {"used_percent": 13.6, "window_minutes": 10080, "resets_at": WEEKLY_RESET},
        "secondary": None,
        "credits": {"has_credits": False, "unlimited": False, "balance": "0"},
        "individual_limit": None,
        "spend_control_reached": None,
        "plan_type": "prolite",
        "rate_limit_reached_type": None,
    })
    verdict = _limits(bridge)
    assert verdict == {
        "status": "ok",
        "resets_at": None,
        "five_hour": None,
        "weekly": {"used_pct": 14, "resets_at": WEEKLY_RESET},
    }
    # il ritmo del team continua a leggere la finestra unica come suo unico vincolo
    parsed = bridge.fetch_codex_rollout()
    assert parsed["usage"] == 14 and parsed["weekly_usage"] == 14
    assert parsed["reset_at_unix"] == parsed["weekly_reset_at_unix"] == float(WEEKLY_RESET)
    assert parsed["usage_is_weekly"] is True
