"""The cap on workers comes from the RAM of a session of the harness, the cores and the load: made-up machines only."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import host_capacity as hc  # noqa: E402
import plan_registry  # noqa: E402


def machine(total, cores, load5=1.0, avail=None):
    return {"ram_total_gib": total, "ram_avail_gib": total * 0.6 if avail is None else avail,
            "cores": cores, "load5": load5}


# A machine with 6 GiB and 4 cores. A flat 0.6 GiB per agent gave 1 worker here.
def test_the_windows_pc_that_was_stuck_at_one_worker_now_carries_a_full_pipeline():
    got = hc.capacity(machine(6.0, 4), "codex")
    assert got["cap"] >= 8 and got["cap"] > 1
    assert got["limit"] == "cpu" and got["ram_per_agent_measured"] is True


def test_a_measured_harness_needs_less_ram_than_an_estimated_one():
    codex = hc.capacity(machine(9.0, 16), "codex")
    claude = hc.capacity(machine(9.0, 16), "claude")
    assert codex["limit"] == claude["limit"] == "ram"
    assert codex["cap"] > claude["cap"] and claude["ram_per_agent_measured"] is False
    assert "estimated, not measured" in claude["message"]


def test_the_cores_cap_the_workers_even_with_plenty_of_ram():
    got = hc.capacity(machine(64, 4), "codex")
    assert got["cap"] == 8 and got["limit"] == "cpu" and "cores are the limit" in got["message"]


def test_a_really_small_machine_gets_a_low_cap_and_says_why():
    tiny = hc.capacity(machine(2.0, 2), "codex")
    assert tiny["cap"] == 1 and "too small" in tiny["message"]
    small = hc.capacity(machine(3.9, 2), "codex")
    assert small["cap"] == 3 and "3 workers" in small["message"]
    one_core = hc.capacity(machine(16, 1), "codex")
    assert one_core["cap"] == 2 and one_core["limit"] == "cpu"
    assert hc.capacity(machine(1.0, 1), "claude")["cap"] == 1


def test_a_machine_that_cannot_hold_the_fixed_agents_plus_a_pipeline_gets_one_worker_as_before():
    # 4 GiB with an estimated 0.6 GiB per agent: (4 - 2) / 0.6 = 3 agents, the 5 fixed ones alone do not fit.
    for harness in ("claude", "kimi", "pi"):
        got = hc.capacity(machine(4.0, 4), harness)
        assert got["cap"] == 1, harness
    assert hc.capacity(machine(6.0, 4), "claude")["cap"] == 1     # the same 6 GiB: the flat constant gave 1 too
    assert hc.capacity(machine(4.0, 4), "codex")["cap"] >= 3      # the measured 0.22 GiB per Codex agent does fit


def test_nothing_raises_the_cap_above_what_the_ram_holds():
    for total in (1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 32.0):
        for cores in (1, 2, 4, 16):
            for harness in ("codex", "claude", "kimi", "pi", None):
                for load5, avail in ((0.5, total), (cores * 20.0, total), (1.0, 0.2)):
                    got = hc.capacity(machine(total, cores, load5=load5, avail=avail), harness)
                    assert 1 <= got["cap"] <= max(1, got["ram_cap"]), (total, cores, harness, load5, avail, got)


def test_an_overloaded_machine_halves_the_cap_and_a_busy_one_does_not():
    assert hc.capacity(machine(16, 4, load5=20.0), "codex")["cap"] == 8        # the team's own load at 13 sessions
    braked = hc.capacity(machine(16, 4, load5=40.0), "codex")
    assert braked["cap"] == 4 and braked["limit"] == "load" and "overloaded" in braked["message"]


def test_little_free_ram_right_now_stops_the_growth():
    got = hc.capacity(machine(16, 8, avail=0.4), "codex")
    assert got["cap"] == 3 and got["limit"] == "free-ram"
    assert hc.capacity(machine(4.0, 4, avail=0.2), "claude")["cap"] == 1   # braking never raises


def test_a_machine_that_cannot_be_measured_has_no_cap():
    got = hc.capacity({"ram_total_gib": None, "ram_avail_gib": None, "cores": 4, "load5": 1}, "codex")
    assert got["cap"] is None and "no cap applied" in got["message"]


def test_missing_cores_or_load_do_not_invent_a_limit():
    got = hc.capacity({"ram_total_gib": 6.0, "ram_avail_gib": 4, "cores": None, "load5": None}, "codex")
    assert got["cap"] == 13 and got["limit"] == "ram" and got["cpu_cap"] is None


def test_the_harness_comes_from_the_active_provider():
    assert hc.harness_of("openai", {}) == hc.harness_of("Codex", {}) == "codex"
    assert hc.harness_of("anthropic", {}) == "claude" and hc.harness_of("moonshot", {}) == "kimi"
    assert hc.harness_of("zzz", {}) is None and hc.harness_of(None, {}) is None
    assert hc.capacity(machine(6.0, 16), None)["ram_per_agent_gib"] == hc.UNKNOWN_HARNESS_GIB


# --- the pi harness -----------------------------------------------------------------------------------------

def test_a_role_on_pi_sizes_the_team_with_pi_when_pi_is_the_heavier_session():
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "pi"}) == "pi"
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": " PI "}) == "pi"
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": ""}) == "codex"
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "other", "PATH": "pi"}) == "codex"
    # claude is heavier than pi: the cap keeps holding the claude session
    assert hc.harness_of("claude", {"JHT_AGENT_HARNESS_SCOUT": "pi"}) == "claude"
    assert hc.harness_of("zzz", {"JHT_AGENT_HARNESS_SCOUT": "pi"}) == "pi"


def test_the_harness_of_the_config_sizes_the_team_with_no_variable_at_all():
    """`harness: pi` from `jht setup` puts every role on pi: the team is sized as pi even if no variable is set."""
    pi = {"harness": "pi"}
    assert hc.harness_of("openai", {}, pi) == "pi"
    assert hc.harness_of("Codex", {}, {"harness": " PI "}) == "pi"
    assert hc.harness_of("openai", {}, {"harness": "codex"}) == "codex"
    assert hc.harness_of("openai", {}, {}) == hc.harness_of("openai", {}, None) == "codex"
    assert hc.harness_of("openai", {}, {"harness": "other"}) == "codex"
    assert hc.harness_of("openai", {}, "not a dict") == "codex"
    assert hc.harness_of("claude", {}, pi) == "claude", "claude is heavier than pi: the cap keeps holding it"
    assert hc.harness_of("zzz", {}, pi) == "pi"


def test_the_variable_still_puts_a_role_on_pi_when_the_config_says_codex():
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "pi"}, {"harness": "codex"}) == "pi"
    # one role put back on codex does not make the rest of a pi team lighter
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "codex"}, {"harness": "pi"}) == "pi"


def test_the_team_is_sized_as_pi_from_the_config_the_cap_reads(tmp_path, monkeypatch):
    """The wiring: plan_registry reads jht.config.json and hands it to harness_of (0.3 GiB per agent, not 0.22)."""
    for name in [n for n in __import__("os").environ if n.startswith("JHT_AGENT_HARNESS_")]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(hc, "read_probe", lambda *a, **k: machine(9.0, 16))
    seen = {}
    for harness, expected in (("pi", "pi"), ("codex", "codex")):
        (tmp_path / "jht.config.json").write_text(
            '{"active_provider": "openai", "harness": "%s"}' % harness, encoding="utf-8")
        monkeypatch.setattr(plan_registry, "_HOST_CAPACITY_MODULE", hc)
        seen[harness] = plan_registry._host_capacity()
        assert seen[harness]["ram_per_agent_gib"] == hc.RAM_GIB_PER_AGENT[expected], harness
    assert seen["pi"]["cap"] <= seen["codex"]["cap"]


def test_the_harness_of_the_process_is_read_when_no_environment_is_given(monkeypatch):
    monkeypatch.delenv("JHT_AGENT_HARNESS_SCOUT", raising=False)
    assert hc.harness_of("openai") == "codex"
    monkeypatch.setenv("JHT_AGENT_HARNESS_SCOUT", "pi")
    assert hc.harness_of("openai") == "pi"


def test_pi_has_its_own_ram_and_it_says_it_is_an_estimate():
    got = hc.capacity(machine(9.0, 16), "pi")
    assert got["ram_per_agent_gib"] == hc.RAM_GIB_PER_AGENT["pi"] and got["ram_per_agent_measured"] is False
    assert "estimated, not measured" in got["message"]
    assert hc.capacity(machine(9.0, 16), "codex")["cap"] > got["cap"] > hc.capacity(machine(9.0, 16), "claude")["cap"]


def test_the_probe_reads_meminfo_and_the_container_limits(tmp_path):
    proc, cg = tmp_path / "proc", tmp_path / "cg"
    proc.mkdir()
    cg.mkdir()
    (proc / "meminfo").write_text("MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(16.0) and got["ram_avail_gib"] == pytest.approx(8.0)
    (cg / "memory.max").write_text(str(4 * 1024 ** 3) + "\n")
    (cg / "cpu.max").write_text("200000 100000\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(4.0) and got["ram_avail_gib"] <= 4.0 and got["cores"] == 2.0
    (cg / "memory.max").write_text("max\n")
    (cg / "cpu.max").write_text("max 100000\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(16.0) and got["cores"] != 2.0


# --- plan_registry: the roster and the one source of the cap -------------------------------------------------------

def test_the_big_roster_is_no_longer_cut_to_one_per_role_on_the_windows_pc(monkeypatch):
    plan = dict(plan_registry.find_plan("claude", "max20"))
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: hc.capacity(machine(6.0, 4), "codex"))
    roster = plan_registry.burst_roster(plan)
    assert roster["total_workers"] == 8 and not roster["capped_by_host"]
    assert roster["roster"] == {"scout": 4, "analista": 2, "scorer": 2}
    assert "carries 8 workers" in roster["host_note"]


def test_the_roster_reads_the_machine_once_so_the_note_always_matches_the_cap(monkeypatch):
    readings = iter([hc.capacity(machine(6.0, 4, load5=1.0), "codex"), hc.capacity(machine(6.0, 4, load5=99.0), "codex")])
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: next(readings))
    roster = plan_registry.burst_roster(dict(plan_registry.find_plan("claude", "max20")))
    assert roster["host_agent_cap"] == 8 and "carries 8 workers" in roster["host_note"]


def test_the_flat_constant_is_gone_and_a_failed_measurement_means_no_cap(monkeypatch):
    assert not hasattr(plan_registry, "_RAM_GB_PER_AGENT")
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: None)
    assert plan_registry._host_agent_cap() is None
    assert plan_registry.burst_roster(plan_registry.find_plan("kimi", "moderato"))["host_note"] is None


def test_the_cap_follows_the_active_provider(monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    # The module plan_registry reads the machine through is the one object it keeps: replacing the probe on it reaches
    # the real code path, and the machine under test is a made-up one with many cores (so the cores never decide).
    monkeypatch.setattr(plan_registry._host_capacity_module(), "read_probe", lambda *a, **k: machine(6.0, 64))
    (tmp_path / "jht.config.json").write_text('{"active_provider": "openai"}', encoding="utf-8")
    codex_cap = plan_registry._host_capacity()
    (tmp_path / "jht.config.json").write_text('{"active_provider": "claude"}', encoding="utf-8")
    claude_cap = plan_registry._host_capacity()
    assert codex_cap["ram_per_agent_measured"] and not claude_cap["ram_per_agent_measured"]
    assert codex_cap["cap"] == 13 and claude_cap["cap"] == 1


def test_the_capacity_module_is_loaded_once():
    assert plan_registry._host_capacity_module() is plan_registry._host_capacity_module()
