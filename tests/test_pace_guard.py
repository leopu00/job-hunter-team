"""Test del guard-rail di pacing sulla finestra rate-limit.

Root cause coperta: run ThinkPad 2026-07-26 (Kimi Allegretto). Finestra
aperta alle 14:35 con reset alle 19:43; alle 17:00 il consumo era già al
**100%** e il team è rimasto muto per 2h40. Il pacing misurava correttamente
ma l'attuazione passava dal Capitano, troppo lenta per fermare la deriva.

Il vincolo verificato qui: a metà finestra il consumo ideale è metà del
target, e uno scarto in eccesso deve alzare il freno PRIMA del lockout,
senza mai arrivare al freeze (che lascia l'utente senza risposte).

Eseguire:
    pytest tests/test_pace_guard.py -v
"""

import os
import sys
from datetime import datetime, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import pace_guard  # noqa: E402


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp()


# Il sample vero letto dal ThinkPad durante l'incidente.
WINDOW_START = _ts("2026-07-26T14:35:00")
WINDOW_RESET = _ts("2026-07-26T19:43:08")

REAL_SAMPLE = {
    "provider": "kimi",
    "session_id": "20260726T143500Z",
    "usage": 100,
    "reset_at_unix": WINDOW_RESET,
    "weekly_usage": 23,
    "weekly_remaining_pct": 77.0,
}


def _sample(usage, **over):
    return dict(REAL_SAMPLE, usage=usage, **over)


# ── La curva ────────────────────────────────────────────────────────────

def test_window_start_comes_from_session_id():
    start, end = pace_guard.window_bounds(REAL_SAMPLE, _ts("2026-07-26T17:00:00"))
    assert start == pytest.approx(WINDOW_START, abs=1)
    assert end == pytest.approx(WINDOW_RESET, abs=1)


def test_window_start_falls_back_to_reset_minus_five_hours():
    """Senza session_id la finestra si assume nominale, non si rinuncia."""
    s = dict(REAL_SAMPLE)
    del s["session_id"]
    start, end = pace_guard.window_bounds(s, _ts("2026-07-26T17:00:00"))
    assert end - start == pytest.approx(5 * 3600, abs=1)


def test_stale_sample_is_refused():
    """Dopo il reset il sample non descrive più la finestra corrente."""
    assert pace_guard.window_bounds(REAL_SAMPLE, _ts("2026-07-26T20:30:00")) is None


def test_ideal_is_linear_in_time():
    assert pace_guard.ideal_usage(100.0, 0.0) == 0.0
    assert pace_guard.ideal_usage(100.0, 0.5) == 50.0
    assert pace_guard.ideal_usage(100.0, 1.0) == 100.0
    # Target ridotto dal pacing weekly-aware: la curva scala con lui.
    assert pace_guard.ideal_usage(48.0, 0.5) == 24.0


# ── Il verdetto ─────────────────────────────────────────────────────────

def test_incident_is_caught_before_lockout():
    """Alle 16:00 il team era a ~75% con curva ideale ~28%: va frenato."""
    now = _ts("2026-07-26T16:00:00")
    r = pace_guard.evaluate(_sample(75), now, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    assert r["ok"]
    assert r["verdict"] == "AVANTI"
    assert r["deviation_pct"] > 40
    assert r["throttle_after_s"] > pace_guard.WORKER_FLOOR


def test_on_curve_does_not_touch_the_throttle():
    """Metà finestra, metà budget: è esattamente il comportamento voluto."""
    now = _ts("2026-07-26T17:09:04")   # metà esatta fra start e reset
    r = pace_guard.evaluate(_sample(50), now, target_pct=100.0,
                            current_throttle_s=900)
    assert r["verdict"] == "IN-PARI"
    assert r["changed"] is False
    assert r["throttle_after_s"] == 900


def test_under_curve_releases_the_brake():
    """Sotto la curva il budget resterebbe sul tavolo: si allenta."""
    now = _ts("2026-07-26T17:09:04")
    r = pace_guard.evaluate(_sample(20), now, target_pct=100.0,
                            current_throttle_s=1800)
    assert r["verdict"] == "INDIETRO"
    assert r["throttle_after_s"] < 1800


def test_full_window_at_reset_is_the_goal_not_an_overshoot():
    """Arrivare al 100% al reset è centrare l'obiettivo, non sforare."""
    now = _ts("2026-07-26T19:42:00")
    r = pace_guard.evaluate(_sample(99), now, target_pct=100.0,
                            current_throttle_s=600)
    assert r["verdict"] == "IN-PARI"


def test_danger_zone_brakes_hard():
    now = _ts("2026-07-26T15:30:00")
    r = pace_guard.evaluate(_sample(96), now, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    assert r["verdict"] == "LOCKOUT-IMMINENTE"
    assert r["throttle_after_s"] == pace_guard.WORKER_CEILING


# ── I limiti del freno ──────────────────────────────────────────────────

def test_brake_never_becomes_a_freeze():
    """Il freno satura a 1h: un team lento si recupera, uno lockato no."""
    r = pace_guard.evaluate(_sample(99), _ts("2026-07-26T15:00:00"),
                            target_pct=100.0, current_throttle_s=3600)
    assert r["throttle_after_s"] == pace_guard.WORKER_CEILING


def test_brake_never_goes_below_the_worker_floor():
    """Anche molto indietro, un worker non scende sotto i 5 minuti."""
    r = pace_guard.evaluate(_sample(1), _ts("2026-07-26T19:00:00"),
                            target_pct=100.0, current_throttle_s=300)
    assert r["throttle_after_s"] == pace_guard.WORKER_FLOOR


def test_step_throttle_moves_one_rung_at_a_time():
    assert pace_guard.step_throttle(600, 1) == 900
    assert pace_guard.step_throttle(600, -1) == 300
    assert pace_guard.step_throttle(300, -5) == pace_guard.WORKER_FLOOR
    assert pace_guard.step_throttle(3000, 9) == pace_guard.WORKER_CEILING


def test_off_ladder_value_snaps_down_not_up():
    """Un valore fuori scala non deve far saltare un gradino per arrotondamento."""
    assert pace_guard.step_throttle(700, 1) == 900


# ── Robustezza ──────────────────────────────────────────────────────────

def test_missing_usage_is_not_a_decision():
    r = pace_guard.evaluate({"reset_at_unix": WINDOW_RESET}, _ts("2026-07-26T16:00:00"))
    assert r["ok"] is False


def test_bridge_target_wins_when_present():
    """Se il bridge è weekly-aware il suo target comanda sulla finestra piena."""
    now = _ts("2026-07-26T17:09:04")
    r = pace_guard.evaluate(_sample(30, target_pct=48.0), now)
    assert r["target_pct"] == 48.0
    assert r["ideal_pct"] == pytest.approx(24.0, abs=0.5)
    assert r["verdict"] == "IN-PARI"
