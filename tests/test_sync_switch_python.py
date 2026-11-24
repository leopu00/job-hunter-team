"""The Python twin of shared/cloud/sync-switch.js answers like the Node helper, and the checks of
the box that read cloud.json are quiet while the sync is paused. Synthetic data only, offline.

tests/fixtures/sync-switch-cases.json is the one list of cases: the Node test reads it too.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "skills"))

import cloud_sync_notice as csn  # noqa: E402
import process_health as ph  # noqa: E402
import sync_health as sh  # noqa: E402
import sync_switch as ss  # noqa: E402

CASES = json.loads((REPO / "tests" / "fixtures" / "sync-switch-cases.json").read_text(encoding="utf-8"))
PAUSED = {"enabled": False, "token": "jht_sync_SYNTHETICSYNTHETICSYNTHETIC", "user_id": "u-1",
          "paused_at": "2026-11-24T10:00:00.000Z", "paused_by": "cli", "sync_choice": "user"}
ENABLED = {**{k: v for k, v in PAUSED.items() if k not in ("paused_at", "paused_by")}, "enabled": True}


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_twin_gives_the_answer_of_the_shared_cases(case):
    env = {} if case["env"] is None else {"JHT_CLOUD_SYNC": case["env"]}
    assert ss.sync_switch(case["config"], env) == {"active": case["active"], "reason": case["reason"]}


def test_the_cases_cover_every_reason_and_the_reasons_are_the_closed_set():
    assert {c["reason"] for c in CASES} == ss.REASONS


def test_the_environment_of_the_process_is_the_default(monkeypatch):
    monkeypatch.setenv("JHT_CLOUD_SYNC", "0")
    assert ss.sync_switch(ENABLED) == {"active": False, "reason": "env-off"}
    monkeypatch.delenv("JHT_CLOUD_SYNC")
    assert ss.sync_switch(ENABLED) == {"active": True, "reason": "file-enabled"}


def _home(tmp_path, monkeypatch, config):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_CLOUD_SYNC", raising=False)
    if config is not None:
        (tmp_path / "cloud.json").write_text(json.dumps(config), encoding="utf-8")
    return tmp_path


def test_the_reader_gives_a_dict_or_none(tmp_path):
    assert ss.read_config(str(tmp_path)) is None  # absent
    (tmp_path / "cloud.json").write_text("{not json", encoding="utf-8")
    assert ss.read_config(str(tmp_path)) is None
    (tmp_path / "cloud.json").write_text("[]", encoding="utf-8")
    assert ss.read_config(str(tmp_path)) is None
    (tmp_path / "cloud.json").write_text(json.dumps(PAUSED), encoding="utf-8")
    assert ss.read_config(str(tmp_path)) == PAUSED


# ── test 6: no false alarm while the sync is paused ───────────────────────────
def test_process_health_expects_no_cloud_daemon_while_paused(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch, ENABLED)
    assert ph._cloud_daemon_expected() is True
    _home(tmp_path, monkeypatch, PAUSED)
    assert ph._cloud_daemon_expected() is False
    monkeypatch.setenv("JHT_CLOUD_SYNC", "0")  # the variable switches an enabled file off too
    (tmp_path / "cloud.json").write_text(json.dumps(ENABLED), encoding="utf-8")
    assert ph._cloud_daemon_expected() is False
    monkeypatch.setenv("JHT_CLOUD_SYNC", "1")  # and on a paused one that has its token
    (tmp_path / "cloud.json").write_text(json.dumps(PAUSED), encoding="utf-8")
    assert ph._cloud_daemon_expected() is True


def test_process_health_keeps_the_old_token_condition_for_an_enabled_file(tmp_path, monkeypatch):
    no_token = {k: v for k, v in ENABLED.items() if k != "token"}
    _home(tmp_path, monkeypatch, no_token)
    assert ph._cloud_daemon_expected() is False
    _home(tmp_path, monkeypatch, {"enabled": True, "token": 7})
    assert ph._cloud_daemon_expected() is False


def _stale_box(home, config):
    """A box that would be «behind» if the sync were expected: a database newer than the push cursor."""
    import sqlite3

    (home / "cloud.json").write_text(json.dumps(config), encoding="utf-8")
    (home / ".cloud-sync-cursor.json").write_text(json.dumps({"positions": "2020-01-01 00:00:00"}), encoding="utf-8")
    conn = sqlite3.connect(home / "jobs.db")
    conn.execute("CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY, updated_at TEXT)")
    if not conn.execute("SELECT 1 FROM positions").fetchone():
        conn.execute("INSERT INTO positions (updated_at) VALUES ('2026-11-24 09:00:00')")
    conn.commit()
    conn.close()


def test_sync_health_gives_no_alarm_while_paused_and_the_same_box_alarms_when_enabled(tmp_path, monkeypatch):
    _home(tmp_path, monkeypatch, None)
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    _stale_box(tmp_path, ENABLED)
    on = sh.scan()
    assert on["cloud_enabled"] is True and on["sync_paused"] is False
    assert any(p["kind"] == "push_behind" for p in on["problems"])  # the box is really behind
    _stale_box(tmp_path, PAUSED)
    off = sh.scan()
    assert off["cloud_enabled"] is False and off["sync_paused"] is True
    assert off["problems"] == [] and off["healthy"] is True and off["team_working"] is False
    _stale_box(tmp_path, ENABLED)
    monkeypatch.setenv("JHT_CLOUD_SYNC", "0")
    assert sh.scan()["problems"] == [] and sh.scan()["sync_paused"] is True


# ── test 7: no notice while the sync is paused ────────────────────────────────
class Done:
    returncode, stdout, stderr = 0, "notified 3\n", ""


def _notice(tmp_path, monkeypatch, config, env=None):
    _home(tmp_path, monkeypatch, config)
    if env is not None:
        monkeypatch.setenv("JHT_CLOUD_SYNC", env)
    tool = tmp_path / "jht-notify-user"
    tool.write_text("#!/bin/sh\n")
    monkeypatch.setattr(csn._shared, "notify_tool", lambda: tool)
    calls = []
    out = csn.notify("token_rejected", "jht_sync_AbCd", lang="en", run=lambda cmd, **k: calls.append(cmd) or Done())
    return out, calls


def test_no_notice_is_written_while_the_sync_is_paused(tmp_path, monkeypatch):
    out, calls = _notice(tmp_path, monkeypatch, PAUSED)
    assert out == {"notified": False, "reason": "sync_paused"} and calls == []
    out, calls = _notice(tmp_path, monkeypatch, ENABLED, env="0")
    assert out == {"notified": False, "reason": "sync_paused"} and calls == []
    out, calls = _notice(tmp_path, monkeypatch, {"enabled": False, "token": "t"})  # off with no mark
    assert out["reason"] == "sync_paused" and calls == []


def test_the_notice_still_goes_out_when_the_sync_is_on_or_there_is_no_file(tmp_path, monkeypatch):
    out, calls = _notice(tmp_path, monkeypatch, ENABLED)
    assert out == {"notified": True, "code": "token_rejected", "row_id": 3} and len(calls) == 1
    (tmp_path / "other").mkdir()
    out, calls = _notice(tmp_path / "other", monkeypatch, None)
    assert out["notified"] is True and len(calls) == 1
