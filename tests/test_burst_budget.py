"""Synthetic dollar bursts: pipeline reserves, parallel admissions and Pi's real gate."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "shared/skills/burst_budget.py"
GATE = ROOT / "shared/runtime/pi-harness/spend-gate.js"


def module():
    spec = importlib.util.spec_from_file_location("burst_budget_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stamp(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


@pytest.fixture
def world(tmp_path, monkeypatch):
    now = time.time()
    home = tmp_path / "home"
    (home / "state").mkdir(parents=True)
    root = home / ".pi/agent/sessions/fake"
    root.mkdir(parents=True)
    config = {"active_provider": "openai", "providers": {"openai": {"auth_method": "api_key"}},
              "team": {"budget": {"usd": 5, "starts_at": stamp(now - 3600), "ends_at": stamp(now + 3600)}}}
    (home / "jht.config.json").write_text(json.dumps(config))
    (home / "state/first-run.json").write_text(json.dumps({"phase": "burst", "burst_started_at": stamp(now - 3600),
                                                           "scored_at_start": 0, "scout_cap_first_pass": 50}))
    with sqlite3.connect(home / "jobs.db") as db:
        db.executescript("CREATE TABLE positions(id INTEGER PRIMARY KEY, status TEXT); CREATE TABLE scores(id INTEGER PRIMARY KEY, position_id INTEGER);")
        db.execute("INSERT INTO positions VALUES(1, 'new')")
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(home / "jobs.db"))
    return {"home": home, "root": root, "now": now, "config": config, "module": module()}


def usage(world, agent, cost, offset=0):
    path = world["root"] / (agent + ".jsonl")
    if not path.exists():
        path.write_text(json.dumps({"type": "session", "id": agent, "cwd": "/synthetic/agents/" + agent}) + "\n")
    entry = {"type": "message", "timestamp": stamp(world["now"] + offset),
             "message": {"role": "assistant", "usage": {"cost": {"total": cost}}}}
    with path.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


def save_config(world):
    (world["home"] / "jht.config.json").write_text(json.dumps(world["config"]))


def test_scouts_spent_their_half_but_analyst_and_scorer_can_start(world):
    usage(world, "scout-1", 2.5)
    mod = world["module"]
    assert mod.check("scout-2")["reason"] == "burst-reserve"
    assert mod.check("analista-1")["allowed"]
    assert mod.check("scorer-1")["allowed"]
    assert mod.check("capitano")["allowed"] and mod.check("assistente")["allowed"]


def test_small_budget_keeps_proportional_shares_for_both_pipeline_roles(world):
    world["config"]["team"]["budget"]["usd"] = 0.2
    save_config(world)
    usage(world, "scout-1", 0.1)
    scout = world["module"].check("scout-2")
    assert not scout["allowed"] and scout["protected_usd"] == pytest.approx(0.1)
    assert world["module"].check("analista-1")["allowed"]
    assert world["module"].check("scorer-1")["allowed"]


def test_one_score_does_not_release_reserves_while_new_or_checked_wait(world):
    usage(world, "scout-1", 2.5)
    with sqlite3.connect(world["home"] / "jobs.db") as db:
        db.execute("INSERT INTO scores VALUES(1, 99)")
    assert not world["module"].check("scout-2")["allowed"]
    with sqlite3.connect(world["home"] / "jobs.db") as db:
        db.execute("UPDATE positions SET status='checked'")
    assert world["module"].check("scout-2")["protected_usd"] == 1.25


def test_empty_pipeline_releases_reserves_after_scoring(world):
    usage(world, "scout-1", 2.5)
    with sqlite3.connect(world["home"] / "jobs.db") as db:
        db.execute("UPDATE positions SET status='checked'")
        db.execute("INSERT INTO scores VALUES(1,1)")
    out = world["module"].check("analista-2")
    assert out["protected_usd"] == 0 and out["allowed"]


def test_scouts_done_and_empty_pipeline_releases_initial_reserve(world, monkeypatch):
    usage(world, "scout-1", 2.5)
    with sqlite3.connect(world["home"] / "jobs.db") as db:
        db.execute("DELETE FROM positions")
    monkeypatch.setattr(world["module"], "_sourcing_done", lambda: True)
    out = world["module"].check("analista-2")
    assert out["protected_usd"] == 0 and out["allowed"]


@pytest.mark.parametrize("role", ["scout-1", "analista-1", "scrittore-1", "dottore"])
def test_unreadable_accounts_hold_workers_but_not_scorer_or_core(world, role):
    usage(world, "scout-2", 0.1)
    (world["root"] / "scout-2.jsonl").write_text("broken\n")
    assert world["module"].check(role)["reason"] == "burst-accounting-unavailable"
    for exempt in ("scorer-1", "capitano", "assistente"):
        assert world["module"].check(exempt)["allowed"]


@pytest.mark.parametrize("change", ["subscription", "no-dollars", "steady"])
def test_no_effect_on_subscription_or_budget_without_dollars(world, change):
    if change == "subscription":
        world["config"]["providers"]["openai"] = {"auth_method": "oauth", "plan": "pro"}
    elif change == "no-dollars":
        world["config"]["team"]["budget"] = {"quota_pct": 25}
    else:
        (world["home"] / "state/first-run.json").write_text('{"phase":"steady"}')
    save_config(world)
    shutil.rmtree(world["root"])
    out = world["module"].check("scout-1", claim="unused", spawn=True)
    assert out == {"allowed": True, "reason": "not-dollar-burst"}
    assert not (world["home"] / "state/burst-budget.json").exists()


def test_duration_counts_from_search_and_excludes_onboarding(world):
    config = world["config"]
    config["team"]["budget"] = {"usd": 5, "duration_minutes": 30, "saved_at": stamp(world["now"] - 3600)}
    save_config(world)
    usage(world, "assistente", 4, -100)
    usage(world, "scout-1", 0.1)
    out = world["module"].check("analista-1")
    assert out["allowed"] and out["spent_usd"] == pytest.approx(0.1)


def _claim(world, agent, ident):
    result = subprocess.run([sys.executable, str(SCRIPT), "claim", agent, "--id", str(ident)],
                            capture_output=True, text=True, timeout=20, env=os.environ)
    assert result.returncode in (0, 75), result.stderr
    return json.loads(result.stdout)


def test_parallel_requests_count_inflight_without_serializing_model_calls(world):
    world["config"]["team"]["burst_budget"] = {"request_estimate_usd": 0.25}
    save_config(world)
    # Core has spent 2 USD. Scout room is .5 USD after pipeline reserve.
    usage(world, "capitano", 2)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda n: _claim(world, "scout-" + str(n), n), range(8)))
    assert sum(r["allowed"] for r in results) == 2
    record = json.loads((world["home"] / "state/burst-budget.json").read_text())
    assert len(record["pending"]) == 2  # both model calls can still be running
    assert sum(r["estimate"] for r in record["pending"]) == 0.5
    assert _claim(world, "analista-1", "analyst")["allowed"]
    assert _claim(world, "scorer-1", "score")["allowed"]


def test_far_from_threshold_all_parallel_scouts_are_admitted(world):
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda n: _claim(world, "scout-" + str(n), n), range(5)))
    assert all(r["allowed"] for r in results)


def test_maximum_reserve_overshoot_is_already_admitted_calls(world):
    mod = world["module"]
    world["config"]["team"]["burst_budget"] = {"request_estimate_usd": 0.25}
    save_config(world)
    usage(world, "capitano", 2)
    assert mod.check("scout-1", claim="a")["allowed"]
    assert mod.check("scout-2", claim="b")["allowed"]
    assert not mod.check("scout-3", claim="c")["allowed"]
    # Both actual calls cost more than their estimate. Only these two had
    # admission: subsequent calls see paid usage and cannot extend overshoot.
    usage(world, "scout-1", 0.4)
    usage(world, "scout-2", 0.4)
    out = mod.check("scout-3", claim="d")
    assert not out["allowed"] and out["inflight"] == 0
    assert out["spent_usd"] == pytest.approx(2.8)


def test_measured_completion_settles_inflight_and_last_role_call_updates_estimate(world):
    mod = world["module"]
    assert mod.check("scout-1", now=world["now"], claim="a")["allowed"]
    usage(world, "scout-1", 0.1, 1)
    out = mod.check("scout-2", now=world["now"] + 2)
    assert out["inflight"] == 0 and out["estimate_usd"] == pytest.approx(0.15)


def test_dead_request_expires_instead_of_holding_budget_forever(world):
    mod = world["module"]
    world["config"]["team"]["burst_budget"] = {"request_estimate_usd": 0.25, "request_ttl_s": 5}
    save_config(world)
    usage(world, "capitano", 2.25)
    assert mod.check("scout-1", now=world["now"], claim="dead")["allowed"]
    assert not mod.check("scout-2", now=world["now"] + 4, claim="wait")["allowed"]
    assert mod.check("scout-2", now=world["now"] + 6, claim="next")["allowed"]


def test_first_scout_then_observation_interval_before_next_spawn(world):
    mod = world["module"]
    assert mod.check("scout", now=world["now"], spawn=True)["allowed"]
    held = mod.check("scout", now=world["now"] + 5, spawn=True)
    assert held["reason"] == "burst-stage" and held["retry_after_s"] == 55
    assert mod.check("analista", now=world["now"] + 5, spawn=True)["allowed"]
    assert mod.check("scorer", now=world["now"] + 5, spawn=True)["allowed"]
    assert mod.check("scout", now=world["now"] + 60, spawn=True)["allowed"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node required")
@pytest.mark.parametrize("agent,blocked", [("scout-2", True), ("analista-1", False), ("scorer-1", False), ("capitano", False)])
def test_real_pi_before_provider_request_enforces_reserve(world, agent, blocked):
    usage(world, "scout-1", 2.5)
    driver = r'''
const handlers = {};
require(process.argv[1])({on:(name, fn)=>{handlers[name]=fn;}});
let aborted=0;
handlers.before_provider_request({}, {abort:()=>{aborted++;}});
process.stdout.write(JSON.stringify({aborted}));
'''
    done = subprocess.run(["node", "-e", driver, str(GATE)], capture_output=True, text=True, timeout=20,
                          env={**os.environ, "JHT_AGENT_NAME": agent})
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)["aborted"] == int(blocked)


def test_roster_stages_scouts_in_code_and_starts_pipeline_first(world, monkeypatch):
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("roster_stages_test", ROOT / "shared/skills/burst_roster.py")
    roster = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(roster)
    clock = [world["now"]]
    calls, waits = [], []
    monkeypatch.setattr(roster, "_stop_brake", lambda: None)
    monkeypatch.setattr(roster, "_number", lambda role: 1)
    monkeypatch.setattr(roster, "_log", lambda row: None)
    monkeypatch.setattr(roster, "_stopped_by_the_person", lambda: False)
    monkeypatch.setattr(roster, "_budget_admission", lambda role: world["module"].check(role, now=clock[0], spawn=True))
    def wait(seconds):
        waits.append(seconds)
        clock[0] += seconds
        return True
    monkeypatch.setattr(roster, "_wait_stage", wait)
    def launch(argv, **kwargs):
        calls.append((argv[2], clock[0]))
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(roster.subprocess, "run", launch)
    roster._spawn(roster.order({"scout": 5, "analista": 1, "scorer": 1}), {})
    assert [r for r, _ in calls[:3]] == ["scout", "analista", "scorer"]
    scouts = [at for role, at in calls if role == "scout"]
    assert len(scouts) == 5 and all(b - a >= 60 for a, b in zip(scouts, scouts[1:]))
    assert waits == [60] * 4


def test_roster_still_launches_scorer_when_scout_budget_is_spent(world, monkeypatch):
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("roster_budget_test", ROOT / "shared/skills/burst_roster.py")
    roster = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(roster)
    usage(world, "scout-1", 2.5)
    calls = []
    monkeypatch.setattr(roster, "_stop_brake", lambda: None)
    monkeypatch.setattr(roster, "_number", lambda role: 1)
    monkeypatch.setattr(roster, "_log", lambda row: None)
    monkeypatch.setattr(roster, "_stopped_by_the_person", lambda: False)
    monkeypatch.setattr(roster, "_budget_admission", lambda role: world["module"].check(role, spawn=True))
    def launch(argv, **kwargs):
        calls.append(argv[2])
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(roster.subprocess, "run", launch)
    rows = roster._spawn(["scout", "analista", "scorer"], {})
    assert rows[0]["why"] == "burst-reserve"
    assert calls == ["analista", "scorer"] and rows[-1]["ok"]
