"""Regressione fix#4 — correzione design 2026-06-13 (feedback utente).

Lo status del pacing NON deve dipendere da un LIVELLO weekly ASSOLUTO. Il weekly
resta solo awareness (weekly_remaining_pct / proj_weekly esposti come INFO); il
freno weekly time-aware vive nel pacing-bridge (vel_team vs vel_target,
active-hours-aware), non in compute_metrics.

Prima della correzione: `weekly_usage >= 75` (o proj_weekly>100 calendar-based)
forzava status=ATTENZIONE anche con primary 5h SOTTOUTILIZZO → un HALT anticipato
che incagliava il budget invece di saturare ~100% AL reset weekly
(DIAGNOSI-pacing-weekly L20: "weekly=100% all'ultimo minuto, non bruciarlo prima
ne sprecarlo"; migration-plan L84: "atterraggio ~100% al reset, NESSUN HALT
anticipato").

Guard: a QUALUNQUE livello weekly, lo status dipende SOLO dal primary 5h.
"""
from datetime import datetime, timezone, timedelta

import json
import os
import tempfile

from shared.skills.compute_metrics import compute_metrics
from shared.skills.weekly_pace import is_weekly_binding, weekly_pace_assessment


def _parsed(usage, weekly_usage):
    """Sample con primary 5h a `usage` e weekly a `weekly_usage`."""
    now = datetime.now(timezone.utc)
    return {
        "provider": "codex",
        "usage": usage,
        # reset 5h ~3h avanti → hours_to_reset > 0, projection calcolata
        "reset_at": (now + timedelta(hours=3)).strftime("%H:%M"),
        "weekly_usage": weekly_usage,
        "weekly_reset_at_unix": (now + timedelta(days=4)).timestamp(),
    }


def test_weekly_alto_non_forza_attenzione():
    # primary 5h basso (cold-start last=None → vel=0 → projection=usage=5 < 90)
    # = SOTTOUTILIZZO. Con il vecchio codice weekly=92>=75 forzava ATTENZIONE.
    res = compute_metrics(_parsed(usage=5, weekly_usage=92), last=None, history=[])
    assert res["status"] == "SOTTOUTILIZZO", f"status forzato dal weekly: {res['status']}"
    assert res["weekly_binding"] is False
    # awareness resta esposta
    assert res["weekly_remaining_pct"] == 8.0


def test_status_indipendente_dal_livello_weekly():
    # Stesso primary, weekly basso vs altissimo → STESSO status.
    low = compute_metrics(_parsed(usage=5, weekly_usage=10), last=None, history=[])
    high = compute_metrics(_parsed(usage=5, weekly_usage=99), last=None, history=[])
    assert low["status"] == high["status"] == "SOTTOUTILIZZO"
    assert low["weekly_binding"] is False
    assert high["weekly_binding"] is False


def test_weekly_binding_sempre_false_su_qualunque_soglia():
    for wk in (0, 50, 74, 75, 76, 92, 100):
        res = compute_metrics(_parsed(usage=5, weekly_usage=wk), last=None, history=[])
        assert res["weekly_binding"] is False, f"weekly_binding True a weekly={wk}"


def test_campi_weekly_awareness_presenti():
    res = compute_metrics(_parsed(usage=5, weekly_usage=40), last=None, history=[])
    for k in ("weekly_remaining_pct", "proj_weekly", "weekly_binding", "proj_binding"):
        assert k in res, f"campo awareness mancante: {k}"
    assert res["weekly_remaining_pct"] == 60.0


# ── is_weekly_binding: il binding VERO è active-hours-aware, NON il livello ──
# assoluto né il proj_weekly naive. Vive a valle (sentinel-bridge legge il pace),
# coerente con fix#4: niente halt su soglia, freno solo quando il pace proietta
# lockout PRIMA del reset. Chiude "Sentinella cieca al weekly" (front-load Kimi)
# senza coast prematuro su un team in pari.

def test_binding_su_frontload_conclamato():
    # SOPRA-PACE + lockout anticipato + non burst → binding (il caso Kimi).
    assert is_weekly_binding(
        {"kind": "SOPRA-PACE", "early_lockout_h": 40.0, "burst_transient": False}
    ) is True


def test_no_binding_team_in_pari_o_recuperabile():
    # Allineato/sotto-pace, o sopra-pace senza lockout anticipato (recuperabile),
    # o burst in esaurimento → MAI binding (no coast prematuro su Codex sano).
    assert is_weekly_binding(
        {"kind": "ALLINEATO", "early_lockout_h": None, "burst_transient": False}) is False
    assert is_weekly_binding(
        {"kind": "SOTTO-PACE", "early_lockout_h": None, "burst_transient": False}) is False
    assert is_weekly_binding(
        {"kind": "SOPRA-PACE", "early_lockout_h": None, "burst_transient": False}) is False
    assert is_weekly_binding(
        {"kind": "SOPRA-PACE", "early_lockout_h": 10.0, "burst_transient": True}) is False


def test_binding_degrada_in_sicurezza():
    # Dato assente/malformato → False (= comportamento attuale, zero rischio).
    assert is_weekly_binding(None) is False
    assert is_weekly_binding({}) is False


# ── Debito cumulativo (2026-06-28): il binding scatta anche quando il RATE
# istantaneo dice ALLINEATO ma il SALDO è in debito (front-load del boot). In
# debito la tolleranza scende da 1.2x a 1.0x; il debito è immune al rumore di
# quantizzazione perché cumulativo, non a finestra.

def test_binding_su_debito_anche_se_rate_allineato():
    # Caso live: kind ALLINEATO (rate a finestra ingannevole) ma debito 17pp e
    # ratio reale (de-noised) > 1.0 → binding (non stai recuperando il debito).
    assert is_weekly_binding(
        {"kind": "ALLINEATO", "ratio": 1.7, "debt_pct": 17.0,
         "early_lockout_h": None, "burst_transient": False}) is True


def test_no_binding_in_debito_ma_in_recupero():
    # In debito MA ratio<=1.0 (sotto il sostenibile ridotto) = stai recuperando
    # → NON binding (altrimenti freneresti chi si sta già correggendo).
    assert is_weekly_binding(
        {"kind": "SOTTO-PACE", "ratio": 0.7, "debt_pct": 17.0,
         "burst_transient": False}) is False


def test_no_binding_debito_sotto_soglia():
    # Debito piccolo (< DEBT_BIND_PCT=8) e ratio appena sopra 1 = variazione
    # naturale, niente front-load → NON binding.
    assert is_weekly_binding(
        {"kind": "ALLINEATO", "ratio": 1.05, "debt_pct": 2.0,
         "burst_transient": False}) is False


def test_debito_mai_binding_su_burst():
    # Anche con debito alto, un picco in esaurimento (burst_transient) NON binda:
    # frenare un burst finito = over-brake (vale per entrambi i rami).
    assert is_weekly_binding(
        {"kind": "SOPRA-PACE", "ratio": 2.0, "debt_pct": 17.0,
         "early_lockout_h": 20.0, "burst_transient": True}) is False


# ── Finestra ADATTIVA + debito end-to-end (file reale): il caso che il rate a
# finestra fissa 2h leggeva come "ALLINEATO 1.07x" e che ora viene smascherato.

def _write_jsonl(samples):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    for s in samples:
        f.write(json.dumps(s) + "\n")
    f.close()
    return f.name


def _series(now_ts, rate_pct_h, hours, end_pct):
    """Storia weekly INTERA (quantizzata a 1%) a `rate_pct_h`, terminante a end_pct."""
    out = []
    t = now_ts - hours * 3600.0
    while t <= now_ts:
        h_ago = (now_ts - t) / 3600.0
        out.append({"ts": _iso(t), "weekly_usage": max(0, round(end_pct - rate_pct_h * h_ago))})
        t += 300.0
    return out


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def test_finestra_adattiva_smaschera_overpace_lento():
    # Over-pace lento 0.75%/h: su finestra fissa 2h il delta intero è ~1 punto →
    # 0.5%/h → "ALLINEATO" (il bug). La finestra adattiva allarga finché il delta
    # è affidabile → vel ~0.88%/h, ratio>1.2 = SOPRA-PACE.
    now = 1_800_000_000.0
    fn = _series(now, 0.75, 8.0, 28)
    path = _write_jsonl(fn)
    try:
        r = weekly_pace_assessment(path, now, 72.0, 150.0, weekly_total_active_hours=168.0)
    finally:
        os.unlink(path)
    assert r is not None
    assert r["rate_window_h"] > 2.0, "la finestra non si è adattata"
    assert r["kind"] == "SOPRA-PACE", f"rate non smascherato: {r['kind']} ratio={r['ratio']}"
    # debito ~17pp (28% speso vs ~10.7% ideale dopo 18h attive)
    assert r["debt_pct"] > 10.0
    assert r["binding"] is True


def test_debito_none_se_manca_total_active_hours():
    # Caller legacy (senza weekly_total_active_hours) → debito None, binding ricade
    # SOLO sul rate classico (zero rischio di regressione).
    now = 1_800_000_000.0
    path = _write_jsonl(_series(now, 0.75, 8.0, 28))
    try:
        r = weekly_pace_assessment(path, now, 72.0, 150.0)
    finally:
        os.unlink(path)
    assert r is not None
    assert r["debt_pct"] is None
    assert r["ideal_used_pct"] is None
