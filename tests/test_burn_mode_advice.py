"""
Quando il weekly sta per essere sprecato, il consiglio deve indicare una leva
che il team può davvero tirare.

Perché esiste ([BURN-MODE-ADVISES-THE-WRONG-LEVER], misurato su P05 il
2026-08-02): l'allarme `burn_mode` ha funzionato — annunciava `spreco ~40% del
weekly`, reset fra 15 ore — e il budget è evaporato lo stesso, perché il
consiglio era «SATURA: scala worker». Quel team aveva **460 posizioni e zero
candidature**: il sourcing era già saturo (è work-capped, non budget-capped) e
la leva ferma era scrivere CV. L'allarme ha suonato per ore indicando l'unica
cosa che non poteva spendere.

Cosa proteggono questi test:
  1. con un raccolto pronto il consiglio propone la MODALITÀ `harvest`, e lo
     dice come proposta all'utente — mai come cambio automatico;
  2. senza raccolto il consiglio storico resta intatto (saturare È giusto
     quando il collo di bottiglia è davvero il sourcing);
  3. il conteggio non è contabile → si ricade sul consiglio storico, invece di
     proporre un raccolto che non sappiamo se esiste;
  4. il bridge conta il backlog SOLO in burn_mode: una query per tick, a ogni
     tick, non la paga nessuno;
  5. la stessa correzione è nei prompt di Capitano e Sentinella, in tutte e 7
     le lingue — il segnale attraversa tre hop e ognuno può declinarlo.

Eseguire con: pytest tests/test_burn_mode_advice.py -v
"""

import importlib.util
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
AGENTS_DIR = os.path.join(REPO_ROOT, 'agents')
LOCALES = ('', '.it', '.es', '.fr', '.de', '.pt', '.hu')

sys.path.insert(0, SKILLS_DIR)
import bridge_message  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def bridge():
    return _load('sentinel_bridge_burn',
                 os.path.join(REPO_ROOT, '.launcher', 'sentinel-bridge.py'))


BURN = {"kind": "SOTTO-PACE", "burn_mode": True, "projected_final_pct": 62.0,
        "wasted_pct": 38.0, "reset_in_active_h": 15.0,
        "sustainable_pct_h": 2.4, "vel_weekly_pct_h": 0.15}


def _advice(extras):
    return bridge_message.derive_advice({
        "fivehh": {"status": "SOTTOUTILIZZO"},
        "weekly": {"kind": "SOTTO-PACE", "burn_mode": True},
        "extras": extras, "work_phase": "ON",
    })


# ── 1-2. Quale leva viene indicata ──────────────────────────────────────

def test_a_waiting_harvest_makes_the_advice_a_mode_proposal():
    line = " ".join(_advice({"harvest_backlog": 460}))
    assert "harvest" in line
    assert "460" in line
    # È una proposta all'utente, non un ordine di spesa.
    assert "PROPOSE" in line.upper()
    assert "do not switch it yourself" in line
    # E soprattutto NON manda a scalare Scout, che è la leva già satura.
    assert "SATURATE" not in line.upper()


def test_without_a_harvest_the_historic_advice_stands():
    """Saturare è giusto quando il collo di bottiglia è davvero il sourcing."""
    line = " ".join(_advice({"harvest_backlog": 0}))
    assert "SATURATE" in line
    assert "harvest" not in line


def test_an_uncountable_backlog_falls_back_to_the_old_advice():
    """Meglio un consiglio imperfetto che proporre un raccolto immaginario."""
    assert "SATURATE" in " ".join(_advice({}))
    assert "SATURATE" in " ".join(_advice({"harvest_backlog": None}))


# ── 3. Il verdetto imperativo che arriva alla Sentinella ────────────────

def test_the_sentinella_verdict_names_the_harvest(bridge):
    line = bridge._pace_verdict_line(BURN, 43.0, harvest_backlog=460)
    assert "PROPOSE-HARVEST" in line
    assert "460 positions" in line
    assert "do NOT switch it yourself" in line
    # La diagnosi resta: è la metà del segnale che funzionava.
    assert "wasting ~38%" in line


def test_the_verdict_keeps_saturate_without_a_harvest(bridge):
    line = bridge._pace_verdict_line(BURN, 43.0, harvest_backlog=0)
    assert "ACCELERATE-SATURATE" in line
    assert "wasting ~38%" in line


def test_slowing_down_still_wins_over_the_burn_branch(bridge):
    """Precedenza invariata: sopra-pace frena, e non si propone niente."""
    over = dict(BURN, kind="SOPRA-PACE", burn_mode=True, early_lockout_h=4.0)
    line = bridge._pace_verdict_line(over, 12.0, harvest_backlog=460)
    assert "SLOW-DOWN" in line
    assert "HARVEST" not in line.upper()


# ── 4. Il conto si fa solo quando serve ─────────────────────────────────

def _tick(bridge, monkeypatch, burn):
    calls = []
    monkeypatch.setattr(bridge, "_harvest_backlog_count",
                        lambda: (calls.append(1), 460)[1])
    entry = {"provider": "kimi", "weekly_usage": 57,
             "weekly_remaining_pct": 43.0, "reset_at_unix": 1e12,
             "weekly_reset_at_unix": 1e12}
    msg = bridge._build_tick_message(
        entry, entry, "SOTTOUTILIZZO", 60, 57, "?", 92, "ON",
        dict(BURN, burn_mode=burn), False, "10:00:00", 1e9)
    return msg, calls


def test_the_backlog_is_counted_only_in_burn_mode(bridge, monkeypatch):
    _, calls = _tick(bridge, monkeypatch, burn=False)
    assert calls == []


def test_the_tick_carries_the_proposal_when_burning(bridge, monkeypatch):
    msg, calls = _tick(bridge, monkeypatch, burn=True)
    assert calls == [1]
    assert "harvest" in msg


# ── 5. Il segnale attraversa tre hop: i prompt devono dirlo tutti ───────

@pytest.mark.parametrize("role", ["capitano", "sentinella"])
def test_every_localization_knows_the_harvest_proposal(role):
    """Bridge → Sentinella → Capitano: basta un anello che non lo sappia e
    il consiglio muore lì, come su P05."""
    for loc in LOCALES:
        path = os.path.join(AGENTS_DIR, role, f'{role}{loc}.md')
        text = open(path, encoding='utf-8').read()
        # Il token è quello che il bridge scrive davvero nel verdetto: se un
        # prompt non lo nomina, quell'anello non riconosce il segnale.
        assert 'PROPOSE-HARVEST' in text, path
        assert '`harvest`' in text, path
