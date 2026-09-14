"""
The LinkedIn verification code reaches the CLOSER from Telegram, and nothing else. [JHT-CLOSER-LOGIN-CODE]

The LinkedIn sign-in can stop on "enter the code": the flow waits in the
browser (backend-2's linkedin_apply) behind a `closer_login_code` alert row.
The code is not a form answer and must not live anywhere that syncs: the
bridge writes it to a local 0600 file for the flow, marks the row
'[received]', and the chat — the ASSISTENTE's input, pushed to the cloud —
keeps only a mask.

Synthetic only: no bot, no network, a temporary jobs.db, invented digits.

Run with: pytest tests/test_closer_login_code.py -v
"""

import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import _db  # noqa: E402
import application_answers as aa  # noqa: E402

BRIDGE_PATH = ROOT / ".launcher" / "tg-bridge.py"
NOTIFY = ROOT / "agents" / "_tools" / "jht-notify-user"
CODE = "482913"


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions(id, title, company, url, status) "
        "VALUES (7, 'Fixture Role', 'Fixture Co', 'https://jobs.example.com/7', 'ready')"
    )
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def bridge(monkeypatch, tmp_path):
    def load(role="assistente"):
        monkeypatch.setenv("JHT_TG_BOT_ROLE", role)
        monkeypatch.setenv("JHT_HOME", str(tmp_path))
        spec = importlib.util.spec_from_file_location(f"tg_bridge_login_{role}", BRIDGE_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.feedback = []
        monkeypatch.setattr(mod, "_answer_feedback", lambda outcome: mod.feedback.append(outcome))
        return mod

    return load


def login_request(db, *, minutes=5, ns=1, reply=None):
    """The row backend-2's flow creates through jht-notify-user."""
    source_id = f"closer-login-code:linkedin:{ns}"
    expires = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {"version": 1, "service": "linkedin", "position_id": 7, "expires_at": expires}
    body = f"LinkedIn asks for a verification code.\nCode request: {aa.answer_code(source_id)}"
    with sqlite3.connect(db) as conn:
        cur = conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, "
            "source_action, source_payload, delivered_via, user_reply) "
            "VALUES ('closer', ?, 'alert', 7, ?, ?, ?, 'telegram', ?)",
            (body, source_id, aa.LOGIN_CODE_ACTION, json.dumps(payload), reply),
        )
        return cur.lastrowid, body, source_id


def form_question(db):
    source_id = "closer-answer:7:notice"
    payload = {"version": 1, "position_id": 7, "key": "notice period", "label": "Notice period?",
               "field_type": "text", "options": []}
    body = "Question: Notice period?\n" + aa.telegram_hint(source_id)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, "
            "source_action, source_payload, delivered_via) VALUES ('closer', ?, 'question', 7, ?, ?, ?, 'telegram')",
            (body, source_id, aa.SOURCE_ACTION, json.dumps(payload)),
        )
    return body, source_id


def telegram(mod, db, uid, text, reply_to=None):
    message = {"chat": {"id": 999}, "date": 1_760_000_000 + uid, "text": text}
    if reply_to is not None:
        message["reply_to_message"] = {"text": reply_to}
    mod.dispatch_update("tok", 999, {"update_id": uid, "message": message})
    return mod.flush_inbound_queue(db)


def row(db, query, params=()):
    with sqlite3.connect(db) as conn:
        return conn.execute(query, params).fetchall()


def chat_bodies(db):
    return [r[0] for r in row(db, "SELECT body FROM pending_user_messages WHERE author = 'user'")]


def code_file(tmp_path, source_id):
    return aa.login_code_path(source_id, tmp_path)


def statuses(mod):
    return [outcome.status for outcome in mod.feedback]


# ── the code reaches the flow ────────────────────────────────────────────────


def test_a_reply_to_the_request_hands_the_code_over_in_a_0600_file(db, bridge, tmp_path):
    mod = bridge()
    row_id, body, source_id = login_request(db)

    telegram(mod, db, 1, "482 913", reply_to=body)

    path = code_file(tmp_path, source_id)
    assert json.loads(path.read_text())["code"] == CODE
    assert json.loads(path.read_text())["source_id"] == source_id
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert path.name == aa.hashlib.sha256(source_id.encode()).hexdigest()[:32] + ".json"
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [("[received]",)]
    assert row(db, "SELECT user_reply_at IS NOT NULL FROM pending_user_messages WHERE id = ?", (row_id,)) == [(1,)]
    assert statuses(mod) == ["received"]
    assert chat_bodies(db) == [aa.LOGIN_CODE_MASK]


def test_the_request_code_in_the_text_names_the_request(db, bridge, tmp_path):
    mod = bridge("capitano")  # not the questions bot: only a named code is taken
    _row_id, _body, source_id = login_request(db)

    telegram(mod, db, 1, CODE)
    assert chat_bodies(db) == [CODE] and mod.feedback == []  # a bare number to another bot is chat

    telegram(mod, db, 2, f"{aa.answer_code(source_id)} 482-913")

    assert json.loads(code_file(tmp_path, source_id).read_text())["code"] == CODE
    assert statuses(mod) == ["received"]


def test_a_direct_message_that_is_only_the_code_is_taken_with_one_open_request(db, bridge, tmp_path):
    mod = bridge()
    _row_id, _body, source_id = login_request(db)

    telegram(mod, db, 1, CODE)

    assert json.loads(code_file(tmp_path, source_id).read_text())["code"] == CODE
    assert chat_bodies(db) == [aa.LOGIN_CODE_MASK]


def test_a_direct_code_with_two_open_requests_is_masked_but_not_taken(db, bridge, tmp_path):
    mod = bridge()
    _row_id, _body, first = login_request(db, ns=1)
    _row_id, _body, second = login_request(db, ns=2)

    telegram(mod, db, 1, CODE)

    assert not code_file(tmp_path, first).exists() and not code_file(tmp_path, second).exists()
    assert statuses(mod) == ["ambiguous"]
    assert chat_bodies(db) == [aa.LOGIN_CODE_MASK]


# ── and nothing else ─────────────────────────────────────────────────────────


def test_the_digits_never_reach_the_journal_the_chat_or_the_dead_letter(db, bridge, tmp_path, monkeypatch):
    mod = bridge()
    _row_id, body, _source_id = login_request(db)
    journaled = []
    real = mod._atomic_json
    monkeypatch.setattr(mod, "_atomic_json", lambda path, rec: journaled.append(dict(rec)) or real(path, rec))

    telegram(mod, db, 1, CODE, reply_to=body)

    assert journaled and all(rec["body"] == aa.LOGIN_CODE_MASK for rec in journaled)
    assert CODE not in json.dumps(row(db, "SELECT * FROM pending_user_messages"))

    update = {"update_id": 2, "message": {"chat": {"id": 999}, "date": 1, "text": f"code {CODE}",
                                          "reply_to_message": {"text": f"{body} 482913"}}}
    mod.dead_letter(update, RuntimeError(f"failed on {CODE}"), 3)
    assert CODE not in mod.DEADLETTER_PATH.read_text()
    assert update["message"]["text"] == f"code {CODE}"  # the live update is left alone
    mod.flush_inbound_queue(db)
    assert CODE not in json.dumps(row(db, "SELECT * FROM pending_user_messages"))


def test_a_direct_code_with_a_form_question_open_is_not_taken(db, bridge, tmp_path):
    mod = bridge()
    _row_id, _body, source_id = login_request(db)
    form_question(db)

    telegram(mod, db, 1, CODE)

    assert not code_file(tmp_path, source_id).exists()
    assert statuses(mod) == ["ambiguous"]
    assert chat_bodies(db) == [aa.LOGIN_CODE_MASK]
    assert row(db, "SELECT COUNT(*) FROM closer_application_answers")[0][0] == 0 if row(
        db, "SELECT 1 FROM sqlite_master WHERE name = 'closer_application_answers'") else True


def test_two_groups_of_digits_are_not_a_code(db, bridge, tmp_path):
    mod = bridge()
    row_id, body, source_id = login_request(db)

    telegram(mod, db, 1, "482913 or 117733", reply_to=body)

    assert not code_file(tmp_path, source_id).exists()
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [(None,)]
    assert statuses(mod) == ["ambiguous"]


def test_an_expired_request_gets_feedback_and_no_write(db, bridge, tmp_path):
    mod = bridge()
    row_id, body, source_id = login_request(db, minutes=-1)

    telegram(mod, db, 1, CODE, reply_to=body)

    assert not code_file(tmp_path, source_id).exists()
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [(None,)]
    assert statuses(mod) == ["expired"]
    assert "expired" in mod._answer_feedback_text(mod.feedback[0])
    assert chat_bodies(db) == [aa.LOGIN_CODE_MASK]


def test_a_used_request_is_closed_and_a_second_code_is_not_written(db, bridge, tmp_path):
    mod = bridge()
    row_id, body, source_id = login_request(db, reply="[used]")

    telegram(mod, db, 1, CODE, reply_to=body)

    assert not code_file(tmp_path, source_id).exists()
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [("[used]",)]
    assert statuses(mod) == ["closed"]
    assert "already closed" in mod._answer_feedback_text(mod.feedback[0])


def test_a_request_closed_while_the_code_was_written_keeps_no_file(db, tmp_path, monkeypatch):
    row_id, _body, source_id = login_request(db)
    real = aa._login_rows

    def closed_meanwhile(conn, now):
        rows = real(conn, now)
        conn.execute("UPDATE pending_user_messages SET user_reply = '[expired]' WHERE id = ?", (row_id,))
        return rows

    monkeypatch.setattr(aa, "_login_rows", closed_meanwhile)
    with sqlite3.connect(db) as conn:
        outcome = aa.resolve_login_code(conn, text=CODE, reply_to_text=None, direct=True, jht_home=tmp_path)

    assert outcome.status == "closed"
    assert not code_file(tmp_path, source_id).exists()
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [("[expired]",)]


def test_a_replayed_journal_does_not_hand_the_code_over_twice(db, bridge, tmp_path):
    mod = bridge()
    _row_id, body, source_id = login_request(db)
    telegram(mod, db, 1, CODE, reply_to=body)
    code_file(tmp_path, source_id).unlink()  # the flow read and deleted it

    mod.enqueue_inbound_turn(1, {"date": 1}, aa.LOGIN_CODE_MASK, login_text=CODE)
    mod.flush_inbound_queue(db)

    assert not code_file(tmp_path, source_id).exists()
    assert statuses(mod) == ["received"]


def test_form_answers_and_plain_chat_are_untouched(db, bridge, tmp_path):
    mod = bridge()
    body, _source_id = form_question(db)

    telegram(mod, db, 1, "30 days", reply_to=body)
    telegram(mod, db, 2, "call me at 5 pm")

    assert statuses(mod) == ["resolved"]
    assert chat_bodies(db) == ["30 days", "call me at 5 pm"]

    login_request(db)
    telegram(mod, db, 3, "my postcode is 20121 and I will be late")
    assert chat_bodies(db)[-1] == "my postcode is 20121 and I will be late"
    telegram(mod, db, 4, "123")
    assert chat_bodies(db)[-1] == "123" and statuses(mod) == ["resolved"]


def test_the_row_is_never_updated_when_the_file_cannot_be_written(db, bridge, tmp_path, monkeypatch):
    mod = bridge()
    row_id, body, _source_id = login_request(db)
    blocked = tmp_path / ".cache" / "apply-flow" / "login-code"
    blocked.parent.mkdir(parents=True)
    blocked.write_text("not a folder")

    telegram(mod, db, 1, CODE, reply_to=body)

    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (row_id,)) == [(None,)]
    assert statuses(mod) == ["failed"]
    assert blocked.read_text() == "not a folder"


# ── delivery ─────────────────────────────────────────────────────────────────


def test_off_hours_a_login_code_request_still_reaches_telegram(db, tmp_path):
    (tmp_path / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {
        "timezone": "UTC", "windows": [{"start": "00:00", "end": "00:01", "days": []}],
    }}}))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sent = tmp_path / "telegram-sent.txt"
    stub = bin_dir / "jht-telegram-send"
    stub.write_text(f'#!/bin/sh\necho sent >> "{sent}"\nexit 0\n', encoding="utf-8")
    stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "JHT_HOME": str(tmp_path),
           "JHT_DB": str(db)}
    plain = subprocess.run([str(NOTIFY), "--agent", "closer", "held for working hours"],
                           capture_output=True, text=True, env=env)
    assert plain.returncode == 0 and "via=web" in plain.stdout and not sent.exists()

    payload = {"version": 1, "service": "linkedin", "position_id": 7, "expires_at": "2026-09-14T10:05:00Z"}
    done = subprocess.run(
        [str(NOTIFY), "--agent", "closer", "--kind", "alert", "--position-id", "7",
         "--source-id", "closer-login-code:linkedin:1", "--source-action", aa.LOGIN_CODE_ACTION,
         "--source-payload", json.dumps(payload), "Code request: Q0000"],
        capture_output=True, text=True, env=env,
    )
    assert done.returncode == 0 and "via=telegram" in done.stdout, done.stdout + done.stderr
    assert sent.exists()
