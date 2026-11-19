"""Who still waits for its stage of the pace is woken by nobody else: not by the end of the sleep of the throttle, not by the
Dottore's unblock, not by the Dottore's start (retest 19/11: 0,293 $ before the stage of two workers, the Dottore 18 s early)."""
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import agent_unblock  # noqa: E402
import pi_spend_cap  # noqa: E402

import test_throttle_engine as tt  # noqa: E402

eng = tt.eng
home = tt.home


def _queue(tmp_path, names, at):
    (tmp_path / "state").mkdir(exist_ok=True)
    (tmp_path / "state" / "pace-wake-queue.json").write_text(json.dumps({"pending": names, "at": at}), encoding="utf-8")


def test_the_end_of_the_sleep_does_not_wake_a_worker_that_waits_for_its_stage(home):
    tt.set_config(home, **{"scorer-1": 300})
    eng.register("scorer-1", now=tt.T0)
    _queue(home, ["SCORER-1", "DOTTORE"], tt.T0 + 100)

    eng.tick(now=tt.T0 + 300)
    assert tt.SENT == [], "the [RIPRENDI] of the throttle came before the stage"
    assert tt.events("gated")[0]["gate"] == "pace-queue"
    assert tt.flag("scorer-1")["state"] == eng.IN_THROTTLE

    # the stage came: the pace took it out of the queue, and the sleep that ended is told at the next look
    _queue(home, ["DOTTORE"], tt.T0 + 400)
    eng.tick(now=tt.T0 + 300 + eng.GATE_RETRY_SEC)
    assert len(tt.SENT) == 1 and tt.flag("scorer-1")["state"] == eng.NOTIFIED


def test_another_worker_is_woken_by_the_throttle_as_always(home):
    tt.set_config(home, **{"scout-1": 300})
    eng.register("scout-1", now=tt.T0)
    _queue(home, ["SCORER-1"], tt.T0 + 100)
    eng.tick(now=tt.T0 + 300)
    assert len(tt.SENT) == 1


def test_a_queue_left_behind_is_not_a_wait(home):
    tt.set_config(home, **{"scorer-1": 300})
    eng.register("scorer-1", now=tt.T0)
    _queue(home, ["SCORER-1"], tt.T0 - pi_spend_cap.QUEUE_STALE_SEC - 10)
    eng.tick(now=tt.T0 + 300)
    assert len(tt.SENT) == 1, "a queue nobody has touched for hours must not hold a worker for ever"


def _panes():
    return {"CAPITANO": {"state": "idle"}, "SCORER-1": {"state": "idle"}, "ANALISTA-3": {"state": "idle"}, "SCOUT-2": {"state": "idle"}}


def test_the_unblock_of_the_dottore_does_not_say_resume_while_the_queue_of_the_pace_is_open():
    now = datetime(2026, 11, 19, 4, 35, tzinfo=timezone.utc)
    # with the queue closed this is the block of always: everybody idle, the Captain silent
    kinds = [b["kind"] for b in agent_unblock.build_scan(_panes(), [], now=now)["blocks"]]
    assert "all_operatives_idle" in kinds and "mute_coordinator" in kinds
    kinds = [b["kind"] for b in agent_unblock.build_scan(_panes(), [], now=now, paced=True)["blocks"]]
    assert "all_operatives_idle" not in kinds and "mute_coordinator" not in kinds


def test_the_scan_reads_the_queue_of_the_pace(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    assert agent_unblock.waiting_for_the_pace(tmp_path) == []
    _queue(tmp_path, ["SCORER-1", "DOTTORE"], time.time())
    assert agent_unblock.waiting_for_the_pace(tmp_path) == ["SCORER-1", "DOTTORE"]


def test_the_dottore_is_not_started_before_its_stage_of_the_pace(tmp_path):
    text = (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    assert "|| pace_waits_roles || daily_halt_active || setup_open || standby_active; then" in text, "the loop must stop on it before the spawn"
    assert 'python3 "$PACE_PY" DOTTORE MANTENITORE' in text

    def waits():
        run = subprocess.run([sys.executable, str(ROOT / "shared" / "skills" / "pace_waits.py"), "DOTTORE", "MANTENITORE"],
                             capture_output=True, text=True, timeout=60, env={"JHT_HOME": str(tmp_path), "PATH": "/usr/bin:/bin"})
        return run.stdout.strip() == "yes"

    assert waits() is False
    _queue(tmp_path, ["SCORER-1"], time.time())
    assert waits() is False, "a worker in the queue does not hold the Dottore"
    _queue(tmp_path, ["SCORER-1", "DOTTORE"], time.time())
    assert waits() is True
    _queue(tmp_path, ["MANTENITORE"], time.time())
    assert waits() is True
    _queue(tmp_path, [], time.time())
    assert waits() is False


def test_the_hour_the_person_reads_is_human_and_has_no_date_or_zone_in_it():
    from zoneinfo import ZoneInfo
    import quota_data
    i18n = quota_data.shared_i18n()
    config = {"team": {"working_hours": {"timezone": "Europe/Rome"}}}
    late = datetime(2026, 11, 19, 23, 0, tzinfo=ZoneInfo("Europe/Rome")).timestamp()
    today = pi_spend_cap.person_clock(late + 600, config, late, i18n)
    assert today == "23:10"
    tomorrow = pi_spend_cap.person_clock(late + 4 * 3600 + 3000, config, late, i18n)
    assert "03:50" in tomorrow and "2026" not in tomorrow and "Europe/Rome" not in tomorrow and tomorrow != "03:50"
    assert pi_spend_cap.person_clock(late + 3 * 86400, config, late, i18n).startswith("2026-11-22")


def test_the_scan_is_held_while_the_brake_pauses_or_just_woke_the_team(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    assert agent_unblock.held_by_the_pace(tmp_path) is False
    (tmp_path / "logs").mkdir()
    flag = tmp_path / "logs" / "daily-halt.flag"
    flag.write_text('{"reason": "other"}', encoding="utf-8")
    assert agent_unblock.held_by_the_pace(tmp_path) is False
    flag.write_text('{"reason": "pi_spend_cap"}', encoding="utf-8")
    assert agent_unblock.held_by_the_pace(tmp_path) is True, "on a pause nothing is to be unblocked: the message to the Assistente costs a turn"
    flag.unlink()
    pi_spend_cap.note_resume(tmp_path, time.time() - 60)
    assert agent_unblock.held_by_the_pace(tmp_path) is True, "just woken: the silence from before the pause is not a block"
    (tmp_path / "state" / "pace-resumes.json").write_text("[1.0]", encoding="utf-8")
    assert agent_unblock.held_by_the_pace(tmp_path) is False
