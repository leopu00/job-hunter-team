"""Un solo riferimento per il budget settimanale: la Sentinella (WEEKLY-PACE) e il PACE-GUARD misurano sulla STESSA retta.

Il caso reale del 02/11, durante un burn, nello stesso minuto:
  - WEEKLY-PACE: «SLOW DOWN: 54 % remains across 21 active hours, vel_weekly 7.20 %/h vs sustainable 2.53 %/h»;
  - PACE-GUARD:  «BEHIND: usage 47 % vs curve 75 % (-28 pt), RECOMMENDED 300 s».
Il primo contava le ORE ATTIVE (il team lavora 13-00), il secondo il calendario della finestra (notti comprese): su una
finestra settimanale con orario di lavoro il calendario e' il righello sbagliato. Ora il righello e' uno (pace_reference.py).

Sotto la deroga di spesa dell'utente («Lavora a tutta») essere avanti sulla retta, il debito e il rapporto col sostenibile sono
INFORMAZIONE; frena solo il LOCKOUT-RISK (il limite BASSO del ritmo esaurisce il residuo piu' di 2 ore attive prima del reset).
Senza deroga resta tutto com'era.
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
import pace_guard  # noqa: E402
import pace_reference as pref  # noqa: E402
import weekly_pace  # noqa: E402

UTC = timezone.utc
RESET = datetime(2026, 11, 5, 6, 35, 52, tzinfo=UTC).timestamp()
START = RESET - 7 * 86400
NOW = datetime(2026, 11, 2, 19, 0, 0, tzinfo=UTC).timestamp()      # ~62 h calendario al reset


def _assessment(**over):
    base = {"kind": "ALLINEATO", "ideal_used_pct": 40.0, "sustainable_pct_h": 2.53, "binding": False,
            "lockout_risk": False, "lockout_early_active_h": None, "burst_transient": False}
    base.update(over)
    return base


# ── il rischio di lockout ────────────────────────────────────────────────────────────────────────────────

def test_lockout_risk_is_the_low_end_of_the_rate_against_the_runway():
    # 54 % rimane, 21 ore attive al reset, 7.2 %/h: finisce dopo 7.5 h, 13.5 ore attive prima del reset
    assert pref.lockout_risk(54.0, 21.0, 7.2) == (True, 13.5)
    # al ritmo sostenibile (2.53 %/h) arriva al reset: nessun rischio
    assert pref.lockout_risk(54.0, 21.0, 2.53)[0] is False
    # la soglia e' il margine: 1.9 ore attive prima non frena, 2.4 si'
    assert pref.lockout_risk(54.0, 21.0, 54.0 / 19.1)[0] is False
    assert pref.lockout_risk(54.0, 21.0, 54.0 / 18.6)[0] is True


def test_lockout_risk_never_decides_on_missing_or_odd_data():
    assert pref.lockout_risk(None, 21.0, 3.0) == (False, None)
    assert pref.lockout_risk(54.0, 0.0, 3.0) == (False, None)         # reset arrivato
    assert pref.lockout_risk(54.0, 21.0, 0.0) == (False, None)        # fermo: non finisce
    assert pref.lockout_risk(54.0, 21.0, True) == (False, None)       # bool non e' un numero
    assert pref.lockout_risk(0.0, 21.0, 3.0)[0] is True               # residuo finito prima del reset


# ── il verdetto, senza deroga: com'era ──────────────────────────────────────────────────────────────────

def test_without_burn_binding_brakes_as_before():
    v = pref.verdict(_assessment(binding=True, kind="SOPRA-PACE"), usage_pct=47.0)
    assert v["verdict"] == "AVANTI" and v["brake"] is True and v["steps"] >= 1


def test_without_burn_ahead_of_the_active_hours_line_brakes_and_behind_speeds_up():
    ahead = pref.verdict(_assessment(ideal_used_pct=30.0), usage_pct=47.0)       # +17 punti sulla retta
    assert ahead["verdict"] == "AVANTI" and ahead["brake"] and ahead["steps"] == 2
    behind = pref.verdict(_assessment(ideal_used_pct=60.0), usage_pct=47.0)      # -13 punti
    assert behind["verdict"] == "INDIETRO" and behind["steps"] == -2 and not behind["brake"]
    onpace = pref.verdict(_assessment(ideal_used_pct=45.0), usage_pct=47.0)
    assert onpace["verdict"] == "IN-PARI" and onpace["steps"] == 0


def test_no_data_is_no_verdict_and_no_brake():
    for a in (None, {}, {"kind": "ND"}, {"kind": None}):
        v = pref.verdict(a, usage_pct=47.0, burn_intent_on=False)
        assert v["verdict"] == "ND" and v["brake"] is False and v["steps"] == 0


def test_a_spike_that_is_leaving_does_not_brake():
    v = pref.verdict(_assessment(binding=True, burst_transient=True, ideal_used_pct=10.0), usage_pct=47.0)
    assert v["verdict"] == "IN-PARI" and v["brake"] is False


# ── sotto deroga: frena solo il lockout ─────────────────────────────────────────────────────────────────

def test_under_burn_being_ahead_debt_and_ratio_brake_nothing():
    a = _assessment(kind="SOPRA-PACE", ideal_used_pct=30.0, binding=False, lockout_risk=False, debt_pct=17.0, ratio=2.8)
    v = pref.verdict(a, burn_intent_on=True, usage_pct=47.0)
    assert v["brake"] is False and v["steps"] == 0
    assert v["verdict"] == "IN-PARI" and v["reason"] == "burn_ahead_is_information"
    assert v["burn_intent"] is True


def test_under_burn_the_lockout_risk_is_the_brake_and_it_scales_with_the_distance():
    near = pref.verdict(_assessment(lockout_risk=True, lockout_early_active_h=2.5), burn_intent_on=True, usage_pct=47.0)
    far = pref.verdict(_assessment(lockout_risk=True, lockout_early_active_h=13.5), burn_intent_on=True, usage_pct=47.0)
    assert near["verdict"] == far["verdict"] == "LOCKOUT-RISK"
    assert near["brake"] and far["brake"]
    assert 1 <= near["steps"] < far["steps"] <= pref.MAX_STEPS


def test_under_burn_a_spike_that_is_leaving_is_not_a_lockout_risk():
    v = pref.verdict(_assessment(lockout_risk=True, lockout_early_active_h=9.0, burst_transient=True),
                     burn_intent_on=True, usage_pct=47.0)
    assert v["brake"] is False and v["verdict"] == "IN-PARI"


def test_under_burn_behind_the_line_is_still_room_to_go_faster():
    v = pref.verdict(_assessment(ideal_used_pct=70.0), burn_intent_on=True, usage_pct=47.0)
    assert v["verdict"] == "INDIETRO" and v["steps"] < 0 and not v["brake"]


# ── weekly_pace_assessment: lo stesso rate, due letture ─────────────────────────────────────────────────

def _series(now_ts, rate_pct_h, hours, end_pct):
    out, t = [], now_ts - hours * 3600.0
    while t <= now_ts:
        h_ago = (now_ts - t) / 3600.0
        out.append({"ts": datetime.fromtimestamp(t, UTC).isoformat().replace("+00:00", "Z"),
                    "weekly_usage": max(0, round(end_pct - rate_pct_h * h_ago))})
        t += 300.0
    return out


def _assess(tmp_path, rate, hours, end_pct, remaining, active_h, total_h=168.0, **kw):
    p = tmp_path / "s.jsonl"
    p.write_text("".join(json.dumps(r) + "\n" for r in _series(NOW, rate, hours, end_pct)), encoding="utf-8")
    return weekly_pace.weekly_pace_assessment(str(p), NOW, remaining, active_h, weekly_total_active_hours=total_h, **kw)


def test_front_loaded_debt_binds_without_burn_and_is_only_information_under_burn(tmp_path):
    # 46 % speso, 54 % rimane su 21 ore attive di un ciclo di 30 (ideale ~30 %): debito ~16 punti, ma il ritmo (2.7 %/h)
    # arriva al reset con meno di 2 ore di margine: nessun muro
    off = _assess(tmp_path, 2.7, 8.0, 46, 54.0, 21.0, total_h=30.0)
    on = _assess(tmp_path, 2.7, 8.0, 46, 54.0, 21.0, total_h=30.0, burn_intent_on=True)
    assert off["debt_pct"] > weekly_pace.DEBT_BIND_PCT
    assert off["binding"] is True                       # come prima: il debito frena
    assert on["lockout_risk"] is False and on["binding"] is False   # sotto deroga e' informazione
    assert on["debt_pct"] == off["debt_pct"] and on["kind"] == off["kind"] and on["ratio"] == off["ratio"]
    assert on["burn_intent"] is True and off["burn_intent"] is False


def test_fast_burn_toward_the_wall_binds_in_both(tmp_path):
    # il caso del 02/11: ~7 %/h con 54 % residuo e 21 ore attive al reset
    off = _assess(tmp_path, 7.0, 6.0, 46, 54.0, 21.0)
    on = _assess(tmp_path, 7.0, 6.0, 46, 54.0, 21.0, burn_intent_on=True)
    assert off["lockout_risk"] is True and on["lockout_risk"] is True
    assert off["binding"] is True and on["binding"] is True
    assert on["lockout_early_active_h"] > pref.LOCKOUT_MARGIN_ACTIVE_H


# ── la Sentinella e il PACE-GUARD danno LO STESSO verdetto ──────────────────────────────────────────────

def _weekly_sample(usage):
    sid = datetime.fromtimestamp(START, UTC).strftime("%Y%m%dT%H%M%SZ")
    return {"provider": "codex", "session_id": sid, "usage": usage, "usage_is_weekly": True,
            "reset_at_unix": RESET, "weekly_usage": usage, "weekly_remaining_pct": 100.0 - usage}


def test_the_02_11_contradiction_is_gone_both_read_the_active_hours_line(tmp_path):
    usage = 47.0
    # il calendario dice «indietro di 28 punti»: curva 75 % a ~62 h dal reset su 168 (nessuna deroga, nessun riferimento)
    old = pace_guard.evaluate(_weekly_sample(usage), NOW, target_pct=100.0, current_throttle_s=pace_guard.WORKER_FLOOR)
    assert old["verdict"] == "INDIETRO"
    # le ore attive dicono «avanti»: ~30 % della retta trascorso
    ref = _assessment(ideal_used_pct=30.0, kind="SOPRA-PACE", binding=True)
    new = pace_guard.evaluate(_weekly_sample(usage), NOW, target_pct=100.0,
                              current_throttle_s=pace_guard.WORKER_FLOOR, reference=ref)
    shared = pref.verdict(ref, usage_pct=usage)
    assert new["verdict"] == shared["verdict"] == "AVANTI"
    assert new["steps"] == shared["steps"] and new["steps"] > 0
    assert new["ideal_pct"] == shared["ideal_pct"] == 30.0 and new["basis"] == "active_hours"
    assert new["throttle_recommended_s"] > pace_guard.WORKER_FLOOR           # frena, non accelera


def test_under_burn_the_guard_does_not_brake_on_the_line_only_on_the_lockout_risk():
    usage = 47.0
    ahead = _assessment(ideal_used_pct=30.0, kind="SOPRA-PACE", binding=False, lockout_risk=False)
    g = pace_guard.evaluate(_weekly_sample(usage), NOW, target_pct=100.0, current_throttle_s=900,
                            reference=ahead, burn_intent_on=True)
    assert g["verdict"] == "IN-PARI" and g["steps"] == 0 and g["recommends_change"] is False
    risk = _assessment(ideal_used_pct=30.0, kind="SOPRA-PACE", binding=True, lockout_risk=True, lockout_early_active_h=9.0)
    g = pace_guard.evaluate(_weekly_sample(usage), NOW, target_pct=100.0, current_throttle_s=900,
                            reference=risk, burn_intent_on=True)
    assert g["verdict"] == "LOCKOUT-RISK" and g["steps"] > 0 and g["recommends_change"] is True


def test_the_wall_stays_the_same_under_burn_or_not():
    # >= DANGER_PCT e in anticipo sulla retta: LOCKOUT-IMMINENTE, deroga o no
    ref = _assessment(ideal_used_pct=40.0)
    for burn in (False, True):
        r = pace_guard.evaluate(_weekly_sample(pace_guard.DANGER_PCT + 1), NOW, target_pct=100.0,
                                current_throttle_s=pace_guard.WORKER_FLOOR, reference=ref, burn_intent_on=burn)
        assert r["verdict"] == "LOCKOUT-IMMINENTE"


def test_a_five_hour_window_is_unchanged_by_a_reference():
    # finestra di 5 ore (Kimi): il calcolo e' quello di sempre, il riferimento non c'entra
    reset = NOW + 2 * 3600
    sid = datetime.fromtimestamp(reset - 5 * 3600, UTC).strftime("%Y%m%dT%H%M%SZ")
    s = {"provider": "kimi", "session_id": sid, "usage": 75, "reset_at_unix": reset}
    plain = pace_guard.evaluate(s, NOW, target_pct=100.0, current_throttle_s=pace_guard.WORKER_FLOOR)
    ref = _assessment(ideal_used_pct=99.0)
    with_ref = pace_guard.evaluate(s, NOW, target_pct=100.0, current_throttle_s=pace_guard.WORKER_FLOOR,
                                   reference=ref, burn_intent_on=True)
    assert with_ref == plain


def test_no_reference_means_the_old_calendar_curve():
    r = pace_guard.evaluate(_weekly_sample(47.0), NOW, target_pct=100.0, current_throttle_s=pace_guard.WORKER_FLOOR,
                            reference=None, burn_intent_on=True)
    assert r["verdict"] == "INDIETRO" and "basis" not in r


# ── la riga del tick della Sentinella (bridge) ──────────────────────────────────────────────────────────

def _bridge():
    spec = importlib.util.spec_from_file_location("sentinel_bridge_pace_ref", str(REPO / ".launcher" / "sentinel-bridge.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _wp(**over):
    base = {"kind": "SOPRA-PACE", "sustainable_pct_h": 2.53, "vel_weekly_pct_h": 7.2, "binding": True, "burst_transient": False,
            "burn_mode": False, "early_lockout_h": 13.0, "reset_in_active_h": 21.0, "lockout_risk": True,
            "lockout_early_active_h": 13.5, "burn_intent": False}
    base.update(over)
    return base


def test_the_tick_line_without_burn_is_the_slow_down_as_before():
    line = _bridge()._pace_verdict_line(_wp(), 54.0)
    assert "WEEKLY-PACE→SLOW-DOWN" in line and "54% remains across 21 active hours" in line


def test_the_tick_line_under_burn_is_information_unless_the_lockout_is_near():
    b = _bridge()
    info = b._pace_verdict_line(_wp(binding=False, lockout_risk=False, burn_intent=True, early_lockout_h=None), 54.0)
    assert "BURN-INFO" in info and "NOT a brake" in info and "SLOW-DOWN" not in info
    risk = b._pace_verdict_line(_wp(burn_intent=True), 54.0)
    assert "LOCKOUT-RISK" in risk and "14 active hours" in risk or "13 active hours" in risk
    assert "SLOW-DOWN" not in risk


def test_the_tick_line_under_burn_keeps_maintain_and_accelerate():
    b = _bridge()
    m = b._pace_verdict_line(_wp(kind="ALLINEATO", binding=False, lockout_risk=False, burn_intent=True), 54.0)
    assert m.startswith(" WEEKLY-PACE→MAINTAIN") and "only a lockout risk brakes" in m
    acc = b._pace_verdict_line(_wp(kind="SOTTO-PACE", binding=False, lockout_risk=False, burn_intent=True, burn_mode=True), 54.0)
    assert "ACCELERATE-SATURATE" in acc
