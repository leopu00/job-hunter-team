"""ram_guard.py: with the team running, the memory is watched, and the workers the machine carries least are retired before the
kernel's OOM killer takes the user's manager (a 7.7 GB server, no swap, 18 Codex sessions of ~360 MB)."""
import sys
from pathlib import Path
from types import SimpleNamespace

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import ram_guard as rg  # noqa: E402

TEAM = ["CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE", "SCOUT-1", "SCOUT-2", "SCOUT-3", "ANALISTA-1", "ANALISTA-2", "SCORER-1", "SCORER-2"]


def test_nothing_is_retired_while_the_memory_is_fine_or_unknown():
    assert rg.decide(2.0, 7.7, TEAM) == []
    assert rg.decide(None, 7.7, TEAM) == [] and rg.decide(1.0, None, TEAM) == []


def test_the_threshold_is_a_floor_or_a_share_of_the_ram():
    assert rg.threshold_gib(7.7) == 0.6 and abs(rg.threshold_gib(64) - 4.48) < 1e-9


def test_the_newest_scouts_go_first_then_nothing_the_fixed_agents_and_one_of_each_kept():
    assert rg.decide(0.4, 7.7, TEAM) == ["SCOUT-3", "SCOUT-2"]
    assert rg.decide(0.4, 7.7, [s for s in TEAM if not s.startswith("SCOUT")]) == ["SCORER-2", "ANALISTA-2"]
    assert rg.decide(0.4, 7.7, ["CAPITANO", "MENTOR", "SCORER-1", "ANALISTA-1"]) == [], "the last of each role stays, the fixed never go"


def test_under_half_the_threshold_even_the_last_of_a_role_goes():
    assert rg.decide(0.2, 7.7, ["CAPITANO", "SCORER-1", "ANALISTA-1"]) == ["SCORER-1", "ANALISTA-1"]


def test_at_most_two_per_look():
    assert len(rg.decide(0.1, 7.7, TEAM)) == 2


def _run():
    sent = []
    api = SimpleNamespace(time=SimpleNamespace(time=lambda: 1000.0), CAPITANO_SESSION="CAPITANO",
                          session_exists=lambda s: True, jht_tmux_send=lambda s, t: sent.append((s, t)) or True)
    return api, SimpleNamespace(state={}), sent


def test_a_look_retires_tells_the_captain_and_waits_before_the_next():
    api, run, sent = _run()
    gone = []
    probe = {"ram_avail_gib": 0.4, "ram_total_gib": 7.7}
    done = rg.step(api, run, notify_user=lambda *a: None, probe=probe, sessions=TEAM, retire=lambda s, why: gone.append(s) or True)
    assert done == gone == ["SCOUT-3", "SCOUT-2"]
    assert [s for s, _ in sent] == ["CAPITANO"] and "in their language" in sent[0][1] and "SCOUT-3, SCOUT-2" in sent[0][1]
    assert rg.step(api, run, notify_user=lambda *a: None, probe=probe, sessions=TEAM, retire=lambda s, why: gone.append(s) or True) == [], "cooldown"
    api.time.time = lambda: 1000.0 + rg.RETIRE_COOLDOWN_SEC + 1
    assert rg.step(api, run, notify_user=lambda *a: None, probe=probe, sessions=TEAM, retire=lambda s, why: True) != []


def test_a_retire_that_fails_is_not_reported_and_a_broken_look_never_raises():
    api, run, sent = _run()
    assert rg.step(api, run, notify_user=lambda *a: None, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: False) == []
    assert sent == []
    assert rg.step(api, SimpleNamespace(), notify_user=lambda *a: None, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}) == []


def test_the_launcher_raises_the_oom_score_of_the_agents_on_linux():
    import os
    import subprocess
    import pytest
    if not os.path.exists("/proc/self/oom_score_adj"):
        pytest.skip("no /proc/self/oom_score_adj here")
    text = (SKILLS.parent.parent / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    start = text.index("if [ -w /proc/self/oom_score_adj ]")
    block = text[start: text.index("\nfi\n", start) + 4]
    done = subprocess.run(["bash", "-c", block + "\ncat /proc/self/oom_score_adj"], capture_output=True, text=True, timeout=30)
    assert done.returncode == 0 and int(done.stdout.strip()) >= 500, done.stdout + done.stderr


def test_the_newest_session_goes_first_by_its_date_not_by_its_number():
    # SCOUT-3 was born after SCOUT-6 (a session retired and made again takes a low number)
    born = {"SCOUT-1": 100, "SCOUT-6": 200, "SCOUT-4": 300, "SCOUT-2": 400, "SCOUT-3": 500, "SCORER-1": 50, "ANALISTA-1": 60}
    assert rg.decide(0.4, 7.7, born) == ["SCOUT-3", "SCOUT-2"]
    assert rg.decide(0.4, 7.7, list(born)) == ["SCOUT-6", "SCOUT-4"], "with no dates it falls back to the number"
    assert rg.decide(0.4, 7.7, dict(born, **{"SCOUT-5": None})) [0] == "SCOUT-3", "a name with no date counts as the oldest"


def test_the_person_is_told_straight_and_the_last_retirement_is_written_for_the_status(tmp_path):
    api, run, sent = _run()
    api._path = lambda name: str(tmp_path)
    told = []
    done = rg.step(api, run, probe={"ram_avail_gib": 0.44, "ram_total_gib": 3.7}, sessions=TEAM, retire=lambda s, why: True,
                   notify_user=lambda text, reason: told.append((text, reason)))
    assert done == ["SCOUT-3", "SCOUT-2"]
    assert len(told) == 1 and "0.44" in told[0][0] and told[0][1].startswith("ram-guard-")
    import json
    status = json.loads((tmp_path / "state" / "ram-guard.json").read_text())
    assert status["retired"] == done and status["at"] == 1000 and status["avail_gib"] == 0.44
    assert (tmp_path / "state" / "ram-guard.json").stat().st_mode & 0o777 == 0o600


def test_a_notifier_that_fails_does_not_lose_the_retirement():
    api, run, sent = _run()
    def boom(text, reason):
        raise RuntimeError("down")
    assert rg.step(api, run, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: True, notify_user=boom) == ["SCOUT-3", "SCOUT-2"]


def test_a_captain_notice_that_fails_silently_does_not_hide_the_notice_to_the_person(monkeypatch):
    import sentinel_delivery
    api, run, sent = _run()
    told = []

    def boom(*a, **k):
        raise RuntimeError("bridge down")

    monkeypatch.setattr(sentinel_delivery, "notice", boom)
    done = rg.step(api, run, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: True,
                   notify_user=lambda text, reason: told.append(reason))
    assert done == ["SCOUT-3", "SCOUT-2"] and len(told) == 1


def test_the_retired_workers_come_back_when_the_memory_is_well_over_the_threshold_and_the_captain_knows():
    api, run, sent = _run()
    rg.step(api, run, notify_user=lambda *a: None, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: True)
    assert run.state["ram_guard"]["retired_by_guard"] == ["SCOUT-2", "SCOUT-3"]
    started = []
    alive = {"SCOUT-1": 1}
    ok = {"ram_avail_gib": 2.5, "ram_total_gib": 7.7}
    api.time.time = lambda: 1000.0 + rg.RETIRE_COOLDOWN_SEC + 1
    assert rg.step(api, run, probe=ok, sessions=alive, restart=lambda s, why: started.append(s) or True) == []
    assert started == [], "not for a while after the last retirement"
    api.time.time = lambda: 1000.0 + rg.REOPEN_AFTER_SEC + 1
    rg.step(api, run, probe={"ram_avail_gib": 0.6, "ram_total_gib": 7.7}, sessions=alive, restart=lambda s, why: started.append(s) or True)
    assert started == [], "just over the threshold is not enough"
    sent.clear()
    rg.step(api, run, probe=ok, sessions=alive, restart=lambda s, why: started.append(s) or True)
    assert started == ["SCOUT-2", "SCOUT-3"] and run.state["ram_guard"]["retired_by_guard"] == [], "two Scouts in one look"
    assert [s for s, _ in sent] == ["CAPITANO"] and "capacity is open" in sent[0][1]


def test_a_worker_a_brake_holds_stays_down_and_is_tried_again():
    api, run, sent = _run()
    rg.step(api, run, notify_user=lambda *a: None, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: True)
    api.time.time = lambda: 1000.0 + rg.REOPEN_AFTER_SEC + 1
    rg.step(api, run, probe={"ram_avail_gib": 2.5, "ram_total_gib": 7.7}, sessions={}, restart=lambda s, why: False)
    assert run.state["ram_guard"]["retired_by_guard"] == ["SCOUT-2", "SCOUT-3"]


def test_the_scouts_come_back_first_two_a_look_then_one_other_worker_a_look():
    api, run, sent = _run()
    run.state["ram_guard"] = {"retired_by_guard": ["SCORER-1", "ANALISTA-3", "SCOUT-4", "SCOUT-2", "SCOUT-5"], "last_retire_at": 0}
    started = []
    ok = {"ram_avail_gib": 2.5, "ram_total_gib": 7.7}
    for _ in range(5):
        rg.step(api, run, probe=ok, sessions={}, restart=lambda s, why: started.append(s) or True)
        api.time.time = lambda t=api.time.time(): t + 1
    assert started == ["SCOUT-2", "SCOUT-4", "SCOUT-5", "ANALISTA-3", "SCORER-1"]
    assert run.state["ram_guard"]["retired_by_guard"] == []


def test_workers_retired_for_ram_by_an_older_guard_come_back_too(monkeypatch):
    api, run, sent = _run()
    roster = {"agents": {"SCOUT-2": {"status": "retired", "retire_reason": "ram: 0.40 of 7.7 GiB free"},
                         "SCOUT-3": {"status": "retired", "retire_reason": "the person asked"},
                         "SCOUT-4": {"status": "active"}}}
    monkeypatch.setattr(rg, "_load", lambda name: type("R", (), {"load": staticmethod(lambda: roster)}))
    started = []
    rg.step(api, run, probe={"ram_avail_gib": 2.5, "ram_total_gib": 7.7}, sessions={}, restart=lambda s, why: started.append(s) or True)
    assert started == ["SCOUT-2"]


def test_a_name_that_is_not_a_worker_in_the_memory_of_the_guard_is_left_out_and_the_look_goes_on():
    api, run, sent = _run()
    run.state["ram_guard"] = {"retired_by_guard": ["rm -rf", 7, "SCOUT-2"], "last_retire_at": 0}
    started = []
    rg.step(api, run, probe={"ram_avail_gib": 2.5, "ram_total_gib": 7.7}, sessions={}, restart=lambda s, why: started.append(s) or True)
    assert started == ["SCOUT-2"]


def test_the_workers_the_guard_brings_back_are_marked_and_the_captain_is_told_they_stay(tmp_path):
    import json
    api, run, sent = _run()
    api._path = lambda name: str(tmp_path)
    run.state["ram_guard"] = {"retired_by_guard": ["SCOUT-2", "SCOUT-3"], "last_retire_at": 0}
    rg.step(api, run, probe={"ram_avail_gib": 2.5, "ram_total_gib": 7.7}, sessions={}, restart=lambda s, why: True)
    marked = json.loads((tmp_path / "state" / "ram-restored.json").read_text())
    assert sorted(marked) == ["SCOUT-2", "SCOUT-3"] and marked["SCOUT-2"] == 1000
    assert "not a scale-up" in sent[0][1] and "C-02" in sent[0][1]


def _retire_tool():
    import importlib.util
    spec = importlib.util.spec_from_file_location("jht_agent_retire", SKILLS.parent.parent / "agents" / "_tools" / "jht-agent-retire.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_retire_tool_refuses_a_worker_the_guard_brought_back_a_moment_ago(tmp_path, monkeypatch, capsys):
    import json
    import time
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (tmp_path / "state").mkdir()
    now = time.time()
    (tmp_path / "state" / "ram-restored.json").write_text(json.dumps({"SCOUT-3": now - 10, "SCOUT-4": now - 5000, "SCOUT-5": "x"}))
    tool = _retire_tool()
    assert tool.restored_by_the_guard("SCOUT-3") is not None and tool.restored_by_the_guard("SCOUT-3") > 800
    assert tool.restored_by_the_guard("SCOUT-4") is None and tool.restored_by_the_guard("SCOUT-5") is None
    assert tool.restored_by_the_guard("SCOUT-9") is None
    monkeypatch.setattr(sys, "argv", ["jht-agent-retire", "SCOUT-3", "--reason", "C-02 stepped calibration"])
    assert tool.main() == 1
    assert "brought back by the memory guard" in capsys.readouterr().err
    (tmp_path / "state" / "ram-restored.json").write_text("not json")
    assert tool.restored_by_the_guard("SCOUT-3") is None, "a file that cannot be read protects nothing"


def test_the_status_stops_saying_the_workers_that_came_back(tmp_path):
    import json
    api, run, sent = _run()
    api._path = lambda name: str(tmp_path)
    rg.step(api, run, probe={"ram_avail_gib": 0.44, "ram_total_gib": 3.7}, sessions=TEAM, retire=lambda s, why: True, notify_user=lambda *a: None)
    path = tmp_path / "state" / "ram-guard.json"
    assert json.loads(path.read_text())["retired"] == ["SCOUT-3", "SCOUT-2"]
    api.time.time = lambda: 1000.0 + rg.REOPEN_AFTER_SEC + 1
    started = []
    ok = {"ram_avail_gib": 2.5, "ram_total_gib": 3.7}
    rg.step(api, run, probe=ok, sessions={}, restart=lambda s, why: started.append(s) or True)
    assert started == ["SCOUT-2", "SCOUT-3"]
    assert json.loads(path.read_text())["retired"] == [] and path.stat().st_mode & 0o777 == 0o600
