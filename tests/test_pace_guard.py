"""Test del consigliere di pacing sulla finestra rate-limit.

Root cause coperta: run ThinkPad 2026-07-26 (Kimi Allegretto). Finestra
aperta alle 14:35 con reset alle 19:43; alle 17:00 il consumo era già al
**100%** e il team è rimasto muto per 2h40.

Il vincolo verificato qui è doppio:
  • la misura — a metà finestra il consumo ideale è metà del target, e uno
    scarto in eccesso deve produrre un freno PRIMA del lockout, senza mai
    arrivare al freeze (che lascia l'utente senza risposte);
  • la separazione dei poteri (2026-07-28) — il pace guard CONSIGLIA e basta.
    Nessun percorso automatico scrive il throttle: lo fa il Capitano, che
    riceve il consiglio nel pane. Le reti di sicurezza (worker floor, daily
    hard-stop) restano invece automatiche e non sono toccate da questa scelta.

Eseguire:
    pytest tests/test_pace_guard.py -v
"""

import importlib.util
import os
import sys
from datetime import datetime, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import pace_guard  # noqa: E402


def _load_by_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_bridge():
    return _load_by_path('sentinel_bridge_pace',
                         os.path.join(REPO_ROOT, '.launcher', 'sentinel-bridge.py'))


def _load_throttle_config():
    """throttle-config.py ha un trattino nel nome: non è importabile, va per path."""
    return _load_by_path('throttle_config_pace',
                         os.path.join(SKILLS_DIR, 'throttle-config.py'))


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
    assert r["throttle_recommended_s"] > pace_guard.WORKER_FLOOR


def test_on_curve_recommends_leaving_the_throttle_alone():
    """Metà finestra, metà budget: il consiglio è 'non toccare niente'."""
    now = _ts("2026-07-26T17:09:04")   # metà esatta fra start e reset
    r = pace_guard.evaluate(_sample(50), now, target_pct=100.0,
                            current_throttle_s=660)
    assert r["verdict"] == "IN-PARI"
    assert r["recommends_change"] is False
    assert r["throttle_recommended_s"] == 660


def test_under_curve_releases_the_brake():
    """Sotto la curva il budget resterebbe sul tavolo: si allenta."""
    now = _ts("2026-07-26T17:09:04")
    r = pace_guard.evaluate(_sample(20), now, target_pct=100.0,
                            current_throttle_s=1860)
    assert r["verdict"] == "INDIETRO"
    assert r["throttle_recommended_s"] < 1860


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
    assert r["throttle_recommended_s"] == pace_guard.WORKER_CEILING


# ── I limiti del freno ──────────────────────────────────────────────────

def test_brake_never_becomes_a_freeze():
    """Il freno satura a 1h: un team lento si recupera, uno lockato no."""
    r = pace_guard.evaluate(_sample(99), _ts("2026-07-26T15:00:00"),
                            target_pct=100.0, current_throttle_s=3600)
    assert r["throttle_recommended_s"] == pace_guard.WORKER_CEILING


def test_brake_never_goes_below_the_worker_floor():
    """Anche molto indietro, un worker non scende sotto i 5 minuti."""
    r = pace_guard.evaluate(_sample(1), _ts("2026-07-26T19:00:00"),
                            target_pct=100.0, current_throttle_s=300)
    assert r["throttle_recommended_s"] == pace_guard.WORKER_FLOOR


def test_the_ladder_is_the_same_in_both_modules():
    """pace_guard e throttle-config devono scegliere gli STESSI gradini.

    Quando le due scale divergono, questo modulo consiglia un valore che
    throttle-config sposta subito altrove: il Capitano applicherebbe 900s e
    ne leggerebbe 780. È già successo con WORKER_FLOOR.
    """
    tc = _load_throttle_config()
    # LADDER include lo 0 (throttle spento, riservato al core interattivo),
    # THROTTLE_LADDER parte dal primo gradino reale.
    assert pace_guard.LADDER[0] == 0
    assert pace_guard.LADDER[1:] == tc.THROTTLE_LADDER
    assert pace_guard.WORKER_FLOOR == tc.WORKER_FLOOR


def test_step_throttle_moves_one_rung_at_a_time():
    """Gradini in minuti primi: da 7min (420s) si sale a 11min (660s)."""
    assert pace_guard.step_throttle(600, 1) == 660
    assert pace_guard.step_throttle(600, -1) == 300
    assert pace_guard.step_throttle(300, -5) == pace_guard.WORKER_FLOOR
    assert pace_guard.step_throttle(3000, 9) == pace_guard.WORKER_CEILING


def test_off_ladder_value_snaps_down_not_up():
    """Un valore fuori scala non deve far saltare un gradino per arrotondamento."""
    # 700s sta fra 660 (11min) e 780 (13min): il gradino corrente è 660, quindi
    # +1 porta a 780. Arrotondando al più vicino si salterebbe a 1020.
    assert pace_guard.step_throttle(700, 1) == 780


# ── Chi decide: il guard consiglia, il Capitano applica ─────────────────

AHEAD = _sample(75)          # 75% consumato con curva ideale al 28%
AHEAD_NOW = _ts("2026-07-26T16:00:00")


class _StubGuard:
    """pace_guard finto: registra le chiamate ad apply_throttle invece di scrivere."""

    def __init__(self, result, workers=("scout-1", "analista-1")):
        self._result = result
        self._workers = list(workers)
        self.applied = []

    def active_workers(self):
        return list(self._workers)

    def current_worker_throttle(self, workers):
        return self._result["throttle_current_s"]

    def evaluate(self, entry, now, current_throttle_s=None):
        return dict(self._result)

    def advisable_workers(self, workers):
        return list(workers)

    def advice_line(self, result, workers=None, targets=None):
        return pace_guard.advice_line(result, workers, targets)

    def apply_throttle(self, workers, seconds):
        self.applied.append((list(workers), seconds))
        return {}


class _StubHours:
    """working_hours finto: risponde quello che gli si dice, senza config."""

    def __init__(self, inside):
        self._inside = inside

    def is_within_working_hours(self, *a, **k):
        return self._inside


def _run_bridge_step(monkeypatch, tmp_path, result, sent, within_hours=True,
                     burn_intent_on=False, config_inside=True, bridge=None):
    """Esegue un tick di _pace_guard_step con il guard finto. Ritorna lo stub.

    `config_inside` è la risposta di `working_hours.is_within_working_hours()`
    (la config dell'utente), distinta da `within_hours` che è il work_phase del
    pacing-bridge: le due sorgenti rispondono a domande diverse e il gate le
    consulta entrambe.
    """
    bridge = bridge or _load_bridge()
    guard = _StubGuard(result)
    hours = _StubHours(config_inside)

    def _load(name, filename):
        return hours if filename == "working_hours.py" else guard

    monkeypatch.setattr(bridge, "_load_skill_module", _load)
    monkeypatch.setattr(bridge, "jht_tmux_send",
                        lambda session, text: (sent.append((session, text)), True)[1])
    monkeypatch.setattr(bridge, "LOGS_DIR", tmp_path)
    bridge._pace_guard_step({"ts": "2026-07-26T16:00:00Z", "usage": 75},
                            within_hours=within_hours,
                            burn_intent_on=burn_intent_on)
    return guard


def test_the_bridge_advises_and_never_writes_the_throttle(tmp_path, monkeypatch):
    """Il cuore della decisione dell'utente: nessuno script muove il throttle.

    Il team è a 75% con la curva al 28% — il caso più netto possibile — e il
    bridge si limita a scrivere nel pane del Capitano.
    """
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    sent = []
    guard = _run_bridge_step(monkeypatch, tmp_path, r, sent)

    assert guard.applied == []                      # nessuna scrittura
    assert [s for s, _ in sent] == ["CAPITANO"]     # un consiglio, al Capitano
    logged = (tmp_path / "pace-guard.jsonl").read_text(encoding="utf-8")
    assert '"applied": false' in logged


def test_a_lost_advice_stays_in_the_mailbox(tmp_path, monkeypatch):
    """Se il pane è occupato il consiglio non si perde: si drena dalla mailbox.

    Prima il freno era già applicato e il messaggio era un'informativa; ora è
    l'unico output, quindi una consegna fallita significherebbe zero correzione.
    """
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    bridge = _load_bridge()
    monkeypatch.setattr(bridge, "_load_skill_module",
                        lambda *a, **k: _StubGuard(r))
    monkeypatch.setattr(bridge, "jht_tmux_send", lambda session, text: False)
    monkeypatch.setattr(bridge, "LOGS_DIR", tmp_path)
    bridge._pace_guard_step({"ts": "2026-07-26T16:00:00Z", "usage": 75})

    mailbox = (tmp_path / "bridge-mailbox.jsonl").read_text(encoding="utf-8")
    assert '"kind":"pace-guard"' in mailbox
    assert '"delivered_via_tmux":false' in mailbox
    assert pace_guard.ADVICE_TAG in mailbox


def test_advice_line_hands_the_decision_over():
    """La riga deve dire che NON è applicato e dare il comando pronto."""
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    line = pace_guard.advice_line(r, ["scout-1", "analista-1"],
                                  ["scout-1", "analista-1"])
    rec = r["throttle_recommended_s"]
    assert "\n" not in line                      # una riga sola: è un pane tmux
    assert line.startswith("[@bridge -> @capitano] [PACE-GUARD] AHEAD")
    assert "NOT APPLIED" in line
    assert f"RECOMMENDED {rec}s" in line
    assert f"throttle-config.py bulk-set scout-1={rec} analista-1={rec}" in line


def test_advice_leaves_out_workers_exempt_from_the_floor(monkeypatch):
    """Un agente esente sta girando senza pause per una misura a termine:
    il consiglio non lo include, come non lo includeva il vecchio apply."""
    monkeypatch.setattr(pace_guard, "_exempt_checker",
                        lambda: (lambda agent: agent == "scout-9"))
    assert pace_guard.advisable_workers(["scout-1", "scout-9"]) == ["scout-1"]


def test_lockout_advice_asks_for_the_roster_not_just_the_brake():
    r = pace_guard.evaluate(_sample(96), _ts("2026-07-26T15:30:00"),
                            target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    line = pace_guard.advice_line(r, ["scout-1"], ["scout-1"])
    assert "LOCKOUT-IMMINENT" in line
    assert "ROSTER" in line


# ── Quanto spesso si parla al Capitano ──────────────────────────────────

def test_no_advice_when_the_throttle_is_already_right():
    """In pari: niente da decidere, niente turno di modello consumato."""
    bridge = _load_bridge()
    r = pace_guard.evaluate(_sample(50), _ts("2026-07-26T17:09:04"),
                            target_pct=100.0, current_throttle_s=660)
    assert bridge._should_advise_captain(r, dict(ts=0.0, throttle_s=None,
                                                 verdict=None), 1000.0) is False


def test_a_new_advice_goes_out_immediately():
    bridge = _load_bridge()
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    state = {"ts": 999.0, "throttle_s": 660, "verdict": "AVANTI"}
    assert bridge._should_advise_captain(r, state, 1000.0) is True


def test_the_same_advice_is_repeated_only_after_the_cooldown():
    """Il Capitano che ignora il consiglio se lo rivede, ma non ogni 5 minuti."""
    bridge = _load_bridge()
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    state = {"ts": 1000.0, "throttle_s": r["throttle_recommended_s"],
             "verdict": r["verdict"]}
    cooldown = bridge.PACE_ADVICE_COOLDOWN_MIN * 60
    assert bridge._should_advise_captain(r, state, 1000.0 + cooldown - 1) is False
    assert bridge._should_advise_captain(r, state, 1000.0 + cooldown) is True


# ── Quando si parla: la finestra di lavoro ──────────────────────────────
#
# Notte 29-30/07: un tick ogni 15 minuti ha tenuto sveglio il Capitano fino al
# mattino a ~9%/h di weekly. Il guard aveva ragione sulla curva e torto sul
# destinatario: fuori finestra non c'è nessun team da rimettere in pari, e la
# sveglia costa più della manutenzione che stava cadenzando.

def test_outside_working_hours_the_captain_is_not_woken(tmp_path, monkeypatch):
    """Il caso della notte: si misura, si logga, non si parla."""
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    sent = []
    _run_bridge_step(monkeypatch, tmp_path, r, sent, within_hours=False)

    assert sent == []
    logged = (tmp_path / "pace-guard.jsonl").read_text(encoding="utf-8")
    # Il campione c'è (la misura non costa), e dice PERCHÉ è muto: un guard
    # silenzioso per l'orario non deve somigliare a un guard morto.
    assert '"verdict": "AVANTI"' in logged
    assert '"silenced": "outside-working-hours"' in logged
    assert '"advised": false' in logged
    assert not (tmp_path / "bridge-mailbox.jsonl").exists()


def test_the_config_window_silences_the_guard_on_its_own(tmp_path, monkeypatch):
    """work_phase assente = "24/7 per back-compat", ma la config dell'utente no.

    Se il pacing-bridge non scrive il target, il tick tratta l'orario come
    aperto: è la strada per cui il guard parlava di notte. Il gate rilegge la
    finestra dalla config e tace lo stesso.
    """
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    sent = []
    _run_bridge_step(monkeypatch, tmp_path, r, sent, within_hours=True,
                     config_inside=False)
    assert sent == []


def test_a_burn_intent_buys_the_night_back(tmp_path, monkeypatch):
    """La deroga di spesa è una decisione dell'utente: stanotte si lavora,
    quindi il consiglio di pacing serve e deve arrivare."""
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    sent = []
    _run_bridge_step(monkeypatch, tmp_path, r, sent, within_hours=False,
                     burn_intent_on=True)
    assert [s for s, _ in sent] == ["CAPITANO"]


def test_the_advice_is_not_swallowed_by_the_night(tmp_path, monkeypatch):
    """Alla riapertura il consiglio parte SUBITO, non dopo il cooldown.

    Tacere non deve consumare l'edge: se lo stato dell'ultimo consiglio
    venisse aggiornato mentre si tace, il primo tick del mattino sembrerebbe
    una ripetizione e aspetterebbe il cooldown con il team già in corsa.
    """
    bridge = _load_bridge()
    r = pace_guard.evaluate(AHEAD, AHEAD_NOW, target_pct=100.0,
                            current_throttle_s=pace_guard.WORKER_FLOOR)
    sent = []
    _run_bridge_step(monkeypatch, tmp_path, r, sent, within_hours=False,
                     bridge=bridge)
    assert sent == []
    _run_bridge_step(monkeypatch, tmp_path, r, sent, within_hours=True,
                     bridge=bridge)
    assert [s for s, _ in sent] == ["CAPITANO"]


def test_a_broken_working_hours_skill_does_not_gag_the_guard(monkeypatch):
    """Fail-open: senza la skill si parla. Un consiglio di troppo costa un
    turno, un guard muto per un import rotto costa la finestra."""
    bridge = _load_bridge()
    monkeypatch.setattr(bridge, "_load_skill_module", lambda *a, **k: None)
    assert bridge._pace_guard_within_hours(True, False) is True
    # …ma un work_phase=OFF esplicito resta un no: lì il tick ha già deciso
    # che nessuna LLM va svegliata.
    assert bridge._pace_guard_within_hours(False, False) is False


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
