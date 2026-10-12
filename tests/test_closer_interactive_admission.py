"""Independent admission/queue negatives for the isolated Closer candidate.

Select the reviewed product tree with JHT_CLOSER_INTERACTIVE_SOURCE. Product
guards, SQLite and local locks are real; synthetic data and inert transport
dependencies do not establish operator identity, provider delivery or #279.
No browser, tmux server, model, site or application is started by this suite.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("JHT_CLOSER_INTERACTIVE_SOURCE", ROOT)).resolve()
SKILLS = SOURCE / "shared" / "skills"


@pytest.fixture(scope="module")
def product():
    assert (SKILLS / "closer_interactive.py").is_file(), (
        "Select the frozen product tree with JHT_CLOSER_INTERACTIVE_SOURCE"
    )
    sys.path.insert(0, str(SKILLS))
    modules = {}
    for name in (
        "_db", "apply_gate", "apply_request", "application_answers",
        "apply_session_lock", "apply_flow", "apply_assisted", "team_roster",
        "closer_interactive",
    ):
        module = importlib.import_module(name)
        assert Path(module.__file__).resolve().parent == SKILLS, name
        modules[name] = module
    return SimpleNamespace(**modules)


@dataclass
class Box:
    api: SimpleNamespace
    home: Path
    db: Path
    cv: Path
    sent: list

    def connect(self):
        return sqlite3.connect(self.db)

    def rows(self, table="positions"):
        assert table in {
            "positions", "applications", "closer_wakes",
            "apply_cap_reservations",
        }
        with self.connect() as conn:
            return conn.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()

    def checkpoints(self):
        root = self.home / ".cache" / "apply-flow"
        return {
            str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.glob("*.json")
        }

    def authorise_fixture_positions(self, *position_ids):
        # Fixture setup through the existing writer; this is not evidence of a
        # real user or permission to run an application.
        with self.connect() as conn:
            for pid in position_ids:
                self.api.apply_request.write_authorisation(conn, pid, True, "user_local")

    def queue(self):
        return self.api.apply_gate.application_queue(
            config_path=self.home / "jht.config.json",
            db_path=str(self.db), jht_home=self.home,
        )


@pytest.fixture
def box(tmp_path, monkeypatch, product):
    home = tmp_path / "home"
    home.mkdir()
    db = home / "jobs.db"
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(db))
    monkeypatch.setattr(product._db, "DB_PATH", str(db), raising=False)
    (home / "jht.config.json").write_text(json.dumps({
        "applications": {"auto_apply": {
            "enabled": True, "mode": "authorised", "max_per_day": 3,
        }},
    }))
    (home / "profile").mkdir()
    (home / "profile" / "candidate_profile.yml").write_text("{}\n")
    cv = home / "fixture.pdf"
    cv.write_bytes(b"%PDF-1.4 inert fixture; no personal data")
    conn = product._db.get_db()
    try:
        product._db.ensure_schema(conn)
        conn.executemany(
            "INSERT INTO positions (id,title,company,url,status) VALUES (?,?,?,?,?)",
            [(pid, "Synthetic role", "Synthetic fixture",
              f"https://example.invalid/position/{pid}", "ready") for pid in (1, 2)],
        )
        conn.executemany(
            "INSERT INTO applications (position_id,cv_pdf_path) VALUES (?,?)",
            [(pid, str(cv)) for pid in (1, 2)],
        )
        conn.commit()
    finally:
        conn.close()
    # PDF measurement/preview are inert dependencies, not substituted consent,
    # holds, cap decisions, admission guards or authorisation writers.
    monkeypatch.setattr(product.apply_gate, "cv_layout_hold", lambda _cv: "")
    monkeypatch.setattr(product.apply_gate, "refresh_cv_preview", lambda *_a: "")
    sent = []
    monkeypatch.setattr(product.application_answers, "_closer_sessions", lambda: ["CLOSER-1"])
    monkeypatch.setattr(
        product.application_answers, "_tmux_send",
        lambda session, text: sent.append((session, text)) or True,
    )
    return Box(product, home, db, cv, sent)


def test_two_authorised_positions_are_ready_without_an_interactive_slot(box):
    box.authorise_fixture_positions(1, 2)
    queue = box.queue()
    assert queue["ready"] is True
    assert {position["position_id"] for position in queue["positions"]} == {1, 2}
    assert box.sent == []


def flow(box, pid=1):
    return box.api.apply_flow.ApplicationFlow(
        position_id=pid, url=f"https://example.invalid/position/{pid}",
        profile={}, cv_path=box.cv, db_path=str(box.db),
    )


def test_slot_is_durable_before_flag_and_never_wakes(box, monkeypatch):
    before = box.rows()
    writer = box.api.apply_request.write_authorisation
    observed = []

    def checked_writer(conn, pid, requested, origin):
        slot = box.api.closer_interactive.read(box.home)
        assert slot["position_id"] == pid == 1
        assert slot["phase"] == "admitted"
        assert slot["owner_id"] is None
        observed.append(pid)
        return writer(conn, pid, requested, origin)

    monkeypatch.setattr(box.api.apply_request, "write_authorisation", checked_writer)
    box.api.closer_interactive.admit(1, home=box.home)
    assert observed == [1]
    assert box.rows()[1] == before[1]
    assert box.queue()["ready"] is False
    assert box.sent == []


@pytest.mark.parametrize("pid", [1, 2])
def test_duplicate_or_other_admission_does_not_rewrite_flags(box, pid):
    api = box.api.closer_interactive
    api.admit(1, home=box.home)
    before = box.rows(), api.read(box.home)
    with pytest.raises(api.InteractiveDenied, match="interactive_mission_reserved"):
        api.admit(pid, home=box.home)
    assert (box.rows(), api.read(box.home)) == before


@pytest.mark.parametrize("pid", [1, 2])
def test_ordinary_authorisation_writer_is_blocked(box, pid):
    box.api.closer_interactive.admit(1, home=box.home)
    before = box.rows()
    result, rc = box.api.apply_request.toggle(pid, True)
    assert rc != 0 and result["reason"] == "interactive_mission_reserved"
    assert box.rows() == before
    assert box.sent == []


@pytest.mark.parametrize("kind", ["ordinary", "idle"])
def test_wake_guard_blocks_even_a_stale_ready_queue(box, kind):
    box.authorise_fixture_positions(1, 2)
    box.api.closer_interactive.admit(1, home=box.home)
    before = box.rows("closer_wakes")
    with box.connect() as conn:
        stale = lambda _c: {"ready": True, "positions": [{"position_id": 1}, {"position_id": 2}]}
        if kind == "ordinary":
            result = box.api.application_answers.wake_closer(conn, {}, queue=stale)
        else:
            result = box.api.application_answers.wake_idle_closer(
                conn, idle_sessions=lambda: ["CLOSER-1"], queue=stale)
    assert result == [] and box.sent == []
    assert box.rows("closer_wakes") == before


def test_global_work_lock_prevents_admission_before_any_write(box):
    api = box.api.closer_interactive
    before = box.rows()
    with api.work_lock(box.home, owner=object()):
        with pytest.raises(box.api.apply_session_lock.SessionBusy):
            api.admit(1, home=box.home)
    assert api.read(box.home) is None and box.rows() == before


def test_flow_cannot_enter_while_global_work_owner_is_active(box, monkeypatch):
    ordinary = flow(box, 2)
    entered = []
    monkeypatch.setattr(ordinary, "_run", lambda **_kw: entered.append(True))
    with box.api.closer_interactive.work_lock(box.home, owner=object()):
        result = ordinary.run()
    assert result.status == "denied" and result.reason == "application_session_busy"
    assert entered == [] and not ordinary.checkpoint_path.exists()


def test_wake_delivery_retains_global_lock_until_sender_returns(box):
    box.authorise_fixture_positions(1, 2)
    api = box.api.closer_interactive
    seen = []

    def sender(_session, _text):
        with pytest.raises(box.api.apply_session_lock.SessionBusy):
            api.admit(1, home=box.home)
        assert api.read(box.home) is None
        seen.append(True)
        return True

    with box.connect() as conn:
        result = box.api.application_answers.wake_idle_closer(
            conn, idle_sessions=lambda: ["CLOSER-1"], sender=sender)
    assert result == ["CLOSER-1"] and seen == [True]
    assert api.admit(1, home=box.home)["position_id"] == 1


def claimed(box):
    api = box.api.closer_interactive
    api.admit(1, home=box.home)
    owner = flow(box)
    api.claim(owner)
    return owner


def test_claim_cannot_adopt_running_owner_or_second_position(box):
    owner = claimed(box)
    api = box.api.closer_interactive
    for candidate in (flow(box, 1), flow(box, 2)):
        with pytest.raises(api.InteractiveDenied, match="interactive_claim_denied"):
            api.claim(candidate)
    assert api.guard(box.home, 1, owner._interactive_owner) == ""
    assert api.guard(box.home, 2, owner._interactive_owner) == "interactive_mission_reserved"
    assert api.guard(box.home, 1, ("0" * 32, "0" * 32)) == "interactive_mission_reserved"


def test_copied_identifiers_do_not_transfer_owner_to_another_process(box):
    owner = claimed(box)
    code = (
        "import sys;sys.path.insert(0,sys.argv[1]);import closer_interactive as c;"
        "print(c.guard(sys.argv[2],1,(sys.argv[3],sys.argv[4])))"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(SKILLS), str(box.home), *owner._interactive_owner],
        capture_output=True, text=True, timeout=5, check=True,
    )
    assert result.stdout.strip() == "interactive_mission_reserved"


def test_exited_owner_is_not_automatically_adopted_or_requeued(box):
    api = box.api.closer_interactive
    api.admit(1, home=box.home)
    code = '''
import json,sys
sys.path.insert(0,sys.argv[1])
import closer_interactive as c
from types import SimpleNamespace
from pathlib import Path
home=Path(sys.argv[2])
f=SimpleNamespace(position_id=1,url="https://example.invalid/position/1",
 checkpoint_path=home/".cache/apply-flow/1.json",db_path=str(home/"jobs.db"),
 _jht_home=lambda:home)
with c.work_lock(home,owner=f):
 c.claim(f)
 print(json.dumps(f._interactive_owner))
'''
    result = subprocess.run([sys.executable, "-I", "-c", code, str(SKILLS), str(box.home)],
                            capture_output=True, text=True, check=True, timeout=5)
    previous = json.loads(result.stdout)
    assert api.guard(box.home, 1, previous) == "interactive_mission_reserved"
    assert box.queue()["ready"] is False
    with pytest.raises(api.InteractiveDenied):
        api.claim(flow(box))
    with pytest.raises(api.InteractiveDenied):
        api.admit(2, home=box.home)


@pytest.mark.parametrize("wrong", ["position", "mission", "owner", "review"])
def test_control_wrong_binding_leaves_record_unchanged(box, wrong):
    owner = claimed(box)
    api = box.api.closer_interactive
    record = api.update(owner, phase="review_wait", review_id="a" * 32)
    args = [1, *owner._interactive_owner, "a" * 32]
    args[["position", "mission", "owner", "review"].index(wrong)] = 2 if wrong == "position" else "b" * 32
    with pytest.raises(api.InteractiveDenied):
        api.control("confirm", *args, home=box.home)
    assert api.read(box.home) == record


def test_confirmation_is_consumed_once_and_not_replayed(box):
    owner = claimed(box)
    api = box.api.closer_interactive
    api.update(owner, phase="review_wait", review_id="a" * 32)
    api.control("confirm", 1, *owner._interactive_owner, "a" * 32, home=box.home)
    assert api.take_command(owner) == "confirm"
    assert api.take_command(owner) is None
    with pytest.raises(api.InteractiveDenied):
        api.control("confirm", 1, *owner._interactive_owner, "a" * 32, home=box.home)


def test_wrong_position_cannot_consume_pinned_command(box):
    owner = claimed(box)
    api = box.api.closer_interactive
    api.update(owner, phase="review_wait", review_id="a" * 32)
    api.control("confirm", 1, *owner._interactive_owner, "a" * 32, home=box.home)
    wrong = flow(box, 2)
    wrong._interactive_owner = owner._interactive_owner
    before = api.read(box.home)
    with pytest.raises(api.InteractiveDenied):
        api.take_command(wrong)
    assert api.read(box.home) == before


def test_wrong_position_cannot_update_pinned_record(box):
    owner = claimed(box)
    api = box.api.closer_interactive
    wrong = flow(box, 2)
    wrong._interactive_owner = owner._interactive_owner
    before = api.read(box.home)
    with pytest.raises(api.InteractiveDenied):
        api.update(wrong, phase="closed")
    assert api.read(box.home) == before


@pytest.mark.parametrize("phase", ["closed", "completed", "unknown"])
def test_terminal_slot_does_not_restart_or_resume_ordinary_queue(box, phase):
    owner = claimed(box)
    api = box.api.closer_interactive
    api.update(owner, phase=phase)
    before = box.rows()
    assert box.queue()["ready"] is False
    assert api.guard(box.home, 1, owner._interactive_owner)
    with pytest.raises(api.InteractiveDenied):
        api.claim(flow(box))
    with pytest.raises(api.InteractiveDenied):
        api.admit(2, home=box.home)
    assert box.rows() == before


def test_flag_failure_leaves_durable_blocking_slot_without_retry(box, monkeypatch):
    api = box.api.closer_interactive
    before = box.rows()

    def failure(*_a):
        raise sqlite3.OperationalError("synthetic writer failure")

    monkeypatch.setattr(box.api.apply_request, "write_authorisation", failure)
    with pytest.raises(sqlite3.OperationalError):
        api.admit(1, home=box.home)
    assert box.rows() == before
    assert api.read(box.home)["phase"] == "admitted"
    assert box.queue()["ready"] is False and box.sent == []
    with pytest.raises(api.InteractiveDenied):
        api.admit(1, home=box.home)


@pytest.mark.parametrize("state,reason,started", [
    ("blocked_human", "captcha", False),
    ("blocked_human", "submit_outcome_unknown", True),
])
def test_admission_preserves_existing_checkpoint_hold(box, state, reason, started):
    box.authorise_fixture_positions(1)
    # The existing authorisation must unambiguously predate the human stop;
    # writer milliseconds and checkpoint seconds otherwise overlap.
    with box.connect() as conn:
        conn.execute("UPDATE positions SET apply_requested_at='2000-01-01T00:00:00Z' WHERE id=1")
    f = flow(box)
    checkpoint = box.api.apply_flow.FlowCheckpoint.new(1, f.url)
    checkpoint.state, checkpoint.blocked_reason = state, reason
    checkpoint.submit_started = started
    checkpoint.save(f.checkpoint_path)
    before = box.rows(), f.checkpoint_path.read_bytes()
    with pytest.raises(box.api.closer_interactive.InteractiveDenied):
        box.api.closer_interactive.admit(1, home=box.home)
    assert (box.rows(), f.checkpoint_path.read_bytes()) == before
    assert box.api.closer_interactive.read(box.home) is None


def test_daily_cap_reservation_is_preserved_and_admission_denied(box):
    config = json.loads((box.home / "jht.config.json").read_text())
    config["applications"]["auto_apply"]["max_per_day"] = 1
    (box.home / "jht.config.json").write_text(json.dumps(config))
    verdict = box.api.apply_gate.reserve_daily_slot(2, "browser", db_path=str(box.db))
    assert verdict.allowed
    before = box.rows(), box.rows("apply_cap_reservations")
    with pytest.raises(box.api.closer_interactive.InteractiveDenied, match="daily_cap_reached"):
        box.api.closer_interactive.admit(1, home=box.home)
    assert (box.rows(), box.rows("apply_cap_reservations")) == before


def test_consent_revocation_prevents_slot_and_flag(box):
    path = box.home / "jht.config.json"
    value = json.loads(path.read_text())
    value["applications"]["auto_apply"]["enabled"] = False
    path.write_text(json.dumps(value))
    before = box.rows()
    with pytest.raises(box.api.closer_interactive.InteractiveDenied):
        box.api.closer_interactive.admit(1, home=box.home)
    assert box.rows() == before and box.api.closer_interactive.read(box.home) is None


def test_corrupt_slot_fails_closed_without_flags_queue_or_wakes(box):
    api = box.api.closer_interactive
    api.admit(1, home=box.home)
    slot = box.home / ".cache" / "closer-interactive" / "mission.json"
    slot.write_text("{synthetic-corrupt-json")
    before = box.rows()
    assert api.guard(box.home) == "interactive_state_unreadable"
    assert box.queue()["ready"] is False
    result, rc = box.api.apply_request.toggle(2, True)
    assert rc != 0 and result["reason"] == "interactive_state_unreadable"
    assert box.rows() == before and box.sent == []


def test_direct_ordinary_flow_does_not_rewrite_unselected_unknown_checkpoint(box):
    box.authorise_fixture_positions(1, 2)
    box.api.closer_interactive.admit(1, home=box.home)
    other = flow(box, 2)
    checkpoint = box.api.apply_flow.FlowCheckpoint.new(2, other.url)
    checkpoint.state = "blocked_human"
    checkpoint.blocked_reason = "submit_outcome_unknown"
    checkpoint.submit_started = True
    checkpoint.save(other.checkpoint_path)
    before = other.checkpoint_path.read_bytes(), box.rows()
    # Gate runs before any Page dependency; none is supplied or opened.
    result = other.run()
    assert result.status == "denied"
    assert (other.checkpoint_path.read_bytes(), box.rows()) == before


def launcher_fixture(box, tmp_path, race=False, spawn_probe=False):
    """Actual complete launcher; only interpreter scheduling and transports inert.

    A rejected fake new-session records a spawn request, never creates tmux or
    a provider. The race admits via the actual CLI after its actual check.
    """
    launcher = SOURCE / ".launcher" / "start-agent.sh"
    if "Refusing Closer spawn: admission lock unavailable." in launcher.read_text() and not shutil.which("flock"):
        pytest.skip("Real flock required by this launcher; host has none (Linux fixture required)")
    binary = tmp_path / "bin"
    binary.mkdir()
    # In the isolated Linux runner /app is an owned empty tmpfs. The launcher
    # prepends /app/agents/_tools, so place ONLY inert fixture transports there.
    # This is not an installed/root-immutable product tool or loader proof.
    fixture_prefix = os.environ.get("JHT_CLOSER_FIXTURE_TOOL_PREFIX")
    if fixture_prefix:
        assert Path(fixture_prefix) == Path("/app/agents/_tools")
        assert Path("/app/shared/skills").resolve() == SKILLS
        binary = Path(fixture_prefix)
        binary.mkdir(parents=True, exist_ok=True)
    trace = tmp_path / "transport.jsonl"
    python = binary / "python3"
    python.write_text(f"#!{sys.executable}\n" + '''
import json, os, subprocess, sys
args = sys.argv[1:]
result = subprocess.run([sys.executable, *args])
if (os.environ.get("FIXTURE_ADMIT_AFTER_CHECK") == "1" and len(args) == 2
        and args[0].endswith("/closer_interactive.py") and args[1] == "ordinary-allowed"
        and result.returncode == 0):
    admitted = subprocess.run([sys.executable, args[0], "admit", "1"],capture_output=True,text=True)
    with open(os.environ["FIXTURE_ADMISSION_TRACE"],"w") as stream:
        json.dump({"rc":admitted.returncode,"stdout":admitted.stdout,"stderr":admitted.stderr},stream)
raise SystemExit(result.returncode)
''')
    tmux = binary / "tmux"
    tmux.write_text(f"#!{sys.executable}\n" + '''
import json, os, subprocess, sys
with open(os.environ["FIXTURE_TRANSPORT_TRACE"], "a") as stream:
    stream.write(json.dumps(sys.argv[1:]) + "\\n")
def opened(fd):
    try: os.fstat(fd); return True
    except OSError: return False
with open(os.environ["FIXTURE_FD_TRACE"],"a") as stream:
    stream.write(json.dumps({"argv":sys.argv[1:],"fd8":opened(8),"fd9":opened(9)})+"\\n")
if sys.argv[1:2]==["new-session"] and os.environ.get("FIXTURE_ADMIT_AT_SPAWN")=="1":
    attempt=subprocess.run([sys.executable,os.environ["FIXTURE_MISSION_MODULE"],"admit","1"],capture_output=True,text=True)
    with open(os.environ["FIXTURE_SPAWN_ADMISSION_TRACE"],"w") as stream:
        json.dump({"rc":attempt.returncode,"stdout":attempt.stdout,"stderr":attempt.stderr},stream)
raise SystemExit(1 if sys.argv[1:2] == ["has-session"] else 97)
''')
    provider = binary / "codex"
    provider.write_text("#!/bin/sh\nexit 99\n")
    for path in (python, tmux, provider):
        path.chmod(0o700)
    config_path = box.home / "jht.config.json"
    config = json.loads(config_path.read_text())
    config.update(active_provider="codex", providers={"codex": {"auth_method": "subscription"}})
    config_path.write_text(json.dumps(config))
    identity = box.home / "agents" / "closer-1" / "AGENTS.md"
    identity.parent.mkdir(parents=True)
    identity.write_text("Inert synthetic identity; provider is never executed.\n")
    env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ["PATH"],
               JHT_USER_DIR=str(tmp_path / "visible"),
               FIXTURE_TRANSPORT_TRACE=str(trace),
               FIXTURE_ADMISSION_TRACE=str(tmp_path / "admit-at-check.json"),
               FIXTURE_FD_TRACE=str(tmp_path / "transport-fds.jsonl"),
               FIXTURE_ADMIT_AT_SPAWN="1" if spawn_probe and "admission lock unavailable" in launcher.read_text() else "0",
               FIXTURE_MISSION_MODULE=str(SKILLS / "closer_interactive.py"),
               FIXTURE_SPAWN_ADMISSION_TRACE=str(tmp_path / "admit-at-spawn.json"),
               FIXTURE_ADMIT_AFTER_CHECK="1" if race else "0", JHT_LANG="en")
    return launcher, env, trace


@pytest.mark.parametrize("instance", ["1", "2"])
def test_actual_launcher_rejects_reserved_slot_before_transport(box, tmp_path, instance):
    box.api.closer_interactive.admit(1, home=box.home)
    launcher, env, trace = launcher_fixture(box, tmp_path)
    result = subprocess.run(["bash", str(launcher), "closer", instance],
                            env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert "interactive mission reserved" in result.stderr
    assert not trace.exists()


def test_launcher_check_then_admission_cannot_request_ordinary_spawn(box, tmp_path):
    launcher, env, trace = launcher_fixture(box, tmp_path, race=True)
    result = subprocess.run(["bash", str(launcher), "closer", "1"],
                            env=env, capture_output=True, text=True, timeout=10)
    record = box.api.closer_interactive.read(box.home)
    attempt = json.loads(Path(env["FIXTURE_ADMISSION_TRACE"]).read_text())
    if attempt["rc"] != 0:
        assert "SessionBusy" in attempt["stderr"], attempt
        assert record is None
        # Actual work-lock contention, not a substituted admission decision.
        return
    assert record and record["position_id"] == 1 and record["phase"] == "admitted", result.stderr
    calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
    assert "Error: template" not in result.stdout, (result.stdout, result.stderr)
    assert "Error: active_provider" not in result.stdout, (result.stdout, result.stderr)
    # This assertion is intentionally red if the real launcher reaches spawn.
    assert not any(call[:1] == ["new-session"] for call in calls), (calls, result.stdout, result.stderr)


def test_launcher_fixture_can_reach_inert_spawn_without_slot(box, tmp_path):
    launcher, env, trace = launcher_fixture(box, tmp_path, spawn_probe=True)
    result = subprocess.run(["bash", str(launcher), "closer", "1"],
                            env=env, capture_output=True, text=True, timeout=10)
    calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
    assert any(call[:1] == ["new-session"] for call in calls), (calls, result.stdout, result.stderr)
    assert result.returncode != 0
    fds = [json.loads(line) for line in Path(env["FIXTURE_FD_TRACE"]).read_text().splitlines()]
    assert all(not item["fd8"] and not item["fd9"] for item in fds), fds
    if env["FIXTURE_ADMIT_AT_SPAWN"] == "1":
        attempt = json.loads(Path(env["FIXTURE_SPAWN_ADMISSION_TRACE"]).read_text())
        assert attempt["rc"] != 0 and "SessionBusy" in attempt["stderr"], attempt
        assert box.api.closer_interactive.read(box.home) is None
    # Process exit must release the real admission barrier, even on failed spawn.
    with box.api.closer_interactive.work_lock(box.home):
        pass
    assert box.api.closer_interactive.admit(1, home=box.home)["phase"] == "admitted"


def test_actual_watchdog_respawn_uses_rejecting_launcher_and_never_kicks_off(box, tmp_path):
    box.api.closer_interactive.admit(1, home=box.home)
    launcher, env, trace = launcher_fixture(box, tmp_path)
    source = (SOURCE / ".launcher" / "agent-watchdog.sh").read_text()
    function = re.search(r"^respawn_worker\(\) \{\n.*?^\}\n", source, re.M | re.S).group()
    # Exact production function, isolated from the daemon loop; only logging,
    # roster and delivery dependencies are inert. Launcher itself is complete.
    script = '''
spawn_log_offset() { echo 0; }
spawn_detail_since() { :; }
log() { :; }
mark_roster_respawn() { :; }
observe_spawn_failure() { :; }
clear_spawn_failures() { :; }
is_session_alive() { echo UNEXPECTED_ALIVE_PROBE; return 0; }
worker_kickoff() { echo UNEXPECTED_KICKOFF; }
notify_captain_recovery() { echo UNEXPECTED_NOTIFICATION; }
''' + function + '\nrespawn_worker closer 1 CLOSER-1\n'
    env.update(START_AGENT=str(launcher), LOG=str(tmp_path / "watchdog.log"))
    result = subprocess.run(["bash", "-c", script], env=env, capture_output=True,
                            text=True, timeout=10)
    assert result.returncode == 1 and "UNEXPECTED" not in result.stdout
    assert "interactive mission reserved" in Path(env["LOG"]).read_text()
    assert not trace.exists()
