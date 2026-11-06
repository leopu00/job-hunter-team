"""Synthetic transports exercise delivery outcomes, state transitions and retry limits."""

import importlib.util
import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
from delivery_retry import WakeBudget
from delivery_context import Context
import application_wakes as wakes
import sentinel_delivery as notices
import sentinel_loop as loop


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path


@pytest.mark.parametrize("rc", [0, 3, 4, 5, 130, 1])
def test_stepcap_transport_reports_every_failed_exit(home, monkeypatch, rc):
    wd = load("stepcap_outcome", ".launcher/stepcap-watchdog.py")
    monkeypatch.setattr(wd, "_transport_run", lambda *a: subprocess.CompletedProcess([], rc))
    assert wd.notify_captain("fixture") is (rc == 0)
    log = home / "logs/runtime.log"
    assert log.exists() is (rc != 0)
    if rc:
        assert json.loads(log.read_text())["rc"] == rc


def test_stepcap_never_marks_a_failed_escalation_complete_and_caps_retries(home):
    from stepcap_delivery import _handle_agent

    sends, events = [], []
    wd = SimpleNamespace(
        _agent_paused=lambda s: False,
        capture_pane=lambda s: "same",
        pane_tail=lambda p: p,
        pane_hash=lambda p: p,
        notify_captain=lambda msg: sends.append(msg) or False,
        emit=lambda event, **k: events.append(event),
    )
    entry = {"phase": "awaiting_captain", "stall_hash": "same", "pending_escalation": "fixture"}
    for now in (1000, 1001, 1060, 1180, 2000, 3000):
        _handle_agent(wd, "SCOUT-1", "scout-1", entry, now, 1)
    assert len(sends) == 3
    assert entry["phase"] == "awaiting_captain"
    assert "last_escalate_ts" not in entry and "escalated" not in events


def test_stepcap_marks_success_only_after_retry_is_acknowledged(home):
    from stepcap_delivery import _handle_agent

    outcome = {"ok": False}
    wd = SimpleNamespace(
        _agent_paused=lambda s: False,
        capture_pane=lambda s: "same",
        pane_tail=lambda p: p,
        pane_hash=lambda p: p,
        notify_captain=lambda msg: outcome["ok"],
        emit=lambda *a, **k: None,
    )
    entry = {"phase": "awaiting_captain", "stall_hash": "same", "pending_escalation": "fixture"}
    _handle_agent(wd, "SCOUT-1", "scout-1", entry, 1000, 1)
    outcome["ok"] = True
    _handle_agent(wd, "SCOUT-1", "scout-1", entry, 1060, 1)
    assert entry["phase"] == "escalated" and entry["last_escalate_ts"] == 1060


def test_pending_stepcap_escalation_keeps_the_previous_success_cooldown():
    from stepcap_delivery import _deliver_escalation
    calls = []
    wd = SimpleNamespace(ESCALATE_COOLDOWN_SEC=3600,
        notify_captain=lambda text: calls.append(text) or True, emit=lambda *a, **k: None)
    entry = {"last_escalate_ts": 1000, "pending_escalation": "fixture", "phase": "awaiting_captain"}
    _deliver_escalation(wd, "SCOUT-1", "scout-1", entry, 1060)
    assert calls == [] and entry["phase"] == "awaiting_captain"
    _deliver_escalation(wd, "SCOUT-1", "scout-1", entry, 4600)
    assert calls == ["fixture"] and entry["last_escalate_ts"] == 4600


def test_missing_ack_does_not_burn_its_success_cooldown(home):
    from stepcap_delivery import check_missing_acks

    state = {}
    wd = SimpleNamespace(
        _throttle_engine=lambda: SimpleNamespace(
            NOTIFIED_ACK_MAX_SEC=60,
            notified_without_ack=lambda **k: [{"agent": "scout-1", "waiting_sec": 120}],
        ),
        NOTIFIED_ACK_MAX_SEC=60,
        ACK_ESCALATE_COOLDOWN_SEC=100,
        _home=lambda: home,
        emit=lambda *a, **k: None,
        notify_captain=lambda msg: False,
    )
    check_missing_acks(wd, state, 1000)
    assert state["ack_escalations"] == {}
    wd.notify_captain = lambda msg: True
    check_missing_acks(wd, state, 1060)
    assert state["ack_escalations"] == {"scout-1": 1060}


def api(clock, sender):
    return SimpleNamespace(
        time=SimpleNamespace(time=lambda: clock["now"]),
        session_exists=lambda s: True,
        jht_tmux_send=sender,
        CAPITANO_SESSION="CAPITANO",
        SENTINELLA_SESSION="SENTINELLA",
        FETCH_FAIL_THRESHOLD=2,
        ANCHOR_TICK_MIN=5,
        _build_tick_message=lambda *a: "fixture",
        _write_last_tick=lambda *a: None,
    )


def test_burn_notice_tracks_each_recipient_without_claiming_a_failed_transition():
    clock, calls = {"now": 1000}, []
    outcome = {"ok": False}
    ctx = api(clock, lambda session, text: calls.append(session) or session == "CAPITANO" or outcome["ok"])
    ctx._BURN_INTENT_MOD = None
    state = {}
    notices._burn_intent_announce(ctx, state, {"active": True})
    assert not state.get("burn_intent_on") and state["burn_notified"] == {"CAPITANO": True}
    clock["now"] += 60
    outcome["ok"] = True
    notices._burn_intent_announce(ctx, state, {"active": True})
    assert state["burn_intent_on"] and calls == ["CAPITANO", "SENTINELLA", "SENTINELLA"]


@pytest.mark.parametrize("kind", ["silent", "alert"])
def test_vitals_cooldown_is_written_only_after_delivery(kind):
    clock = {"now": 10000}
    outcome = {"ok": False}
    ctx = api(clock, lambda *a: outcome["ok"])
    ctx._LAST_VITALS_SILENT_AT = ctx._LAST_VITALS_ALERT_AT = 0
    ctx.VITALS_SILENT_COOLDOWN_MIN = ctx.VITALS_ALERT_COOLDOWN_MIN = 5
    ctx.VITALS_ALERT_PCT = 95
    ctx.VITALS_FILE = "fixture.jsonl"
    ctx._sampler_silence = lambda n: {"minutes": 20}
    ctx._take_vitals_sample = lambda: {"mem": {"pct": 99}}
    ctx._sustained_cpu = lambda: None
    ctx.subprocess = SimpleNamespace(run=lambda *a, **k: subprocess.CompletedProcess([], 0))
    ctx.sys, ctx.VITALS_SKILL = sys, "fixture"
    fn = notices._warn_if_vitals_silent if kind == "silent" else notices._sample_vitals_and_maybe_alert
    field = "_LAST_VITALS_SILENT_AT" if kind == "silent" else "_LAST_VITALS_ALERT_AT"
    fn(ctx, 5)
    assert getattr(ctx, field) == 0
    clock["now"] += 60
    outcome["ok"] = True
    fn(ctx, 5)
    assert getattr(ctx, field) == 10060


def test_fetch_alert_and_recovery_wait_for_actual_delivery():
    clock, calls = {"now": 1000}, []
    outcome = {"ok": False}
    ctx = api(clock, lambda session, text: calls.append(text) or outcome["ok"])
    run = SimpleNamespace(
        fail_streak=0,
        capitano_alerted=False,
        state={},
        within_hours=True,
        fail_reason="fixture",
        override_min=None,
    )
    loop._failure(ctx, run)
    clock["now"] += 60
    loop._failure(ctx, run)
    assert not run.capitano_alerted
    outcome["ok"] = True
    clock["now"] += 120
    loop._failure(ctx, run)
    assert run.capitano_alerted
    _tick_fields(run)
    outcome["ok"] = False
    loop._notify(ctx, run)
    assert run.capitano_alerted and run.recovery_pending
    outcome["ok"] = True
    clock["now"] += 60
    loop._notify(ctx, run)
    assert not run.capitano_alerted and not run.recovery_pending


def _tick_fields(run):
    run.weekly_pace, run.weekly_locked = {}, False
    run.entry, run.parsed, run.status, run.proj, run.usage = {}, {}, "LOCKED", 0, 0
    run.reset, run.dyn_target, run.work_phase, run.now_h, run.now_ts = "", 0, "", "", 1000
    run._bi_on, run.should_notify, run.daily_halted = False, False, False


def test_tick_delivery_does_not_advance_the_last_sent_state():
    clock = {"now": 1000}
    ctx = api(clock, lambda *a: False)
    ctx._build_tick_message = lambda *a: "fixture"
    ctx._write_last_tick = lambda *a: None
    run = SimpleNamespace(fail_streak=0, capitano_alerted=False, state={}, within_hours=True)
    _tick_fields(run)
    run.should_notify = True
    loop._notify(ctx, run)
    assert "last_sent_ts" not in run.state
    ctx.jht_tmux_send = lambda *a: True
    clock["now"] += 60
    loop._notify(ctx, run)
    assert run.state["last_sent_ts"] == 1000 and run.state["last_sent_status"] == "LOCKED"


def test_wake_budget_survives_new_instances_and_has_a_hard_cap(home):
    assert WakeBudget(home).reserve("fixture", 1000)
    assert not WakeBudget(home).reserve("fixture", 1001)
    assert WakeBudget(home).reserve("fixture", 1060)
    assert WakeBudget(home).reserve("fixture", 1180)
    assert not WakeBudget(home).reserve("fixture", 100000)
    assert WakeBudget(home).exhausted("fixture")
    assert len(json.loads((home / "state/closer-wake-retries.json").read_text())) == 1


def test_wakes_keep_pending_and_report_corrupt_retry_state(home):
    (home / "state").mkdir()
    (home / "state/closer-wake-retries.json").write_text("broken")
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE closer_wakes (wake_key TEXT PRIMARY KEY, position_id INTEGER, delivered INTEGER DEFAULT 0)"
    )
    sent = []
    result = wakes.deliver_wakes(
        conn,
        [SimpleNamespace(key="fixture", reason="answers_complete", position_id=7)],
        sessions=lambda: ["CLOSER-1"],
        sender=lambda *a: sent.append(a) or True,
        queue=lambda c: {"ready": True, "positions": [{"position_id": 7}]},
        now=1000,
    )
    assert result == [] and sent == []
    assert conn.execute("SELECT COUNT(*) FROM closer_wakes").fetchone() == (0,)
    assert "wake_retry_state_unavailable" in (home / "logs/runtime.log").read_text()


def test_a_timeout_is_not_a_stepcap_delivery(home, monkeypatch):
    wd = load("stepcap_timeout", ".launcher/stepcap-watchdog.py")

    def timeout(*args):
        raise subprocess.TimeoutExpired("fixture", 1)

    monkeypatch.setattr(wd, "_transport_run", timeout)
    assert not wd.notify_captain("fixture")
    assert "message_not_delivered" in (home / "logs/runtime.log").read_text()


def test_a_wake_timeout_releases_the_claim_but_keeps_the_budget(home):
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE closer_wakes (wake_key TEXT PRIMARY KEY, position_id INTEGER, delivered INTEGER DEFAULT 0)"
    )
    calls = []

    def timeout(*args):
        calls.append(args)
        raise subprocess.TimeoutExpired("fixture", 1)

    args = dict(
        sessions=lambda: ["CLOSER-1"],
        sender=timeout,
        queue=lambda c: {"ready": True, "positions": [{"position_id": 7}]},
    )
    event = SimpleNamespace(key="fixture-timeout", reason="answers_complete", position_id=7)
    for now in (1000, 1001, 1060, 1180, 2000):
        assert wakes.deliver_wakes(conn, [event], now=now, **args) == []
    assert len(calls) == 3
    assert conn.execute("SELECT COUNT(*) FROM closer_wakes").fetchone() == (0,)
    assert "wake_retry_exhausted" in (home / "logs/runtime.log").read_text()


def test_team_resume_reports_partial_delivery_instead_of_resumed(home):
    from agent_resume import resume

    class Refusal(Exception):
        pass

    ctx = SimpleNamespace(
        DETAIL={},
        _halted=lambda: False,
        RESUME_REASON="fixture",
        standby=lambda: SimpleNamespace(
            status=lambda: {"state": "active"},
            wake=lambda **k: {"removed": True, "reached": ["SCOUT-1"], "not_reached": ["SCOUT-2"]},
        ),
        jht_home=lambda: home,
        Refusal=Refusal,
    )
    with pytest.raises(Refusal, match="team_resume_failed"):
        resume(ctx)
    assert ctx.DETAIL == {"pause_removed": True, "reached": ["SCOUT-1"], "not_reached": ["SCOUT-2"]}


def test_one_agent_resume_keeps_the_marker_and_delivery_facts_separate(home):
    from agent_resume import resume_agent

    class Refusal(Exception):
        pass

    ctx = SimpleNamespace(
        DETAIL={},
        parse_session=lambda s: None,
        RESUME_REASON="fixture",
        agent_pause_module=lambda: SimpleNamespace(
            resume=lambda *a, **k: {"removed": True, "notified": False, "live": True}
        ),
        jht_home=lambda: home,
        Refusal=Refusal,
    )
    with pytest.raises(Refusal, match="agent_resume_failed"):
        resume_agent(ctx, "SCOUT-1")
    assert ctx.DETAIL == {"notified": False, "pause_removed": True}


def test_concurrent_wake_budgets_share_one_reservation(home):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: WakeBudget(home).reserve("concurrent-fixture", 1000), range(12)))
    assert sum(results) == 1


def test_a_symlink_is_not_a_retry_state_file(home):
    (home / "state").mkdir()
    target = home / "elsewhere.json"
    target.write_text("{}")
    (home / "state/closer-wake-retries.json").symlink_to(target)
    with pytest.raises(OSError):
        WakeBudget(home).reserve("fixture", 1000)
    assert target.read_text() == "{}"


def test_burn_expiry_compensates_a_partially_delivered_override():
    clock, calls = {"now": 1000}, []
    ctx = api(clock, lambda session, text: calls.append((session, text)) or session == "CAPITANO")
    ctx._BURN_INTENT_MOD = None
    state = {}
    notices._burn_intent_announce(ctx, state, {"active": True})
    assert state["burn_notified"] == {"CAPITANO": True}
    clock["now"] += 1
    notices._burn_intent_announce(ctx, state, {"active": False})
    assert state["burn_intent_on"] is False
    assert calls[-1][0] == "CAPITANO" and "EXPIRED/REVOKED" in calls[-1][1]
    assert state["burn_notified"] == {"CAPITANO": False}


def test_a_new_missing_ack_episode_gets_a_fresh_budget_while_another_agent_stays_stuck(home):
    from stepcap_delivery import check_missing_acks

    rows = [{"agent": "scout-1", "waiting_sec": 120}, {"agent": "scout-2", "waiting_sec": 120}]
    state = {}
    calls = []
    engine = SimpleNamespace(NOTIFIED_ACK_MAX_SEC=60, notified_without_ack=lambda **k: rows)
    wd = SimpleNamespace(
        _throttle_engine=lambda: engine,
        NOTIFIED_ACK_MAX_SEC=60,
        ACK_ESCALATE_COOLDOWN_SEC=100,
        _home=lambda: home,
        emit=lambda *a, **k: None,
        notify_captain=lambda text: calls.append(text) or False,
    )
    for now in (1000, 1060, 1180):
        check_missing_acks(wd, state, now)
    rows.pop(0)
    check_missing_acks(wd, state, 1300)
    assert "scout-1" not in state["ack_delivery_attempts"]
    rows.append({"agent": "scout-1", "waiting_sec": 120})
    check_missing_acks(wd, state, 1301)
    assert state["ack_delivery_attempts"]["scout-1"]["attempts"] == 1


def test_retry_diagnostic_failure_cannot_strand_a_failed_wake_claim(home):
    conn = sqlite3.connect(home / "fixture.db")
    conn.execute(
        "CREATE TABLE closer_wakes (wake_key TEXT PRIMARY KEY, position_id INTEGER, delivered INTEGER DEFAULT 0)"
    )

    def sender(*args):
        (home / "state/closer-wake-retries.json").unlink()
        return False

    event = SimpleNamespace(key="fixture-diagnostic", reason="answers_complete", position_id=7)
    assert (
        wakes.deliver_wakes(
            conn,
            [event],
            sessions=lambda: ["CLOSER-1"],
            sender=sender,
            queue=lambda c: {"ready": True, "positions": [{"position_id": 7}]},
            now=1000,
        )
        == []
    )
    conn.close()
    with sqlite3.connect(home / "fixture.db") as read:
        assert read.execute("SELECT COUNT(*) FROM closer_wakes").fetchone() == (0,)
    assert "wake_retry_state_unavailable" in (home / "logs/runtime.log").read_text()


def test_resume_session_read_errors_are_not_an_empty_list(home):
    from delivery_sessions import sessions

    def timeout(*a, **k):
        raise subprocess.TimeoutExpired("fixture", 1)

    with pytest.raises(subprocess.TimeoutExpired):
        sessions(runner=timeout, home=home)
    assert "delivery_state_unavailable" in (home / "logs/runtime.log").read_text()
    assert (
        sessions(
            runner=lambda *a, **k: subprocess.CompletedProcess([], 1, b"", b"no server running"), home=home
        )
        == []
    )


def test_kickoff_retries_three_times_without_marking_a_failed_send_as_done(home):
    from watchdog_delivery import kickoff

    calls, delays = [], []
    assert not kickoff("SCOUT-1", "scout", sender=lambda *a: calls.append(a) or False, sleeper=delays.append)
    assert len(calls) == 3 and delays == [12, 60, 120]


def test_bridge_escalation_updates_cooldown_only_on_confirmed_delivery(home, monkeypatch):
    from watchdog_delivery import bridge

    stamp = home / "bridge.ts"
    args = (stamp, 3600, "fixture bridge", 3, 600, "fixture-sender")
    assert not bridge(*args, sender=lambda *a: False, now=10000)
    assert not stamp.exists()
    assert bridge(*args, sender=lambda *a: True, now=10060)
    assert stamp.read_text().strip() == "10060"
    assert not bridge(*args, sender=lambda *a: pytest.fail("cooldown ignored"), now=10061)


def test_bridge_escalation_has_a_durable_limit_for_a_failed_notification(home):
    from watchdog_delivery import bridge

    calls = []
    for now in (10000, 10001, 10060, 10180, 10300, 10500, 10800, 11100):
        assert not bridge(
            home / "bridge.ts",
            3600,
            "fixture bridge",
            3,
            600,
            "fixture-sender",
            sender=lambda *a: calls.append(a) or False,
            now=now,
        )
    assert len(calls) == 3 and not (home / "bridge.ts").exists()


def test_a_later_bridge_failure_episode_gets_a_fresh_budget(home):
    from watchdog_delivery import bridge
    args = (home / "bridge.ts", 3600, "fixture bridge", 3, 600, "fixture-sender")
    for now in (10000, 10060, 10180, 10300):
        assert not bridge(*args, sender=lambda *a: False, now=now)
    assert bridge(*args, sender=lambda *a: True, now=11000)
    assert (home / "bridge.ts").read_text().strip() == "11000"


def test_a_missing_tmux_socket_is_empty_but_permission_failure_is_not(home):
    from delivery_sessions import sessions
    missing = b"error connecting to /fixture/default (No such file or directory)"
    assert sessions(runner=lambda *a, **k: subprocess.CompletedProcess([], 1, b"", missing), home=home) == []
    denied = b"error connecting to /fixture/default (Permission denied)"
    with pytest.raises(RuntimeError, match="delivery_state_unavailable"):
        sessions(runner=lambda *a, **k: subprocess.CompletedProcess([], 1, b"", denied), home=home)


@pytest.mark.parametrize("rc", [0, 3, 1, 130])
def test_mail_receipts_follow_the_actual_transport_result(home, rc):
    mail = load("mail_outcomes", "shared/skills/jht_mail.py")
    import mail_delivery

    mail.send("capitano", "fixture", sender=("verified", "scout-1", "scout-1"), message_id="fixture-mail")
    result = mail_delivery.transport_exit(Context(vars(mail)), "CAPITANO", "fixture-mail", rc, 0)
    states = [row["state"] for row in mail.receipts("capitano", "fixture-mail")]
    assert ("nudged" in states) is (rc == 0)
    assert result == (3 if rc == 3 else 0)
    assert mail.state_of("capitano", "fixture-mail") == "queued"


def test_failed_mail_nudges_keep_their_receipts_and_stop_retrying(home):
    from datetime import datetime, timedelta, timezone

    mail = load("mail_reminder_outcomes", "shared/skills/jht_mail.py")
    calls = []
    start = datetime(2031, 1, 1, tzinfo=timezone.utc)
    mail.send(
        "capitano", "fixture", sender=("verified", "scout-1", "scout-1"), message_id="fixture-mail", now=start
    )
    for seconds in (0, 1, 60, 180, 300):
        assert (
            mail.remind(
                {"capitano-1"},
                now=start + timedelta(seconds=seconds),
                ready=lambda s: True,
                sender=lambda *a: calls.append(a) or False,
            )
            == []
        )
    assert len(calls) == 3
    assert [r["state"] for r in mail.receipts("capitano", "fixture-mail")] == ["queued"]


def test_a_mail_reminder_is_recorded_after_a_successful_retry(home):
    from datetime import datetime, timedelta, timezone

    mail = load("mail_retry_outcomes", "shared/skills/jht_mail.py")
    start = datetime(2031, 1, 1, tzinfo=timezone.utc)
    mail.send(
        "capitano", "fixture", sender=("verified", "scout-1", "scout-1"), message_id="fixture-mail", now=start
    )
    mail.remind({"capitano-1"}, now=start, ready=lambda s: True, sender=lambda *a: False)
    assert mail.remind(
        {"capitano-1"}, now=start + timedelta(seconds=60), ready=lambda s: True, sender=lambda *a: True
    ) == [{"session": "CAPITANO", "text": mail.nudge_text(1)}]
    assert [r["state"] for r in mail.receipts("capitano", "fixture-mail")] == ["queued", "nudged"]


@pytest.mark.parametrize("paused", [False, True])
def test_mail_expiry_notices_respect_an_individual_pause(home, monkeypatch, paused):
    from datetime import datetime, timezone
    import agent_pause
    import mail_delivery
    import tmux_send_run
    calls = []
    monkeypatch.setattr(agent_pause, "is_paused", lambda *a, **k: paused)
    monkeypatch.setattr(tmux_send_run, "run", lambda args, timeout: calls.append(args) or subprocess.CompletedProcess(args, 0))
    ctx = SimpleNamespace(home=lambda: home, load_receivers=lambda: {"capitano-1"},
        _utc=lambda value: datetime(2031, 1, 1, tzinfo=timezone.utc), box_dir=lambda agent: home,
        sweep=lambda *a, **k: {"typed": [{"session": "SCOUT-1", "text": "fixture expired"}]},
        pending=lambda *a, **k: [], session_of=lambda agent: "CAPITANO",
        session_ready=lambda session: False, EXIT={"ok": 0})
    assert mail_delivery.deliver_tick(ctx) == 0
    assert len(calls) == (0 if paused else 1)
