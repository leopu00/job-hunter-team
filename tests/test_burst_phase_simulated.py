"""The first burst, phase by phase, on a made-up team: the brake, the roster and a 30-minute run with no API.

What the measurement of a real run cannot see by itself (a run costs money and shows one roster):

  1. the brake. A worker whose own queue has positions waiting does not pause (Analista: `new`; Scorer: `checked`
     with no score). With the queue empty the Capitano's pause stays, and in the burst it is cut to `burst_wait`
     (60 s). A queue that fills DURING that pause wakes the worker (event_wake). The spend brake still wins.
  2. the roster. `plan_registry.burst_roster()` for every provider of the app (kimi, claude, openai with their plans;
     glm through its API key and the spending ceiling): at least one worker per role, the machine's cap respected,
     and the direction the measurement asked for in the middle tiers (more Analisti and Scorers, no fewer Scouts).
  3. a burst simulated with the REAL throttle engine and a made-up database: positions arrive, the Analisti check
     them, the Scorers score them, and the run counts positions -> checked -> scored in 30 minutes and says whether
     an Analista or a Scorer slept with its queue full.

The simulation is a model, not a measurement: the Scouts are an arrival curve (they are not under the brake being
tested), the durations of the units are fixed numbers, and time is the `now` the engine is given. Nothing sleeps, no
network, no key, no money; every name, title and company below is made up.

Run:
    pytest tests/test_burst_phase_simulated.py -v
"""

import heapq
import importlib.util
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))

import event_wake as ew  # noqa: E402
import host_capacity as hc  # noqa: E402
import plan_registry  # noqa: E402

NOW = 1_800_000_000
CAPTAINS_PAUSE = 300
BURST_CAP = json.loads((REPO_ROOT / "agents/_skills/throttle/pause-rules.json").read_text(encoding="utf-8"))["burst_wait"]["cap_sec"]


# ── a made-up home with a burst running ──────────────────────────────────────────────────────────────────────────

def _iso(epoch):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds")


@pytest.fixture
def team(tmp_path, monkeypatch):
    """(engine, home): a fresh throttle engine, JHT_HOME and JHT_DB of this test, an empty schema, a burst that began
    one second before NOW and every agent on the Capitano's pause of 300 s."""
    db = tmp_path / "jobs.db"
    for key in ("JHT_HOME", "JHT_DB"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(db))
    # The engine imports db_query, which imports `_db` by name: one left in sys.modules by another test file would
    # count the queues in THAT file's database. In production the engine is a process of its own.
    for name in ("_db", "db_query"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    spec = importlib.util.spec_from_file_location("throttle_engine_burst_phase", SKILLS_DIR / "throttle_engine.py")
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    engine._MODULE_CACHE.clear()
    seed = subprocess.run(
        [sys.executable, "-c", "import sys; sys.path.insert(0, %r); from _db import get_db, ensure_schema; "
         "c = get_db(); ensure_schema(c); c.commit()" % str(SKILLS_DIR)],
        capture_output=True, text=True, timeout=60)
    assert seed.returncode == 0, seed.stderr
    (tmp_path / "config").mkdir(exist_ok=True)
    (tmp_path / "config" / "throttle.json").write_text(json.dumps({"default": CAPTAINS_PAUSE}), encoding="utf-8")
    set_phase(tmp_path, "burst")
    return engine, tmp_path


def set_phase(home, phase):
    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "first-run.json").write_text(
        json.dumps({"phase": phase, "burst_started_at": _iso(NOW - 1)}), encoding="utf-8")


def db(home):
    conn = sqlite3.connect(str(home / "jobs.db"), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def add_positions(home, n, status="new", tag="p"):
    conn = db(home)
    for i in range(n):
        conn.execute("INSERT INTO positions (title, company, url, status, found_by) VALUES (?, ?, ?, ?, 'scout-1')",
                     (f"Made-up role {tag}{i}", f"Made-up company {tag}{i}", f"https://jobs.example/{tag}{i}", status))
    conn.commit()
    conn.close()


def events(engine, kind=None):
    path = engine.event_log_path()
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.exists() else []
    return [row for row in rows if row.get("event", row.get("kind")) == kind] if kind else rows


def kinds(engine, agent):
    return [row.get("event", row.get("kind")) for row in events(engine) if row.get("agent") == agent]


# ── 1. the brake ─────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("phase", ["burst", "steady"])
@pytest.mark.parametrize(("agent", "status"), [("analista-1", "new"), ("scorer-1", "checked")])
def test_a_full_queue_is_no_pause_for_the_analista_and_the_scorer(team, phase, agent, status):
    engine, home = team
    set_phase(home, phase)
    add_positions(home, 4, status=status)
    res = engine.register(agent, reason="end of unit", now=NOW)
    assert res["armed"] is False and res["applied_sec"] == 0 and res["queued_work"] == 4, res
    assert "no_throttle" in kinds(engine, agent)
    assert "armed" not in kinds(engine, agent), "a worker with work waiting must never be armed"


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1"])
def test_a_queue_of_one_position_is_enough_for_no_pause(team, agent):
    engine, home = team
    add_positions(home, 1, status="new" if agent.startswith("analista") else "checked")
    assert engine.register(agent, now=NOW)["applied_sec"] == 0


def test_the_queue_that_counts_is_the_queue_of_the_role(team):
    """Positions waiting for the Scorer do not keep the Analista awake, and the other way round: each queue is its own."""
    engine, home = team
    add_positions(home, 3, status="checked", tag="c")            # the Scorer's queue only
    assert engine.register("analista-1", now=NOW)["applied_sec"] == BURST_CAP, "nothing `new` for the Analista"
    assert engine.register("scorer-1", now=NOW)["applied_sec"] == 0
    conn = db(home)
    conn.execute("UPDATE positions SET status = 'new'")          # the Analista's queue only
    conn.commit()
    conn.close()
    assert engine.register("analista-2", now=NOW)["applied_sec"] == 0
    assert engine.register("scorer-2", now=NOW)["applied_sec"] == BURST_CAP


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1", "scout-1"])
def test_in_the_burst_an_empty_queue_waits_at_most_a_minute(team, agent):
    engine, home = team
    res = engine.register(agent, reason="nothing to do", now=NOW)
    assert 0 < res["applied_sec"] <= BURST_CAP == 60, res
    assert res["armed"] is True


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1", "scout-1"])
def test_outside_the_burst_an_empty_queue_keeps_the_captains_pause(team, agent):
    engine, home = team
    set_phase(home, "steady")
    assert engine.register(agent, now=NOW)["applied_sec"] == CAPTAINS_PAUSE


def test_a_queue_that_fills_during_the_pause_wakes_the_worker(team):
    engine, home = team
    res = engine.register("analista-1", reason="empty queue", now=NOW)
    assert res["armed"] and res["until"] == NOW + BURST_CAP
    add_positions(home, 2, status="new")                          # a Scout lands two positions while it waits
    out = ew.pull_forward("analista-1", NOW + 10, engine)
    assert out["pulled"] is True and out["left_sec"] == BURST_CAP - 10, out
    assert engine.get_flag("analista-1")["until"] == NOW + 10
    assert engine.pending_until("analista-1", now=NOW + 11) is None, "the shim blocked on the pause is free to leave"


def test_the_wake_of_the_event_picks_the_worker_in_a_pause_and_leaves_the_busy_one(team):
    engine, home = team
    assert engine.register("scorer-1", reason="empty queue", now=NOW)["armed"]
    add_positions(home, 1, status="checked")
    conn = db(home)

    def queue(role):
        return conn.execute("SELECT COUNT(*) FROM positions p LEFT JOIN scores s ON s.position_id = p.id "
                            "WHERE p.status = 'checked' AND s.id IS NULL").fetchone()[0] if role == "scorer" else 0
    sent = []
    out = ew.wake("scorer", now=NOW + 5, home=home, queue=queue,
                  sessions=lambda role: {"SCORER-1": 1.0, "SCORER-2": 1.0},
                  derive=lambda uid, created, n, h: {"state": "busy", "since": NOW},
                  paused=lambda session, h: False, send=lambda s, t: sent.append(s) or True,
                  blocked=lambda h, n: None, flag_of=engine.get_flag,
                  pull=lambda uid, at: ew.pull_forward(uid, at, engine), hold=engine.captains_pause_stays)
    conn.close()
    assert out["woken"] == "scorer-1" and out["via"] == "throttle", out
    assert sent == [], "the one in a pause is brought forward; nobody gets a message"


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1"])
def test_the_spend_brake_still_wins_over_a_full_queue_in_the_burst(team, monkeypatch, agent):
    engine, home = team
    add_positions(home, 5, status="new" if agent.startswith("analista") else "checked")
    monkeypatch.setattr(engine, "captains_pause_stays", lambda now: {"reason": "recovery after a freeze"})
    res = engine.register(agent, now=NOW)
    assert res["applied_sec"] == CAPTAINS_PAUSE and res["armed"] is True, res


@pytest.mark.parametrize("agent", ["analista-1", "scorer-1"])
def test_a_queue_that_cannot_be_read_is_the_captains_pause_not_a_free_run(team, monkeypatch, agent):
    engine, home = team
    monkeypatch.setattr(engine, "queued_work", lambda a: 0)
    monkeypatch.setattr(engine, "queue_is_empty", lambda a: False)
    res = engine.register(agent, now=NOW)
    assert res["applied_sec"] == CAPTAINS_PAUSE and res["armed"] is True, res


# ── 2. the roster ────────────────────────────────────────────────────────────────────────────────────────────────

def _all_plans():
    out = []
    for provider, plans in plan_registry.PLANS.items():
        out += [pytest.param(dict(plan, provider=provider), id=f"{provider}-{plan['id']}") for plan in plans]
    return out


def api_key_plan(home, monkeypatch, eur, provider="glm"):
    """glm has no plan table: with an API key the plan is made from the spending ceiling (`no_quota_cap.eur`)."""
    monkeypatch.setenv("JHT_HOME", str(home))
    cfg = {"active_provider": provider, "providers": {provider: {"auth_method": "api_key"}}}
    if eur is not None:
        cfg["no_quota_cap"] = {"eur": eur}
    (home / "jht.config.json").write_text(json.dumps(cfg), encoding="utf-8")
    return plan_registry.api_key_plan(cfg, provider)


@pytest.mark.parametrize("plan", _all_plans())
def test_every_plan_of_every_provider_has_a_worker_for_each_role(plan):
    got = plan_registry.burst_roster(plan, host_cap=100)
    assert got["ok"] and set(got["roster"]) == {"scout", "analista", "scorer"}
    assert all(n >= 1 for n in got["roster"].values()), got["roster"]
    assert got["total_workers"] == sum(got["roster"].values())
    assert got["scout_cap_first_pass"] >= 1 and got["target_scored"] >= 1


@pytest.mark.parametrize("plan", _all_plans())
@pytest.mark.parametrize("cap", [3, 4, 5, 6, 7, 8, 10])
def test_the_roster_never_goes_over_the_cap_of_the_machine(plan, cap):
    free = plan_registry.burst_roster(plan, host_cap=100)
    got = plan_registry.burst_roster(plan, host_cap=cap)
    assert got["total_workers"] <= cap, (cap, got["roster"])
    assert all(got["roster"][role] <= free["roster"][role] for role in got["roster"]), "a cap only ever cuts"
    assert all(n >= 1 for n in got["roster"].values())
    assert got["capped_by_host"] is (free["total_workers"] > cap)


@pytest.mark.parametrize("cap", [1, 2])
def test_a_machine_that_cannot_carry_three_workers_still_gets_one_per_role(cap):
    """Under one worker per role the limit is the machine, not the roster: the floor is 1/1/1 (documented in
    plan_registry.burst_roster). The Capitano is told by `capped_by_host` and the note."""
    got = plan_registry.burst_roster(dict(plan_registry.find_plan("claude", "max20"), provider="claude"), host_cap=cap)
    assert got["roster"] == {"scout": 1, "analista": 1, "scorer": 1} and got["capped_by_host"] is True


@pytest.mark.parametrize(("ram_gib", "cores", "harness"), [
    (2.0, 2, "codex"), (4.0, 2, "codex"), (6.0, 4, "codex"), (8.0, 4, "claude"), (16.0, 8, "claude"), (64.0, 16, "codex")])
def test_the_roster_follows_the_measured_machine_for_each_provider(monkeypatch, ram_gib, cores, harness):
    """Made-up machines through host_capacity: whatever the provider, the workers started are at most what the machine
    carries (a roster is never what overloads it), and a stronger machine never gets fewer workers than a weaker one."""
    machine = {"ram_total_gib": ram_gib, "ram_avail_gib": ram_gib * 0.6, "cores": cores, "load5": 1.0}
    capacity = hc.capacity(machine, harness)
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: capacity)
    for plan in (dict(plan_registry.find_plan(p, i), provider=p) for p, i in
                 (("kimi", "allegro"), ("claude", "max20"), ("openai", "pro-max"), ("openai", "plus"))):
        got = plan_registry.burst_roster(plan)
        assert got["total_workers"] <= max(capacity["cap"], 3), (plan["provider"], plan["id"], capacity["cap"], got["roster"])
        assert got["host_agent_cap"] == capacity["cap"]


@pytest.mark.parametrize(("eur", "tier"), [(None, 1), (5, 1), (10, 5), (29.99, 5), (30, 15), (200, 15)])
def test_glm_with_an_api_key_gets_its_roster_from_the_spending_ceiling(tmp_path, monkeypatch, eur, tier):
    plan = api_key_plan(tmp_path, monkeypatch, eur)
    assert plan["id"] == "api-key" and plan["tier"] == tier and plan["provider"] == "glm"
    got = plan_registry.burst_roster(host_cap=100)               # the plan is read from the configuration, not assumed
    assert got["ok"] and got["provider"] == "glm" and got["tier"] == tier
    assert all(n >= 1 for n in got["roster"].values())


def test_the_bigger_the_ceiling_the_bigger_the_glm_roster_and_never_smaller(tmp_path, monkeypatch):
    sizes = []
    for eur in (None, 10, 30):
        api_key_plan(tmp_path, monkeypatch, eur)
        got = plan_registry.burst_roster(host_cap=100)
        sizes.append(got["roster"])
    for small, big in zip(sizes, sizes[1:]):
        assert all(big[role] >= small[role] for role in big) or big["analista"] + big["scorer"] >= small["analista"] + small["scorer"], sizes


@pytest.mark.parametrize("tier_plan", [
    pytest.param(("kimi", "allegro"), id="kimi-allegro-15"),
    pytest.param(("claude", "max20"), id="claude-max20-20"),
    pytest.param(("openai", "pro-max"), id="openai-pro-max-20"),
])
def test_the_middle_and_top_tiers_have_more_analisti_and_scorers_and_no_fewer_scouts(tier_plan):
    """The measurement of 10/11 (analisti drain the queue as soon as the pause goes; the limit is the Scouts' supply and
    then the Scorer): the roster of these tiers is NOT 3/2/1 and 4/2/2 any more, and has no fewer Scouts than before.
    Red until the roster of the burst phase is changed."""
    provider, plan_id = tier_plan
    plan = dict(plan_registry.find_plan(provider, plan_id), provider=provider)
    old = {"allegro": {"scout": 3, "analista": 2, "scorer": 1}}.get(plan_id, {"scout": 4, "analista": 2, "scorer": 2})
    got = plan_registry.burst_roster(plan, host_cap=100)["roster"]
    assert got["analista"] >= 3 and got["scorer"] >= 2, got
    assert got["scout"] >= old["scout"], got


def test_glm_in_the_30_euro_band_gets_the_middle_roster_the_measurement_asked_for(tmp_path, monkeypatch):
    api_key_plan(tmp_path, monkeypatch, 30)
    got = plan_registry.burst_roster(host_cap=100)
    assert got["tier"] == 15 and got["roster"]["scout"] >= 5 and got["roster"]["analista"] >= 3 and got["roster"]["scorer"] >= 2, got


# ── 3. a burst of 30 minutes, simulated ──────────────────────────────────────────────────────────────────────────

SIM_MINUTES = 30
SCOUT_RATE_EARLY = 0.7        # positions per minute per Scout in the first 11 minutes of the burst
SCOUT_RATE_LATE = 0.09        # ... and after
SCOUT_EARLY_MIN = 11
CHECKED_SHARE = 0.58          # the share of positions the Analista passes on (the rest is excluded)
ANALISTA_SEC = 70
SCORER_SEC = 56
CHECK_SEC = 10                # a look at an empty queue
PARKED = "review"             # a position being worked: neither the Analista's queue nor the Scorer's counts it


def arrival_times(scouts, cap):
    """Seconds (from the start of the burst) at which positions land: each Scout follows the same made-up curve, and
    the team stops at the cap of the first pass."""
    times = []
    for scout in range(scouts):
        t, produced = 0.0, 0.0
        while t < SIM_MINUTES * 60:
            minute = t / 60
            rate = SCOUT_RATE_EARLY if minute < SCOUT_EARLY_MIN else SCOUT_RATE_LATE
            t += 1.0
            produced += rate / 60
            if produced >= 1.0:
                produced -= 1.0
                times.append(t + scout * 0.001)
    return sorted(times)[:cap]


def simulate(engine, home, roster, cap):
    """The burst with the real engine: returns the counts and the seconds the Analisti and the Scorers slept with a
    queue that was not empty."""
    conn = db(home)
    seq = 0
    heap = []

    def push(t, kind, who=None):
        nonlocal seq
        seq += 1
        heapq.heappush(heap, (t, seq, kind, who))

    agents = ([f"analista-{i + 1}" for i in range(roster["analista"])] + [f"scorer-{i + 1}" for i in range(roster["scorer"])])
    for i, agent in enumerate(agents):
        push(NOW + 0.01 * i, "ready", agent)
    for n, t in enumerate(arrival_times(roster["scout"], cap)):
        push(NOW + t, "arrive", n)
    end = NOW + SIM_MINUTES * 60
    slept_with_work = {"analista": 0, "scorer": 0}
    pauses_with_empty_queue = []
    passed = 0
    working = {}
    ready_at = {}
    stale = set()

    def queue(role):
        if role == "analista":
            return conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'new'").fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM positions p LEFT JOIN scores s ON s.position_id = p.id "
                            "WHERE p.status = 'checked' AND s.id IS NULL").fetchone()[0]

    def wake(role, now):
        """The event wake: one sleeping worker of the role is brought forward when its queue has something."""
        if queue(role) <= 0:
            return
        for agent in sorted(a for a in agents if a.startswith(role + "-")):
            until = ready_at.get(agent)
            if until is not None and until - now > 15 and agent not in working:
                if ew.pull_forward(agent, now, engine).get("pulled"):
                    stale.add((agent, until))
                    ready_at[agent] = now
                    push(now, "ready", agent)
                    return

    while heap and heap[0][0] <= end:
        t, _, kind, who = heapq.heappop(heap)
        if kind == "arrive":
            conn.execute("INSERT INTO positions (title, company, url, status, found_by) VALUES (?, ?, ?, 'new', 'scout-1')",
                         (f"Made-up role {who}", f"Made-up company {who}", f"https://jobs.example/sim{who}"))
            conn.commit()
            wake("analista", t)
        elif kind == "ready":
            if (who, t) in stale:
                stale.discard((who, t))
                continue
            ready_at.pop(who, None)
            role = who.split("-")[0]
            if role == "analista":
                row = conn.execute("SELECT id FROM positions WHERE status = 'new' ORDER BY id LIMIT 1").fetchone()
                dur = ANALISTA_SEC
            else:
                row = conn.execute("SELECT p.id FROM positions p LEFT JOIN scores s ON s.position_id = p.id "
                                   "WHERE p.status = 'checked' AND s.id IS NULL ORDER BY p.id LIMIT 1").fetchone()
                dur = SCORER_SEC
            if row is None:
                push(t + CHECK_SEC, "finish", who)
                working[who] = None
            else:
                conn.execute("UPDATE positions SET status = ? WHERE id = ?", (PARKED, row[0]))
                conn.commit()
                push(t + dur, "finish", who)
                working[who] = row[0]
        elif kind == "finish":
            role = who.split("-")[0]
            pid = working.pop(who, None)
            if pid is not None and role == "analista":
                passed += 1
                ok = int(passed * CHECKED_SHARE) > int((passed - 1) * CHECKED_SHARE)
                conn.execute("UPDATE positions SET status = ? WHERE id = ?", ("checked" if ok else "excluded", pid))
                conn.commit()
                if ok:
                    wake("scorer", t)
            elif pid is not None:
                conn.execute("INSERT INTO scores (position_id, total_score, scored_by) VALUES (?, 70, ?)", (pid, who))
                conn.execute("UPDATE positions SET status = 'scored' WHERE id = ?", (pid,))
                conn.commit()
            res = engine.register(who, reason="end of unit", now=t)
            applied = int(res["applied_sec"])
            waiting = queue(role)
            if waiting > 0 and applied > 0:
                slept_with_work[role] += applied
            if waiting == 0:
                pauses_with_empty_queue.append(applied)
            ready_at[who] = t + applied
            push(t + applied, "ready", who)
    counts = {status: n for status, n in conn.execute("SELECT status, COUNT(*) FROM positions GROUP BY status")}
    scored = conn.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
    found = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    conn.close()
    return {"found": found, "analysed": found - counts.get("new", 0) - counts.get(PARKED, 0), "scored": scored,
            "slept_with_work": slept_with_work, "pauses_with_empty_queue": pauses_with_empty_queue}


def fresh_team(tmp_path_factory, monkeypatch, name):
    """The `team` fixture, for a second independent run in the same test."""
    home = tmp_path_factory.mktemp(name)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(home / "jobs.db"))
    for module in ("_db", "db_query"):
        monkeypatch.delitem(sys.modules, module, raising=False)
    spec = importlib.util.spec_from_file_location("throttle_engine_burst_sim_" + name, SKILLS_DIR / "throttle_engine.py")
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    engine._MODULE_CACHE.clear()
    seed = subprocess.run(
        [sys.executable, "-c", "import sys; sys.path.insert(0, %r); from _db import get_db, ensure_schema; "
         "c = get_db(); ensure_schema(c); c.commit()" % str(SKILLS_DIR)],
        capture_output=True, text=True, timeout=60)
    assert seed.returncode == 0, seed.stderr
    (home / "config").mkdir(exist_ok=True)
    (home / "config" / "throttle.json").write_text(json.dumps({"default": CAPTAINS_PAUSE}), encoding="utf-8")
    set_phase(home, "burst")
    return engine, home


def test_in_the_simulated_burst_nobody_who_reads_a_queue_sleeps_with_work_in_it(tmp_path_factory, monkeypatch):
    engine, home = fresh_team(tmp_path_factory, monkeypatch, "full")
    roster = plan_registry.burst_roster(dict(plan_registry.find_plan("kimi", "allegro"), provider="kimi"), host_cap=100)
    out = simulate(engine, home, roster["roster"], roster["scout_cap_first_pass"])
    assert out["slept_with_work"] == {"analista": 0, "scorer": 0}, out
    assert out["found"] > 0 and out["scored"] > 0, "the model has to produce something to be a test of anything"
    armed_with_work = [row for row in events(engine, "armed") if row.get("applied_sec", 0) > BURST_CAP]
    assert armed_with_work == [], "an Analista or a Scorer armed with more than the burst cap while the queue had work"


def test_in_the_simulated_burst_a_pause_with_an_empty_queue_is_never_longer_than_a_minute(tmp_path_factory, monkeypatch):
    engine, home = fresh_team(tmp_path_factory, monkeypatch, "empty")
    roster = plan_registry.burst_roster(dict(plan_registry.find_plan("kimi", "allegro"), provider="kimi"), host_cap=100)
    out = simulate(engine, home, roster["roster"], roster["scout_cap_first_pass"])
    assert out["pauses_with_empty_queue"], "the run must have seen an empty queue (the first minutes)"
    assert max(out["pauses_with_empty_queue"]) <= BURST_CAP, out["pauses_with_empty_queue"]


def test_the_counts_of_the_simulated_burst_are_a_funnel(tmp_path_factory, monkeypatch):
    engine, home = fresh_team(tmp_path_factory, monkeypatch, "funnel")
    roster = plan_registry.burst_roster(dict(plan_registry.find_plan("kimi", "allegro"), provider="kimi"), host_cap=100)
    out = simulate(engine, home, roster["roster"], roster["scout_cap_first_pass"])
    assert out["found"] >= out["analysed"] >= out["scored"] > 0, out
    assert out["found"] <= roster["scout_cap_first_pass"]


def test_the_new_roster_scores_more_in_30_minutes_than_the_old_one_on_the_same_supply(tmp_path_factory, monkeypatch):
    """The comparison the measurement asked for, with the made-up curve of the Scouts: the old 3/2/1 (cap 30 on the first
    pass) against the roster plan_registry gives to the same tier now. Red until the roster of the burst is changed."""
    plan = dict(plan_registry.find_plan("kimi", "allegro"), provider="kimi")
    new = plan_registry.burst_roster(plan, host_cap=100)
    engine, home = fresh_team(tmp_path_factory, monkeypatch, "old")
    old_out = simulate(engine, home, {"scout": 3, "analista": 2, "scorer": 1}, 30)
    engine, home = fresh_team(tmp_path_factory, monkeypatch, "new")
    new_out = simulate(engine, home, new["roster"], new["scout_cap_first_pass"])
    assert new_out["scored"] > old_out["scored"], (old_out, new_out, new["roster"], new["scout_cap_first_pass"])
