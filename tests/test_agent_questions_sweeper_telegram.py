"""Structured questions, second cut (JHT-T07): the sweeper, Telegram, the numeric label.

What is proved here:

- the sweeper applies the deadlines in the loop that always runs (the throttle engine), and does it
  the way the reader does: what the user typed in time first, THEN the deadlines; the user is told once;
- on the bot the launcher really starts (`.launcher/tg-bridge.py`): a typed `2`, `Q#### 2` or the exact
  label goes to the question and is NOT a chat turn; anything else stays chat; a button press is recorded
  once; the buttons leave through `jht-notify-user` -> `jht-telegram-send --inline-buttons`;
- an option label made only of digits is refused when the question is built.

No network: a bot API stub, and `curl` replaced by a recorder. No prompt and no skill of any role is touched.

Run with: pytest tests/test_agent_questions_sweeper_telegram.py -v
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

NONCE_KEY = "JHT_EXTERNAL_CONTENT_NONCE"
TEST_NONCE = "t07btest"

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
NOTIFY = ROOT / "agents" / "_tools" / "jht-notify-user"
CHECK = ROOT / "agents" / "_tools" / "jht-check-user-replies"
SENDER = ROOT / "agents" / "_tools" / "jht-telegram-send"
BRIDGE_PATH = ROOT / ".launcher" / "tg-bridge.py"

# Imported under a nonce of this file's own and put back as found: other test files fix THEIRS.
_saved_nonce = os.environ.get(NONCE_KEY)
_MODULES = ("external_content", "agent_questions", "application_answers", "i18n")
_saved_modules = {name: sys.modules.pop(name, None) for name in _MODULES}
os.environ[NONCE_KEY] = TEST_NONCE
sys.path.insert(0, str(SKILLS))
try:
    import agent_questions as aq  # noqa: E402
    import external_content as ec  # noqa: E402
finally:
    if _saved_nonce is None:
        os.environ.pop(NONCE_KEY, None)
    else:
        os.environ[NONCE_KEY] = _saved_nonce
    for name, module in _saved_modules.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
assert ec.NONCE == TEST_NONCE

SEP = "\x1e"
T0 = datetime(2026, 10, 18, 10, 0, 0, tzinfo=timezone.utc)
OPTIONS = [
    {"id": "breve", "label": "CV breve"},
    {"id": "lungo", "label": "CV completo"},
    {"id": "nessuno", "label": "Nessuno dei due"},
]


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _keep_modules():
    """The bridge, the engine and the tools import these by name: whatever they leave is taken away."""
    before = {name: sys.modules.get(name) for name in _MODULES}
    yield
    for name, module in before.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


@pytest.fixture()
def world(tmp_path, monkeypatch):
    """A real jobs.db, a Telegram sender that records, and the PATH the tools run with."""
    home = tmp_path / "home"
    home.mkdir()
    db_path = home / "jobs.db"
    seed = subprocess.run(
        [sys.executable, "-c", "from _db import get_db, ensure_schema; c=get_db(); ensure_schema(c); c.commit(); c.close()"],
        cwd=SKILLS,
        env={**os.environ, "JHT_DB": str(db_path), "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sent = tmp_path / "telegram-args.txt"
    stub = bin_dir / "jht-telegram-send"
    stub.write_text(
        f'#!/bin/sh\nfor a in "$@"; do printf "%s{SEP}" "$a" >> "{sent}"; done\nprintf "\\035" >> "{sent}"\nexit 0\n',
        encoding="utf-8",
    )
    stub.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
        "HOME": str(home),
        "JHT_HOME": str(home),
        "JHT_DB": str(db_path),
        "JHT_LANG": "it",
        "JHT_EXTERNAL_CONTENT_NONCE": TEST_NONCE,
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return type("World", (), {"db": db_path, "sent": sent, "env": env, "home": home})


@pytest.fixture()
def conn(world):
    connection = sqlite3.connect(world.db, timeout=10)
    yield connection
    connection.close()


def telegram_calls(world):
    if not world.sent.exists():
        return []
    return [record.split(SEP)[:-1] for record in world.sent.read_text().split("\x1d")[:-1]]


def put(world, **overrides):
    """A question row as the tool writes it; `now` is in the past so a deadline can be over."""
    base = dict(agent="assistente", testo="Quale versione del CV uso?", oggetto="CV per Acme", opzioni=OPTIONS, now=T0, nonce="n1", lang="it")
    base.update(overrides)
    question = aq.build_question(**base)
    with sqlite3.connect(world.db) as connection:
        connection.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (question.agent, question.body, question.kind, question.source_id, aq.SOURCE_ACTION, question.payload_json),
        )
    return question


def rows(world, query, args=()):
    with sqlite3.connect(world.db) as connection:
        return connection.execute(query, args).fetchall()


def stored_answers(world):
    return [
        json.loads(payload)
        for (payload,) in rows(
            world, "SELECT source_payload FROM pending_user_messages WHERE source_action = ? ORDER BY id", (aq.ANSWER_ACTION,)
        )
    ]


# ── 1. The sweeper ───────────────────────────────────────────────────────────


def test_what_the_user_typed_in_time_beats_the_deadline_the_sweeper_applies_late(world, conn):
    question = put(world, scade_tra="1h")
    # Typed at 10:30, a deadline at 11:00, and nobody looked until the sweeper at 12:00.
    conn.execute(
        "UPDATE pending_user_messages SET user_reply = '2', user_reply_at = '2026-10-18 10:30:00' WHERE source_id = ?",
        (question.source_id,),
    )
    conn.commit()
    events = aq.sweep(conn, now=T0 + timedelta(hours=2))
    answers = stored_answers(world)
    assert [(a["scelte"], a["origine"]) for a in answers] == [(["lungo"], "utente")]
    assert events == []  # the user answered: nothing expired, nothing to tell
    # Not marked as seen: the agent's own reader still reports an invalid reply to the agent.
    assert rows(world, "SELECT agent_seen_reply_at FROM pending_user_messages WHERE source_id = ?", (question.source_id,)) == [(None,)]


def test_an_unanswered_deadline_gets_its_default_and_one_notice_whoever_looks_first(world, conn):
    question = put(world, scade_tra="1h")
    late = T0 + timedelta(hours=2)
    first = aq.sweep(conn, now=late)
    assert [(e.id_domanda, e.agent) for e in first] == [(question.source_id, "assistente")]
    assert [(a["scelte"], a["origine"]) for a in stored_answers(world)] == [(["_rinvia"], "scadenza")]
    # Again, from the sweeper or from the reader: the answer exists, nobody tells the user twice.
    assert aq.sweep(conn, now=late) == []
    assert aq.expire_due(conn, late) == []
    assert rows(world, "SELECT COUNT(*) FROM pending_user_messages WHERE source_action = ?", (aq.EXPIRED_ACTION,)) == [(1,)]


def test_the_notice_leaves_through_jht_notify_user_with_the_existing_row(world, conn):
    put(world, scade_tra="1h")
    (event,) = aq.sweep(conn, now=T0 + timedelta(hours=2))
    calls = []
    sent = aq.deliver_expired([event], tool="notify-stub", runner=lambda cmd, **_: calls.append(cmd))
    assert sent == 1
    (cmd,) = calls
    assert cmd[0] == "notify-stub"
    assert cmd[cmd.index("--existing-id") + 1] == str(event.notice_row_id)
    assert cmd[cmd.index("--source-action") + 1] == aq.EXPIRED_ACTION
    assert cmd[-1] == event.body


def _engine():
    spec = importlib.util.spec_from_file_location("throttle_engine_under_test", SKILLS / "throttle_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_throttle_engine_sweeps_without_an_agent_and_the_reader_adds_nothing(world):
    put(world, agent="mentor", scade_tra="1h")
    engine = _engine()
    told = []
    assert engine.sweep_questions(db_path=world.db, deliver=told.extend) == 1
    assert [e.agent for e in told] == ["mentor"]
    assert engine.sweep_questions(db_path=world.db, deliver=told.extend) == 0  # once
    # The agent looks afterwards: it finds the default, already closed, and nothing more goes to Telegram.
    done = subprocess.run([str(CHECK), "--agent", "mentor"], capture_output=True, text=True, env=world.env)
    assert done.returncode == 0, done.stderr
    assert "origine=scadenza" in done.stdout
    assert telegram_calls(world) == []


def test_the_engine_sweeps_on_a_cadence_and_a_failure_never_leaves_it(world, monkeypatch):
    engine = _engine()
    runs = []
    monkeypatch.setattr(engine, "sweep_questions", lambda: runs.append(1) or 0)
    engine.maybe_sweep_questions(now=1000)
    engine.maybe_sweep_questions(now=1010)
    engine.maybe_sweep_questions(now=1000 + engine.QUESTION_SWEEP_SEC + 1)
    assert len(runs) == 2

    def broken():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(engine, "sweep_questions", broken)
    assert engine.maybe_sweep_questions(now=5000) == 0  # logged, not raised


def test_a_database_without_questions_is_left_alone(tmp_path):
    engine = _engine()
    assert engine.sweep_questions(db_path=tmp_path / "missing.db") == 0
    bare = tmp_path / "bare.db"
    with sqlite3.connect(bare) as connection:
        connection.execute("CREATE TABLE pending_user_messages (id INTEGER PRIMARY KEY, agent TEXT, body TEXT)")
    assert engine.sweep_questions(db_path=bare) == 0


# ── 3. A label of digits only ────────────────────────────────────────────────


@pytest.mark.parametrize("label", ["2", "10", " 3 ", "٣"])
def test_a_label_made_only_of_digits_is_refused(label):
    options = [{"id": "uno", "label": label}, {"id": "due", "label": "Altro"}]
    with pytest.raises(aq.QuestionRejected) as error:
        aq.build_question(agent="assistente", testo="Quanti?", oggetto="Numero", opzioni=options, now=T0, nonce="n1", lang="it")
    assert error.value.code == "option_label_numeric"


def test_a_stored_question_with_such_a_label_is_not_believed_either(world):
    question = put(world)
    payload = json.loads(question.payload_json)
    payload["opzioni"][0]["label"] = "2"
    with pytest.raises(aq.QuestionRejected) as error:
        aq.validate_question_payload(payload)
    assert error.value.code == "option_label_numeric"


@pytest.mark.parametrize("label", ["Sì", "2 mesi", "Q2", "Opzione 2", "Dopo le 10"])
def test_a_label_with_digits_and_words_is_fine(label):
    options = [{"id": "uno", "label": label}, {"id": "due", "label": "Altro"}]
    assert aq.build_question(agent="assistente", testo="Quando?", oggetto="Data", opzioni=options, now=T0, nonce="n1", lang="it")


# ── 2. Telegram: the bridge the launcher starts ──────────────────────────────


def test_the_launcher_starts_tg_bridge_py_unless_the_isolated_service_has_the_cutover():
    """Which bridge runs: this is the file:line the choice rests on (read, not assumed)."""
    start = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    assert 'TG_SCRIPT="$DEV_TEAM_DIR/tg-bridge.py"' in start
    assert "/run/jht-telegram/cutover" in start[: start.index('TG_SCRIPT="$DEV_TEAM_DIR/tg-bridge.py"')]
    assert "shared.telegram_service.relay" in (ROOT / "cli" / "src" / "commands" / "pid1.js").read_text(encoding="utf-8")


def load_bridge(monkeypatch, world, role="capitano"):
    monkeypatch.setenv("JHT_TG_BOT_ROLE", role)
    monkeypatch.setenv("JHT_HOME", str(world.home))
    monkeypatch.delenv("JHT_TG_OFFSET_RESET", raising=False)
    monkeypatch.delenv("JHT_TG_TARGET_SESSION", raising=False)
    spec = importlib.util.spec_from_file_location("tg_bridge_t07b", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def bridge(monkeypatch, world):
    return load_bridge(monkeypatch, world)


def say(bridge, world, uid, text, quoting=None):
    """The user types `text` to the bot: journal, then the flush that writes the row and resolves."""
    message = {"chat": {"id": 999}, "date": 1_790_000_000 + uid, "text": text}
    if quoting is not None:
        message["reply_to_message"] = {"text": quoting}
    assert bridge.enqueue_inbound_turn(uid, message, text)
    assert bridge.flush_inbound_queue(world.db) == 1
    return rows(world, "SELECT body, delivered_at FROM pending_user_messages WHERE source_id = ?", (f"telegram:{bridge.BOT_ROLE}:{uid}",))[0]


def test_a_typed_number_answers_the_only_open_question_and_is_not_a_chat_turn(bridge, world):
    question = put(world, agent="capitano")
    body, delivered_at = say(bridge, world, 1, "2")
    assert body == "2"
    assert delivered_at is not None  # in the history, but never handed to the pane as [CHAT]
    (answer,) = stored_answers(world)
    assert (answer["id_domanda"], answer["scelte"], answer["origine"], answer["canale"]) == (
        question.source_id, ["lungo"], "utente", "telegram",
    )
    (call,) = telegram_calls(world)
    assert call[:2] == ["--from", "capitano"] and "Risposta salvata" in call[2] and "CV completo" in call[2]


def test_the_code_names_the_question_among_several_and_the_label_works_too(bridge, world):
    first = put(world, agent="capitano", nonce="n1")
    second = put(world, agent="capitano", nonce="n2", testo="E il tono della lettera?")
    code = aq.answer_code(second.source_id)
    assert say(bridge, world, 1, "  cv BREVE ")[1] is None  # two are open: the label alone does not say which, so it is chat
    assert say(bridge, world, 2, f"{code.lower()} 3")[1] is not None
    (answer,) = stored_answers(world)
    assert (answer["id_domanda"], answer["scelte"]) == (second.source_id, ["nessuno"])
    assert say(bridge, world, 3, "cv breve")[1] is not None  # now only `first` is open, and the label is exact
    assert [(a["id_domanda"], a["scelte"]) for a in stored_answers(world)] == [
        (second.source_id, ["nessuno"]), (first.source_id, ["breve"]),
    ]


def test_a_reply_that_quotes_the_question_goes_to_it(bridge, world):
    put(world, agent="capitano", nonce="n1")
    second = put(world, agent="capitano", nonce="n2", testo="E il tono della lettera?")
    body = rows(world, "SELECT body FROM pending_user_messages WHERE source_id = ?", (second.source_id,))[0][0]
    assert say(bridge, world, 1, "3", quoting=body)[1] is not None
    assert [(a["id_domanda"], a["scelte"]) for a in stored_answers(world)] == [(second.source_id, ["nessuno"])]


@pytest.mark.parametrize("text", ["grazie, ci penso", "ok", "4 giorni", "Q9999 2", "Q0000"])
def test_anything_else_stays_chat_as_today(bridge, world, text):
    put(world, agent="capitano")
    body, delivered_at = say(bridge, world, 1, text)
    assert delivered_at is None  # still waiting for the pane delivery, a [CHAT] turn
    assert stored_answers(world) == [] and telegram_calls(world) == []


def test_the_code_with_a_number_the_question_does_not_have_is_told_and_the_question_stays_open(bridge, world):
    question = put(world, agent="capitano")
    code = aq.answer_code(question.source_id)
    body, delivered_at = say(bridge, world, 1, f"{code} 9")
    assert delivered_at is not None  # a written code is an answer attempt, not a chat message
    assert stored_answers(world) == []
    (call,) = telegram_calls(world)
    assert "Non è una delle opzioni" in call[2] and code in call[2]


def test_a_question_of_another_bot_is_not_answered_here(bridge, world):
    put(world, agent="mentor")
    assert say(bridge, world, 1, "2")[1] is None
    assert stored_answers(world) == []


def test_an_agent_without_a_bot_of_its_own_asks_on_the_assistant_bot_and_the_tool_agrees(monkeypatch, world):
    spec = importlib.util.spec_from_loader("notify_tool_t07b", importlib.machinery.SourceFileLoader("notify_tool_t07b", str(NOTIFY)))
    notify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(notify)
    for agent in ("scout", "analista", "capitano", "mentor", "assistente", "CAPITANO", ""):
        assert aq.bot_role_for(agent) == notify.bot_role_for(agent), agent
    bridge = load_bridge(monkeypatch, world, role="assistente")
    put(world, agent="scout")
    assert say(bridge, world, 1, "1")[1] is not None
    assert stored_answers(world)[0]["scelte"] == ["breve"]


def callback(question, number, *, chat=999, message_id=77, callback_id="cb1"):
    code = aq.answer_code(question.source_id)[1:].lower()
    return {"id": callback_id, "data": f"jhtq:{code}:{number}", "message": {"message_id": message_id, "chat": {"id": chat}}}


@pytest.fixture()
def bot_calls(bridge, monkeypatch):
    calls = []
    monkeypatch.setattr(bridge, "_bot_api", lambda token, method, payload: calls.append((method, payload)))
    return calls


def test_a_button_press_records_the_answer_once_and_removes_the_buttons(bridge, world, bot_calls):
    question = put(world, agent="capitano")
    bridge.handle_callback("tok", 999, callback(question, 2))
    (answer,) = stored_answers(world)
    assert (answer["scelte"], answer["canale"], answer["origine"]) == (["lungo"], "telegram", "utente")
    assert [method for method, _ in bot_calls] == ["answerCallbackQuery", "editMessageReplyMarkup"]
    assert "CV completo" in bot_calls[0][1]["text"]
    assert bot_calls[1][1]["reply_markup"] == {"inline_keyboard": []} and bot_calls[1][1]["message_id"] == 77
    # A second tap, on another button: the first answer stands, and the user is told so.
    bot_calls.clear()
    bridge.handle_callback("tok", 999, callback(question, 1, callback_id="cb2"))
    assert [a["scelte"] for a in stored_answers(world)] == [["lungo"]]
    assert "Questa domanda ha già una risposta" in bot_calls[0][1]["text"]
    # No chat turn was written for any of it.
    assert rows(world, "SELECT COUNT(*) FROM pending_user_messages WHERE author = 'user' AND source_action IS NULL") == [(0,)]


def test_a_button_from_another_chat_or_with_data_that_is_not_ours_does_nothing(bridge, world, bot_calls):
    question = put(world, agent="capitano")
    bridge.handle_callback("tok", 999, callback(question, 2, chat=12345))
    assert bot_calls == []
    for data in ("jhtq:ffff:1", "jhtq:zzzz:1", "other", None, "jhtq:" + aq.answer_code(question.source_id)[1:].lower() + ":99"):
        bot_calls.clear()
        cb = callback(question, 1)
        cb["data"] = data
        bridge.handle_callback("tok", 999, cb)
        assert [m for m, _ in bot_calls] == ["answerCallbackQuery"], data
    assert stored_answers(world) == []


def test_dispatch_routes_a_callback_query_and_getupdates_asks_for_it(bridge, world, bot_calls, monkeypatch):
    question = put(world, agent="capitano")
    bridge.dispatch_update("tok", 999, {"update_id": 5, "callback_query": callback(question, 3)})
    assert [a["scelte"] for a in stored_answers(world)] == [["nessuno"]]
    # The list is asked EVERY time: Telegram remembers the last one, and the isolated service leaves messages only.
    urls = []

    class Resp:
        def read(self):
            return b'{"result": []}'

    def fake_urlopen(url, timeout=None):
        urls.append(url)
        if len(urls) > 1:
            raise KeyboardInterrupt
        return Resp()

    monkeypatch.setattr(bridge, "read_config", lambda: ("tok", 999))
    monkeypatch.setattr(bridge, "load_offset", lambda: 0)
    monkeypatch.setattr(bridge, "setup_bot_commands", lambda token: None)
    monkeypatch.setattr(bridge.time, "sleep", lambda _s: None)
    monkeypatch.setattr(bridge.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(KeyboardInterrupt):
        bridge.main()
    import urllib.parse

    query = urllib.parse.parse_qs(urllib.parse.urlparse(urls[0]).query)
    assert json.loads(query["allowed_updates"][0]) == ["message", "edited_message", "callback_query"]


# ── The buttons leave with the question ──────────────────────────────────────


def notify(world, *argv):
    return subprocess.run([str(NOTIFY), *argv], capture_output=True, text=True, env=world.env)


THREE = ["--option", "breve=CV breve", "--option", "lungo=CV completo", "--option", "nessuno=Nessuno dei due"]


def test_a_single_choice_question_leaves_with_one_button_per_option(world):
    done = notify(world, "--agent", "capitano", "--oggetto", "CV", *THREE, "--scade-tra", "1h", "Quale CV?")
    assert done.returncode == 0, done.stderr
    qid = done.stdout.split("id=")[1].strip()
    (call,) = telegram_calls(world)
    assert call[:2] == ["--from", "capitano"] and call[2] == "--inline-buttons"
    keyboard = json.loads(call[3])["inline_keyboard"]
    code = aq.answer_code(qid)[1:].lower()
    assert [row[0]["callback_data"] for row in keyboard] == [f"jhtq:{code}:{n}" for n in (1, 2, 3, 4)]
    assert [row[0]["text"] for row in keyboard][:3] == ["CV breve", "CV completo", "Nessuno dei due"]
    assert len(keyboard) == 4  # the postpone option the expiry adds is a button too, last
    assert "1. CV breve" in call[4]  # the numbered text stays: it is what a text-only chat sees


def test_a_multiple_choice_or_a_plain_notification_leaves_without_buttons(world):
    assert notify(world, "--agent", "capitano", "--oggetto", "CV", *THREE, "--multipla", "Quali?").returncode == 0
    assert notify(world, "--agent", "capitano", "Un avviso qualunque").returncode == 0
    multi, plain = telegram_calls(world)
    assert "--inline-buttons" not in multi
    assert plain == ["--from", "capitano", "Un avviso qualunque"]  # byte-identical to before


@pytest.fixture()
def curl(tmp_path):
    bin_dir = tmp_path / "curlbin"
    bin_dir.mkdir()
    record = tmp_path / "curl-args.txt"
    stub = bin_dir / "curl"
    stub.write_text(
        "#!/bin/sh\n"
        f'for a in "$@"; do printf "%s\\036" "$a" >> "{record}"; done\n'
        'out=""\nwhile [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\n'
        '[ -n "$out" ] && printf \'{"ok":true,"result":{"message_id":1}}\' > "$out"\nprintf \'200\'\n',
        encoding="utf-8",
    )
    stub.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "JHT_HOME": str(tmp_path / "nohome"),
        "TELEGRAM_BOT_TOKEN": "1234567890:" + "B" * 35,
        "TELEGRAM_CHAT_ID": "42",
    }
    return type("Curl", (), {"record": record, "env": env})


def send(curl, *argv):
    return subprocess.run([str(SENDER), *argv], env=curl.env, capture_output=True, text=True)


GOOD = json.dumps({"inline_keyboard": [[{"text": "CV breve", "callback_data": "jhtq:ab12:1"}], [{"text": "CV completo", "callback_data": "jhtq:ab12:2"}]]})


def test_the_sender_attaches_the_buttons_as_the_reply_markup(curl):
    done = send(curl, "--inline-buttons", GOOD, "Quale CV?")
    assert done.returncode == 0, done.stderr
    args = curl.record.read_text(encoding="utf-8").split("\x1e")
    markup = [a[len("reply_markup="):] for a in args if a.startswith("reply_markup=")]
    assert [json.loads(m) for m in markup] == [json.loads(GOOD)]


@pytest.mark.parametrize(
    "bad",
    [
        "not json",
        json.dumps({"inline_keyboard": [[{"text": "x", "callback_data": "other:1"}]]}),
        json.dumps({"inline_keyboard": [[{"text": "x", "callback_data": "jhtq:ab12:1", "url": "https://example.org"}]]}),
        json.dumps({"inline_keyboard": [[{"text": "x" * 65, "callback_data": "jhtq:ab12:1"}]]}),
        json.dumps({"inline_keyboard": [], "extra": 1}),
    ],
)
def test_the_sender_refuses_buttons_that_are_not_the_questions_and_sends_nothing(curl, bad):
    done = send(curl, "--inline-buttons", bad, "Quale CV?")
    assert done.returncode == 1
    assert not curl.record.exists()


def test_a_secret_in_a_button_label_is_redacted_like_the_text(curl):
    leaked = "ghp_" + "A" * 24
    keyboard = json.dumps({"inline_keyboard": [[{"text": f"usa {leaked}", "callback_data": "jhtq:ab12:1"}]]})
    done = send(curl, "--inline-buttons", keyboard, "Quale?")
    assert done.returncode == 0, done.stderr
    assert leaked not in curl.record.read_text(encoding="utf-8")
