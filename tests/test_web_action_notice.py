"""W7 — the out-of-band notice of an action taken from the website.

The website can authorise an application, start or stop the team and change a team order with the
user's session alone; whoever holds that session can do it. The box tells the user on a channel the
website does not hold (jht-notify-user: a row in the panel, mirrored in the chat, and Telegram when
it is linked). The notice is a closed code with a fixed sentence: nothing from the website or the
position goes in it but the position's number, and one event is one notice.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SKILLS = REPO / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import web_action_notice as wan  # noqa: E402


def test_every_code_has_a_sentence_in_every_language_and_no_free_text():
    assert wan.CODES == {
        "apply_authorized_from_web",
        "team_stopped_from_web",
        "team_started_from_web",
        "team_restarted_from_web",
        "directive_changed_from_web",
    }
    for code, texts in wan.TEXTS.items():
        assert set(texts) == set(wan.LANGUAGES), code
        for lang, text in texts.items():
            # the only slot is the position's number, and only where there is a position
            assert text.count("{") == (1 if code == "apply_authorized_from_web" else 0), (code, lang)
            assert "{position}" in text or code != "apply_authorized_from_web"
    assert wan.body_for("apply_authorized_from_web", 42, "it").count("42") == 1
    # an unknown language falls back to English, not to an error
    assert wan.body_for("team_stopped_from_web", None, "xx") == wan.TEXTS["team_stopped_from_web"]["en"]


@pytest.mark.parametrize(
    "code,key,position,reason",
    [
        ("anything_else", "k", None, "code_unknown"),
        ("team_stopped_from_web", "bad key with spaces", None, "key_invalid"),
        ("team_stopped_from_web", "x" * 121, None, "key_invalid"),
        ("team_stopped_from_web", "k;rm", None, "key_invalid"),
        ("apply_authorized_from_web", "apply:1:2", None, "position_missing"),
        ("apply_authorized_from_web", "apply:1:2", 0, "position_invalid"),
        ("apply_authorized_from_web", "apply:1:2", True, "position_invalid"),
    ],
)
def test_what_is_not_a_notice_is_refused_before_anything_runs(code, key, position, reason):
    ran = []
    out = wan.notify(code, key, position, lang="en", run=lambda *a, **k: ran.append(a))
    assert out == {"notified": False, "reason": reason}
    assert ran == []


def test_the_command_carries_the_code_and_the_position_only():
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="7\n", stderr="")

    out = wan.notify("apply_authorized_from_web", "apply:42:1757669400000", 42, lang="de", run=run)
    assert out == {"notified": True, "code": "apply_authorized_from_web", "row_id": 7}
    cmd = seen["cmd"]
    assert cmd[cmd.index("--source-id") + 1] == "web-action:apply_authorized_from_web:apply:42:1757669400000"
    assert cmd[cmd.index("--source-action") + 1] == "web_action_notice"
    assert json.loads(cmd[cmd.index("--source-payload") + 1]) == {"code": "apply_authorized_from_web", "position_id": 42}
    assert cmd[cmd.index("--position-id") + 1] == "42"
    assert cmd[-1] == wan.body_for("apply_authorized_from_web", 42, "de")


def _box(tmp_path: Path) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    db = home / "jobs.db"
    import _db  # noqa: E402

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute("INSERT INTO positions (id, title, company, status) VALUES (42, 'Engineer', 'Example Ltd', 'ready')")
    conn.commit()
    conn.close()
    return home


def _rows(home: Path):
    conn = sqlite3.connect(home / "jobs.db")
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT agent, kind, body, related_position_id, source_id, source_action, source_payload, delivered_via "
        "FROM pending_user_messages ORDER BY id")]
    conn.close()
    return rows


def _env(home: Path, bin_dir: Path | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_")}
    env.update({"JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db"), "PYTHONDONTWRITEBYTECODE": "1"})
    # no jht-telegram-send on the PATH unless the test puts one there
    env["PATH"] = (str(bin_dir) + os.pathsep if bin_dir else "") + "/usr/bin:/bin"
    return env


def _cli(home: Path, *args, bin_dir: Path | None = None):
    r = subprocess.run([sys.executable, str(SKILLS / "web_action_notice.py"), *args],
                       capture_output=True, text=True, env=_env(home, bin_dir), timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_one_event_is_one_row_in_the_panel_and_in_the_users_language(tmp_path):
    home = _box(tmp_path)
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": "it"}))
    first = _cli(home, "apply_authorized_from_web", "apply:42:1757669400000", "--position-id", "42")
    again = _cli(home, "apply_authorized_from_web", "apply:42:1757669400000", "--position-id", "42")
    assert first["notified"] and again["notified"] and first["row_id"] == again["row_id"]
    rows = _rows(home)
    assert len(rows) == 1, "the same event pulled twice is one notice"
    row = rows[0]
    assert row["source_action"] == "web_action_notice"
    assert json.loads(row["source_payload"]) == {"code": "apply_authorized_from_web", "position_id": 42}
    assert row["related_position_id"] == 42 and row["kind"] == "alert"
    assert row["delivered_via"] == "web", "without Telegram the row stays for the panel"
    assert "Engineer" not in row["body"] and "Example" not in row["body"]
    assert row["body"] == wan.body_for("apply_authorized_from_web", 42, "it")
    # a new authorisation of the same position (a new instant) is a new notice
    _cli(home, "apply_authorized_from_web", "apply:42:1757673000000", "--position-id", "42")
    assert len(_rows(home)) == 2


def test_with_telegram_linked_the_notice_goes_out_even_off_hours(tmp_path):
    home = _box(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sent = tmp_path / "sent.txt"
    fake = bin_dir / "jht-telegram-send"
    fake.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$@\" >> {sent}\nexit 0\n")
    fake.chmod(0o755)
    # a working window that never contains now: every other notice would be held for the web
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {"windows": [{"start": "00:00", "end": "00:01", "days": []}]}}}))
    out = _cli(home, "team_stopped_from_web", "emergency-stop:1757669400000", bin_dir=bin_dir)
    assert out["notified"]
    assert sent.exists(), "a stop from the website is not a notice to hold until morning"
    assert _rows(home)[0]["delivered_via"] == "telegram"


def test_jht_notify_user_lists_the_notice_among_the_ones_not_held():
    text = (REPO / "agents" / "_tools" / "jht-notify-user").read_text(encoding="utf-8")
    block = text[text.index("off_hours = args.source_action not in ("):]
    block = block[: block.index(") and _is_off_hours()")]
    assert '"web_action_notice"' in block


def test_a_failure_is_said_and_never_raised(tmp_path):
    home = tmp_path / "empty"
    home.mkdir()  # no jobs.db: jht-notify-user refuses
    out = _cli(home, "team_stopped_from_web", "stop:1")
    assert out["notified"] is False and out["reason"] == "notify_failed"
