"""Regressioni per la cintura del daily hard-stop (#95).

Il bridge non manda messaggi durante l'halt: osserva digest dei pane e usa
solo ESC. I test guidano le due cuciture deterministiche, senza tmux reale e
senza avviare il loop/fetch del bridge.
"""
import importlib.util
import json
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "sentinel-bridge.py"


def _load_bridge():
    spec = importlib.util.spec_from_file_location(
        "sentinel_bridge_daily_halt_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    module = _load_bridge()
    flag = tmp_path / "logs" / "daily-halt.flag"
    flag.parent.mkdir(parents=True)
    monkeypatch.setattr(module, "DAILY_HALT_FLAG", flag)
    return module


def test_pane_immutati_non_ricevono_esc(bridge, monkeypatch):
    bridge.DAILY_HALT_FLAG.write_text(json.dumps({
        "halted_at": "2026-07-02T01:50:00Z",
        "pane_signatures": {"CAPITANO": "cap-1", "SCOUT-1": "scout-1"},
    }), encoding="utf-8")
    monkeypatch.setattr(bridge, "_session_pane_signatures", lambda: {
        "CAPITANO": "cap-1", "SCOUT-1": "scout-1",
    })
    escaped = []
    monkeypatch.setattr(bridge, "_esc_sessions",
                        lambda sessions: escaped.extend(sessions) or list(sessions))

    assert bridge._enforce_daily_halt() == []
    assert escaped == []


def test_attivazione_scrive_il_flag_prima_del_primo_esc(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_session_pane_signatures",
                        lambda: {"SCOUT-1": "before-esc"})

    def esc_after_gate_is_closed():
        assert bridge.DAILY_HALT_FLAG.exists(), \
            "il motore deve vedere il gate prima che il bridge mandi ESC"
        payload = json.loads(
            bridge.DAILY_HALT_FLAG.read_text(encoding="utf-8"))
        assert payload["pane_signatures"] == {"SCOUT-1": "before-esc"}
        return ["SCOUT-1"]

    monkeypatch.setattr(bridge, "_esc_all_sessions", esc_after_gate_is_closed)
    assert bridge._activate_daily_halt(14.0, 13.4, 8.4) == ["SCOUT-1"]
    payload = json.loads(bridge.DAILY_HALT_FLAG.read_text(encoding="utf-8"))
    assert payload["sessions"] == ["SCOUT-1"]
    assert payload["consumed_pct"] == 14.0


def test_sessione_che_parla_durante_halt_viene_riescata(bridge, monkeypatch):
    bridge.DAILY_HALT_FLAG.write_text(json.dumps({
        "halted_at": "2026-07-02T01:50:00Z",
        "consumed_pct": 14,
        "pane_signatures": {"CAPITANO": "cap-1", "SCOUT-1": "scout-1"},
    }), encoding="utf-8")
    monkeypatch.setattr(bridge, "_session_pane_signatures", lambda: {
        "CAPITANO": "cap-2", "SCOUT-1": "scout-1",
    })
    monkeypatch.setattr(bridge, "_esc_sessions", lambda sessions: list(sessions))

    assert bridge._enforce_daily_halt() == ["CAPITANO"]
    payload = json.loads(bridge.DAILY_HALT_FLAG.read_text(encoding="utf-8"))
    assert payload["consumed_pct"] == 14, "i dati originali del flag vanno preservati"
    assert payload["pane_signatures"]["CAPITANO"] == "cap-2"
    assert payload["reesc_count"] == 1
    assert payload["last_reesc_at"]


def test_esc_fallito_non_consuma_il_segnale_e_verra_ritentato(
        bridge, monkeypatch):
    bridge.DAILY_HALT_FLAG.write_text(json.dumps({
        "pane_signatures": {"CAPITANO": "cap-1"},
    }), encoding="utf-8")
    monkeypatch.setattr(bridge, "_session_pane_signatures",
                        lambda: {"CAPITANO": "cap-2"})
    monkeypatch.setattr(bridge, "_esc_sessions", lambda _sessions: [])

    assert bridge._enforce_daily_halt() == []
    payload = json.loads(bridge.DAILY_HALT_FLAG.read_text(encoding="utf-8"))
    assert payload["pane_signatures"]["CAPITANO"] == "cap-1"


def test_sessione_nata_durante_halt_e_flag_legacy_sono_fail_closed(
        bridge, monkeypatch):
    bridge.DAILY_HALT_FLAG.write_text(
        json.dumps({"halted_at": "2026-07-02T01:50:00Z"}),
        encoding="utf-8")
    monkeypatch.setattr(bridge, "_session_pane_signatures", lambda: {
        "CAPITANO": "cap-1", "ANALISTA-2": "analista-1",
    })
    monkeypatch.setattr(bridge, "_esc_sessions", lambda sessions: list(sessions))

    assert bridge._enforce_daily_halt() == ["ANALISTA-2", "CAPITANO"]


def test_senza_flag_la_cintura_non_osserva_neppure_tmux(bridge, monkeypatch):
    def forbidden():
        raise AssertionError("tmux non va letto senza daily halt")

    monkeypatch.setattr(bridge, "_session_pane_signatures", forbidden)
    assert bridge._enforce_daily_halt() == []
