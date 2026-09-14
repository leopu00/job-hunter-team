"""CLOSER notices: the user's language, and one summary per round.

Origin. Position 1817 stopped with ats_unsupported and the user got an
English Telegram message on an Italian profile; six more LinkedIn positions
were about to send six more. This suite holds:

  1. a stop reads in the profile's language (i18n-prefs.json), names the
     position and says why and what to do; the technical reason stays at the end;
  2. every reason the CLOSER explains has its text in all seven catalogs, with
     the same placeholders as English;
  3. site stops are deferred: N stops in a round are ONE message, never
     repeated for the same authorisation, again after a new authorisation;
  4. a failed send keeps the stops and retries with the same source id; a
     stop older than FLUSH_AFTER flushes on the next defer;
  5. the question prose is localized, the parsed head is not touched here.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import closer_notices as notices  # noqa: E402
import i18n  # noqa: E402

LANGS = ("en", "it", "es", "fr", "de", "pt", "hu")


def _catalog(lang: str) -> dict:
    return json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    monkeypatch.delenv("JHT_LANG", raising=False)
    monkeypatch.setenv("JHT_HOST_ENV_FILE", str(tmp_path / "missing.env"))
    with sqlite3.connect(tmp_path / "jobs.db") as conn:
        conn.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, apply_requested_at TEXT)")
        conn.executemany(
            "INSERT INTO positions VALUES (?, ?, ?, ?)",
            [
                (1817, "Synthetic Data Engineer", "Example Corp", "2026-09-14T08:00:00Z"),
                (1845, "Synthetic ML Engineer", "Sample GmbH", "2026-09-14T08:00:00Z"),
                (1866, "Synthetic Analyst", None, "2026-09-14T08:00:00Z"),
            ],
        )
    i18n._resolve_lang.cache_clear()
    yield tmp_path
    i18n._resolve_lang.cache_clear()


def _set_lang(home: Path, lang: str) -> None:
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": lang}), encoding="utf-8")
    i18n._resolve_lang.cache_clear()


# ── 1. per-position stop in the user's language ─────────────────────────────


def test_stop_message_speaks_the_profile_language(home):
    _set_lang(home, "it")
    message = notices.stop_message("captcha", "Site requires human intervention (captcha)", 1817)
    assert message.startswith("Il CLOSER ha fermato la candidatura #1817 (Synthetic Data Engineer presso Example Corp)")
    assert "captcha" in message.splitlines()[1]
    assert "Candidati a mano" in message
    assert message.rstrip().endswith("(captcha: Site requires human intervention (captcha))")
    assert "blind retry" not in message


def test_stop_message_falls_back_to_english_and_to_the_default_reason(home):
    message = notices.stop_message("some_new_reason", "detail", 9999)
    assert message.startswith("CLOSER stopped the application #9999 ")
    assert notices.text("closer.reason.default.why") in message
    assert "(some_new_reason: detail)" in message


def test_position_without_company_or_database(home):
    _set_lang(home, "de")
    assert "#1866 (Synthetic Analyst)" in notices.stop_message("captcha", "", 1866)
    (home / "jobs.db").unlink()
    assert notices.stop_message("captcha", "", 1817).startswith("Der CLOSER hat die Bewerbung #1817 gestoppt")


def test_scraped_title_and_company_are_cleaned_of_bidi_controls(home):
    with sqlite3.connect(home / "jobs.db") as conn:
        conn.execute("UPDATE positions SET title = ?, company = ? WHERE id = 1817",
                     ("Data\u202e Engineer\u2066", "Example\u200b Corp"))
    message = notices.stop_message("captcha", "detail", 1817)
    assert not any(ch in message for ch in "\u202e\u2066\u200b")
    assert "#1817 (Data Engineer at Example Corp)" in message
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    summary = notices.summary_message(notices._read_state(notices._state_path())["pending"])
    assert "\u202e" not in summary


def test_email_stop_message_is_localized(home):
    _set_lang(home, "fr")
    message = notices.email_stop_message("cv_missing", "no cv", 1845)
    assert message.startswith("Le CLOSER a arrêté la candidature par email #1845")


# ── 2. catalogs ─────────────────────────────────────────────────────────────


def _closer_keys() -> list[str]:
    return [key for key in _catalog("en") if key.startswith("closer.")]


def test_every_known_reason_has_why_and_action_in_english():
    catalog = _catalog("en")
    for reason in notices.KNOWN_REASONS + ("default",):
        assert catalog.get(f"closer.reason.{reason}.why"), reason
        assert catalog.get(f"closer.reason.{reason}.action"), reason


SITE_REASONS = (
    "ats_unsupported", "ats_conflict", "linkedin_easy_apply", "application_form_embedded",
    "page_not_found", "bot_protection", "page_temporarily_unavailable",
    "generic_form_missing",  # 2071, 1798: the recipe's own reason, no longer wrapped as ats_unsupported
)


def test_site_and_page_stops_are_explained_and_a_retry_is_not_a_stop():
    # Every stop joins the summary now (the flow no longer filters); the site
    # and page stops keep their own words, a temporary failure is never a stop.
    assert set(SITE_REASONS) <= set(notices.KNOWN_REASONS)
    assert "retry_later" not in notices.KNOWN_REASONS
    assert not hasattr(notices, "DIGEST_REASONS")


@pytest.mark.parametrize("lang", LANGS)
def test_every_closer_string_exists_in_every_language_with_the_same_placeholders(lang):
    english, catalog = _catalog("en"), _catalog(lang)
    for key in _closer_keys():
        value = catalog.get(key)
        assert isinstance(value, str) and value.strip(), f"{lang}: {key} missing"
        assert set(re.findall(r"\{(\w+)\}", value)) == set(re.findall(r"\{(\w+)\}", english[key])), f"{lang}: {key}"
    if lang != "en":
        translated = [k for k in _closer_keys() if catalog[k] != english[k] and not k.startswith("closer.position.")]
        assert len(translated) >= len(_closer_keys()) - 6, f"{lang}: strings left in English"


# ── 3. the per-round summary ────────────────────────────────────────────────


class Recorder:
    def __init__(self, fail: bool = False):
        self.calls: list[dict] = []
        self.fail = fail

    def __call__(self, *, message: str, source_id: str, payload: dict):
        self.calls.append({"message": message, "source_id": source_id, "payload": payload})
        if self.fail:
            raise RuntimeError("telegram down")
        return "1"


def test_many_site_stops_become_one_message(home, monkeypatch):
    _set_lang(home, "it")
    sent = Recorder()
    monkeypatch.setattr(notices, "_default_notifier", sent)
    notices.defer(1817, "linkedin_easy_apply", "https://www.linkedin.com/jobs/view/1")
    notices.defer(1845, "ats_unsupported", "https://jobs.example.com/1")
    notices.defer(1866, "application_form_embedded", "https://careers.example.com/2")
    assert sent.calls == []
    assert notices.flush(sent)["status"] == "sent"
    assert len(sent.calls) == 1
    message = sent.calls[0]["message"]
    assert message.startswith("Giro del CLOSER: 3 candidature ferme")
    assert "#1817 (Synthetic Data Engineer presso Example Corp)" in message
    assert "candidatura semplificata di LinkedIn" in message
    assert message.count("\n- ") == 3
    assert notices.flush(sent)["status"] == "empty"


def test_the_same_stop_is_not_a_second_line_until_authorised_again(home):
    sent = Recorder()
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    notices.flush(sent)
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    assert notices.flush(sent)["status"] == "empty"
    with sqlite3.connect(home / "jobs.db") as conn:
        conn.execute("UPDATE positions SET apply_requested_at = '2026-09-15T08:00:00Z' WHERE id = 1817")
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    assert notices.flush(sent)["count"] == 1
    assert len(sent.calls) == 2


def test_a_position_is_one_line_the_latest_stop(home):
    # Patch 20 (14/09): 2071 and 1798 were listed twice, once per authorisation.
    sent = Recorder()
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    with sqlite3.connect(home / "jobs.db") as conn:
        conn.execute("UPDATE positions SET apply_requested_at = '2026-09-15T08:00:00Z' WHERE id = 1817")
    notices.defer(1817, "bot_protection", "https://a.example.com")
    notices.defer(1845, "ats_unsupported", "https://b.example.com")
    assert [e["position_id"] for e in notices._read_state(notices._state_path())["pending"]] == [1817, 1845]
    assert notices.flush(sent)["count"] == 2
    message = sent.calls[0]["message"]
    assert message.count("#1817") == 1
    assert notices.reason_why("bot_protection") in message
    assert notices.reason_why("ats_unsupported") in message  # 1845's line
    assert sent.calls[0]["payload"] == {"position_ids": [1817, 1845]}


def test_a_queue_written_before_the_dedupe_still_sends_one_line_per_position(home):
    sent = Recorder()
    state = home / ".cache" / "apply-flow" / "notices.json"
    state.parent.mkdir(parents=True)
    state.write_text(json.dumps({"version": 1, "sent": [], "pending": [
        {"key": "1817:ats_unsupported:a", "position_id": 1817, "reason": "ats_unsupported", "host": "", "at": "2026-09-14T10:00:00+00:00"},
        {"key": "1817:ats_unsupported:b", "position_id": 1817, "reason": "ats_unsupported", "host": "", "at": "2026-09-14T11:00:00+00:00"},
    ]}), encoding="utf-8")
    assert notices.flush(sent) == {"status": "sent", "count": 1, "source_id": sent.calls[0]["source_id"]}
    assert sent.calls[0]["message"].count("#1817") == 1
    saved = json.loads(state.read_text())
    assert saved["pending"] == [] and saved["sent"] == ["1817:ats_unsupported:a", "1817:ats_unsupported:b"]


def test_the_real_notify_tool_accepts_the_summary(home, tmp_path, monkeypatch):
    # Patch 20 (14/09): jht-notify-user refused a source id without its action
    # and payload (exit 1), and every flush failed behind a fake notifier.
    db_path = tmp_path / "box-jobs.db"  # the real schema, as on the box
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        conn.executemany(
            "INSERT INTO positions(id, title, company, url, status, apply_requested, apply_requested_at, "
            "apply_requested_by) VALUES (?, ?, 'Example Corp', ?, 'ready', 1, '2026-09-14T08:00:00.000Z', 'user_web')",
            [(1817, "Synthetic Data Engineer", "https://jobs.example.com/1817"),
             (1845, "Synthetic ML Engineer", "https://jobs.example.com/1845")],
        )
        conn.commit()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "jht-notify-user").symlink_to(ROOT / "agents" / "_tools" / "jht-notify-user")
    telegram = tmp_path / "telegram.txt"
    stub = bin_dir / "jht-telegram-send"
    stub.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{telegram}"\nexit 0\n', encoding="utf-8")
    stub.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    monkeypatch.setenv("JHT_DB", str(db_path))
    monkeypatch.delenv("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY", raising=False)
    notices.defer(1817, "linkedin_credentials_missing", "https://www.linkedin.com/jobs/view/1")
    notices.defer(1845, "ats_unsupported", "https://b.example.com")

    result = notices.flush()

    assert result["status"] == "sent", result
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT agent, kind, body, source_id, source_action, source_payload, delivered_via "
            "FROM pending_user_messages"
        ).fetchall()
    assert len(rows) == 1
    agent, kind, body, source_id, action, payload, via = rows[0]
    assert (agent, kind, source_id, action, via) == ("closer", "digest", result["source_id"], "closer_digest", "telegram")
    assert json.loads(payload) == {"position_ids": [1817, 1845]}
    assert "#1817" in body and "#1845" in body
    assert "#1817" in telegram.read_text(encoding="utf-8")
    assert notices._read_state(notices._state_path())["pending"] == []
    # The same queue again is not a second row: the source id is idempotent.
    assert notices.flush()["status"] == "empty"


def test_a_failed_send_keeps_the_stops_and_reuses_the_source_id(home):
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    down = Recorder(fail=True)
    assert notices.flush(down)["status"] == "failed"
    up = Recorder()
    assert notices.flush(up)["status"] == "sent"
    assert down.calls[0]["source_id"] == up.calls[0]["source_id"]


def test_an_old_pending_stop_flushes_on_the_next_defer(home, monkeypatch):
    sent = Recorder()
    monkeypatch.setattr(notices, "_default_notifier", sent)
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    real_now = notices._now
    monkeypatch.setattr(notices, "_now", lambda: real_now() + notices.FLUSH_AFTER + timedelta(minutes=1))
    notices.defer(1845, "ats_unsupported", "https://b.example.com")
    assert len(sent.calls) == 1
    assert "#1817" in sent.calls[0]["message"] and "#1845" in sent.calls[0]["message"]


def test_unreadable_state_does_not_lose_new_stops(home):
    state = home / ".cache" / "apply-flow" / "notices.json"
    state.parent.mkdir(parents=True)
    state.write_text("{not json", encoding="utf-8")
    notices.defer(1817, "ats_unsupported", "https://a.example.com")
    assert json.loads(state.read_text())["pending"][0]["position_id"] == 1817


def test_summary_is_capped(home):
    pending = [{"position_id": 1817, "reason": "ats_unsupported", "host": ""}] * (notices.MAX_LINES + 3)
    message = notices.summary_message(pending)
    assert message.count("\n- ") == notices.MAX_LINES
    assert "3" in message.splitlines()[notices.MAX_LINES + 1]


@pytest.mark.parametrize("lang", LANGS)
def test_an_expired_linkedin_session_has_its_own_words(lang):
    # 35ddb27f3 (HQ-BACKEND-3): the hand-made session expired; the default text
    # would not say to sign in again in the CLOSER's browser.
    catalog = _catalog(lang)
    assert "linkedin_session_expired" in notices.KNOWN_REASONS
    for part in ("why", "action"):
        assert catalog[f"closer.reason.linkedin_session_expired.{part}"] != catalog[f"closer.reason.default.{part}"]


@pytest.mark.parametrize("lang", LANGS)
def test_every_summary_line_says_what_to_do(home, lang):
    # 14/09 live: 6 of 8 stops were linkedin_credentials_missing; the "why"
    # alone left the user without the one thing to do (create the sign-in).
    _set_lang(home, lang)
    catalog = _catalog(lang)
    message = notices.summary_message([{"position_id": 1817, "reason": "linkedin_credentials_missing", "host": ""}])
    assert catalog["closer.reason.linkedin_credentials_missing.why"] in message
    assert catalog["closer.reason.linkedin_credentials_missing.action"] in message


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("reason", ["submit_outcome_unknown", "receipt_incomplete", "send_outcome_unknown"])
def test_a_sent_or_maybe_sent_application_never_reads_as_nothing_sent(home, lang, reason):
    # Every stop now reaches the summary (HQ-BACKEND-3), email ones included:
    # the old footer "Nothing was sent for these" read them the wrong way round.
    _set_lang(home, lang)
    catalog = _catalog(lang)
    assert catalog[f"closer.reason.{reason}.why"] != catalog["closer.reason.default.why"]
    message = notices.summary_message([{"position_id": 1817, "reason": reason, "host": ""}])
    english = _catalog("en")
    for old in ("Nothing was sent", "non è stato inviato nulla", "nichts gesendet", "Rien n'a été envoyé",
                "No se ha enviado nada", "Nada foi enviado", "semmi nem lett elküldve"):
        assert old.casefold() not in message.casefold()
    assert catalog[f"closer.reason.{reason}.why"] in message
    assert english["closer.digest.line"].count("{action}") == 1


def test_cli_pending_lists_the_queue(home, capsys):
    notices.defer(1817, "ats_unsupported", "https://a.example.com/x")
    assert notices.main(["pending"]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert listed[0]["host"] == "a.example.com"


# ── 5. question prose ───────────────────────────────────────────────────────


def test_question_prose_is_localized_and_keeps_the_code(home):
    _set_lang(home, "es")
    assert "Q1A2B" in notices.question_telegram_hint("Q1A2B")
    assert notices.question_telegram_hint("Q1A2B").startswith("En Telegram")
    assert notices.question_dashboard_hint().startswith("Responde")
    assert notices.question_essential_note().startswith("Es un dato esencial")


# ── the CLOSER sends the summary ────────────────────────────────────────────


@pytest.mark.parametrize("lang", LANGS)
def test_closer_flushes_the_summary_when_its_round_ends(lang):
    suffix = "" if lang == "en" else f".{lang}"
    prompt = (ROOT / "agents" / "closer" / f"closer{suffix}.md").read_text(encoding="utf-8")
    step6 = prompt[prompt.index("STEP 6 —"):]
    step6 = step6[:step6.index("```")]
    assert "python3 /app/shared/skills/closer_notices.py flush" in step6
    assert step6.index("closer_notices.py flush") < step6.index("[REPORT]")
    skill = (ROOT / "agents" / "_skills" / "apply-flow" / f"SKILL{suffix}.md").read_text(encoding="utf-8")
    assert "Bash(python3 /app/shared/skills/closer_notices.py *)" in skill.split("---")[1]
    for reason in SITE_REASONS:
        assert f"`{reason}`" in skill


# ── localized prose never breaks the parsers (HQ-BACKEND's conditions) ─────

import application_answers as aa  # noqa: E402
import _db  # noqa: E402

HEAD = "CLOSER needs one required application answer before it can continue.\n"
WEB_PREFIX = HEAD + "Question: "  # web/lib/application-answer-request.ts REQUEST_PREFIX


def _answer_db(tmp_path: Path) -> Path:
    path = tmp_path / "answers.db"
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        conn.execute(
            "INSERT INTO positions(id, title, company, url, status, apply_requested, apply_requested_at, "
            "apply_requested_by) VALUES (7, 'Fixture Role', 'Fixture Co', 'https://jobs.example.com/7', "
            "'ready', 1, '2026-09-13T10:00:00.000Z', 'user_web')"
        )
    return path


def _question_body(source_id: str, *, essential: bool) -> str:
    """The head as apply_flow/application_answers write it, then the localized prose."""
    english_hint = aa.telegram_hint(source_id)
    code = aa.answer_code(source_id)
    head = HEAD + "Question: Which work model can you accept?\nField type: radio\nOptions:\n- Remote\n- Hybrid"
    prose = [notices.question_essential_note(default="x") if essential else notices.question_dashboard_hint(default="x"),
             notices.question_telegram_hint(code, default=english_hint)]
    return head + "\n\n" + "\n".join(prose)


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("essential", [False, True])
def test_localized_question_resolves_like_english(lang, essential, home, tmp_path):
    _set_lang(home, lang)
    db = _answer_db(tmp_path)
    source_id = ("closer-essential:work model:1" if essential else "closer-answer:7:workmodel")
    body = _question_body(source_id, essential=essential)
    assert body.startswith(WEB_PREFIX)
    assert body.split("\n\n")[0].endswith("\nOptions:\n- Remote\n- Hybrid")
    assert aa._CODE.search(body.split("\n\n", 1)[1]).group(1) == aa.answer_code(source_id)
    payload = {"version": 1, "position_id": 7, "key": "which work model can you accept",
               "label": "Which work model can you accept?", "field_type": "radio", "options": ["Remote", "Hybrid"]}
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', ?, 'question', 7, ?, ?, ?, 'telegram')",
            (body, source_id, aa.SOURCE_ACTION, json.dumps(payload)),
        )
        by_code = aa.resolve_telegram_reply(conn, text=f"{aa.answer_code(source_id)} Remote")
        assert by_code.status == "resolved", (lang, by_code)
        conn.execute("UPDATE pending_user_messages SET user_reply = NULL, user_reply_at = NULL")
        by_quote = aa.resolve_telegram_reply(conn, text="Hybrid", reply_to_text=body)
        assert by_quote.status == "resolved", (lang, by_quote)


def test_without_a_translation_the_english_default_goes_out(home, monkeypatch):
    monkeypatch.setattr(notices.i18n, "t", lambda key: key)
    assert notices.question_telegram_hint("Q1A2B", default="english hint Q1A2B") == "english hint Q1A2B"
    assert notices.question_dashboard_hint(default="english dashboard") == "english dashboard"
    assert notices.stop_message("captcha", "d", 1817, default="english stop") == "english stop"


def test_a_failing_catalog_never_raises(home, monkeypatch):
    def broken(key):
        raise RuntimeError("catalog unreadable")

    monkeypatch.setattr(notices.i18n, "t", broken)
    assert notices.question_essential_note(default="english note") == "english note"
    assert notices.email_stop_message("cv_missing", "d", 1845, default="english email") == "english email"


def test_a_translation_that_drops_the_code_falls_back(home, monkeypatch):
    monkeypatch.setattr(notices, "text", lambda key, **params: "localized hint without the token")
    assert notices.question_telegram_hint("Q1A2B", default="english Q1A2B") == "english Q1A2B"
