"""A notice of the sentinel bridge to a session that is not there writes nothing in runtime.log.

Before the team starts (or after it stops) the bridge still ticks every five minutes towards the Sentinella and the Captain: each
tick wrote «message_not_delivered» in runtime.log, a line about a failure where there was only nobody to talk to. Now a session
that does not exist spends no attempt and writes no line; the notice goes out at the first tick that finds the session, and a
session that is there but refuses the message is still reported.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sentinel_delivery = importlib.import_module("sentinel_delivery")


def _api(*, exists: bool, sent: bool, calls: list):
    return SimpleNamespace(
        time=SimpleNamespace(time=lambda: 1_000.0),
        session_exists=lambda session: exists,
        jht_tmux_send=lambda session, text: calls.append((session, text)) or sent,
    )


def _log(home: Path) -> list[str]:
    path = home / "logs" / "runtime.log"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def test_no_session_no_line_no_attempt(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    calls: list = []
    state: dict = {}
    for _ in range(5):  # five ticks before the start
        assert sentinel_delivery.notice(_api(exists=False, sent=True, calls=calls), state, "tick:ok", "SENTINELLA", "x") is False
    assert _log(tmp_path) == [] and calls == []
    assert state.get("delivery_attempts", {}) == {}


def test_the_notice_goes_out_at_the_first_tick_that_finds_the_session(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    calls: list = []
    state: dict = {}
    sentinel_delivery.notice(_api(exists=False, sent=True, calls=calls), state, "tick:ok", "SENTINELLA", "x")
    assert sentinel_delivery.notice(_api(exists=True, sent=True, calls=calls), state, "tick:ok", "SENTINELLA", "x") is True
    assert calls == [("SENTINELLA", "x")] and _log(tmp_path) == []


def test_a_session_that_is_there_and_refuses_is_still_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    calls: list = []
    assert sentinel_delivery.notice(_api(exists=True, sent=False, calls=calls), {}, "tick:ok", "SENTINELLA", "x") is False
    lines = _log(tmp_path)
    assert len(lines) == 1 and '"code":"message_not_delivered"' in lines[0]
