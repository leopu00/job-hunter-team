"""La pausa dello Scorer dipende dalla sua coda, non e' sempre quella del Capitano.

Misura sul campo: il lavoro vero e' ~51 s per posizione e la pausa dopo ogni posizione 300-780 s, fra il 67 % e il
94 % del ciclo, anche con posizioni in coda da valutare. La regola (per lo Scorer e per l'Analista):

  coda piena            pausa corta, al massimo 60 s
  coda vuota            pausa piena (il Capitano: il freno contro i giri a vuoto)
  «Lavora a tutta»      nessuna pausa
  budget critico        la pausa del Capitano com'e' oggi (dopo un congelamento, squadra sopra il suo ritmo)

I test parlano solo con `register()` e con il database, quindi valgono per qualunque forma abbia la regola dentro il
motore. Le fixture e gli aiuti sono quelli di test_throttle_engine.py.
"""
import sqlite3

import pytest

from test_throttle_engine import (  # noqa: F401  (le fixture si importano per nome)
    SKILLS_DIR, T0, _freeze_marker, _jobs_db, _load, _pacing_report, burn, eng, events, home, set_config,
)

SHORT_MAX = 60
FULL = 660  # un gradino della ladder: il Capitano lo ha messo e il floor lo lascia stare


def _queue(db, *, waiting: int, scored: int = 0):
    """`waiting` posizioni controllate senza punteggio (la coda dello Scorer) e `scored` controllate con punteggio."""
    conn = sqlite3.connect(db)
    conn.execute("DELETE FROM positions")
    ids = []
    for i in range(waiting + scored):
        ids.append(conn.execute("INSERT INTO positions (title, company, status) VALUES (?, 'Acme', 'checked')",
                                ("Engineer %d" % i,)).lastrowid)
    for pid in ids[waiting:]:
        conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?, 70)", (pid,))
    conn.commit()
    conn.close()


def _scorer(home, monkeypatch, *, waiting, scored=0, agent="scorer-1"):
    set_config(home, **{agent: FULL})
    db = _jobs_db(home, monkeypatch)
    _queue(db, waiting=waiting, scored=scored)
    return db


def _all_out(burn, monkeypatch):
    """«A tutta»: la deroga a termine dell'utente, con il tetto alla pausa che mette il burst."""
    burn.grant(hours=2, reason="burst until 23:00", pace_cap_sec=60)
    eng._MODULE_CACHE.clear()
    tc = _load("throttle_config_scorer_all_out", SKILLS_DIR / "throttle-config.py")
    tc._BURN_INTENT_MOD = burn
    monkeypatch.setattr(eng, "_throttle_config", lambda: tc)


def test_a_scorer_with_a_queue_pauses_short(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=3)
    res = eng.register("scorer-1", reason="post-score", now=T0)
    assert res["applied_sec"] <= SHORT_MAX, "la pausa del Capitano (660 s) e' il freno dei giri a vuoto: qui ci sono tre posizioni"
    assert events("armed")[-1]["applied_sec"] <= SHORT_MAX


def test_the_short_pause_is_a_cap_not_a_floor(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=1)
    monkeypatch.setattr(eng, "effective_seconds", lambda agent, requested=None: 30)
    assert eng.register("scorer-1", now=T0)["applied_sec"] <= 30


def test_a_scorer_with_an_empty_queue_keeps_the_full_pause(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=0)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == FULL


def test_positions_that_already_have_a_score_are_not_a_queue(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=0, scored=4)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == FULL


def test_a_queue_that_cannot_be_counted_keeps_the_brake(home, monkeypatch):
    set_config(home, **{"scorer-1": FULL})
    bad = home / "jobs.db"
    bad.write_text("not a database", encoding="utf-8")
    monkeypatch.setenv("JHT_DB", str(bad))
    import sys
    monkeypatch.delitem(sys.modules, "_db", raising=False)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == FULL


def test_the_queue_of_the_scorer_does_not_shorten_the_pause_of_the_scout(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=5)
    set_config(home, **{"scout-2": FULL})
    assert eng.register("scout-2", now=T0)["applied_sec"] == FULL


def test_all_out_with_a_queue_means_no_pause_at_all(home, burn, monkeypatch):
    _scorer(home, monkeypatch, waiting=3)
    _all_out(burn, monkeypatch)
    res = eng.register("scorer-1", reason="post-score", now=T0)
    assert res["applied_sec"] == 0 and res["armed"] is False and res["until"] is None
    assert eng.get_flag("scorer-1")["state"] == eng.ACTIVE


def test_after_a_freeze_the_captains_pause_stays_even_with_a_queue(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=3)
    _freeze_marker().mark("freeze", now=T0 - 60)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == FULL


def test_a_team_over_its_pace_keeps_the_captains_pause_even_with_a_queue(home, monkeypatch):
    _scorer(home, monkeypatch, waiting=3)
    _pacing_report(home, team=3.5, target=1.4)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == FULL


def test_all_out_lifts_the_budget_hold(home, burn, monkeypatch):
    # «A tutta» e' una decisione dell'utente sulla spesa: toglie il freno come toglie floor e ladder.
    _scorer(home, monkeypatch, waiting=3)
    _freeze_marker().mark("freeze", now=T0 - 60)
    _pacing_report(home, team=3.5, target=1.4)
    _all_out(burn, monkeypatch)
    assert eng.register("scorer-1", now=T0)["applied_sec"] == 0
