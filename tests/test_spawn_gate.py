"""spawn_gate.py: the seats of the host go first to the Analista and the Scorer that have positions waiting.

On a real run the host carried 4 workers, the Captain filled the 4 seats with Scouts, and 12 positions waited for an
Analista and a Scorer that were never started. The gate refuses the Scout that would take the seat, lets the Analista and
the Scorer in, and says which Scout to retire when the seats are all taken. It retires nothing.
"""
import json
import os
import re
import subprocess
import sys
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = REPO_ROOT / "shared" / "skills"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gate = _load("spawn_gate_under_test", SKILLS / "spawn_gate.py")


def workers(*names):
    """Live sessions, created in the order given (the last is the most recent)."""
    out = []
    for i, name in enumerate(names):
        role = re.match(r"[A-Z]+", name).group(0).lower()
        out.append((name, role, 1000.0 + i))
    return out


FOUR_SCOUTS = workers("SCOUT-1", "SCOUT-3", "SCOUT-2", "SCOUT-6")


# ── the four cases ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_1_seats_full_of_scouts_and_positions_waiting_refuses_the_scout_and_makes_room_for_the_others():
    waiting = {"analista": 12, "scorer": 3}
    scout = gate.decide("scout", FOUR_SCOUTS, 4, waiting)
    assert scout["verdict"] == "no_seat" and scout["reason"] == "seats_reserved" and scout["missing"] == ["analista", "scorer"]
    for role in ("analista", "scorer"):
        got = gate.decide(role, FOUR_SCOUTS, 4, waiting)
        assert got["verdict"] == "make_room" and got["retire"] == "SCOUT-6", got  # the most recent Scout
        assert "Retire SCOUT-6 to make room" in gate.message(got)
    assert "retire SCOUT-6 to make room" in gate.message(scout)


def test_2_with_the_queues_empty_nothing_is_reserved_but_the_cap_still_holds_for_the_scouts():
    empty = {"analista": 0, "scorer": 0}
    assert gate.decide("scout", workers("SCOUT-1", "SCOUT-2", "SCOUT-3"), 4, empty)["verdict"] == "go"
    full = gate.decide("scout", FOUR_SCOUTS, 4, empty)
    assert full["verdict"] == "no_seat" and full["reason"] == "cap_reached" and full["retire"] is None
    assert "retire" not in gate.message(full).lower().replace("not started", "")


def test_3_a_seat_is_kept_for_each_missing_role_and_the_scouts_take_the_rest():
    waiting = {"analista": 12, "scorer": 3}
    assert gate.decide("scout", workers("SCOUT-1"), 4, waiting)["verdict"] == "go", "1 live + 1 new + 2 kept = 4"
    assert gate.decide("scout", workers("SCOUT-1", "SCOUT-2"), 4, waiting)["verdict"] == "no_seat", "2 + 1 + 2 = 5"
    # the Analista is running: only the Scorer is kept a seat
    assert gate.decide("scout", workers("ANALISTA-1", "SCOUT-1"), 4, waiting)["verdict"] == "go", "2 + 1 + 1 = 4"
    assert gate.decide("scout", workers("ANALISTA-1", "SCOUT-1", "SCOUT-2"), 4, waiting)["verdict"] == "no_seat"
    # both running: the Scouts take what is left
    assert gate.decide("scout", workers("ANALISTA-1", "SCORER-1", "SCOUT-1"), 4, waiting)["verdict"] == "go"
    assert gate.decide("scout", workers("ANALISTA-1", "SCORER-1", "SCOUT-1", "SCOUT-2"), 4, waiting)["verdict"] == "no_seat"


def test_4_the_analista_and_the_scorer_get_in_while_there_is_a_seat():
    waiting = {"analista": 12, "scorer": 3}
    assert gate.decide("analista", workers("SCOUT-1", "SCOUT-2", "SCOUT-3"), 4, waiting)["verdict"] == "go"
    assert gate.decide("scorer", workers("SCOUT-1", "SCOUT-2", "SCOUT-3"), 4, waiting)["verdict"] == "go"
    # full, with a worker of the role already there: no seat is owed, and nothing is made up
    full = workers("ANALISTA-1", "SCOUT-1", "SCOUT-2", "SCOUT-3")
    assert gate.decide("analista", full, 4, waiting)["verdict"] == "no_seat"
    # full and nobody to retire (no Scout): it cannot invent one
    nobody = gate.decide("scorer", workers("ANALISTA-1", "SCRITTORE-1", "CRITICO", "ANALISTA-2"), 4, waiting)
    assert nobody["verdict"] == "no_seat" and nobody["retire"] is None


# ── the doubts go toward starting the worker ─────────────────────────────────────────────────────────────────────────
def test_a_cap_that_cannot_be_measured_a_session_list_that_cannot_be_read_or_a_queue_that_cannot_be_counted_is_no_gate():
    assert gate.decide("scout", FOUR_SCOUTS, None, {"analista": 12})["verdict"] == "go"
    assert gate.decide("scout", None, 4, {"analista": 12})["verdict"] == "go"
    # an unreadable queue is {}: no reservation, only the cap holds
    assert gate.decide("scout", workers("SCOUT-1", "SCOUT-2", "SCOUT-3"), 4, {})["verdict"] == "go"


@pytest.mark.parametrize("role", ["scrittore", "critico", "closer", "capitano", "sentinella", "mentor", "x"])
def test_the_other_roles_are_never_gated(role):
    assert gate.decide(role, FOUR_SCOUTS, 4, {"analista": 12})["verdict"] == "go"


def test_the_core_agents_do_not_take_a_seat():
    sessions = gate.WORKER_SESSION
    for core in ("CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE"):
        assert not sessions.match(core)
    for worker in ("SCOUT-1", "ANALISTA-2", "SCORER-6", "SCRITTORE-3", "CRITICO", "CRITICO-S2", "CLOSER-1"):
        assert sessions.match(worker)


# ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _run(*argv, home):
    env = {**os.environ, "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, "-I", str(SKILLS / "spawn_gate.py"), "check", *argv], env=env,
                          capture_output=True, text=True, timeout=60)


def test_the_command_exits_10_with_the_reason_on_stderr_and_a_closed_line_in_the_log(tmp_path):
    sessions = "SCOUT-1,SCOUT-3,SCOUT-2,SCOUT-6"
    refused = _run("--role", "scout", "--cap", "4", "--sessions", sessions, "--queues", "analista=12,scorer=3", "--json", home=tmp_path)
    assert refused.returncode == 10
    answer = json.loads(refused.stdout)
    assert answer["verdict"] == "no_seat" and answer["retire"] == "SCOUT-6" and "retire SCOUT-6" in refused.stderr
    room = _run("--role", "analista", "--cap", "4", "--sessions", sessions, "--queues", "analista=12,scorer=3", home=tmp_path)
    assert room.returncode == 10 and "Retire SCOUT-6 to make room" in room.stderr
    go = _run("--role", "analista", "--cap", "5", "--sessions", sessions, "--queues", "analista=12", home=tmp_path)
    assert go.returncode == 0 and go.stderr == ""
    lines = [json.loads(l) for l in (tmp_path / "logs" / "spawn-gate.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [l["verdict"] for l in lines] == ["no_seat", "make_room"], "a refusal leaves a line, a go leaves none"
    assert set(lines[0]) <= {"ts", "role", "verdict", "reason", "cap", "live", "missing", "retire"}


def test_the_command_reads_the_real_queues_of_the_database(tmp_path, monkeypatch):
    import sqlite3
    sys.path.insert(0, str(SKILLS))
    import _db
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    for i in range(3):
        conn.execute("INSERT INTO positions (title, company, status, url) VALUES (?, 'Acme', 'new', ?)", ("E%d" % i, "https://x.example/%d" % i))
    conn.commit()
    conn.close()
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_DB": str(db), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "spawn_gate.py"), "check", "--role", "scout", "--cap", "3",
                           "--sessions", "SCOUT-1,SCOUT-2", "--json"], env=env, capture_output=True, text=True, timeout=60)
    answer = json.loads(done.stdout)
    assert answer["waiting"] == {"analista": 3, "scorer": 0} and answer["missing"] == ["analista"]
    assert done.returncode == 10, "2 live + 1 new + 1 kept for the Analista waiting = 4 > 3"


# ── the shell side: who is gated ─────────────────────────────────────────────────────────────────────────────────────
def _gate_block():
    text = (REPO_ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    start = text.index("# --- cancello dei posti")
    return text[start: text.index("# --- fine cancello dei posti")]


def _shell(tmp_path, *, role="scout", agent="capitano", spawn_src="", session_exists=False, gate_rc=10, gate_off=""):
    calls = tmp_path / "calls.txt"
    script = (
        "set -u\n"
        'tmux() { return %d; }\n'
        'python3() { echo "gate $*" >> "%s"; return %d; }\n'
        'ROLE="%s"; SESSION="%s-9"\n%s\necho went-on\n'
        % (0 if session_exists else 1, calls, gate_rc, role, role.upper(), _gate_block())
    )
    env = {"PATH": os.environ["PATH"], "JHT_AGENT_NAME": agent, "JHT_SPAWN_SRC": spawn_src, "JHT_SPAWN_GATE": gate_off}
    done = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30)
    return done.returncode, done.stdout, calls.read_text(encoding="utf-8") if calls.exists() else ""


def test_the_captains_new_spawn_is_stopped_with_75_when_the_gate_says_no_seat(tmp_path):
    rc, out, calls = _shell(tmp_path, gate_rc=10)
    assert rc == 75 and "went-on" not in out and "spawn_gate.py check --role scout" in calls


@pytest.mark.parametrize("gate_rc", [0, 1, 2, 127])
def test_any_other_answer_of_the_gate_goes_on_to_start_the_worker(tmp_path, gate_rc):
    rc, out, _ = _shell(tmp_path, gate_rc=gate_rc)
    assert rc == 0 and "went-on" in out


@pytest.mark.parametrize("kwargs", [
    {"spawn_src": "agent-watchdog"},      # the watchdog's respawn of the same instance
    {"spawn_src": "agent-control"},       # the operator's team start
    {"agent": "dottore"},                 # the Doctor's refresh
    {"agent": ""},                        # a shell with no agent
    {"session_exists": True},             # a session that is already there is not a new spawn
    {"gate_off": "off"},
    {"role": "scrittore"},
])
def test_only_the_captains_new_spawns_of_the_three_roles_reach_the_gate(tmp_path, kwargs):
    rc, out, calls = _shell(tmp_path, gate_rc=10, **kwargs)
    assert rc == 0 and "went-on" in out and calls == ""


def test_the_gate_block_sits_after_the_mentors_and_before_the_lock_of_the_session():
    text = (REPO_ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    mentor, seats = text.index("# --- fine cancello del Mentor"), text.index("# --- cancello dei posti")
    assert mentor < seats < text.index('_spawn_stage="lock_wait"', seats), "before the session's lock, where the work begins"


@pytest.mark.parametrize("suffix", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_the_captain_is_told_in_seven_languages_to_retire_the_scout_the_gate_names_and_the_skill_says_75(suffix):
    prompt = (REPO_ROOT / "agents" / "capitano" / ("capitano%s.md" % suffix)).read_text(encoding="utf-8")
    block = next(l for l in prompt.splitlines() if l.startswith("**C-29"))
    for needle in ("spawn_gate.py", "host_agent_cap", "75", "Retire SCOUT-N to make room", "jht-agent-retire", "C-28"):
        assert needle in block, "%s: C-29 lacks %r" % (suffix or "en", needle)
    skill = (REPO_ROOT / "agents" / "_skills" / "spawn-agent" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    assert "75" in skill and "Retire SCOUT-N to make room" in skill and "C-29" in skill
    # the message the gate prints is the one the prompt quotes
    got = gate.decide("analista", FOUR_SCOUTS, 4, {"analista": 1})
    assert "Retire SCOUT-6 to make room" in gate.message(got)
