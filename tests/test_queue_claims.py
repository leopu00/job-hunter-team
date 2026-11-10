"""One position, one Analista (or one Scorer) at a time: the claim of `next-for-analista` / `next-for-scorer` (queue_claims.py).

On the burst of 10/11 the three Analisti all opened the same positions (24 of 24 were opened by at least two, 10 finished twice
or three times: the unique work of one Analista done by three) and the `new` queue stayed at 17-25 while the Scorers waited on
an empty queue. The soft lock of the protocol (stamp `last_checked`) depended on the agent; now the queue does it. Synthetic only.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import queue_claims  # noqa: E402


@pytest.fixture
def box(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    db = home / "jobs.db"
    env = {**os.environ, "JHT_HOME": str(home), "JHT_DB": str(db), "PYTHONDONTWRITEBYTECODE": "1"}
    for name in ("JHT_AGENT_NAME", "JHT_AGENT_ID"):
        env.pop(name, None)
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JHT_HOME", str(home))
    seed = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, %r); from _db import get_db, ensure_schema; c = get_db(); ensure_schema(c)" % str(SKILLS)],
        env=env, capture_output=True, text=True, timeout=60)
    assert seed.returncode == 0, seed.stderr

    def add(status, n):
        conn = sqlite3.connect(db)
        ids = [conn.execute("INSERT INTO positions (title, company, status) VALUES (?, 'Acme', ?)", (f"Engineer {i}", status)).lastrowid
               for i in range(n)]
        conn.commit()
        conn.close()
        return ids

    def ask(queue, agent=None, *extra):
        e = dict(env)
        if agent:
            e["JHT_AGENT_NAME"] = agent
        done = subprocess.run([sys.executable, str(SKILLS / "db_query.py"), queue, "--json", *extra], env=e, capture_output=True, text=True, timeout=60)
        assert done.returncode == 0, done.stdout + done.stderr
        return json.loads(done.stdout)

    return type("Box", (), {"home": home, "db": db, "env": env, "add": staticmethod(add), "ask": staticmethod(ask)})


def ids(answer):
    return [row["id"] for row in answer["rows"]]


def test_two_analisti_do_not_get_the_same_position(box):
    box.add("new", 4)
    first = box.ask("next-for-analista", "analista-1")
    second = box.ask("next-for-analista", "analista-2")
    assert ids(first)[0] != ids(second)[0]
    assert ids(first)[0] not in ids(second)           # what a colleague holds is not offered at all
    assert second["total"] == 3 and first["total"] == 4


def test_the_same_analista_asking_again_gets_its_own_position_back(box):
    box.add("new", 3)
    mine = ids(box.ask("next-for-analista", "analista-1"))[0]
    assert ids(box.ask("next-for-analista", "analista-1"))[0] == mine
    assert ids(box.ask("next-for-analista", "analista-2"))[0] != mine


def test_the_run_of_the_burst_three_analisti_on_a_queue_take_a_position_each_until_it_is_over(box):
    box.add("new", 5)
    taken = []
    for agent in ("analista-1", "analista-2", "analista-5"):
        taken.append(ids(box.ask("next-for-analista", agent))[0])
    assert len(set(taken)) == 3                         # before: the three opened the same, the oldest one
    fourth = ids(box.ask("next-for-analista", "analista-9"))[0]
    fifth = ids(box.ask("next-for-analista", "analista-8"))[0]
    assert len({*taken, fourth, fifth}) == 5           # the fourth and the fifth get what is left
    assert box.ask("next-for-analista", "analista-7")["rows"] == []  # nothing is left for a sixth: it is not offered a duplicate


def test_a_position_that_leaves_the_queue_frees_nothing_it_just_stops_being_listed(box):
    first, second = box.add("new", 2)
    assert ids(box.ask("next-for-analista", "analista-1"))[0] == first
    conn = sqlite3.connect(box.db)
    conn.execute("UPDATE positions SET status = 'checked' WHERE id = ?", (first,))
    conn.commit()
    conn.close()
    assert ids(box.ask("next-for-analista", "analista-2")) == [second]
    assert ids(box.ask("next-for-analista", "analista-1")) == []     # the second is held by the other now


def test_two_scorers_do_not_get_the_same_position_either(box):
    box.add("checked", 3)
    one = box.ask("next-for-scorer", "scorer-4")
    two = box.ask("next-for-scorer", "scorer-5")
    assert ids(one)[0] != ids(two)[0] and ids(one)[0] not in ids(two)


def test_the_queues_of_the_two_roles_are_separate(box):
    (pid,) = box.add("new", 1)
    box.ask("next-for-analista", "analista-1")
    assert queue_claims.holder("analista", pid) == "analista-1"
    assert queue_claims.holder("scorer", pid) is None


def test_a_caller_that_is_not_an_agent_gets_the_queue_as_it_was_and_claims_nothing(box):
    box.add("new", 3)
    assert len(ids(box.ask("next-for-analista", None))) == 3
    assert not (box.home / "queue-claims").exists()
    box.ask("next-for-analista", "analista-1")
    assert len(ids(box.ask("next-for-analista", None))) == 3  # the bridge and a person still see all of it


def test_a_claim_is_over_after_its_time(box):
    (pid,) = box.add("new", 1)
    assert queue_claims.claim("analista", pid, "analista-1", now=1000.0)
    assert not queue_claims.claim("analista", pid, "analista-2", now=1000.0 + queue_claims.TTL_SEC - 1)
    assert queue_claims.holder("analista", pid, now=1000.0 + queue_claims.TTL_SEC - 1) == "analista-1"
    assert queue_claims.claim("analista", pid, "analista-2", now=1000.0 + queue_claims.TTL_SEC + 1)
    assert queue_claims.holder("analista", pid, now=1000.0 + queue_claims.TTL_SEC + 2) == "analista-2"


def test_of_many_callers_at_once_exactly_one_gets_a_position(box):
    wins = []
    barrier = threading.Barrier(8)

    def go(n):
        barrier.wait()
        wins.append(queue_claims.claim("analista", 7, f"analista-{n}"))

    threads = [threading.Thread(target=go, args=(n,)) for n in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert wins.count(True) == 1


def test_of_many_callers_at_once_on_many_positions_each_position_has_one_winner(box):
    # the claim must never be seen empty between its creation and its body (a reader took an empty file for an
    # old claim, moved it and took the position too: 3 winners instead of 1 on 16 processors)
    positions = range(100, 160)
    wins = {p: [] for p in positions}
    barrier = threading.Barrier(8)

    def go(n):
        barrier.wait()
        for p in positions:
            if queue_claims.claim("analista", p, f"analista-{n}"):
                wins[p].append(n)

    threads = [threading.Thread(target=go, args=(n,)) for n in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert [p for p in positions if len(wins[p]) != 1] == []


def test_an_empty_claim_file_that_is_young_is_still_held(box, monkeypatch):
    # a claim file made by a caller that has not written its body yet (a disk with no hard links) holds the position
    directory = queue_claims._dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "analista-9").write_text("", encoding="utf-8")
    assert queue_claims.claim("analista", 9, "analista-2") is False
    assert queue_claims.claim("analista", 9, "analista-2", now=queue_claims.time.time() + queue_claims.TTL_SEC + 5) is True


def test_a_claim_is_published_whole_and_leaves_no_file_behind(box):
    assert queue_claims.claim("analista", 4, "analista-1") is True
    names = sorted(e.name for e in queue_claims._dir().iterdir())
    assert names == ["analista-4"]
    assert json.loads((queue_claims._dir() / "analista-4").read_text(encoding="utf-8"))["agent"] == "analista-1"
    # the same agent again renews it in place; nobody else gets it
    assert queue_claims.claim("analista", 4, "analista-1") is True
    assert queue_claims.claim("analista", 4, "analista-2") is False
    assert sorted(e.name for e in queue_claims._dir().iterdir()) == ["analista-4"]


def test_an_agent_of_another_role_lists_the_queue_and_holds_nothing(box):
    box.add("new", 3)
    for other in ("capitano", "critico-1", "scout-2", "scorer-1"):
        answer = box.ask("next-for-analista", other)
        assert answer["total"] == 3                            # the queue as it was, nobody's position taken out of it
    assert not queue_claims._dir().exists() or list(queue_claims._dir().iterdir()) == []
    # and the Analista who comes after still gets the first one
    assert ids(box.ask("next-for-analista", "analista-1"))[0] == ids(box.ask("next-for-analista"))[0]
    assert [e.name for e in queue_claims._dir().iterdir()] == [f"analista-{ids(box.ask('next-for-analista'))[0]}"]


def test_the_count_for_an_agent_of_another_role_leaves_nothing_out(box):
    box.add("new", 3)
    box.ask("next-for-analista", "analista-1")
    sys.path.insert(0, str(SKILLS))
    import importlib
    import db_query
    importlib.reload(db_query)
    c = sqlite3.connect(box.db)
    try:
        assert db_query.role_queue_count(c, "analista", for_agent="critico-1") == 3
        assert db_query.role_queue_count(c, "analista", for_agent="analista-2") == 2
    finally:
        c.close()


def test_a_claim_file_with_a_digit_that_is_not_ascii_cannot_bring_the_queue_down(box):
    # str.isdigit() is true for «²» and int() then raises: the whole next-for-* of the box would fall
    box.add("new", 2)
    directory = queue_claims._dir()
    directory.mkdir(parents=True, exist_ok=True)
    for name in ("analista-\u00b2", "analista-\u0663", "analista-", "analista-1.old", "analista-" + "9" * 40):
        (directory / name).write_text(json.dumps({"agent": "analista-9", "at": queue_claims.time.time()}), encoding="utf-8")
    assert queue_claims.claimed_by_others("analista", "analista-1") == set()
    answer = box.ask("next-for-analista", "analista-1")
    assert answer["total"] == 2


def test_what_sits_where_a_claim_should_be_is_not_read_when_it_is_not_one(box):
    directory = queue_claims._dir()
    directory.mkdir(parents=True, exist_ok=True)
    os.mkfifo(directory / "analista-5")
    (directory / "analista-6").write_bytes(b" " * (queue_claims.MAX_CLAIM_BYTES + 10) + json.dumps({"agent": "analista-9", "at": queue_claims.time.time()}).encode())
    real = directory.parent / "real.json"
    real.write_text(json.dumps({"agent": "analista-9", "at": queue_claims.time.time()}), encoding="utf-8")
    (directory / "analista-7").symlink_to(real)
    outcome = {}

    def go():
        outcome["taken"] = queue_claims.claimed_by_others("analista", "analista-1")
        outcome["holder"] = [queue_claims.holder("analista", n) for n in (5, 6, 7)]

    thread = threading.Thread(target=go, daemon=True)
    thread.start()
    thread.join(10)
    assert not thread.is_alive(), "reading a claim waited on a pipe"
    assert outcome["taken"] == set() and outcome["holder"] == [None, None, None]


def test_a_claim_stamped_in_the_future_does_not_hold_the_position_for_ever(box):
    directory = queue_claims._dir()
    directory.mkdir(parents=True, exist_ok=True)
    now = queue_claims.time.time()
    (directory / "analista-3").write_text(json.dumps({"agent": "analista-9", "at": now + 10 * 365 * 86400}), encoding="utf-8")
    assert queue_claims.holder("analista", 3) is None
    assert queue_claims.claimed_by_others("analista", "analista-1") == set()
    # a little skew between two clocks is believed
    (directory / "analista-4").write_text(json.dumps({"agent": "analista-9", "at": now + 5}), encoding="utf-8")
    assert queue_claims.holder("analista", 4) == "analista-9"


def test_the_count_for_an_agent_leaves_out_what_a_colleague_holds(box):
    box.add("new", 3)
    box.ask("next-for-analista", "analista-1")
    sys.path.insert(0, str(SKILLS))
    import importlib
    import db_query
    importlib.reload(db_query)
    c = sqlite3.connect(box.db)
    try:
        assert db_query.role_queue_count(c, "analista") == 3                          # the total, as the wake and the gate read it
        assert db_query.role_queue_count(c, "analista", for_agent="analista-1") == 3  # its own position is its own
        assert db_query.role_queue_count(c, "analista", for_agent="analista-2") == 2
    finally:
        c.close()


# ── the pause of a worker looks at what IT can take ───────────────────────────
from test_throttle_engine import (  # noqa: E402,F401  (the fixtures are imported by name)
    T0, _jobs_db, burn, eng, events, home, set_config,
)


def _two_new(db):
    conn = sqlite3.connect(db)
    conn.execute("DELETE FROM positions")
    ids_ = [conn.execute("INSERT INTO positions (title, company, status) VALUES (?, 'Acme', 'new')", (f"Engineer {i}",)).lastrowid for i in range(2)]
    conn.commit()
    conn.close()
    return ids_


def test_a_queue_that_is_all_in_the_hands_of_colleagues_is_not_work_waiting_for_the_worker(home, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(home))
    set_config(home, **{"analista-1": 780})
    first, second = _two_new(_jobs_db(home, monkeypatch))
    assert queue_claims.claim("analista", first, "analista-2") and queue_claims.claim("analista", second, "analista-3")
    # nothing here for analista-1: the Capitano's pause, as with an empty queue (no spin on a queue it cannot touch)
    res = eng.register("analista-1", now=T0)
    assert res["applied_sec"] == 780 and "queued_work" not in res
    # one position free again (the claim of analista-3 is over): the queue is work waiting, and no pause
    assert queue_claims.claim("analista", second, "analista-3", now=1.0)          # an old claim, long over
    os.utime(queue_claims._path("analista", second), (1.0, 1.0))
    res = eng.register("analista-1", now=T0 + 10)
    assert res["applied_sec"] == 0 and res["queued_work"] == 1
