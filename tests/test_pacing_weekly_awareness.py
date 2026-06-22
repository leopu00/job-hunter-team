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

from shared.skills.compute_metrics import compute_metrics
from shared.skills.weekly_pace import is_weekly_binding


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
