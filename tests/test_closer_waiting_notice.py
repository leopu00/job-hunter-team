"""The positions that WAIT: a state told for as long as it lasts, not an event.

Origin (operator's box, 24/09). Sixteen of twenty-one authorised positions had
been sitting in a `blocked_human` checkpoint for twenty-six days, stopped by the
sites themselves — an unsupported ATS, an anti-bot wall, a captcha, an ambiguous
form. Nothing was broken: the gate holds them at its per-position checks, and the
person WAS told, once, the evening they stopped (`notices.json`: pending 0,
sent 27). And then nobody ever asked her again for the hand those sixteen were
waiting for.

An event is told once; a state can be told for as long as it lasts. So:

  1. the source is the queue's `held` list — what is true NOW — never the stops
     as they happen, which is what `flush()` already does and cannot repeat;
  2. the text says HOW LONG: "4 for 26 days" moves a person, `ats_unsupported`
     does not, and the technical reason stays out of it;
  3. it is sent only when the LIST CHANGES. The fingerprint is the set of
     positions and reasons and never the days, because the days move every night
     and a notice that arrives every night is one nobody reads;
  4. it does not depend on the CLOSER: the executor is whoever runs anyway and
     reads the gate, since the CLOSER does not exist when the queue is closed —
     which is exactly when the list is longest.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import closer_notices as notices  # noqa: E402
import i18n  # noqa: E402

LANGS = ("en", "it", "es", "fr", "de", "pt", "hu")
WAITING_KEYS = (
    "closer.waiting.header",
    "closer.waiting.age",
    "closer.waiting.line",
    "closer.waiting.more",
    "closer.waiting.footer",
)
NOW = datetime(2026, 9, 24, 21, 0, 0, tzinfo=timezone.utc)


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
                # Twenty-six days before NOW, as on the operator's box; then two nearer ones.
                (1817, "Synthetic Data Engineer", "Example Corp", "2026-08-29 10:00:00"),
                (1845, "Synthetic ML Engineer", "Sample GmbH", "2026-08-29 11:30:00"),
                (1866, "Synthetic Analyst", "Third Ltd", "2026-09-12 09:00:00"),
                (1901, "Synthetic Platform Engineer", "Fourth SpA", None),
            ],
        )
    i18n._resolve_lang.cache_clear()
    yield tmp_path
    i18n._resolve_lang.cache_clear()


def _set_lang(home: Path, lang: str) -> None:
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": lang}), encoding="utf-8")
    i18n._resolve_lang.cache_clear()


def queue(*held: tuple[int, str]) -> dict:
    """A gate answer with these positions held, as `apply_gate queue` returns it."""
    return {"ready": False, "reason": "queue_empty", "held": [{"position_id": pid, "reason": reason} for pid, reason in held]}


class Notifier:
    """The notify wrapper, captured: what was said, under which source id."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, *, message: str, source_id: str, payload: dict) -> str:
        self.calls.append({"message": message, "source_id": source_id, "payload": payload})
        return "captured"


# ── 1. one message, the ages in it, no technical reason ─────────────────────


def test_one_message_for_the_whole_list_with_the_days_and_not_the_reason(home):
    _set_lang(home, "it")
    notifier = Notifier()
    answer = notices.waiting(notifier, queue((1817, "ats_unsupported"), (1845, "captcha"), (1866, "form_ambiguous")), now=NOW)
    assert answer["status"] == "sent"
    assert answer["count"] == 3
    # ONE message for all three, never one per position.
    assert len(notifier.calls) == 1
    message = notifier.calls[0]["message"]
    # The ages, oldest first, counted: two at twenty-six days, one at twelve.
    assert "3 candidature che hai autorizzato aspettano ancora te: 2 da 26 giorni, 1 da 12 giorni." in message
    assert "in attesa da 26 giorni" in message
    # What she can do, in her words: no reason CODE anywhere — not one
    # snake_case token in the whole message. ("captcha" as a word may well
    # appear: the sentence that tells her the CLOSER never solves one is prose
    # she can act on, which is the opposite of `ats_unsupported`.)
    assert "ats_unsupported" not in message
    assert "form_ambiguous" not in message
    assert re.search(r"\b[a-z]+_[a-z_]+\b", message) is None, message
    assert "Nessuna può partire senza di te" in message
    # And the positions are named as the person knows them.
    assert "#1817 (Synthetic Data Engineer presso Example Corp)" in message
    # The payload carries the ids, for the dashboard's side of it.
    assert notifier.calls[0]["payload"] == {"position_ids": [1817, 1845, 1866]}


def test_the_oldest_comes_first_and_an_undated_authorisation_does_not_invent_an_age(home):
    notifier = Notifier()
    notices.waiting(notifier, queue((1901, "captcha"), (1866, "captcha"), (1817, "captcha")), now=NOW)
    lines = [line for line in notifier.calls[0]["message"].splitlines() if line.startswith("- ")]
    assert "#1817" in lines[0] and "26 days" in lines[0]
    assert "#1866" in lines[1] and "12 days" in lines[1]
    # 1901 has no authorisation date: it is listed last and claims no age.
    assert "#1901" in lines[2]
    assert "26 days" not in lines[2] and "12 days" not in lines[2]


# ── 2. it is sent when the LIST changes, and only then ──────────────────────


def test_the_same_list_is_not_told_twice(home):
    notifier = Notifier()
    first = notices.waiting(notifier, queue((1817, "ats_unsupported"), (1845, "captcha")), now=NOW)
    second = notices.waiting(notifier, queue((1845, "captcha"), (1817, "ats_unsupported")), now=NOW)
    assert first["status"] == "sent"
    # The same set, in another order, is the same set.
    assert second["status"] == "unchanged"
    assert second["fingerprint"] == first["fingerprint"]
    assert len(notifier.calls) == 1


def test_a_day_passing_is_not_a_change__this_is_the_whole_anti_noise_rule(home):
    notifier = Notifier()
    held = queue((1817, "ats_unsupported"), (1845, "captcha"))
    notices.waiting(notifier, held, now=NOW)
    # Five nights later the ages have all moved, and the list has not.
    later = notices.waiting(notifier, held, now=NOW + timedelta(days=5))
    assert later["status"] == "unchanged"
    assert len(notifier.calls) == 1, "a notice that arrives every night is one nobody reads"


def test_a_position_added_or_gone_is_a_change(home):
    notifier = Notifier()
    notices.waiting(notifier, queue((1817, "ats_unsupported")), now=NOW)
    added = notices.waiting(notifier, queue((1817, "ats_unsupported"), (1845, "captcha")), now=NOW)
    assert added["status"] == "sent"
    gone = notices.waiting(notifier, queue((1845, "captcha")), now=NOW)
    assert gone["status"] == "sent"
    assert len(notifier.calls) == 3
    # A position whose reason changed is a change too: what she must do is different.
    moved = notices.waiting(notifier, queue((1845, "login_required")), now=NOW)
    assert moved["status"] == "sent"


def test_nothing_held_says_nothing(home):
    notifier = Notifier()
    assert notices.waiting(notifier, queue(), now=NOW) == {"status": "empty", "count": 0}
    assert notifier.calls == []


def test_a_send_that_failed_is_not_recorded_as_told(home):
    def broken(**_kwargs):
        raise RuntimeError("jht-notify-user is unavailable")

    held = queue((1817, "ats_unsupported"))
    failed = notices.waiting(broken, held, now=NOW)
    assert failed["status"] == "failed"
    notifier = Notifier()
    # The list is told again: a person waiting twenty-six days needs that more
    # than a tidy state file.
    assert notices.waiting(notifier, held, now=NOW)["status"] == "sent"


# ── 3. the ages are read as UTC, and the state file keeps its other half ────


def test_the_age_is_measured_in_utc_whatever_the_machine_thinks(home, monkeypatch):
    # 23:30 UTC is already tomorrow at +02:00 and still yesterday at -10:00. The
    # column is UTC and is read as UTC, so the count of days does not move with
    # the box (24/09: three defects of that family in one day).
    for zone in ("UTC", "Europe/Rome", "Pacific/Honolulu", "Asia/Kiritimati"):
        monkeypatch.setenv("TZ", zone)
        assert notices._days_waiting("2026-08-29 23:30:00", NOW) == 25
        assert notices._days_waiting("2026-09-24 20:00:00", NOW) == 0
        assert notices._days_waiting("", NOW) is None


def test_the_pending_stops_are_untouched_by_the_waiting_state(home):
    notices.defer(1817, "ats_unsupported", "https://jobs.example/1817")
    notices.waiting(Notifier(), queue((1817, "ats_unsupported")), now=NOW)
    state = json.loads((home / ".cache" / "apply-flow" / "notices.json").read_text(encoding="utf-8"))
    # Two halves in one file: the round's stops, and the list being waited on.
    assert [entry["position_id"] for entry in state["pending"]] == [1817]
    assert state["waiting"]["count"] == 1
    assert state["waiting"]["fingerprint"]


# ── 4. every catalog says it, with the same placeholders ────────────────────


def test_all_seven_catalogs_carry_the_waiting_keys_with_english_placeholders(home):
    english = _catalog("en")
    for key in WAITING_KEYS:
        fields = sorted(part.split("}")[0] for part in english[key].split("{")[1:])
        for lang in LANGS:
            value = _catalog(lang).get(key)
            assert value, f"{lang} is missing {key}"
            assert sorted(part.split("}")[0] for part in value.split("{")[1:]) == fields, f"{lang}:{key}"


def test_the_message_reads_in_the_users_language(home):
    for lang, opening in (("en", "applications you authorised are still waiting"), ("de", "warten weiterhin auf dich"), ("hu", "még rád vár")):
        _set_lang(home, lang)
        notifier = Notifier()
        # A fresh fingerprint each time: the state is per set, and the set differs.
        notices.waiting(notifier, queue((1817, "captcha"), (1845 if lang != "de" else 1866, "captcha")), now=NOW)
        assert opening in notifier.calls[0]["message"], lang
