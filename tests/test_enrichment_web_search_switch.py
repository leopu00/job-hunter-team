"""The web search of each role as a switch of the enrichments, and what each switch costs (T325).

`web_search.<role>.enabled` (analista, scout, mentor) sits in the same `enrichment-policy.json` the CLI and the desktop set:
the Analista's is off by default (on Haiku it cost ~0.26 $ more per position and brought no logo nor office), the Scout's and
the Mentor's on. `enrichment_policy.py web-search <role>` is what the launcher asks, under `economy` and the SAVING mode.

`enrichment_costs.json` is the one place the cost of each switch is written; `show` (and so `apply` and the desktop's get)
carries it as `costs`, checked: only switches of the policy, numbers or null, never a made-up figure.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
POLICY = SKILLS_DIR / "enrichment_policy.py"
COSTS = SKILLS_DIR / "enrichment_costs.json"
ROLES = ("analista", "scout", "mentor")


@pytest.fixture()
def home(tmp_path):
    (tmp_path / "profile").mkdir()
    return tmp_path


def _run(home: Path, *args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    env = {key: value for key, value in os.environ.items() if not key.startswith("JHT_")}
    env.update(JHT_DB=str(home / "jobs.db"), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([sys.executable, str(POLICY), *args], capture_output=True, text=True, input=stdin, env=env,
                          timeout=60)


def _write(home: Path, name: str, data) -> None:
    (home / "profile" / name).write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")


def _asked(home: Path, role: str) -> tuple[int, dict]:
    done = _run(home, "web-search", role)
    return done.returncode, json.loads(done.stdout)


def test_the_defaults_turn_the_analista_s_search_off_and_keep_the_scout_s_and_the_mentor_s(home):
    shown = json.loads(_run(home, "show").stdout)["policy"]
    assert shown["web_search"] == {"analista": {"enabled": False}, "scout": {"enabled": True}, "mentor": {"enabled": True}}
    assert _asked(home, "analista") == (1, {"role": "analista", "web_search": False,
                                           "reason": "disabled by policy (web_search.analista.enabled=false)"})
    assert _asked(home, "scout") == (0, {"role": "scout", "web_search": True, "reason": "on"})
    assert _asked(home, "mentor")[0] == 0


def test_a_file_written_before_the_switches_gets_the_defaults(home):
    _write(home, "enrichment-policy.json", {"economy": False, "logo": {"enabled": True}})
    assert [_asked(home, role)[0] for role in ROLES] == [1, 0, 0]


@pytest.mark.parametrize("role", ROLES)
def test_set_and_apply_turn_each_role_on_and_off(home, role):
    key = f"web_search.{role}.enabled"
    assert _run(home, "set", key, "on").returncode == 0
    assert _asked(home, role)[0] == 0
    done = _run(home, "apply", stdin=json.dumps({key: False}))
    assert done.returncode == 0 and json.loads(done.stdout)["policy"]["web_search"][role] == {"enabled": False}
    assert _asked(home, role)[0] == 1
    others = [r for r in ROLES if r != role]
    shown = json.loads(_run(home, "show").stdout)["policy"]["web_search"]
    assert all(shown[r] == {"enabled": r != "analista"} for r in others), "one switch never moves another"


@pytest.mark.parametrize("request_", [{"web_search.analista.enabled": "true"}, {"web_search.analista.enabled": 1},
                                      {"web_search.scorer.enabled": True}, {"web_search.analista": True}])
def test_apply_refuses_a_bad_value_or_a_role_without_a_switch_and_writes_nothing(home, request_):
    done = _run(home, "apply", stdin=json.dumps(request_))
    assert done.returncode == 1 and json.loads(done.stdout)["ok"] is False
    assert not (home / "profile" / "enrichment-policy.json").exists()


@pytest.mark.parametrize(("policy", "mode", "reason"), [
    ({"economy": True, "web_search": {"scout": {"enabled": True}}}, None, "SAVING policy is active (economy=true)"),
    (None, {"mode": "saving"}, "SAVING mode is active (mode=saving)"),
    (None, "{not json", "capitano-maintenance.json exists but cannot be interpreted: "
                        "autonomous enrichment is suspended until a person reviews it"),
])
def test_economy_and_the_saving_mode_turn_every_search_off(home, policy, mode, reason):
    if policy is not None:
        _write(home, "enrichment-policy.json", policy)
    if mode is not None:
        _write(home, "capitano-maintenance.json", mode)
    for role in ROLES:
        assert _asked(home, role) == (1, {"role": role, "web_search": False, "reason": reason})


def test_a_saving_mode_that_has_ended_gives_the_search_back(home):
    _write(home, "capitano-maintenance.json", {"mode": "saving", "mode_until": "2020-01-01T00:00:00Z"})
    assert _asked(home, "scout")[0] == 0


def test_a_role_without_a_switch_has_no_search(home):
    assert _asked(home, "scorer") == (1, {"role": "scorer", "web_search": False, "reason": "the scorer role has no web search"})


# ── the costs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_costs_file_names_every_switch_of_the_policy_and_only_those():
    data = json.loads(COSTS.read_text(encoding="utf-8"))
    sys.path.insert(0, str(SKILLS_DIR))
    try:
        import enrichment_policy
    finally:
        sys.path.remove(str(SKILLS_DIR))
    switches = {key for key, (_s, _f, how) in enrichment_policy._SETTABLE.items() if how == "bool"}
    assert set(data["switches"]) == switches
    for key, entry in data["switches"].items():
        assert isinstance(entry["costly"], bool), key
        assert entry["usd_per_position"] is None or 0 <= entry["usd_per_position"] < 1, key
        assert entry.get("basis"), f"{key}: where the figure comes from"
    # the measured ones (T323 / T323 bis, Analista on Haiku)
    assert data["switches"]["web_search.analista.enabled"]["usd_per_position"] == 0.26
    assert data["switches"]["economy"]["costly"] is False


def test_show_carries_the_costs_without_the_notes(home):
    costs = json.loads(_run(home, "show").stdout)["costs"]
    assert costs["version"] == 1 and costs["positions_per_day"] == 50
    assert costs["switches"]["web_search.analista.enabled"] == {"costly": True, "usd_per_position": 0.26}
    assert costs["switches"]["web_search.scout.enabled"] == {"costly": True, "usd_per_position": None, "usd_per_search": 0.02}
    assert costs["switches"]["recheck_weekly.enabled"] == {"costly": True, "usd_per_position": None}
    assert all("basis" not in entry for entry in costs["switches"].values())
    applied = json.loads(_run(home, "apply", stdin='{"economy": true}').stdout)
    assert applied["costs"] == costs


@pytest.mark.parametrize("bad", [
    "{not json",
    {"version": 2, "positions_per_day": 50, "switches": {}},
    {"version": 1, "positions_per_day": 0, "switches": {}},
    {"version": 1, "positions_per_day": True, "switches": {}},
    {"version": 1, "positions_per_day": 50, "switches": {"economy": {"costly": "no", "usd_per_position": 0.1}}},
    {"version": 1, "positions_per_day": 50, "switches": {"economy": {"costly": False, "usd_per_position": -1}}},
    {"version": 1, "positions_per_day": 50, "switches": {"economy": {"costly": False, "usd_per_position": "0.1"}}},
    {"version": 1, "positions_per_day": 50, "switches": {"economy": {"costly": False, "usd_per_position": True}}},
    {"version": 1, "positions_per_day": 50, "switches": {"economy": {"costly": False, "usd_per_search": 1000}}},
], ids=["not-json", "version", "per-day-zero", "per-day-bool", "costly-text", "negative", "text", "bool", "too-much"])
def test_a_costs_file_out_of_shape_gives_no_figure_rather_than_a_wrong_one(tmp_path, monkeypatch, bad):
    sys.path.insert(0, str(SKILLS_DIR))
    try:
        import enrichment_policy
    finally:
        sys.path.remove(str(SKILLS_DIR))
    path = tmp_path / "costs.json"
    path.write_text(bad if isinstance(bad, str) else json.dumps(bad), encoding="utf-8")
    monkeypatch.setattr(enrichment_policy, "COSTS_PATH", str(path))
    assert enrichment_policy.costs() is None


def test_a_costs_file_drops_what_is_not_a_switch_and_a_missing_or_huge_file_gives_none(tmp_path, monkeypatch):
    sys.path.insert(0, str(SKILLS_DIR))
    try:
        import enrichment_policy
    finally:
        sys.path.remove(str(SKILLS_DIR))
    path = tmp_path / "costs.json"
    path.write_text(json.dumps({"version": 1, "positions_per_day": 10, "switches": {
        "economy": {"costly": False, "usd_per_position": 0.5, "basis": "x"},
        "logo.min_score": {"costly": True, "usd_per_position": 1},
        "made.up": {"costly": True, "usd_per_position": 1}}}), encoding="utf-8")
    monkeypatch.setattr(enrichment_policy, "COSTS_PATH", str(path))
    assert enrichment_policy.costs() == {"version": 1, "positions_per_day": 10,
                                         "switches": {"economy": {"costly": False, "usd_per_position": 0.5}}}
    path.write_text(" " * (enrichment_policy.COSTS_MAX_BYTES + 1), encoding="utf-8")
    assert enrichment_policy.costs() is None
    monkeypatch.setattr(enrichment_policy, "COSTS_PATH", str(tmp_path / "missing.json"))
    assert enrichment_policy.costs() is None
