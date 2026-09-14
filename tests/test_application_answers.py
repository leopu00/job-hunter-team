"""
The CLOSER asks on Telegram and remembers the answer. [JHT-CLOSER-ANSWERS]

Found on the operator's box: the CLOSER's question reached Telegram, the user
answered there, and nothing happened — the bridge stored the reply as ordinary
chat, only a dashboard reply unblocked the application, and the answers that
did arrive lived in the YAML profile, where a new session never looked. These
tests pin the loop that replaces it: a Telegram reply resolves THAT request
with the dashboard's own rule, renews the position as `user_telegram`, lands in
`jobs.db`, and is never asked again — nor are the essential facts.

Synthetic only: no bot, no network (the feedback sender is replaced), a
temporary jobs.db, fictitious answers.

Run with: pytest tests/test_application_answers.py -v
"""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import _db  # noqa: E402
import application_answers as aa  # noqa: E402
import apply_gate  # noqa: E402

BRIDGE_PATH = ROOT / ".launcher" / "tg-bridge.py"
CASES = json.loads((ROOT / "shared" / "cloud" / "application-answer-cases.json").read_text())["cases"]


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    for pid in (7, 8):
        conn.execute(
            "INSERT INTO positions(id, title, company, url, status, apply_requested, "
            "apply_requested_at, apply_requested_by) VALUES (?, 'Fixture Role', 'Fixture Co', ?, "
            "'ready', 1, '2026-09-13T10:00:00.000Z', 'user_web')",
            (pid, f"https://jobs.example.com/{pid}"),
        )
    conn.commit()
    conn.close()
    return path


def ask(db, pid, key, label, field_type="radio", options=("Remote", "Hybrid"), via="telegram"):
    """An open CLOSER request, as apply_flow.py persists it."""
    source_id = f"closer-answer:{pid}:{key.replace(' ', '')[:20]}"
    payload = {
        "version": 1, "position_id": pid, "key": key, "label": label,
        "field_type": field_type, "options": list(options),
    }
    opts = "".join(f"\n- {o}" for o in options)
    body = (
        "CLOSER needs one required application answer before it can continue.\n"
        f"Question: {label}\nField type: {field_type}" + (f"\nOptions:{opts}" if opts else "") +
        "\n\nReply to this request in the dashboard.\n" + aa.telegram_hint(source_id)
    )
    with sqlite3.connect(db) as conn:
        cur = conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, "
            "source_action, source_payload, delivered_via) VALUES ('closer', ?, 'question', ?, ?, ?, ?, ?)",
            (body, pid, source_id, aa.SOURCE_ACTION, json.dumps(payload), via),
        )
        return cur.lastrowid, body, source_id


def row(db, query, params=()):
    with sqlite3.connect(db) as conn:
        return conn.execute(query, params).fetchall()


@pytest.fixture
def bridge(monkeypatch, tmp_path):
    def load(role="assistente"):
        monkeypatch.setenv("JHT_TG_BOT_ROLE", role)
        monkeypatch.setenv("JHT_HOME", str(tmp_path))
        spec = importlib.util.spec_from_file_location(f"tg_bridge_answers_{role}", BRIDGE_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.feedback = []
        monkeypatch.setattr(mod, "_answer_feedback", lambda outcome: mod.feedback.append(outcome))
        return mod

    return load


def telegram(mod, db, uid, text, reply_to=None):
    message = {"chat": {"id": 999}, "date": 1_760_000_000 + uid, "text": text}
    if reply_to is not None:
        message["reply_to_message"] = {"text": reply_to}
    mod.dispatch_update("tok", 999, {"update_id": uid, "message": message})
    return mod.flush_inbound_queue(db)


# ── the rule shared with the dashboard ───────────────────────────────────────


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['field_type']}:{c['reply']}")
def test_the_telegram_rule_answers_the_dashboard_cases(case):
    try:
        aa.validate_reply(case["field_type"], case["options"], case["reply"])
        outcome = "ok"
    except aa.AnswerRejected as exc:
        outcome = exc.reason
    assert outcome == case["outcome"]


def test_user_telegram_is_a_user_channel_for_the_gate():
    assert "user_telegram" in apply_gate.USER_REQUEST_ORIGINS


# ── Telegram reply → the same outcome as a dashboard reply ───────────────────


def test_a_reply_to_the_question_resolves_it_and_renews_the_position(db, bridge):
    mod = bridge()
    qid, body, _ = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    assert telegram(mod, db, 1, "Hybrid", reply_to=body) == 1

    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (qid,)) == [("Hybrid",)]
    flag, at, by = row(db, "SELECT apply_requested, apply_requested_at, apply_requested_by FROM positions WHERE id = 7")[0]
    assert (flag, by) == (1, "user_telegram")
    assert apply_gate._parse_instant(at) > apply_gate._parse_instant("2026-09-13T10:00:00.000Z")
    assert row(db, "SELECT key, answer_json, channel, source_message_id FROM application_answers") == [
        ("which work model can you accept", '"Hybrid"', "telegram", qid)
    ]
    assert [o.status for o in mod.feedback] == ["resolved"]
    # The chat turn itself is kept: nothing the user wrote disappears.
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE author = 'user'") == [(1,)]


def test_an_answer_that_is_not_an_exact_option_is_refused_and_asked_again(db, bridge):
    mod = bridge()
    qid, body, _ = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    telegram(mod, db, 2, "hybrid", reply_to=body)

    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (qid,)) == [(None,)]
    assert row(db, "SELECT apply_requested_by FROM positions WHERE id = 7") == [("user_web",)]
    assert row(db, "SELECT COUNT(*) FROM application_answers") == [(0,)]
    [outcome] = mod.feedback
    assert (outcome.status, outcome.reason) == ("rejected", "closer_answer_not_exact_option")
    assert "Question: Which work model can you accept?" in mod._answer_feedback_text(outcome)

    telegram(mod, db, 3, "Hybrid", reply_to=body)
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (qid,)) == [("Hybrid",)]


def test_two_open_questions_and_no_code_resolve_nothing(db, bridge):
    mod = bridge()
    first, _, source_first = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    second, _, source_second = ask(db, 8, "notice period", "Notice period?", field_type="text", options=())
    telegram(mod, db, 4, "Remote")
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE user_reply IS NOT NULL") == [(0,)]
    assert mod.feedback == []

    # With the short code the user picks one, and only that one.
    telegram(mod, db, 5, f"{aa.answer_code(source_second)} two months")
    assert row(db, "SELECT id, user_reply FROM pending_user_messages WHERE user_reply IS NOT NULL") == [
        (second, "two months")
    ]
    assert row(db, "SELECT apply_requested_by FROM positions WHERE id = 8") == [("user_telegram",)]
    assert row(db, "SELECT apply_requested_by FROM positions WHERE id = 7") == [("user_web",)]


def test_the_next_message_answers_only_the_single_choice_question_delivered_on_this_bot(db, bridge):
    ask(db, 7, "which work model can you accept", "Which work model can you accept?", via="web")
    telegram(bridge(), db, 6, "Hybrid")
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE user_reply IS NOT NULL") == [(0,)]

    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE pending_user_messages SET delivered_via = 'telegram' WHERE author = 'agent'")
    telegram(bridge("capitano"), db, 7, "Hybrid")
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE user_reply IS NOT NULL") == [(0,)]

    mod = bridge()
    telegram(mod, db, 8, "Hybrid")
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE author = 'agent'") == [("Hybrid",)]
    assert [o.status for o in mod.feedback] == ["resolved"]


def test_a_bare_message_that_is_not_an_option_stays_chat(db, bridge):
    qid, _, _ = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    mod = bridge()
    telegram(mod, db, 9, "hi, any news on my applications?")
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (qid,)) == [(None,)]
    assert mod.feedback == []
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE author = 'user'") == [(1,)]


def test_an_unrelated_chat_message_never_answers_a_free_text_question(db, bridge):
    # Cross-review R1: the user withdrew position 7 and chats about something else.
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET apply_requested = 0, apply_requested_by = NULL WHERE id = 7")
    mid, body, source_id = ask(db, 7, "notice period", "What is your notice period?", "text", ())
    mod = bridge()
    telegram(mod, db, 1, "hi, any news on my applications today?")
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (mid,)) == [(None,)]
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 7") == [(0,)]
    assert mod.feedback == []
    # With its code it is an answer: saved, and the position stays withdrawn.
    telegram(mod, db, 2, f"{aa.answer_code(source_id)} two months")
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (mid,)) == [("two months",)]
    assert row(db, "SELECT apply_requested, apply_requested_by FROM positions WHERE id = 7") == [(0, None)]
    assert row(db, "SELECT answer_json FROM application_answers WHERE key = 'notice period'") == [('"two months"',)]
    assert [(o.status, o.reason) for o in mod.feedback] == [("resolved", "position_withdrawn")]
    assert "withdrawn" in mod._answer_feedback_text(mod.feedback[0])


def test_a_telegram_answer_never_turns_a_withdrawn_position_back_on(db, bridge):
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET apply_requested = 0, apply_requested_by = 'user_web' WHERE id = 7")
    _, body, _ = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    telegram(bridge(), db, 3, "Remote", reply_to=body)
    assert row(db, "SELECT apply_requested, apply_requested_by FROM positions WHERE id = 7") == [(0, "user_web")]
    assert row(db, "SELECT answer_json FROM application_answers") == [('"Remote"',)]


def test_a_reply_to_an_answered_question_never_resolves_another_position(db, bridge):
    # Cross-review R2: the same question later asked for position 8.
    label = "Which work model can you accept?"
    mid_a, body_a, _ = ask(db, 7, "which work model can you accept", label)
    mod = bridge()
    telegram(mod, db, 1, "Remote", reply_to=body_a)
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (mid_a,)) == [("Remote",)]
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET apply_requested = 0, apply_requested_by = NULL WHERE id = 8")
    mid_b, _, _ = ask(db, 8, "which work model can you accept", label)
    telegram(mod, db, 2, "Hybrid", reply_to=body_a)
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (mid_b,)) == [(None,)]
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 8") == [(0,)]
    assert [o.status for o in mod.feedback] == ["resolved", "already_answered"]
    assert "already" in mod._answer_feedback_text(mod.feedback[1])
    assert "More than one" not in mod._answer_feedback_text(mod.feedback[1])


def test_an_unknown_code_is_not_called_ambiguous(db, bridge):
    ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    mod = bridge()
    unknown = next(f"Q{n:04X}" for n in range(65536) if f"Q{n:04X}" != aa.answer_code("closer-answer:7:whichworkmodelcanyou"))
    telegram(mod, db, 4, f"{unknown} Remote")
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE user_reply IS NOT NULL") == [(0,)]
    assert [o.status for o in mod.feedback] == ["unknown_code"]
    assert "More than one" not in mod._answer_feedback_text(mod.feedback[0])


def test_a_quoted_message_without_codes_matches_only_the_whole_question_line(db):
    # "Question: Phone" is not the question quoted as "Question: Phone number?".
    ask(db, 7, "phone", "Phone", field_type="tel", options=())
    with sqlite3.connect(db) as conn:
        found = aa.resolve_telegram_reply(conn, text="+1 555 0100", reply_to_text="Question: Phone number?\nField type: tel")
        assert found.status == "not_an_answer"
        found = aa.resolve_telegram_reply(conn, text="+1 555 0100", reply_to_text="Question: Phone\nField type: tel")
        assert found.status == "resolved"


def test_the_bridge_uses_the_module_code_pattern():
    source = BRIDGE_PATH.read_text(encoding="utf-8")
    assert "Q[0-9A-F]{4}" not in source and "application_answers._CODE" in source


def test_a_motivation_is_kept_per_company_and_facts_are_global(db, bridge):
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET company = 'Other Fixture Ltd' WHERE id = 8")
    _, why_body, _ = ask(db, 7, "why do you want to join us", "Why do you want to join us?", "textarea", ())
    _, notice_body, _ = ask(db, 7, "notice period", "Notice period?", "text", ())
    mod = bridge()
    telegram(mod, db, 1, "Fixture motivation", reply_to=why_body)
    telegram(mod, db, 2, "one month", reply_to=notice_body)
    with sqlite3.connect(db) as conn:
        same = aa.load_answers(conn, 7)
        other = aa.load_answers(conn, 8)
        anywhere = aa.load_answers(conn)
    assert same["why do you want to join us"] == "Fixture motivation"
    assert "why do you want to join us" not in other and "why do you want to join us" not in anywhere
    assert other["notice period"] == anywhere["notice period"] == "one month"


def test_a_replayed_telegram_update_does_not_answer_twice(db, bridge):
    mod = bridge()
    qid, body, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    telegram(mod, db, 9, "one month", reply_to=body)
    at = row(db, "SELECT apply_requested_at FROM positions WHERE id = 8")
    # A second question opens; then the first update's journal is replayed
    # after a crash between commit and unlink. The replay is the SAME turn:
    # it must not become the answer to the question that is open now.
    other, _, _ = ask(db, 8, "start date", "Start date?", field_type="text", options=())
    mod.enqueue_inbound_turn(9, {"date": 1_760_000_009}, "one month")
    mod.flush_inbound_queue(db)
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (qid,)) == [("one month",)]
    assert row(db, "SELECT user_reply FROM pending_user_messages WHERE id = ?", (other,)) == [(None,)]
    assert row(db, "SELECT apply_requested_at FROM positions WHERE id = 8") == at
    assert [o.status for o in mod.feedback] == ["resolved"]


def test_an_empty_message_is_not_an_answer(db):
    ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    with sqlite3.connect(db) as conn:
        assert aa.resolve_telegram_reply(conn, text="   \n").status == "not_an_answer"


def test_an_answer_never_reauthorises_an_application_already_sent(db, bridge):
    mod = bridge()
    _, body, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE positions SET status = 'applied', apply_requested = 0 WHERE id = 7")
    telegram(mod, db, 10, "one month", reply_to=body)
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 7") == [(0,)]
    assert [(o.status, o.reason) for o in mod.feedback] == [("rejected", "closer_answer_already_submitted")]


# ── remembered in jobs.db ────────────────────────────────────────────────────


def test_after_a_restart_the_answer_is_still_there_and_nothing_is_asked(db, bridge, tmp_path):
    mod = bridge()
    _, body, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    telegram(mod, db, 11, "one month", reply_to=body)

    # A new process: fresh connection, fresh module state, empty agent context.
    sys.modules.pop("application_answers", None)
    fresh = importlib.import_module("application_answers")
    with sqlite3.connect(db) as conn:
        assert fresh.load_answers(conn)["notice period"] == "one month"
        profile = {"contacts": {"phone": "+1 555 0100"}}
        fresh.save_answer(conn, key="availability", label="Start?", answer="now", field_type="text", channel="telegram")
        asked = []
        out = fresh.ensure_essentials(conn, profile, 7, notifier=lambda **kw: asked.append(kw) or "1")
    assert "notice period" not in out["missing"] and "availability" not in out["missing"]
    assert {kw["source_id"] for kw in asked} == {
        "closer-essential:work_authorization", "closer-essential:sponsorship",
        "closer-essential:salary_expectations", "closer-essential:relocation",
    }


def test_yaml_answers_are_imported_once_and_the_database_wins(db):
    with sqlite3.connect(db) as conn:
        aa.save_answer(conn, key="relocation", label="Relocate?", answer="No", field_type="radio",
                       options=["Yes", "No"], channel="telegram")
        profile = {"application_answers": {"Relocation": "Yes", "How did you hear": "Job board"}}
        assert aa.import_profile_answers(conn, profile) == 1
        assert aa.import_profile_answers(conn, profile) == 0
        answers = aa.load_answers(conn)
    assert answers["relocation"] == "No" and answers["how did you hear"] == "Job board"


def test_a_dashboard_reply_is_harvested_into_the_table(db):
    qid, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=(), via="web")
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE pending_user_messages SET user_reply = 'two weeks', user_reply_at = '2026-09-13' WHERE id = ?", (qid,))
        assert aa.harvest_replies(conn) == 1
        assert aa.harvest_replies(conn) == 0
        assert aa.load_answers(conn) == {"notice period": "two weeks"}


# ── essential facts before the first application ─────────────────────────────


FULL_PROFILE = {
    "availability": "in one month", "notice_period": "one month",
    "work_authorization": "EU", "sponsorship": False, "salary_expectations": "50000 EUR",
    "relocation": True, "contacts": {"phone": "+1 555 0100"},
}


def test_an_essential_fact_already_known_is_never_asked(db):
    asked = []
    with sqlite3.connect(db) as conn:
        out = aa.ensure_essentials(conn, FULL_PROFILE, 7, notifier=lambda **kw: asked.append(kw) or "1")
    assert (out["status"], asked) == ("complete", [])


def test_each_missing_essential_is_asked_once_and_an_answer_closes_it(db, bridge):
    asked = []

    def notifier(**kw):
        asked.append(kw)
        with sqlite3.connect(db) as conn:  # what jht-notify-user writes
            conn.execute(
                "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, "
                "source_action, source_payload, delivered_via) VALUES ('closer', ?, 'question', ?, ?, ?, ?, 'telegram')",
                (kw["message"], kw["position_id"], kw["source_id"], aa.SOURCE_ACTION, json.dumps(kw["payload"])),
            )
        return "1"

    profile = {k: v for k, v in FULL_PROFILE.items() if k != "notice_period"}
    with sqlite3.connect(db) as conn:
        first = aa.ensure_essentials(conn, profile, 7, notifier=notifier)
        second = aa.ensure_essentials(conn, profile, 8, notifier=notifier)
    assert first["asked"] == ["notice period"] and second["asked"] == []
    assert second["already_asked"] == ["notice period"] and len(asked) == 1
    assert "Field type: text" in asked[0]["message"]

    mod = bridge()
    telegram(mod, db, 12, "three months")  # a free-text fact: a bare message is chat
    with sqlite3.connect(db) as conn:
        assert aa.ensure_essentials(conn, profile, 8, notifier=notifier)["status"] == "waiting"
    telegram(mod, db, 13, "three months", reply_to=asked[0]["message"])
    with sqlite3.connect(db) as conn:
        third = aa.ensure_essentials(conn, profile, 8, notifier=notifier)
    assert third["status"] == "complete" and len(asked) == 1


def test_apply_flow_waits_for_essentials_without_holding_or_opening_the_browser(db, tmp_path, monkeypatch):
    import apply_flow

    flow = apply_flow.ApplicationFlow(
        position_id=7,
        url="https://jobs.ashbyhq.com/fixture/1",
        profile={"name": "Test Candidate"},
        cv_path=tmp_path / "cv.pdf",
        checkpoint_path=tmp_path / "checkpoint.json",
        db_path=db,
        gate_checker=lambda **_: type("V", (), {"allowed": True, "context": {"mode": "authorised"}})(),
        essentials_checker=lambda **_: ["notice period"],
    )
    monkeypatch.setattr(flow, "_managed_page", lambda: pytest.fail("browser opened before the essentials"))
    result = flow.run()
    assert (result.status, result.reason) == ("blocked_human", "essential_facts_missing")
    assert not (tmp_path / "checkpoint.json").exists()


def test_apply_flow_reads_answers_from_the_database(db, tmp_path):
    import apply_flow

    with sqlite3.connect(db) as conn:
        aa.save_answer(conn, key="which work model can you accept", label="Which work model?",
                       answer="Remote", field_type="radio", options=["Remote", "Hybrid"], channel="telegram")
    flow = apply_flow.ApplicationFlow(
        position_id=7, url="https://jobs.ashbyhq.com/fixture/1", profile={"name": "Test Candidate"},
        cv_path=tmp_path / "cv.pdf", db_path=db,
    )
    recipe = flow._recipe("ashby")
    assert recipe._answer_for("Which work model can you accept?", "x") == (True, "Remote")


# ── found on the box with patch 03 ───────────────────────────────────────────

NOTIFY = ROOT / "agents" / "_tools" / "jht-notify-user"
SKILL = ROOT / "shared" / "skills" / "application_answers.py"


def test_the_essentials_check_writes_nothing_and_only_ask_creates_questions(db, tmp_path):
    import subprocess

    profile = tmp_path / "profile.yml"
    profile.write_text("name: Test Candidate\n", encoding="utf-8")
    before = db.read_bytes()
    env = {**__import__("os").environ, "JHT_DB": str(db), "JHT_HOME": str(tmp_path),
           "JHT_NOTIFY_USER_BIN": str(tmp_path / "no-notifier")}
    for _ in range(2):
        done = subprocess.run(
            [sys.executable, str(SKILL), "essentials", "--position-id", "7", "--json", "--db", str(db),
             "--profile", str(profile)],
            capture_output=True, text=True, env=env,
        )
        out = json.loads(done.stdout)
        assert (done.returncode, out["status"]) == (3, "missing"), done.stdout + done.stderr
        assert len(out["missing"]) == 7
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages") == [(0,)]
    assert db.read_bytes() == before

    asked = []
    with sqlite3.connect(db) as conn:
        aa.ensure_essentials(conn, {"name": "Test Candidate"}, 7, notifier=lambda **kw: asked.append(kw) or "1")
    assert len(asked) == 7


def _off_hours_box(tmp_path, db):
    """A working-hours window that never contains now, and a Telegram stub."""
    import os

    (tmp_path / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {
        "timezone": "UTC", "windows": [{"start": "00:00", "end": "00:01", "days": []}],
    }}}))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    sent = tmp_path / "telegram-sent.txt"
    stub = bin_dir / "jht-telegram-send"
    stub.write_text(f'#!/bin/sh\necho sent >> "{sent}"\nexit 0\n', encoding="utf-8")
    stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}", "JHT_HOME": str(tmp_path),
           "JHT_DB": str(db), "JHT_NOTIFY_USER_BIN": str(NOTIFY)}
    env.pop("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY", None)
    return env, sent


def test_off_hours_a_closer_question_still_reaches_telegram(db, tmp_path, monkeypatch):
    import subprocess

    env, sent = _off_hours_box(tmp_path, db)
    # Control: an ordinary notification IS held off hours, so the window works.
    plain = subprocess.run([str(NOTIFY), "--agent", "closer", "held for working hours"],
                           capture_output=True, text=True, env=env)
    assert plain.returncode == 0 and "via=web" in plain.stdout
    assert not sent.exists()

    for key, value in env.items():
        monkeypatch.setenv(key, value)
    with sqlite3.connect(db) as conn:
        out = aa.ensure_essentials(conn, {"name": "Test Candidate"}, 7)
    assert len(out["asked"]) == 7
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages WHERE source_id LIKE 'closer-essential:%' "
                   "AND delivered_via = 'telegram'") == [(7,)]
    assert sent.read_text().count("sent") == 7


def test_off_hours_a_form_answer_request_still_reaches_telegram(db, tmp_path):
    import subprocess

    env, sent = _off_hours_box(tmp_path, db)
    payload = {"version": 1, "position_id": 7, "key": "notice period", "label": "Notice period?",
               "field_type": "text", "options": []}
    done = subprocess.run(
        [str(NOTIFY), "--agent", "closer", "--kind", "question", "--position-id", "7",
         "--source-id", "closer-answer:7:fixture", "--source-action", aa.SOURCE_ACTION,
         "--source-payload", json.dumps(payload), "Question: Notice period?"],
        capture_output=True, text=True, env=env,
    )
    assert done.returncode == 0 and "via=telegram" in done.stdout, done.stdout + done.stderr
    assert sent.exists()


# ── waking the CLOSER after the answers (seen live on 14/09) ─────────────────


def _ready_box(db, tmp_path, monkeypatch):
    """Consent on, CVs on disk: the real queue can say `queue_ready`."""
    (tmp_path / "jht.config.json").write_text(json.dumps(
        {"applications": {"auto_apply": {"enabled": True, "mode": "authorised", "max_per_day": 5}}}
    ))
    (tmp_path / "profile").mkdir(exist_ok=True)
    (tmp_path / "profile" / "candidate_profile.yml").write_text("name: Test Candidate\n", encoding="utf-8")
    with sqlite3.connect(db) as conn:
        for pid in (7, 8):
            cv = tmp_path / f"cv-{pid}.pdf"
            cv.write_bytes(b"%PDF-1.4 fixture")
            conn.execute("INSERT INTO applications (position_id, cv_pdf_path) VALUES (?, ?)", (pid, str(cv)))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(db))
    monkeypatch.setattr(apply_gate, "_jht_home", lambda: tmp_path, raising=False)


def _answer(db, qid, reply):
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE pending_user_messages SET user_reply = ?, user_reply_at = '2026-09-14' WHERE id = ?",
                     (reply, qid))


def _wake(db, profile=None, sessions=("CLOSER-1",), ready=(7, 8)):
    sent = []
    with sqlite3.connect(db) as conn:
        woken = aa.wake_closer(
            conn, profile or FULL_PROFILE,
            sessions=lambda: list(sessions),
            sender=lambda session, text: sent.append((session, text)) or True,
            queue=lambda _c: {"ready": bool(ready), "positions": [{"position_id": p} for p in ready]},
        )
    return woken, sent


def test_the_last_answer_wakes_the_closer_once_and_an_intermediate_one_does_not(db):
    first, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    second, _, _ = ask(db, 7, "start date", "Start date?", field_type="text", options=())
    _answer(db, first, "one month")
    assert _wake(db) == ([], [])

    _answer(db, second, "in May")
    woken, sent = _wake(db)
    assert [w.reason for w in woken] == ["answers_complete"]
    assert len(sent) == 1 and sent[0][0] == "CLOSER-1"
    assert sent[0][1].startswith("[BRIDGE INFO]") and "#7" in sent[0][1] and "@" not in sent[0][1]
    # Checked again (next poll, a second bridge, a replay): nothing more.
    assert _wake(db) == ([], [])


def test_answers_arriving_together_make_a_single_wake(db):
    ids = [ask(db, 7, f"q{i}", f"Q{i}?", field_type="text", options=())[0] for i in range(3)]
    for qid in ids:
        _answer(db, qid, "fixture")
    woken, sent = _wake(db)
    assert len(woken) == 1 and len(sent) == 1


def test_completed_essentials_wake_the_closer(db):
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', 'q', 'question', 7, 'closer-essential:notice_period', ?, ?, 'telegram')",
            (aa.SOURCE_ACTION, json.dumps({"version": 1, "position_id": 7, "key": "notice period",
                                           "label": "Notice?", "field_type": "text", "options": []})),
        )
        qid = conn.execute("SELECT MAX(id) FROM pending_user_messages").fetchone()[0]
    profile = {k: v for k, v in FULL_PROFILE.items() if k != "notice_period"}
    assert _wake(db, profile) == ([], [])  # still open: nothing to wake for

    _answer(db, qid, "two months")
    woken, sent = _wake(db, profile)
    assert [w.reason for w in woken] == ["essentials_complete"] and len(sent) == 1
    assert _wake(db, profile) == ([], [])


def test_without_a_live_closer_nothing_is_sent_and_the_queue_shows_the_position(db, tmp_path, monkeypatch):
    _ready_box(db, tmp_path, monkeypatch)
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', 'q', 'question', 7, 'closer-essential:notice_period', ?, ?, 'telegram')",
            (aa.SOURCE_ACTION, json.dumps({"version": 1, "position_id": 7, "key": "notice period",
                                           "label": "Notice?", "field_type": "text", "options": []})),
        )
        qid = conn.execute("SELECT MAX(id) FROM pending_user_messages").fetchone()[0]
    profile_yaml = "\n".join(
        ["name: Test Candidate", "availability: in one month", "work_authorization: EU", "sponsorship: false",
         "salary_expectations: 50000 EUR", "relocation: true", "contacts:", "  phone: '+1 555 0100'"]
    )
    (tmp_path / "profile" / "candidate_profile.yml").write_text(profile_yaml, encoding="utf-8")

    # Waiting for the answer: held, so neither the CLOSER nor the Capitano loops on it.
    waiting = apply_gate.application_queue(db_path=str(db), jht_home=tmp_path)
    assert not waiting["ready"]
    assert {h["reason"] for h in waiting["held"]} == {"essential_answers_pending"}

    _answer(db, qid, "two months")
    ready = apply_gate.application_queue(db_path=str(db), jht_home=tmp_path)
    assert ready["ready"] and {p["position_id"] for p in ready["positions"]} == {7, 8}

    woken, sent = _wake(db, {**FULL_PROFILE}, sessions=())
    assert (woken, sent) == ([], [])
    assert row(db, "SELECT wake_key, delivered FROM closer_wakes") == [(f"essentials:{qid}", 0)]


def test_a_position_that_is_not_ready_is_not_announced(db):
    qid, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    _answer(db, qid, "one month")
    assert _wake(db, ready=(8,)) == ([], [])


def test_a_telegram_answer_wakes_the_closer_through_the_bridge(db, bridge, tmp_path, monkeypatch):
    _ready_box(db, tmp_path, monkeypatch)
    sent = []
    monkeypatch.setattr(aa, "_closer_sessions", lambda: ["CLOSER-1"])
    monkeypatch.setattr(aa, "_tmux_send", lambda session, text: sent.append((session, text)) or True)
    mod = bridge()
    monkeypatch.setattr(mod, "application_answers", aa)
    qid, body, _ = ask(db, 7, "which work model can you accept", "Which work model can you accept?")
    (tmp_path / "profile" / "candidate_profile.yml").write_text(
        "name: Test Candidate\navailability: now\nnotice_period: none\nwork_authorization: EU\n"
        "sponsorship: false\nsalary_expectations: 50000 EUR\nrelocation: true\ncontacts:\n  phone: '+1 555 0100'\n",
        encoding="utf-8",
    )
    telegram(mod, db, 20, "Hybrid", reply_to=body)
    assert [s[0] for s in sent] == ["CLOSER-1"]
    # The main loop checks again on every poll: no second wake.
    mod.wake_closer_after_answers(db)
    telegram(mod, db, 21, "Hybrid", reply_to=body)
    assert len(sent) == 1


def _essential_question(db, key):
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', 'q', 'question', 7, ?, ?, ?, 'telegram')",
            (f"closer-essential:{key}", aa.SOURCE_ACTION,
             json.dumps({"version": 1, "position_id": 7, "key": key.replace("_", " "),
                         "label": key, "field_type": "text", "options": []})),
        )
        return conn.execute("SELECT MAX(id) FROM pending_user_messages").fetchone()[0]


def test_one_essential_answered_out_of_two_does_not_wake(db):
    notice = _essential_question(db, "notice_period")
    _essential_question(db, "relocation")
    _answer(db, notice, "two months")
    profile = {k: v for k, v in FULL_PROFILE.items() if k not in ("notice_period", "relocation")}
    assert _wake(db, profile) == ([], [])


def test_a_later_question_answered_later_wakes_again(db):
    first, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    _answer(db, first, "one month")
    assert len(_wake(db)[1]) == 1
    second, _, _ = ask(db, 7, "start date", "Start date?", field_type="text", options=())
    assert _wake(db) == ([], [])
    _answer(db, second, "in May")
    assert len(_wake(db)[1]) == 1


def test_a_woken_key_is_no_longer_pending(db):
    qid, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    _answer(db, qid, "one month")
    assert len(_wake(db)[1]) == 1
    with sqlite3.connect(db) as conn:
        assert aa.pending_wakes(conn, FULL_PROFILE) == []


def test_two_bridges_checking_together_send_one_wake(db):
    qid, _, _ = ask(db, 7, "notice period", "Notice period?", field_type="text", options=())
    _answer(db, qid, "one month")
    sent = []

    def other_bridge_claims_first(conn):
        # The other bridge read the same pending wake and claimed it meanwhile.
        with sqlite3.connect(db) as other:
            for wake in aa.pending_wakes(other, FULL_PROFILE):
                other.execute("INSERT INTO closer_wakes (wake_key, position_id) VALUES (?, ?)",
                              (wake.key, wake.position_id))
        return {"ready": True, "positions": [{"position_id": 7}]}

    with sqlite3.connect(db) as conn:
        woken = aa.wake_closer(conn, FULL_PROFILE, sessions=lambda: ["CLOSER-1"],
                               sender=lambda s, t: sent.append(s) or True, queue=other_bridge_claims_first)
    assert (woken, sent) == ([], [])


# ── cross-review decisions (N1 · M4 in apply_flow) ───────────────────────────


def test_a_dry_run_never_asks_the_user_for_essentials(db, tmp_path, monkeypatch, caplog):
    import apply_flow

    asked = []
    flow = apply_flow.ApplicationFlow(
        position_id=7, url="https://jobs.ashbyhq.com/fixture/1", profile={"name": "Test Candidate"},
        cv_path=tmp_path / "cv.pdf", checkpoint_path=tmp_path / "checkpoint.json", db_path=db,
        gate_checker=lambda **_: type("V", (), {"allowed": True, "context": {"mode": "dry_run"}})(),
        essentials_checker=lambda **kw: asked.append(kw) or ["phone"],
        notifier=lambda **kw: asked.append(kw) or "1",
    )

    class Opened(Exception):
        pass

    monkeypatch.setattr(flow, "_managed_page", lambda: (_ for _ in ()).throw(Opened()))
    before = row(db, "SELECT COUNT(*) FROM pending_user_messages")
    with pytest.raises(Opened):
        flow.run()  # the diagnostic run goes on to the page
    assert asked == []
    assert row(db, "SELECT COUNT(*) FROM pending_user_messages") == before
    assert "7 essential facts unknown, not asked" in caplog.text


def test_the_cross_review_dry_run_case(tmp_path):
    from apply_flow import ApplicationFlow

    class V:
        allowed = True
        reason = "ok"
        context = {"mode": "dry_run"}

    asked = []
    flow = ApplicationFlow(
        essentials_checker=lambda **kw: asked.append(kw) or ["phone"],
        position_id=41, url="https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000000",
        profile={"name": "Fixture"}, cv_path=tmp_path / "cv.pdf",
        checkpoint_path=tmp_path / "checkpoint.json", receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_: V(), notifier=lambda **_: "n", applied_recorder=lambda **_: None,
    )
    flow.run(page=object(), navigate=False)
    assert asked == []


def test_a_textarea_answer_from_the_dashboard_is_asked_again_for_another_company(db, tmp_path):
    import apply_flow

    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET company = 'Other Fixture Ltd' WHERE id = 8")
    flow_a = apply_flow.ApplicationFlow(
        position_id=7, url="https://jobs.ashbyhq.com/fixture/1", profile={"name": "Test Candidate"},
        cv_path=tmp_path / "cv.pdf", db_path=db,
    )
    request = {"payload": {"label": "Why do you want to join us?", "field_type": "textarea", "options": []}}
    flow_a._save_application_answer("why do you want to join us", request, "Fixture motivation")
    flow_a._save_application_answer("years of python", {"payload": {"label": "Years of Python?", "field_type": "number", "options": []}}, "6")
    flow_b = apply_flow.ApplicationFlow(
        position_id=8, url="https://jobs.ashbyhq.com/fixture/2", profile={"name": "Test Candidate"},
        cv_path=tmp_path / "cv.pdf", db_path=db,
    )
    assert flow_a._recipe("ashby")._answer_for("Why do you want to join us?", "x") == (True, "Fixture motivation")
    assert flow_b._recipe("ashby")._answer_for("Why do you want to join us?", "x") == (False, None)
    assert flow_b._recipe("ashby")._answer_for("Years of Python?", "x") == (True, "6")


def test_a_harvested_dashboard_motivation_is_kept_per_company(db):
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET company = 'Other Fixture Ltd' WHERE id = 8")
    qid, _, _ = ask(db, 7, "why do you want to join us", "Why do you want to join us?", "textarea", (), via="web")
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE pending_user_messages SET user_reply = 'Fixture motivation', user_reply_at = '2026-09-14' WHERE id = ?", (qid,))
        assert aa.harvest_replies(conn) == 1
        assert aa.harvest_replies(conn) == 0
        assert "why do you want to join us" in aa.load_answers(conn, 7)
        assert "why do you want to join us" not in aa.load_answers(conn, 8)


def test_an_essential_textarea_stays_global(db):
    with sqlite3.connect(db) as c:
        c.execute("UPDATE positions SET company = 'Other Fixture Ltd' WHERE id = 8")
    qid = _essential_question(db, "work_authorization")
    with sqlite3.connect(db) as conn:
        conn.execute("UPDATE pending_user_messages SET source_payload = ?, user_reply = 'EU', user_reply_at = '2026-09-14' WHERE id = ?",
                     (json.dumps({"version": 1, "position_id": 7, "key": "work authorization", "label": "Work?",
                                  "field_type": "textarea", "options": []}), qid))
        aa.harvest_replies(conn)
        assert aa.load_answers(conn, 8)["work authorization"] == "EU"
