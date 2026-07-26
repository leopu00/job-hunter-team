"""Test del registro abbonamenti e dello stato di primo avvio.

Root cause coperta: un utente nuovo (Kimi Allegretto, 39$) accende il team,
guarda dieci minuti e vede comparire UNA posizione grezza — la calibrazione
graduale (1 worker, misura 30 min, sali di un gradino) è corretta a regime
ma al primo avvio è indistinguibile da un guasto. Serviva un roster
dimensionato sull'abbonamento e una definizione di successo diversa:
posizioni CON PUNTEGGIO, non posizioni trovate (il run del 2026-07-26 ne
trovò 50 e ne punteggiò 3).

Eseguire:
    pytest tests/test_first_run_plan.py -v
"""

import importlib
import json
import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import plan_registry  # noqa: E402


@pytest.fixture()
def jht_home(tmp_path, monkeypatch):
    """Una $JHT_HOME isolata, con i moduli ricaricati per rileggerla."""
    monkeypatch.setenv('JHT_HOME', str(tmp_path))
    monkeypatch.delenv('JHT_DB', raising=False)
    importlib.reload(plan_registry)
    (tmp_path / 'jht.config.json').write_text(
        json.dumps({"active_provider": "kimi",
                    "providers": {"kimi": {"auth_method": "subscription"}}}),
        encoding='utf-8')
    return tmp_path


@pytest.fixture()
def first_run(jht_home):
    import first_run as mod
    importlib.reload(mod)
    return mod


# ── Il registro ─────────────────────────────────────────────────────────

def test_every_provider_has_plans():
    for provider in ("kimi", "claude", "openai"):
        assert plan_registry.list_plans(provider)[provider]

def test_provider_aliases_resolve():
    assert plan_registry.normalize_provider("codex") == "openai"
    assert plan_registry.normalize_provider("moonshot") == "kimi"
    assert plan_registry.normalize_provider("anthropic") == "claude"


def test_no_plan_is_weekly_unlimited():
    """Il 403 'billing cycle' preso sul campo: nessun piano è senza tetto."""
    for plans in plan_registry.PLANS.values():
        for plan in plans:
            assert plan["weekly_capped"] is True


def test_missing_plan_is_a_gate_not_a_default(jht_home):
    """Senza dichiarazione NON si indovina: un roster sbagliato brucia la finestra."""
    assert plan_registry.active_plan() is None
    roster = plan_registry.burst_roster()
    assert roster["ok"] is False


def test_set_plan_persists_and_is_readable(jht_home):
    plan_registry.set_plan("kimi", "allegretto")
    active = plan_registry.active_plan()
    assert active is not None
    assert active["id"] == "allegretto"
    cfg = json.loads((jht_home / 'jht.config.json').read_text(encoding='utf-8'))
    assert cfg["providers"]["kimi"]["plan"] == "allegretto"
    # Non deve calpestare quello che c'era già nel file.
    assert cfg["providers"]["kimi"]["auth_method"] == "subscription"


def test_unknown_plan_is_refused(jht_home):
    with pytest.raises(ValueError):
        plan_registry.set_plan("kimi", "fortissimo")


# ── Il roster ───────────────────────────────────────────────────────────

def test_roster_scales_with_the_plan(jht_home):
    small = plan_registry.burst_roster(plan_registry.find_plan("kimi", "moderato"))
    mid = plan_registry.burst_roster(plan_registry.find_plan("kimi", "allegretto"))
    big = plan_registry.burst_roster(plan_registry.find_plan("claude", "max20"))
    assert small["total_workers"] < mid["total_workers"] < big["total_workers"]


def test_every_roster_can_actually_score(jht_home):
    """Un roster senza Analista o Scorer produce righe grezze: per l'utente, niente."""
    for provider, plans in plan_registry.PLANS.items():
        for plan in plans:
            r = plan_registry.burst_roster(dict(plan, provider=provider))
            assert r["roster"]["analista"] >= 1, (provider, plan["id"])
            assert r["roster"]["scorer"] >= 1, (provider, plan["id"])
            assert r["roster"]["scout"] >= 1, (provider, plan["id"])


def test_sourcing_is_capped_on_the_first_pass(jht_home):
    """Senza tetto lo scouting si mangia la finestra e il punteggio non arriva."""
    r = plan_registry.burst_roster(plan_registry.find_plan("kimi", "allegretto"))
    assert r["scout_cap_first_pass"] > 0
    assert r["target_scored"] > 0


def test_small_host_trims_from_the_head(jht_home):
    """Si taglia dagli Scout: il downstream è ciò che trasforma le righe in punteggi."""
    plan = plan_registry.find_plan("claude", "max20")
    r = plan_registry.burst_roster(plan, host_cap=5)
    assert r["capped_by_host"] is True
    assert r["total_workers"] <= 5
    assert r["roster"]["scout"] == 1
    assert r["roster"]["analista"] == 2 and r["roster"]["scorer"] == 2


def test_pipeline_stays_whole_even_on_a_tiny_host(jht_home):
    """Sotto un worker per ruolo non si scende: una pipeline monca non produce nulla."""
    r = plan_registry.burst_roster(plan_registry.find_plan("claude", "max20"),
                                   host_cap=2)
    assert r["roster"] == {"scout": 1, "analista": 1, "scorer": 1}


# ── Lo stato di primo avvio ─────────────────────────────────────────────

def test_new_install_waits_for_the_profile(first_run):
    assert first_run.status()["phase"] == first_run.PHASE_AWAITING


def test_burst_refuses_to_start_without_a_declared_plan(first_run):
    out = first_run.begin_burst()
    assert out["ok"] is False
    assert "piano" in out["reason"]


def test_burst_carries_the_roster_and_the_goal(first_run):
    plan_registry.set_plan("kimi", "allegretto")
    out = first_run.begin_burst()
    assert out["ok"] is True
    assert out["phase"] == first_run.PHASE_BURST
    assert out["roster"]["scout"] >= 1
    assert out["target_scored"] > 0


def test_begin_burst_is_idempotent(first_run):
    plan_registry.set_plan("kimi", "allegretto")
    first_run.begin_burst()
    again = first_run.begin_burst()
    assert again["phase"] == first_run.PHASE_BURST
    assert "note" in again


def test_burst_closes_when_the_goal_is_reached(first_run, jht_home):
    plan_registry.set_plan("kimi", "moderato")
    started = first_run.begin_burst()
    target = started["target_scored"]

    db = jht_home / 'jobs.db'
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE scores (position_id INTEGER)")
    conn.executemany("INSERT INTO scores VALUES (?)",
                     [(i,) for i in range(target)])
    conn.commit()
    conn.close()

    out = first_run.check()
    assert out["phase"] == first_run.PHASE_STEADY
    assert out["action"] == "completato"


def test_upgrade_of_an_existing_install_gets_no_burst(first_run, jht_home):
    """Chi ha già punteggi in archivio è a regime: niente burst all'aggiornamento."""
    db = jht_home / 'jobs.db'
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE scores (position_id INTEGER)")
    conn.execute("INSERT INTO scores VALUES (1)")
    conn.commit()
    conn.close()

    assert first_run.status()["phase"] == first_run.PHASE_STEADY
