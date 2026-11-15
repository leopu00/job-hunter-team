"""The first burst of an API key with the budget of the setup (JHT-T322) opens on the full roster the machine carries.

A trial of 5 $ for 30 minutes, one night, a few days: the spending brake (pi_spend_cap.py) keeps the team to the budget
and its pace, so the roster is the one measured for 20 scored positions in 30 minutes (5 Scout, 3 Analisti, 2 Scorer),
cut only by host_capacity, and the Captain is not told that the burst opens small. With no limit the roster stays the
smallest (nothing but the provider stops the spending) and the setup says so when the person picks it. The config is
written to a fake JHT_HOME the way the setup writes it; the machines are made up.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "shared"))
import host_capacity as hc  # noqa: E402
import plan_registry  # noqa: E402

HOUR = 3600
FULL = {"scout": 5, "analista": 3, "scorer": 2}
SMALLEST = {"scout": 1, "analista": 1, "scorer": 1}


def stamp(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def preset(name: str, now: float):
    """team.budget and team.working_hours as the setup writes them for each choice (cli/wizard/setup-budget.js)."""
    if name == "trial":
        return {"budget": {"usd": 5, "starts_at": stamp(now), "ends_at": stamp(now + 1800), "set_by": "setup",
                           "timezone": "Europe/Rome"}}
    if name == "night":
        return {"budget": {"usd": 5, "starts_at": stamp(now), "ends_at": stamp(now + 10 * HOUR), "set_by": "setup",
                           "timezone": "Europe/Rome"}}
    if name == "days":
        return {"budget": {"usd": 10, "starts_at": stamp(now), "ends_at": stamp(now + 3 * 24 * HOUR), "set_by": "setup",
                           "timezone": "Europe/Rome"},
                "working_hours": {"timezone": "Europe/Rome", "windows": [
                    {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "08:00", "end": "18:00"}]}}
    return {}  # no limit: no team.budget


def setup_config(home: Path, monkeypatch, name: str, provider="glm"):
    monkeypatch.setenv("JHT_HOME", str(home))
    cfg = {"active_provider": provider, "providers": {provider: {"auth_method": "api_key"}}}
    team = preset(name, time.time())
    if team:
        cfg["team"] = team
    (home / "jht.config.json").write_text(json.dumps(cfg), encoding="utf-8")


@pytest.mark.parametrize("name", ["trial", "night", "days"])
def test_every_budget_of_the_setup_opens_the_full_roster_and_no_small_roster_warning(tmp_path, monkeypatch, name):
    setup_config(tmp_path, monkeypatch, name)
    got = plan_registry.burst_roster(host_cap=100)  # read from the configuration, as the Capitano's burst does
    assert got["ok"] and got["roster"] == FULL and got["total_workers"] == 10
    assert got["assumed"] is None, "the Captain must not read «the burst opens on the smallest roster»"
    assert plan_registry.report_assumed(got) == {}
    assert "budget" in got["plan_label"] and got["scout_cap_first_pass"] == 50 and got["target_scored"] == 20


@pytest.mark.parametrize("name", ["trial", "night", "days"])
@pytest.mark.parametrize(("ram_gib", "cores", "swap_gib"), [(4.0, 2, 4.0), (8.0, 4, 0.0), (2.0, 1, 0.0)])
def test_the_full_roster_is_cut_only_by_what_the_machine_carries(tmp_path, monkeypatch, name, ram_gib, cores, swap_gib):
    setup_config(tmp_path, monkeypatch, name)
    machine = {"ram_total_gib": ram_gib, "ram_avail_gib": ram_gib * 0.8, "cores": cores, "load5": 0.2,
               "swap_total_gib": swap_gib, "host_type": "vps"}
    capacity = hc.capacity(machine, "pi")
    monkeypatch.setattr(plan_registry, "_host_capacity", lambda: capacity)
    got = plan_registry.burst_roster()
    assert got["host_agent_cap"] == capacity["cap"]
    assert got["total_workers"] == max(min(10, capacity["cap"]), 3), (capacity["cap"], got["roster"])
    assert got["capped_by_host"] is (capacity["cap"] < 10)


def test_no_limit_keeps_the_smallest_roster_and_says_how_to_get_the_full_team(tmp_path, monkeypatch):
    setup_config(tmp_path, monkeypatch, "none")
    got = plan_registry.burst_roster(host_cap=100)
    assert got["roster"] == SMALLEST
    note = plan_registry.report_assumed(got)["plan_assumed"]
    assert "no budget declared" in note and "jht setup" in note and "no_quota_cap" not in note


def test_the_setup_warns_of_the_smallest_team_when_the_person_picks_no_limit():
    """The warning the wizard shows on «No limit» (cli/wizard/setup-budget.js) names the small start, in every language."""
    words = {"en": "smallest team", "it": "squadra più piccola", "de": "kleinsten Team", "fr": "plus petite équipe",
             "es": "equipo más pequeño", "pt": "equipa mais pequena", "hu": "legkisebb csapattal"}
    for lang, word in words.items():
        text = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))["wizard.budget.none_warning"]
        assert word in text, lang


def test_an_older_config_with_only_no_quota_cap_keeps_its_steps(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    cfg = {"active_provider": "glm", "providers": {"glm": {"auth_method": "api_key"}}, "no_quota_cap": {"eur": 12}}
    (tmp_path / "jht.config.json").write_text(json.dumps(cfg), encoding="utf-8")
    got = plan_registry.burst_roster(host_cap=100)
    assert got["tier"] == 5 and got["assumed"] is None
