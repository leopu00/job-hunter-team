"""Piani Codex a finestra unica settimanale (es. "prolite", 2026-07-30).

Sul piano prolite il rollout espone UNA sola finestra di rate-limit:
`primary` con window_minutes=10080 (7 giorni) e `secondary: null`. La
mappatura classica (primary=finestra corta, secondary=weekly) lasciava
weekly_usage a None — spegnendo SOPRA-PACE, proj_weekly e weekly-halt —
mentre il budget settimanale finiva in `usage`, trattato a valle come
finestra 5h la cui saturazione vale "qualche ora", non giorni.

Il fix in fetch_codex_rollout(): se primary dura >= 1 giorno e secondary
manca, primary È il weekly e va riportato su entrambi gli assi.
"""
import importlib.util
import json
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def bridge(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "sentinel_bridge", REPO / ".launcher" / "sentinel-bridge.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sessions = tmp_path / ".codex" / "sessions" / "2026"
    sessions.mkdir(parents=True)
    monkeypatch.setattr(mod, "CODEX_SESSIONS_DIR", tmp_path / ".codex" / "sessions")
    return mod, sessions


def _write_rollout(sessions, rate_limits, ts="2026-07-30T11:27:53.484Z"):
    evt = {"timestamp": ts, "payload": {"rate_limits": rate_limits}}
    f = sessions / "rollout-2026-07-30T07-03-41-test.jsonl"
    # padding: il fetcher scarta i file sotto 512 byte
    f.write_text(("x" * 600) + "\n" + json.dumps(evt) + "\n", encoding="utf-8")
    return f


def test_prolite_single_weekly_window_populates_weekly(bridge):
    mod, sessions = bridge
    _write_rollout(sessions, {
        "primary": {"used_percent": 24.0, "window_minutes": 10080,
                    "resets_at": 1785903313},
        "secondary": None,
        "plan_type": "prolite",
    })
    r = mod.fetch_codex_rollout()
    assert r["usage"] == 24
    # il weekly NON deve restare None: primary è la finestra settimanale
    assert r["weekly_usage"] == 24
    assert r["weekly_reset_at_unix"] == 1785903313.0
    assert r["weekly_reset_at"] is not None


def test_classic_two_window_layout_unchanged(bridge):
    mod, sessions = bridge
    _write_rollout(sessions, {
        "primary": {"used_percent": 10.0, "window_minutes": 300,
                    "resets_at": 1785810000},
        "secondary": {"used_percent": 55.0, "resets_at": 1785903313},
    })
    r = mod.fetch_codex_rollout()
    assert r["usage"] == 10
    assert r["weekly_usage"] == 55
    assert r["weekly_reset_at_unix"] == 1785903313.0


def test_short_window_without_secondary_keeps_weekly_none(bridge):
    # Finestra corta e nessun secondary: NON inventare un weekly — un falso
    # 7% settimanale sbloccherebbe automatismi su un dato che non esiste.
    mod, sessions = bridge
    _write_rollout(sessions, {
        "primary": {"used_percent": 7.0, "window_minutes": 300,
                    "resets_at": 1785810000},
        "secondary": None,
    })
    r = mod.fetch_codex_rollout()
    assert r["usage"] == 7
    assert r["weekly_usage"] is None
    assert r["weekly_reset_at"] is None
