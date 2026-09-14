"""
The daily cap of automated applications, reserved atomically. [JHT-CLOSER-CAP]

Found in the review of the email channel: the gate read the cap (`remaining`)
and the channel recorded the send later. Two runs on two positions with one
slot left both passed the gate and both sent: max_per_day=3 became 4. The same
held for the browser submit. These tests pin the fix: one `BEGIN IMMEDIATE`
reservation right before the irreversible send, shared by both channels; a
reservation whose outcome stays unknown keeps counting; only a send that
certainly did not happen gives its slot back.

Races are run in real processes (multiprocessing, spawn), never threads: the
lock under test is SQLite's, which lives per connection and per process. Each
child widens the window between counting and inserting, so a missing lock
shows up as two sends instead of hiding behind a lucky schedule.

Synthetic only: temporary JHT_HOME and jobs.db, stub SMTP transport, local
pages. Run with: pytest tests/test_apply_cap_reservation.py -v
"""

from __future__ import annotations

import contextlib
import json
import multiprocessing
import socket
import sqlite3
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
TESTS = ROOT / "tests"
for _path in (SKILLS, TESTS):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import _db  # noqa: E402
import apply_flow  # noqa: E402
import apply_gate  # noqa: E402
import test_email_application as email_fixtures  # noqa: E402
from test_email_application import box  # noqa: E402,F401
from test_apply_flow import GateVerdict, ashby_form, cv_path, page  # noqa: E402,F401

SPAWN = multiprocessing.get_context("spawn")
RACE_WINDOW_SECONDS = 0.4


# ── fixtures ─────────────────────────────────────────────────────────────────


def _home(tmp_path: Path, monkeypatch, *, max_per_day: int | None) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    (tmp_path / "jht.config.json").write_text(json.dumps(
        {"applications": {"auto_apply": {"enabled": True, "max_per_day": max_per_day, "mode": "authorised"}}}
    ))
    with contextlib.closing(sqlite3.connect(tmp_path / "jobs.db")) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        for pid in (41, 42, 43):
            conn.execute(
                "INSERT INTO positions (id, title, company, url, status, apply_requested, "
                "apply_requested_at, apply_requested_by) VALUES (?, 'Fixture Role', 'Fixture Co', ?, 'ready', 1, "
                "'2026-09-14T08:00:00.000Z', 'user_web')",
                (pid, f"https://jobs.example.invalid/{pid}"),
            )
            conn.execute("INSERT INTO applications (position_id) VALUES (?)", (pid,))
        conn.commit()
    return tmp_path


def _reservations(home: Path) -> list[tuple]:
    with contextlib.closing(sqlite3.connect(home / "jobs.db")) as conn:
        return conn.execute(
            "SELECT position_id, channel, state FROM apply_cap_reservations ORDER BY id"
        ).fetchall()


def _widen_the_race_window() -> None:
    """In a child: count, wait, then let the caller insert. A missing lock now loses."""
    counted = apply_gate._sent_today

    def slow(conn, **kwargs):
        value = counted(conn, **kwargs)
        time.sleep(RACE_WINDOW_SECONDS)
        return value

    apply_gate._sent_today = slow


def _child_reserve(barrier, results, position_id: int, channel: str, db_path: str) -> None:
    _widen_the_race_window()
    barrier.wait(timeout=30)
    if channel == "browser":
        # Exactly the function the browser flow calls before its click.
        verdict = apply_flow._default_cap_reserver(position_id=position_id, db_path=db_path)
    else:
        verdict = apply_gate.reserve_daily_slot(position_id, channel, db_path=db_path)
    results.put((position_id, channel, bool(verdict.allowed), verdict.reason))


def _child_email_send(barrier, results, home: str) -> None:
    _widen_the_race_window()
    email_fixtures._reset_fake()
    barrier.wait(timeout=30)
    out = email_fixtures.flow(Path(home)).send()
    results.put((1, "email", out.state == "sent", out.reason, len(email_fixtures.FakeTransport.sends)))


def _run(targets: list[tuple]) -> list[tuple]:
    barrier = SPAWN.Barrier(len(targets))
    results = SPAWN.Queue()
    processes = [SPAWN.Process(target=fn, args=(barrier, results, *args)) for fn, *args in targets]
    for process in processes:
        process.start()
    for process in processes:
        process.join(timeout=120)
    assert all(process.exitcode == 0 for process in processes), [p.exitcode for p in processes]
    return [results.get(timeout=5) for _ in processes]


# ── the reservation itself ───────────────────────────────────────────────────


def test_two_processes_racing_for_the_last_slot_reserve_exactly_one(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    db = str(home / "jobs.db")

    outcomes = _run([(_child_reserve, 41, "browser", db), (_child_reserve, 42, "browser", db)])

    allowed = [o for o in outcomes if o[2]]
    refused = [o for o in outcomes if not o[2]]
    assert len(allowed) == 1, outcomes
    assert [o[3] for o in refused] == ["daily_cap_reached"]
    assert [row[2] for row in _reservations(home)] == ["reserved"]


def test_an_email_send_and_a_browser_click_racing_for_one_slot_make_one_application(box):
    home = box
    email_fixtures._edit_cap(home, 1)

    outcomes = _run([
        (_child_email_send, str(home)),
        (_child_reserve, 2, "browser", str(home / "jobs.db")),
    ])

    email = next(o for o in outcomes if o[1] == "email")
    browser = next(o for o in outcomes if o[1] == "browser")
    assert email[2] != browser[2], outcomes
    assert email[4] == (1 if email[2] else 0), "an email refused by the cap reached the transport"
    assert len([row for row in _reservations(home) if row[2] == "reserved"]) == 1


def test_a_slot_whose_outcome_is_unknown_keeps_counting(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    db = str(home / "jobs.db")

    first = apply_gate.reserve_daily_slot(41, "browser", db_path=db)
    # The process dies after the click: no receipt, no release, no applied row.
    retry_elsewhere = apply_gate.reserve_daily_slot(42, "email", db_path=db)
    cap = apply_gate.daily_cap_verdict(db_path=db)

    assert first.allowed
    assert (retry_elsewhere.allowed, retry_elsewhere.reason) == (False, "daily_cap_reached")
    assert (cap.allowed, cap.context["sent_today"]) == (False, 1)


def test_a_position_never_takes_a_second_slot_from_its_own_reservation(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    db = str(home / "jobs.db")

    assert apply_gate.reserve_daily_slot(41, "browser", db_path=db).allowed
    # A rerun of the same position after a crash before its click: still one slot.
    assert apply_gate.reserve_daily_slot(41, "browser", db_path=db).allowed
    assert apply_gate.daily_cap_verdict(db_path=db).context["sent_today"] == 1
    assert apply_gate.reserve_daily_slot(42, "browser", db_path=db).reason == "daily_cap_reached"


def test_a_released_slot_is_free_again_and_a_release_is_once(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    db = str(home / "jobs.db")

    slot = apply_gate.reserve_daily_slot(41, "email", db_path=db)
    assert apply_gate.release_daily_slot(slot.context["token"], db_path=db) is True
    assert apply_gate.release_daily_slot(slot.context["token"], db_path=db) is False
    assert apply_gate.reserve_daily_slot(42, "browser", db_path=db).allowed


def test_a_slot_that_is_not_full_is_reserved_with_its_channel(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=3)

    verdict = apply_gate.reserve_daily_slot(41, "email", db_path=str(home / "jobs.db"))

    assert (verdict.allowed, verdict.reason) == (True, "cap_reserved")
    assert verdict.context["remaining_today"] == 3 and verdict.context["token"]
    assert _reservations(home) == [(41, "email", "reserved")]


def test_no_consent_or_no_register_reserves_nothing(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    (home / "jht.config.json").write_text(json.dumps({"applications": {"auto_apply": {"enabled": False}}}))
    assert apply_gate.reserve_daily_slot(41, "email", db_path=str(home / "jobs.db")).allowed is False

    (home / "jht.config.json").write_text(json.dumps(
        {"applications": {"auto_apply": {"enabled": True, "max_per_day": 1, "mode": "authorised"}}}
    ))
    missing = apply_gate.reserve_daily_slot(41, "email", db_path=str(home / "no-such-dir" / "jobs.db"))
    assert (missing.allowed, missing.reason) == (False, "cap_unreadable")


# ── the email channel ────────────────────────────────────────────────────────


def test_email_reserves_before_the_marker_and_keeps_the_slot_when_the_outcome_is_unknown(box):
    home = box
    email_fixtures.FakeTransport.send_error = socket.timeout("synthetic timeout")

    out = email_fixtures.flow(home).send()

    assert out.state == "send_outcome_unknown"
    assert _reservations(home) == [(1, "email", "reserved")]


def test_email_refused_recipients_give_the_slot_back(box):
    home = box
    email_fixtures.FakeTransport.send_error = email_fixtures.ea.RecipientsRefused({"jobs@example.com": (550, b"no")})

    out = email_fixtures.flow(home).send()

    assert (out.state, out.reason) == ("blocked_human", "recipient_refused")
    assert _reservations(home) == [(1, "email", "released")]


def test_email_with_the_cap_taken_by_a_browser_slot_sends_nothing(box, monkeypatch):
    home = box
    email_fixtures._edit_cap(home, 1)
    # Between the email's own gate and its reservation, a browser run takes the slot.
    real_gate = email_fixtures.ea.EmailApplication._gate

    def gate_then_browser_click(self):
        verdict = real_gate(self)
        assert apply_gate.reserve_daily_slot(2, "browser", db_path=str(home / "jobs.db")).allowed
        return verdict

    monkeypatch.setattr(email_fixtures.ea.EmailApplication, "_gate", gate_then_browser_click)

    out = email_fixtures.flow(home).send()

    assert (out.state, out.reason) == ("denied", "daily_cap_reached")
    assert email_fixtures.FakeTransport.sends == []
    assert email_fixtures.sql(home, "SELECT state FROM email_application_attempts") == [("draft_ready",)]


# ── the browser channel ──────────────────────────────────────────────────────


def _browser_flow(home: Path, cv: Path, position_id: int, **kwargs) -> apply_flow.ApplicationFlow:
    return apply_flow.ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        position_id=position_id,
        url=f"https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-0000000000{position_id}/application",
        profile={"name": "Test Candidate", "contacts": {"email": "candidate@example.invalid"}},
        cv_path=cv,
        checkpoint_path=home / f"checkpoint-{position_id}.json",
        receipt_dir=home / "receipts",
        db_path=home / "jobs.db",
        gate_checker=lambda **_kwargs: GateVerdict(True),
        notifier=lambda **_kwargs: "notification-1",
        applied_recorder=lambda **_kwargs: None,
        confirmation_timeout_ms=300,
        **kwargs,
    )


def test_a_browser_click_with_the_cap_full_is_denied_before_the_click(page, tmp_path, monkeypatch, cv_path):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    # First position: the click happens, no confirmation ever comes — outcome unknown.
    page.set_content(ashby_form().replace("document.body.innerHTML", "window.ignored"))
    first = _browser_flow(home, cv_path, 41).run(page=page, navigate=False)
    assert (first.status, first.reason) == ("blocked_human", "receipt_missing")
    assert page.evaluate("window.submitCount") == 1

    page.set_content(ashby_form())
    second = _browser_flow(home, cv_path, 42).run(page=page, navigate=False)

    assert (second.status, second.reason) == ("denied", "daily_cap_reached")
    assert page.evaluate("window.submitCount") == 0
    assert _reservations(home) == [(41, "browser", "reserved")]
    checkpoint = json.loads((home / "checkpoint-42.json").read_text())
    assert checkpoint["submit_started"] is False


def test_a_browser_click_with_room_reserves_and_submits(page, tmp_path, monkeypatch, cv_path):
    home = _home(tmp_path, monkeypatch, max_per_day=2)
    page.set_content(ashby_form())

    result = _browser_flow(home, cv_path, 41).run(page=page, navigate=False)

    assert result.status == "applied"
    assert page.evaluate("window.submitCount") == 1
    assert _reservations(home) == [(41, "browser", "reserved")]


def test_a_dry_run_reserves_nothing(page, tmp_path, monkeypatch, cv_path):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    page.set_content(ashby_form())
    dry = GateVerdict(True, context={"mode": "dry_run", "max_per_day": 1})

    flow = _browser_flow(home, cv_path, 41)
    flow.gate_checker = lambda **_kwargs: dry
    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run"
    assert _reservations(home) == []


def test_a_submit_marker_that_cannot_be_saved_gives_the_slot_back_without_clicking(
    page, tmp_path, monkeypatch, cv_path
):
    home = _home(tmp_path, monkeypatch, max_per_day=1)
    page.set_content(ashby_form())
    real_save = apply_flow.FlowCheckpoint.save

    def failing_submit_save(self, path):
        if self.submit_started:
            raise OSError("synthetic disk full")
        return real_save(self, path)

    monkeypatch.setattr(apply_flow.FlowCheckpoint, "save", failing_submit_save)

    result = _browser_flow(home, cv_path, 41).run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert page.evaluate("window.submitCount") == 0
    assert _reservations(home) == [(41, "browser", "released")]
    assert json.loads((home / "checkpoint-41.json").read_text())["submit_started"] is False



def test_without_a_cap_every_send_is_reserved_and_counted_and_none_is_refused(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch, max_per_day=None)
    db = str(home / "jobs.db")
    verdicts = [apply_gate.reserve_daily_slot(pid, "browser", db_path=db) for pid in (41, 42, 43)]
    assert [v.reason for v in verdicts] == ["cap_reserved"] * 3
    assert [(v.context["max_per_day"], v.context["remaining_today"]) for v in verdicts] == [(None, None)] * 3
    assert [v.context["sent_today"] for v in verdicts] == [0, 1, 2]  # still counted
    assert [row[0] for row in _reservations(home)] == [41, 42, 43]
    assert len({v.context["token"] for v in verdicts}) == 3
