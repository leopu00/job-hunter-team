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
    done = rg.step(api, run, probe=probe, sessions=TEAM, retire=lambda s, why: gone.append(s) or True)
    assert done == gone == ["SCOUT-3", "SCOUT-2"]
    assert [s for s, _ in sent] == ["CAPITANO"] and "in their language" in sent[0][1] and "SCOUT-3, SCOUT-2" in sent[0][1]
    assert rg.step(api, run, probe=probe, sessions=TEAM, retire=lambda s, why: gone.append(s) or True) == [], "cooldown"
    api.time.time = lambda: 1000.0 + rg.RETIRE_COOLDOWN_SEC + 1
    assert rg.step(api, run, probe=probe, sessions=TEAM, retire=lambda s, why: True) != []


def test_a_retire_that_fails_is_not_reported_and_a_broken_look_never_raises():
    api, run, sent = _run()
    assert rg.step(api, run, probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}, sessions=TEAM, retire=lambda s, why: False) == []
    assert sent == []
    assert rg.step(api, SimpleNamespace(), probe={"ram_avail_gib": 0.4, "ram_total_gib": 7.7}) == []


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
