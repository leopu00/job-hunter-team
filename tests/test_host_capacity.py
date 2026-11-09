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


# A 12 GB Windows PC: the VM gets 5.9 GiB and 4 vCPU. The flat 0.6 GiB gave 1 worker here.
def test_the_windows_pc_that_was_stuck_at_one_worker_now_carries_a_full_pipeline():
    got = hc.capacity(machine(5.9, 4), "codex")
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
    assert tiny["cap"] == 1 and tiny["limit"] == "floor" and "too small" in tiny["message"]
    small = hc.capacity(machine(3.9, 2), "codex")
    assert small["cap"] == 3 and "3 workers" in small["message"]
    one_core = hc.capacity(machine(16, 1), "codex")
    assert one_core["cap"] == 2 and one_core["limit"] == "cpu"
    assert hc.capacity(machine(1.0, 1), "claude")["cap"] == 1


def test_the_minimal_pipeline_is_kept_on_a_machine_that_can_hold_it():
    got = hc.capacity(machine(5.9, 4), "claude")  # 5.9 GiB / 0.6 would be 1: a pipeline is still 3 workers
    assert got["cap"] == 3 and got["limit"] == "floor" and "minimal pipeline" in got["message"]


def test_an_overloaded_machine_halves_the_cap_and_a_busy_one_does_not():
    assert hc.capacity(machine(16, 4, load5=20.0), "codex")["cap"] == 8        # the team's own load at 13 sessions
    braked = hc.capacity(machine(16, 4, load5=40.0), "codex")
    assert braked["cap"] == 4 and braked["limit"] == "load" and "overloaded" in braked["message"]


def test_little_free_ram_right_now_stops_the_growth():
    got = hc.capacity(machine(16, 8, avail=0.4), "codex")
    assert got["cap"] == 3 and got["limit"] == "free-ram"


def test_a_machine_that_cannot_be_measured_has_no_cap():
    got = hc.capacity({"ram_total_gib": None, "ram_avail_gib": None, "cores": 4, "load5": 1}, "codex")
    assert got["cap"] is None and "no cap applied" in got["message"]


def test_missing_cores_or_load_do_not_invent_a_limit():
    got = hc.capacity({"ram_total_gib": 5.9, "ram_avail_gib": 4, "cores": None, "load5": None}, "codex")
    assert got["cap"] == 12 and got["limit"] == "ram" and got["cpu_cap"] is None


def test_the_harness_comes_from_the_active_provider():
    assert hc.harness_of("openai") == hc.harness_of("Codex") == "codex"
    assert hc.harness_of("anthropic") == "claude" and hc.harness_of("moonshot") == "kimi"
    assert hc.harness_of("zzz") is None and hc.harness_of(None) is None
    assert hc.capacity(machine(5.9, 16), None)["ram_per_agent_gib"] == hc.UNKNOWN_HARNESS_GIB


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
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: hc.capacity(machine(5.9, 4), "codex"))
    monkeypatch.setattr(plan_registry, "_host_agent_cap", lambda: hc.capacity(machine(5.9, 4), "codex")["cap"])
    roster = plan_registry.burst_roster(plan)
    assert roster["total_workers"] == 8 and not roster["capped_by_host"]
    assert roster["roster"] == {"scout": 4, "analista": 2, "scorer": 2}
    assert "carries 8 workers" in roster["host_note"]


def test_the_flat_constant_is_gone_and_a_failed_measurement_means_no_cap(monkeypatch):
    assert not hasattr(plan_registry, "_RAM_GB_PER_AGENT")
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: None)
    assert plan_registry._host_agent_cap() is None
    assert plan_registry.burst_roster(plan_registry.find_plan("kimi", "moderato"))["host_note"] is None


def test_the_cap_follows_the_active_provider(monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(hc, "read_probe", lambda *a, **k: machine(5.9, 16))
    (tmp_path / "jht.config.json").write_text('{"active_provider": "openai"}', encoding="utf-8")
    codex_cap = plan_registry._host_capacity()
    (tmp_path / "jht.config.json").write_text('{"active_provider": "claude"}', encoding="utf-8")
    claude_cap = plan_registry._host_capacity()
    assert codex_cap["ram_per_agent_measured"] and not claude_cap["ram_per_agent_measured"]
    assert codex_cap["cap"] > claude_cap["cap"]
