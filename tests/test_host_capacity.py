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
    for harness in ("claude", "kimi"):
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
    # every role on pi: no claude or kimi CLI runs, the sessions are pi sessions
    assert hc.harness_of("claude", {}, pi) == "pi" and hc.harness_of("kimi", {}, pi) == "pi"
    assert hc.harness_of("zzz", {}, pi) == "pi"


def test_the_variable_still_puts_a_role_on_pi_when_the_config_says_codex():
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "pi"}, {"harness": "codex"}) == "pi"
    # one role put back on codex does not make the rest of a pi team lighter
    assert hc.harness_of("openai", {"JHT_AGENT_HARNESS_SCOUT": "codex"}, {"harness": "pi"}) == "pi"


def test_the_team_is_sized_as_pi_from_the_config_the_cap_reads(tmp_path, monkeypatch):
    """The wiring: plan_registry reads jht.config.json and hands it to harness_of, and pi gets its own cores factor."""
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
    assert seen["pi"]["cpu_cap"] > seen["codex"]["cpu_cap"]


def test_the_harness_of_the_process_is_read_when_no_environment_is_given(monkeypatch):
    monkeypatch.delenv("JHT_AGENT_HARNESS_SCOUT", raising=False)
    assert hc.harness_of("openai") == "codex"
    monkeypatch.setenv("JHT_AGENT_HARNESS_SCOUT", "pi")
    assert hc.harness_of("openai") == "pi"


def test_pi_has_its_own_measured_ram():
    got = hc.capacity(machine(9.0, 16), "pi")
    assert got["ram_per_agent_gib"] == hc.RAM_GIB_PER_AGENT["pi"] and got["ram_per_agent_measured"] is True
    assert "(measured)" in got["message"]
    assert got["cap"] > hc.capacity(machine(9.0, 16), "claude")["cap"]


def test_glm_runs_on_pi():
    assert hc.harness_of("glm", {}) == "pi" and hc.harness_of("Z.AI", {}) == "pi"


# --- a server without a screen, and the swap ----------------------------------------------------------------------

def vps(total, cores, swap=None, avail=None):
    got = machine(total, cores, avail=avail)
    got.update({"swap_total_gib": swap, "host_type": "vps"})
    return got


GLM_KEY_PLAN = {"provider": "glm", "id": "api-key", "label": "API key", "tier": 15}   # 5 Scout / 3 Analista / 2 Scorer


def test_the_full_team_runs_on_a_4_gb_vps_with_the_swap_of_the_installer():
    # cx23: 2 vCPU, 3.7 GiB seen, the 2 GiB of swap host-setup.sh makes
    got = hc.capacity(vps(3.7, 2, swap=2.0), "pi")
    assert got["cap"] >= 10, got
    roster = plan_registry.burst_roster(GLM_KEY_PLAN, host_cap=got["cap"])
    assert roster["roster"] == {"scout": 5, "analista": 3, "scorer": 2} and not roster["capped_by_host"]
    assert "2.0 GiB swap" in got["message"] and "no screen" in got["message"]


def test_a_4_gb_vps_without_swap_or_a_2_gb_one_gets_a_smaller_team_and_says_so():
    no_swap = hc.capacity(vps(3.7, 2), "pi")
    assert 3 <= no_swap["cap"] < 10 and no_swap["limit"] == "ram" and "the RAM is the limit" in no_swap["message"]
    roster = plan_registry.burst_roster(GLM_KEY_PLAN, host_cap=no_swap["cap"])
    assert roster["capped_by_host"] and roster["total_workers"] == no_swap["cap"]
    two = hc.capacity(vps(1.9, 2), "pi")
    assert two["cap"] == 1 and "too small" in two["message"] and "carries 1 worker:" in two["message"]
    two_swap = hc.capacity(vps(1.9, 2, swap=2.0), "pi")
    assert 1 < two_swap["cap"] < 10


def test_the_same_4_gb_with_a_screen_keeps_room_for_the_person():
    assert hc.capacity(machine(3.7, 2), "pi")["cap"] < hc.capacity(vps(3.7, 2), "pi")["cap"]


def test_the_swap_counts_at_a_weight_not_as_ram():
    with_swap = hc.capacity(vps(3.7, 64, swap=2.0), "pi")["ram_cap"]
    as_ram = hc.capacity(vps(5.7, 64), "pi")["ram_cap"]
    without = hc.capacity(vps(3.7, 64), "pi")["ram_cap"]
    assert without < with_swap < as_ram


def test_a_16_gb_machine_still_carries_the_full_team():
    for probe in (machine(15.2, 8), vps(15.2, 8), vps(15.2, 8, swap=2.0)):
        cap = hc.capacity(probe, "pi")["cap"]
        assert plan_registry.burst_roster(GLM_KEY_PLAN, host_cap=cap)["roster"] == {"scout": 5, "analista": 3, "scorer": 2}


def test_the_probe_reads_meminfo_and_the_container_limits(tmp_path):
    proc, cg = tmp_path / "proc", tmp_path / "cg"
    proc.mkdir()
    cg.mkdir()
    (proc / "meminfo").write_text("MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(16.0) and got["ram_avail_gib"] == pytest.approx(8.0)
    assert got["swap_total_gib"] is None
    (proc / "meminfo").write_text("MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\nSwapTotal:       2097152 kB\n")
    assert hc.read_probe(proc, cg)["swap_total_gib"] == pytest.approx(2.0)
    (cg / "memory.max").write_text(str(4 * 1024 ** 3) + "\n")
    (cg / "cpu.max").write_text("200000 100000\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(4.0) and got["ram_avail_gib"] <= 4.0 and got["cores"] == 2.0
    assert got["swap_total_gib"] is None, "a container with its own memory limit does not count the machine's swap"
    (cg / "memory.max").write_text("max\n")
    (cg / "cpu.max").write_text("max 100000\n")
    got = hc.read_probe(proc, cg)
    assert got["ram_total_gib"] == pytest.approx(16.0) and got["cores"] != 2.0


# --- plan_registry: the roster and the one source of the cap -------------------------------------------------------

def test_the_big_roster_is_no_longer_cut_to_one_per_role_on_the_windows_pc(monkeypatch):
    plan = dict(plan_registry.find_plan("claude", "max20"))
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: hc.capacity(machine(6.0, 4), "codex"))
    roster = plan_registry.burst_roster(plan)
    # the table asks 6/3/2 (11 workers): the machine carries 8. The third Analista goes first (not below two: with no pause
    # two keep up on their own), then the Scouts from the head; no role below one
    assert roster["total_workers"] == 8 and roster["capped_by_host"]
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


@pytest.mark.parametrize("cap, expected", [
    (10, {"scout": 5, "analista": 3, "scorer": 2}),   # the band of tier 15 as the table has it
    (9, {"scout": 5, "analista": 2, "scorer": 2}),    # the third Analista goes first
    (8, {"scout": 4, "analista": 2, "scorer": 2}),    # then the Scouts, from the head: the supply is what the burst waits for
    (6, {"scout": 2, "analista": 2, "scorer": 2}),
    (4, {"scout": 1, "analista": 1, "scorer": 2}),    # then, as before, Analista and Scorer after the Scouts
    (3, {"scout": 1, "analista": 1, "scorer": 1}),
])
def test_a_small_host_drops_the_third_analista_before_any_scout(cap, expected):
    plan = {"provider": "glm", "id": "api-key", "label": "API key", "tier": 15}  # the plan an API key makes (plan_registry)
    assert plan_registry.burst_roster(plan, host_cap=cap)["roster"] == expected


def test_the_probe_reads_the_host_type_the_preflight_wrote(tmp_path, monkeypatch):
    proc = tmp_path / "proc"
    proc.mkdir()
    (proc / "meminfo").write_text("MemTotal:       4000000 kB\nMemAvailable:    3000000 kB\n")
    for value, expected in (("vps", "vps"), (" VPS ", "vps"), ("local", "local"), ("", "local"), (None, "local")):
        if value is None:
            monkeypatch.delenv("JHT_HOST_TYPE", raising=False)
        else:
            monkeypatch.setenv("JHT_HOST_TYPE", value)
        assert hc.read_probe(proc, tmp_path / "no-cgroup")["host_type"] == expected, value


# A server on codex that the kernel OOM killer took down: 7.7 GB, no swap, 18 codex processes held ~6.5 GB (~360 MB each).
def test_a_server_on_codex_is_sized_with_the_measured_360_mb_and_never_filled_to_the_last_byte():
    probe = {**machine(7.7, 16), "host_type": "vps", "swap_total_gib": 0}
    got = hc.capacity(probe, "codex")
    assert got["ram_per_agent_gib"] == 0.36
    sessions = got["cap"] + 6                      # the workers and the six fixed sessions (the Mantenitore counted)
    assert sessions * 0.36 <= 7.7 * 0.8, "the sessions of the team use at most 80 % of the RAM"
    assert got["cap"] < 18 - 5, "the 0.22 GiB figure allowed 25 workers here"


def test_a_local_computer_keeps_the_figure_measured_on_it():
    got = hc.capacity({**machine(16, 16), "host_type": "local"}, "codex")
    assert got["ram_per_agent_gib"] == 0.22
