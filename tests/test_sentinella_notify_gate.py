"""Test del gate di notifica della Sentinella nel bridge di pacing.

Copre lean-comms (2026-06-15) + il "tick leggero" (2026-06-28): durante un
episodio attuabile a REGIME invariato, posticipa la re-conferma fino al cap
SENTINELLA_RECONFIRM_MIN invece di svegliarla a ogni quarto. Un cambio di
regime (status) la sveglia subito.

Vedi docs/internal/2026-06-28-betaD-vps-budget-burn-investigation.md §9.

Eseguire:
    pytest tests/test_sentinella_notify_gate.py -v
"""

import importlib.util
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "shared", "skills"))


def _load_bridge():
    path = os.path.join(REPO_ROOT, ".launcher", "sentinel-bridge.py")
    spec = importlib.util.spec_from_file_location("sentinel_bridge", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bridge = _load_bridge()
gate = bridge._should_notify_sentinella
COOLDOWN = bridge.SENTINELLA_COOLDOWN_MIN
RECONFIRM = bridge.SENTINELLA_RECONFIRM_MIN

NOW = 1_000_000.0


def _state(last_sent_min_ago=None, last_status=None):
    """state dict con last_sent_ts a N minuti fa (None = nessuna notifica)."""
    return {
        "last_sent_ts": None if last_sent_min_ago is None else NOW - last_sent_min_ago * 60,
        "last_sent_status": last_status,
    }


def test_on_pace_is_silent_and_resets():
    st = _state(last_sent_min_ago=5, last_status="ATTENZIONE")
    assert gate(True, st, NOW, is_quarter=True, status="ATTENZIONE") is False
    assert st["last_sent_ts"] is None
    assert st["last_sent_status"] is None


def test_edge_calm_to_actionable_notifies_immediately():
    st = _state(last_sent_min_ago=None)
    # anche fuori dai quarti, l'edge notifica
    assert gate(False, st, NOW, is_quarter=False, status="ATTENZIONE") is True


def test_in_episode_off_quarter_is_silent():
    st = _state(last_sent_min_ago=20, last_status="ATTENZIONE")
    assert gate(False, st, NOW, is_quarter=False, status="ATTENZIONE") is False


def test_in_episode_within_cooldown_is_silent():
    st = _state(last_sent_min_ago=COOLDOWN - 5, last_status="ATTENZIONE")
    assert gate(False, st, NOW, is_quarter=True, status="ATTENZIONE") is False


def test_same_regime_after_cooldown_is_postponed():
    # cooldown scaduto MA regime invariato e sotto il cap → TICK LEGGERO: silenzio
    st = _state(last_sent_min_ago=COOLDOWN + 1, last_status="ATTENZIONE")
    assert gate(False, st, NOW, is_quarter=True, status="ATTENZIONE") is False


def test_regime_change_wakes_immediately_at_quarter():
    st = _state(last_sent_min_ago=COOLDOWN + 1, last_status="ATTENZIONE")
    assert gate(False, st, NOW, is_quarter=True, status="SOTTOUTILIZZO") is True


def test_reconfirm_cap_wakes_even_if_regime_unchanged():
    st = _state(last_sent_min_ago=RECONFIRM + 1, last_status="ATTENZIONE")
    assert gate(False, st, NOW, is_quarter=True, status="ATTENZIONE") is True


def test_legacy_no_status_reconfirms_at_cooldown():
    # backward-compat: senza status, comportamento vecchio (re-conferma al cooldown)
    st = _state(last_sent_min_ago=COOLDOWN + 1, last_status=None)
    assert gate(False, st, NOW, is_quarter=True, status=None) is True


def test_reconfirm_is_meaningfully_rarer_than_cooldown():
    # garanzia che il tick leggero riduca davvero la frequenza
    assert RECONFIRM > COOLDOWN
