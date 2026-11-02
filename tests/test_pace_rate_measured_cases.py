"""Il ritmo del budget su un contatore intero: i cinque casi misurati su un team reale (29/10-01/11, Codex `prolite`, finestra
unica settimanale) e le regole di pace_rate.py. Le serie sono ricostruite dai campioni del team (sentinel-data), con
valori e orari reali dove li abbiamo; nessun dato personale.

  1. COAST con weekly_remaining 63% (01/11 03:45Z): confronto fra la settimanale e il target di una finestra 5h.
  2. «12 %/h»: un punto intero in un campione da 5 minuti.
  3. il contatore scende da 29 a 20 senza reset (29/10 18:40Z): lettura vecchia sostituita da una fresca.
  4. consigli al contrario: 2 punti nelle ultime 2,5 h proiettati sulle 76 h al reset (01/11 02:30Z); il tick con
     «+300% above» sopra «BELOW-PACE»; pace-guard che a 0 gradini «accelera».
  5. +3 punti in 5 minuti senza token del team (01/11 21:05Z): «vel_team=12.00%/h» su 15 minuti, poi «4.00%/h».
"""
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SKILLS = REPO / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import compute_metrics  # noqa: E402
import pace_guard  # noqa: E402
import pace_rate as pr  # noqa: E402
import weekly_pace  # noqa: E402

RESET = 1793774152  # 2026-11-04 06:35:52Z, weekly_reset_at_unix del team
UTC = timezone.utc


def _t(day_hour_min):
    return datetime.fromisoformat(day_hour_min).replace(tzinfo=UTC).timestamp()


def _series(*segments, step_min=5):
    """[(epoch, valore)] ogni `step_min` minuti: segmenti (inizio, fine, valore), fine esclusa."""
    out = []
    for start, end, value in segments:
        t = _t(start)
        while t < _t(end):
            out.append((t, float(value)))
            t += step_min * 60
    return out


def _write(path, series):
    path.write_text("".join(json.dumps({"ts": datetime.fromtimestamp(t, UTC).isoformat(), "weekly_usage": v}) + "\n"
                            for t, v in series), encoding="utf-8")
    return str(path)


# ── le regole ────────────────────────────────────────────────────────────────────────────────────────────

def test_one_step_of_one_point_is_not_twelve_percent_per_hour():
    series = _series(("2026-10-31T20:00", "2026-10-31T21:45", 33), ("2026-10-31T21:45", "2026-10-31T22:30", 34))
    assert pr.counter_rate(series, _t("2026-10-31T22:25"), min_span_h=0.2) is not None  # a 5-minute step exists
    res = pr.counter_rate(series, _t("2026-10-31T22:25"))
    assert res is None or res["span_h"] >= 1.0       # never a window shorter than an hour
    # one point over eight hours: the interval says «slow», it does not say «above»
    longer = _series(("2026-10-31T14:00", "2026-10-31T21:45", 33), ("2026-10-31T21:45", "2026-10-31T22:30", 34))
    res = pr.counter_rate(longer, _t("2026-10-31T22:25"))
    assert res["delta"] == 1 and res["lo"] == 0.0 and res["hi"] < 0.3
    assert pr.classify(res, 1.7) == "SOTTO-PACE"


def test_the_interval_gives_no_verdict_on_one_uncertain_step():
    res = {"lo": 0.0, "hi": 2.0, "rate": 1.0}
    assert pr.classify(res, 1.7) == "ALLINEATO"       # neither above (lo) nor below (hi): no verdict
    assert pr.classify({"lo": 2.5, "hi": 3.5, "rate": 3.0}, 1.7) == "SOPRA-PACE"
    assert pr.classify({"lo": 0.0, "hi": 1.0, "rate": 0.5}, 1.7) == "SOTTO-PACE"
    assert pr.classify(None, 1.7) == "ND" and pr.classify(res, 0) == "ND"


def test_a_real_overpace_is_still_seen():
    # 2 points every 5 minutes for an hour and a half = 24 %/h against a sustainable 1.7: the brake must come
    series = [(_t("2026-11-01T10:00") + 300 * i, 20.0 + 2 * i) for i in range(19)]
    res = pr.counter_rate(series, _t("2026-11-01T10:00") + 300 * 18)
    assert pr.classify(res, 1.7) == "SOPRA-PACE" and res["unattributed_pts"] == 0
    assert res["rate"] == pytest.approx(24.0, rel=0.05)


# ── caso 5: +3 in 5 minuti senza token del team ──────────────────────────────────────────────────────────

D = (("2026-11-01T16:00", "2026-11-01T21:05", 38), ("2026-11-01T21:05", "2026-11-01T21:45", 41),
     ("2026-11-01T21:45", "2026-11-01T22:30", 42))
D_SERIES = _series(*D)
D_SERIES = [(t, 38.0) if t < _t("2026-11-01T21:05") else (t, v) for t, v in D_SERIES]


@pytest.mark.parametrize("now", ["2026-11-01T21:15", "2026-11-01T22:00", "2026-11-01T22:25"])
def test_case5_a_jump_of_three_points_in_five_minutes_is_not_a_team_pace(now):
    res = pr.counter_rate(D_SERIES, _t(now))
    assert res is not None and res["unattributed_pts"] == 3.0
    assert pr.classify(res, 2.03) != "SOPRA-PACE", res
    assert res["rate"] < 1.0


def test_case5_the_weekly_verdict_at_22_00_is_not_slow_down(tmp_path):
    path = _write(tmp_path / "sentinel-data.jsonl", D_SERIES)
    res = weekly_pace.weekly_pace_assessment(path, _t("2026-11-01T22:00"), 58.0, 29.0, weekly_total_active_hours=70.0)
    assert res is not None and res["kind"] != "SOPRA-PACE" and res["unattributed_pts"] == 3.0
    assert res["vel_weekly_pct_h"] < 2.0 and res["early_lockout_h"] is None


def test_case5_the_level_stays_the_providers_even_if_the_pace_ignores_the_jump():
    adjusted, info = pr.adjust_series(D_SERIES)
    assert D_SERIES[-1][1] == 42.0 and info["unattributed_pts"] == 3.0 and adjusted[-1][1] == 39.0


# ── caso 3: il contatore scende senza reset ──────────────────────────────────────────────────────────────

A = _series(("2026-10-29T10:45", "2026-10-29T18:40", 29), ("2026-10-29T18:40", "2026-10-29T21:05", 20),
            ("2026-10-29T21:05", "2026-10-29T21:10", 21), ("2026-10-29T21:10", "2026-10-29T21:35", 22),
            ("2026-10-29T21:35", "2026-10-29T23:55", 24))


def test_case3_a_drop_restarts_the_series_it_is_not_negative_and_not_blind_for_hours(tmp_path):
    path = _write(tmp_path / "sentinel-data.jsonl", A)
    # right after the drop the new baseline is younger than an hour: no rate yet, and nothing negative
    assert weekly_pace.weekly_pace_assessment(path, _t("2026-10-29T18:45"), 80.0, 100.0, weekly_total_active_hours=168.0) is None
    # one hour later there is a rate again (before: 2 h 55 of `None`, then a ratio of 4.65)
    res = weekly_pace.weekly_pace_assessment(path, _t("2026-10-29T19:45"), 80.0, 100.0, weekly_total_active_hours=168.0)
    assert res is not None and res["rebaselined"] is True
    assert res["vel_weekly_pct_h"] >= 0 and res["kind"] != "ND"
    # the team started working at 21:00Z: 4 points in the last hour are a real pace, measured from the new baseline
    res = weekly_pace.weekly_pace_assessment(path, _t("2026-10-29T21:40"), 76.0, 100.0, weekly_total_active_hours=168.0)
    assert res is not None and res["rebaselined"] is True
    assert res["vel_weekly_pct_h"] == pytest.approx(4.0)


def test_case3_compute_metrics_never_writes_negative_velocity_or_projection():
    now = datetime.now(UTC)
    history = [{"ts": (now - timedelta(minutes=5 * (100 - i))).isoformat(), "provider": "openai", "session_id": "s",
                "usage": 29, "delta": 0} for i in range(100)]
    last = {"ts": (now - timedelta(minutes=5)).isoformat(), "provider": "openai", "session_id": "s", "usage": 29,
            "velocity_smooth": 0.0}
    parsed = {"provider": "openai", "usage": 20, "weekly_usage": 20, "reset_at_unix": now.timestamp() + 7920 * 60,
              "weekly_reset_at_unix": now.timestamp() + 7920 * 60}
    out = compute_metrics.compute_metrics(parsed, last, history=history)
    assert out["delta"] == -9
    assert out["velocity"] >= 0 and out["projection"] >= 20 and out["status"] != "ATTENZIONE"


# ── caso 4a: due punti nelle ultime 2,5 h, 76 ore al reset ───────────────────────────────────────────────

@pytest.mark.parametrize("rows", [30, 96])     # 30 righe = la storia che il bridge passava (2,5 h); 96 = quella di adesso
def test_case4a_two_points_in_two_and_a_half_hours_do_not_make_attenzione(rows):
    now = datetime.now(UTC)
    reset = now.timestamp() + 76.1 * 3600
    # la forma vera: 35 per la sera, 36 e 37 nelle ultime due ore e mezza; un campione ogni 5 minuti
    steps = [(0, 35), (350, 36), (420, 37)]    # minuti dall'inizio delle 8 h
    history = []
    for i in range(96):
        minute = 5 * i
        value = [v for m, v in steps if m <= minute][-1]
        history.append({"ts": (now - timedelta(minutes=480 - minute)).isoformat(), "provider": "openai", "session_id": "s",
                        "usage": value, "delta": 0})
    history = history[-rows:]
    last = dict(history[-1], velocity_smooth=0.0)
    parsed = {"provider": "openai", "usage": 37, "weekly_usage": 37, "reset_at_unix": reset, "weekly_reset_at_unix": reset}
    out = compute_metrics.compute_metrics(parsed, last, history=history)
    # prima: 2 punti / 2,5 h x 76 h = +61 di proiezione -> ATTENZIONE e throttle 60 s con il weekly a 0,44 del sostenibile
    assert out["status"] != "ATTENZIONE" and out["suggested_throttle_s"] == 0 and out["throttle"] == 0
    assert out["phase"] == 1


# ── caso 4c: pace-guard a 0 gradini non consiglia ────────────────────────────────────────────────────────

@pytest.mark.parametrize("current", [900, 0, 300, 1020, 3180])
def test_case4c_in_pace_pace_guard_recommends_nothing(current):
    now = _t("2026-10-29T00:25")
    sample = {"usage": 13, "reset_at_unix": RESET, "session_id": "20261028T064000Z", "target_pct": 100.0}
    out = pace_guard.evaluate(sample, now_unix=now, target_pct=100.0, current_throttle_s=current)
    assert out["ok"] and out["steps"] == 0
    assert out["throttle_recommended_s"] == current and out["recommends_change"] is False


def test_case4c_a_real_deviation_still_moves_the_ladder():
    now = _t("2026-10-29T12:00")
    sample = {"usage": 60, "reset_at_unix": RESET, "session_id": "20261028T064000Z"}
    out = pace_guard.evaluate(sample, now_unix=now, target_pct=100.0, current_throttle_s=300)
    assert out["steps"] > 0 and out["throttle_recommended_s"] > 300 and out["recommends_change"] is True


# ── casi 1 e 4b: i bridge (pacing-bridge, sentinel-bridge) ───────────────────────────────────────────────

def _load_bridge(name, filename, monkeypatch, tmp_path):
    home = tmp_path / "jht"
    home.mkdir(exist_ok=True)
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location(name, REPO / ".launcher" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


TEAM_CFG = {"team": {"working_hours": {"timezone": "Europe/Rome",
            "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "22:00", "end": "08:00"}]}}}


def _wht(monkeypatch):
    spec = importlib.util.spec_from_file_location("wht_under_test", SKILLS / "work_hours_target.py")
    wht = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wht)
    monkeypatch.setattr(wht._wh, "_load_config", lambda: TEAM_CFG)
    return wht


@pytest.mark.parametrize("stamp", ["2026-11-01T03:30", "2026-11-01T03:45", "2026-11-01T04:00", "2026-11-01T04:30"])
def test_case1_coast_needs_the_weekly_to_be_ahead_of_the_active_hours_line(stamp, monkeypatch, tmp_path):
    bridge = _load_bridge("pacing_bridge_under_test", "pacing-bridge.py", monkeypatch, tmp_path)
    wht = _wht(monkeypatch)
    now = datetime.fromisoformat(stamp).replace(tzinfo=UTC)
    # the old test: the window target (a share of a 5-hour cap) against the weekly counter
    end = now + timedelta(hours=5)
    target = wht.compute_target(now_utc=now, window_start_utc=now, window_end_utc=end, window_cap_pct_of_weekly=17.0,
                                config=TEAM_CFG, weekly_used_pct=37,
                                weekly_reset_at_utc=datetime.fromtimestamp(RESET, UTC))
    wah = target["weekly_active_hours"]
    if stamp != "2026-11-01T03:30":
        assert 37 >= target["current_window_target_pct"], "the old comparison would have said COAST here"
    debt = bridge._weekly_debt_pct(wht, now, 37, RESET, wah)
    assert debt is not None and debt < 0, debt                       # the weekly is BEHIND the line: no coast
    assert debt < bridge.WEEKLY_COAST_DEBT_PCT


def test_case1_a_weekly_really_ahead_of_the_line_still_coasts(monkeypatch, tmp_path):
    bridge = _load_bridge("pacing_bridge_under_test", "pacing-bridge.py", monkeypatch, tmp_path)
    wht = _wht(monkeypatch)
    now = datetime.fromisoformat("2026-11-01T03:45").replace(tzinfo=UTC)
    wah = wht.active_hours_in_range(now, datetime.fromtimestamp(RESET, UTC), TEAM_CFG)
    debt = bridge._weekly_debt_pct(wht, now, 75, RESET, wah)
    assert debt >= bridge.WEEKLY_COAST_DEBT_PCT


def test_single_weekly_is_declared_or_recognised(monkeypatch, tmp_path):
    bridge = _load_bridge("pacing_bridge_under_test", "pacing-bridge.py", monkeypatch, tmp_path)
    assert bridge._single_weekly({"usage_is_weekly": True, "usage": 5, "weekly_usage": 9})
    assert bridge._single_weekly({"usage": 37, "weekly_usage": 37, "reset_at_unix": RESET, "weekly_reset_at_unix": RESET})
    assert not bridge._single_weekly({"usage": 37, "weekly_usage": 37, "reset_at_unix": RESET - 3600, "weekly_reset_at_unix": RESET})
    assert not bridge._single_weekly({"usage": 12, "weekly_usage": 37, "reset_at_unix": RESET - 3600, "weekly_reset_at_unix": RESET})
    assert not bridge._single_weekly(None)


def test_case4b_one_tick_does_not_say_above_and_below_at_once(monkeypatch, tmp_path):
    bridge = _load_bridge("sentinel_bridge_under_test", "sentinel-bridge.py", monkeypatch, tmp_path)
    now_ts = _t("2026-10-31T21:45")
    entry = {"provider": "openai", "usage": 34, "weekly_usage": 34, "weekly_remaining_pct": 66.0,
             "reset_at_unix": RESET, "weekly_reset_at_unix": RESET, "status": "SOTTOUTILIZZO"}
    weekly = {"kind": "SOTTO-PACE", "vel_weekly_pct_h": 0.1, "sustainable_pct_h": 1.7, "ratio": 0.07, "debt_pct": -10.0,
              "early_lockout_h": None, "burn_mode": False, "burst_transient": False, "binding": False,
              "projected_final_pct": 38, "wasted_pct": 62.0, "reset_in_active_h": 39.0}
    text = bridge._build_tick_message(entry, {"usage_is_weekly": True}, "SOTTOUTILIZZO", 66.34, 34, "2026-11-04 06:35 UTC",
                                      42, "ON", weekly, False, "21:45:00", now_ts)
    assert "BELOW-PACE" in text and "above" not in text, text


@pytest.mark.parametrize("value", ["abc", "", "nan", "inf"])
def test_a_non_numeric_window_in_the_environment_does_not_stop_the_bridge(value, monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_PACING_RATE_WINDOW_MIN", value)
    monkeypatch.setenv("JHT_PACING_MIN_EFFECTIVE_MIN", value)
    bridge = _load_bridge("pacing_bridge_env_test", "pacing-bridge.py", monkeypatch, tmp_path)
    assert bridge.RATE_WINDOW_MIN == 60.0 and bridge.MIN_EFFECTIVE_MIN == 55.0
