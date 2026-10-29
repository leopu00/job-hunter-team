"""«Lavora a tutta fino alle HH:MM» (`shared/skills/burst.py`): una fascia a termine che il team chiude da solo.

Cosa tiene fermo:

  1. `start` allarga gli orari, salva quelli di prima e concede il burn fino a quell'ora;
  2. `sweep` (il tick del sentinel, a app chiusa) rimette gli orari di prima alla scadenza, o se il burn
     è stato revocato prima, e li lascia stare se nel frattempo li ha cambiati qualcun altro;
  3. una seconda `start` non scambia gli orari allargati per quelli normali;
  4. se la config non si legge o non si scrive lo stato resta e si riprova;
  5. il sentinel chiama lo sweep a ogni tick.

Eseguire:
    pytest tests/test_burst.py -v
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import burn_intent  # noqa: E402
import burst  # noqa: E402

ROME = "Europe/Rome"
# 2026-10-29 22:00 in Rome (CET, UTC+1) = 21:00 UTC
NOW = datetime(2026, 10, 29, 21, 0, tzinfo=timezone.utc)
OFFICE = {"timezone": ROME, "windows": [{"days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "18:00"}]}


@pytest.fixture
def home(tmp_path, monkeypatch):
    burn_intent.INTENT_FLAG = tmp_path / ".burn-intent.flag"
    burn_intent.AUDIT_LOG = tmp_path / "logs" / "burn-intent.jsonl"
    burn_intent.NOTICES_FILE = tmp_path / ".burn-intent-notices.json"
    burst.CONFIG_FILE = tmp_path / "jht.config.json"
    burst.STATE_FILE = tmp_path / ".burst.json"
    burst.AUDIT_LOG = tmp_path / "logs" / "burst.jsonl"
    monkeypatch.setattr(burn_intent, "_user_zone", lambda: None)
    monkeypatch.setattr(burn_intent, "_system_zone", lambda: timezone.utc)
    return tmp_path


def put_config(home, hours, **extra):
    team = dict(extra)
    if hours is not None:
        team["working_hours"] = hours
    (home / "jht.config.json").write_text(json.dumps({"team": team, "other": 1}), encoding="utf-8")


def hours_now(home):
    return json.loads((home / "jht.config.json").read_text(encoding="utf-8"))["team"].get("working_hours")


def test_a_team_on_office_hours_gets_one_window_every_day_ending_at_the_chosen_time(home):
    put_config(home, OFFICE)
    out = burst.start("03:00", now=NOW)
    assert out["ok"] and out["burst"]["active"] and out["burst"]["untilLocal"] == "03:00"
    assert out["burst"]["until"] == "2026-10-30T02:00:00+00:00"
    wide = hours_now(home)
    assert burst.valid_hours(wide)
    (window,) = wide["windows"]
    assert window["days"] == list(burst.WEEKDAYS) and window["end"] == "03:00" and window["start"] == "22:00"
    assert wide["timezone"] == ROME
    assert burn_intent.status(NOW)["active"] and burn_intent.status(NOW)["expires_at"] == "2026-10-30T02:00:00+00:00"
    saved = json.loads((home / ".burst.json").read_text(encoding="utf-8"))
    assert saved["previous_hours"] == OFFICE and saved["written_hours"] == wide


def test_the_rest_of_the_config_is_left_alone(home):
    put_config(home, OFFICE, role_models={"scout": {"model": "luna"}})
    burst.start("03:00", now=NOW)
    cfg = json.loads((home / "jht.config.json").read_text(encoding="utf-8"))
    assert cfg["other"] == 1 and cfg["team"]["role_models"] == {"scout": {"model": "luna"}}


def test_a_short_stretch_is_widened_to_the_four_hours_the_hours_rule_wants(home):
    put_config(home, OFFICE)
    burst.start("23:30", now=NOW)
    (window,) = hours_now(home)["windows"]
    assert (window["start"], window["end"]) == ("19:30", "23:30") and burst.valid_hours(hours_now(home))


def test_a_team_that_was_already_24_7_gets_only_the_burn(home):
    put_config(home, None)
    out = burst.start("03:00", now=NOW)
    assert out["burst"]["active"] and hours_now(home) is None
    assert burn_intent.status(NOW)["active"]
    later = NOW + timedelta(hours=6)
    assert burst.sweep(later) == "unchanged"
    assert hours_now(home) is None and not (home / ".burst.json").exists()


def test_the_sweep_before_the_end_does_nothing_and_after_it_puts_the_old_hours_back(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    assert burst.sweep(NOW + timedelta(hours=2)) is None
    assert hours_now(home) != OFFICE
    assert burst.sweep(NOW + timedelta(hours=5, minutes=1)) == "restored"
    assert hours_now(home) == OFFICE and not (home / ".burst.json").exists()
    assert (home / "logs" / "burst.jsonl").exists()


def test_a_burn_revoked_before_the_end_ends_the_burst_too(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    burn_intent.revoke(now=NOW)
    assert burst.sweep(NOW + timedelta(hours=1)) == "restored"
    assert hours_now(home) == OFFICE


def test_hours_changed_by_somebody_else_during_the_burst_are_not_overwritten(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    mine = {"timezone": ROME, "windows": [{"days": ["sat"], "start": "10:00", "end": "16:00"}]}
    put_config(home, mine)
    assert burst.sweep(NOW + timedelta(hours=6)) == "kept"
    assert hours_now(home) == mine and not (home / ".burst.json").exists()


def test_a_second_start_moves_the_end_but_keeps_the_original_hours_to_put_back(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    burst.start("05:00", now=NOW + timedelta(hours=1))
    saved = json.loads((home / ".burst.json").read_text(encoding="utf-8"))
    assert saved["previous_hours"] == OFFICE
    assert burst.sweep(NOW + timedelta(hours=9)) == "restored" and hours_now(home) == OFFICE


def test_stop_puts_the_hours_back_now_and_revokes_the_burn(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    out = burst.stop(now=NOW + timedelta(minutes=30))
    assert out == {"ok": True, "burst": {"active": False}}
    assert hours_now(home) == OFFICE and not burn_intent.status(NOW)["active"]
    assert burst.status(NOW)["burst"] == {"active": False}


def test_stop_with_nothing_running_is_not_an_error_and_does_not_touch_a_burn_the_user_made(home):
    put_config(home, OFFICE)
    burn_intent.grant(3, now=NOW)
    assert burst.stop(now=NOW)["ok"]
    assert burn_intent.status(NOW)["active"]


@pytest.mark.parametrize("until,code", [("25:00", "until_invalid"), ("8:00", "until_invalid"), ("", "until_invalid"),
                                         ("22:05", "until_too_soon"), ("12:00", "until_too_far")])
def test_an_end_out_of_the_rules_is_refused_with_a_closed_code_and_nothing_is_written(home, until, code):
    put_config(home, OFFICE)
    with pytest.raises(burst.Refused) as e:
        burst.start(until, now=NOW)
    assert e.value.code == code
    assert hours_now(home) == OFFICE and not (home / ".burst.json").exists() and not burn_intent.status(NOW)["active"]


def test_the_time_is_the_next_time_the_teams_clock_reads_it_in_its_own_zone(home):
    put_config(home, OFFICE)
    out = burst.start("08:00", now=NOW)           # 22:00 in Rome -> 08:00 tomorrow, 10 h
    assert out["burst"]["until"] == "2026-10-30T07:00:00+00:00"


def test_a_config_that_cannot_be_read_at_the_end_keeps_the_state_and_the_next_tick_retries(home):
    put_config(home, OFFICE)
    burst.start("03:00", now=NOW)
    good = (home / "jht.config.json").read_text(encoding="utf-8")
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    assert burst.sweep(NOW + timedelta(hours=6)) is None
    assert (home / ".burst.json").exists()
    (home / "jht.config.json").write_text(good, encoding="utf-8")
    assert burst.sweep(NOW + timedelta(hours=6, minutes=5)) == "restored"
    assert hours_now(home) == OFFICE


def test_a_start_on_a_config_that_cannot_be_read_is_refused(home):
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(burst.Refused) as e:
        burst.start("03:00", now=NOW)
    assert e.value.code == "config_unreadable" and not burn_intent.status(NOW)["active"]


def test_a_state_file_with_hours_off_the_shape_is_never_trusted_to_write_them(home):
    put_config(home, OFFICE)
    (home / ".burst.json").write_text(json.dumps({
        "until": (NOW - timedelta(hours=1)).isoformat(),
        "previous_hours": {"timezone": "Nowhere/Land", "windows": []},
        "written_hours": OFFICE,
    }), encoding="utf-8")
    assert burst.sweep(NOW) is None
    assert hours_now(home) == OFFICE


def test_the_command_line_answers_one_json_line(home, capsys):
    put_config(home, OFFICE)
    assert burst.main(["status"]) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "burst": {"active": False}}
    assert burst.main(["start", "--until", "99:99"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "code": "until_invalid"}


def test_the_sentinel_sweeps_the_burst_at_every_tick_right_after_the_burn():
    source = (REPO_ROOT / ".launcher" / "sentinel-bridge.py").read_text(encoding="utf-8")
    body = source[source.index("_burn_intent_notify_user()\n        _burn_intent_sweep()"):]
    assert body.index("_burn_intent_sweep()") < body.index("_burst_sweep()") < body.index("_burn_intent_status()")


def test_the_script_runs_as_the_container_runs_it(home):
    put_config(home, OFFICE)
    r = subprocess.run([sys.executable, str(SKILLS_DIR / "burst.py"), "status"], capture_output=True, text=True,
                       env={"JHT_HOME": str(home), "PATH": "/usr/bin:/bin"}, timeout=30)
    assert r.returncode == 0 and json.loads(r.stdout) == {"ok": True, "burst": {"active": False}}
