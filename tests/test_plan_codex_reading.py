"""`jht providers plan` and what Codex says about the plan.

Codex names the plan `prolite` and shows ONE weekly window; the table had plus / pro / pro-max, none of them
called that, and its `window_5h` was a hand-written seed for all three. Now the bridge keeps the last reading
(`logs/codex-plan-reading.json`) and `plan_registry.py` uses it: the name (`prolite` is the table's Pro, 100 $)
and the window (derived from the reading, the seed only when there is none).
"""
import importlib.util
import json
import os
import stat
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import plan_registry  # noqa: E402  (puts shared/ on the path)
import i18n  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_codex_app_server_limits as appserver  # noqa: E402
from test_codex_app_server_limits import world  # noqa: E402,F401  (the fixture: a fake `codex` + a bridge on a private JHT_HOME)

NOW = appserver.NOW
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="il bridge gira nel container Linux")


@pytest.fixture(autouse=True)
def english(monkeypatch):
    monkeypatch.delenv("JHT_LANG", raising=False)
    monkeypatch.setenv("JHT_HOST_ENV_FILE", "/nonexistent/jht-host.env")
    i18n._resolve_lang.cache_clear()
    i18n._load_catalog.cache_clear()
    yield
    i18n._resolve_lang.cache_clear()
    i18n._load_catalog.cache_clear()


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (tmp_path / "logs").mkdir()
    return tmp_path


def reading(home, plan_type="prolite", single_weekly=True, age=60):
    (home / "logs" / "codex-plan-reading.json").write_text(
        json.dumps({"plan_type": plan_type, "single_weekly": single_weekly, "observed_at": time.time() - age}),
        encoding="utf-8")


def declare(home, plan_id):
    (home / "jht.config.json").write_text(
        json.dumps({"active_provider": "openai", "providers": {"openai": {"plan": plan_id}}}), encoding="utf-8")


def openai_plans():
    return {p["id"]: p for p in plan_registry.list_plans("openai")["openai"]}


def listing(capsys):
    assert plan_registry.main(["list", "openai"]) == 0
    return capsys.readouterr().out


# ── The registry ────────────────────────────────────────────────────────

def test_prolite_is_said_to_be_the_100_dollar_pro_and_its_window_is_the_weekly_one(home, capsys):
    reading(home, "prolite", single_weekly=True)
    out = listing(capsys)
    assert "  Codex reports: prolite → Pro 100 $\n" in out
    assert openai_plans()["pro"]["window_5h"] is False and openai_plans()["pro"]["window_5h_observed"] is True


def test_a_plan_with_two_windows_has_the_five_hour_window_even_where_the_seed_says_no(home, capsys):
    reading(home, "plus", single_weekly=False)
    declare(home, "plus")
    plans = openai_plans()
    assert plans["plus"]["window_5h"] is True and plans["plus"]["window_5h_observed"] is True
    assert "[weekly cap, 5-hour window]" in next(l for l in listing(capsys).splitlines() if l.strip().startswith("plus"))
    # the rows the account does not have keep the table's seed
    assert plans["pro"]["window_5h"] is False and "window_5h_observed" not in plans["pro"]
    assert plans["pro-max"]["window_5h"] is False


def test_prolite_with_two_windows_would_show_them(home):
    reading(home, "prolite", single_weekly=False)
    assert openai_plans()["pro"]["window_5h"] is True


def test_without_a_reading_the_table_is_as_it_was_and_says_nothing_of_codex(home, capsys):
    plans = openai_plans()
    assert [p["window_5h"] for p in plans.values()] == [False, False, False]
    assert not any("window_5h_observed" in p for p in plans.values())
    assert "Codex reports" not in listing(capsys)


@pytest.mark.parametrize("breakage", ["old", "garbage", "future", "not_bool", "bad_name"])
def test_a_reading_that_cannot_be_trusted_is_ignored(home, capsys, breakage):
    path = home / "logs" / "codex-plan-reading.json"
    if breakage == "old":
        reading(home, "prolite", True, age=31 * 86400)
    elif breakage == "garbage":
        path.write_text("{not json", encoding="utf-8")
    elif breakage == "future":
        reading(home, "prolite", True, age=-3600)
    elif breakage == "not_bool":
        path.write_text(json.dumps({"plan_type": "prolite", "single_weekly": "yes", "observed_at": time.time()}),
                        encoding="utf-8")
    else:
        reading(home, "pro\x1b[31mlite", True)
    declare(home, "plus")
    assert openai_plans()["pro"].get("window_5h_observed") is None
    assert "Codex reports" not in listing(capsys)


def test_a_plan_the_table_does_not_know_is_named_but_no_row_is_changed(home, capsys):
    reading(home, "team", single_weekly=False)
    assert "  Codex reports: team (not in this table)\n" in listing(capsys)
    assert not any("window_5h_observed" in p for p in openai_plans().values())


def test_an_unknown_name_falls_on_the_plan_the_user_declared(home):
    reading(home, "team", single_weekly=False)
    declare(home, "pro-max")
    plans = openai_plans()
    assert plans["pro-max"]["window_5h"] is True and "window_5h_observed" not in plans["pro"]


def test_other_providers_are_never_touched_by_a_codex_reading(home):
    reading(home, "prolite", True)
    assert all(p["window_5h"] is True and "window_5h_observed" not in p
               for prov in ("kimi", "claude") for p in plan_registry.list_plans(prov)[prov])


def test_the_declared_plan_and_the_roster_carry_the_observed_window(home, capsys):
    reading(home, "prolite", True)
    declare(home, "pro")
    assert plan_registry.main(["get"]) == 0
    got = json.loads(capsys.readouterr().out)
    assert got["window_5h"] is False and got["window_5h_observed"] is True
    assert plan_registry.burst_roster(got, host_cap=99)["window_5h"] is False


def test_the_note_is_in_the_language_of_the_person(home, capsys, monkeypatch):
    reading(home, "prolite", True)
    monkeypatch.setenv("JHT_LANG", "it")
    i18n._resolve_lang.cache_clear()
    assert "Codex indica: prolite → Pro 100 $" in listing(capsys)


# ── The bridge keeps the reading ────────────────────────────────────────

def _bridge(tmp_path, monkeypatch):
    home = tmp_path / "bridge-home"
    home.mkdir()
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_plan_reading_test", appserver.BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return home, module


def kept(home):
    return json.loads((home / "logs" / "codex-plan-reading.json").read_text(encoding="utf-8"))


def test_the_bridge_keeps_what_the_rollout_says(tmp_path, monkeypatch):
    home, bridge = _bridge(tmp_path, monkeypatch)
    folder = home / ".codex" / "sessions" / "2026" / "10" / "26"
    folder.mkdir(parents=True)
    rate = {"plan_type": "prolite", "primary": {"used_percent": 33, "window_minutes": 10080, "resets_at": NOW + 86400},
            "secondary": None}
    event = {"timestamp": "2026-10-26T18:00:00.000Z", "type": "event_msg",
             "payload": {"type": "token_count", "rate_limits": rate}}
    (folder / "rollout-2026-10-26T18-00-00-x.jsonl").write_text(
        "\n".join(json.dumps(event) for _ in range(20)) + "\n", encoding="utf-8")
    parsed = bridge.fetch_codex_rollout()
    assert parsed["plan_type"] == "prolite" and parsed["usage_is_weekly"] is True
    assert kept(home)["plan_type"] == "prolite" and kept(home)["single_weekly"] is True


def test_the_bridge_keeps_what_codex_itself_says(world, monkeypatch):
    monkeypatch.setenv("FAKE_PLAN_TYPE", "plus")
    world.mode("both")
    assert world.bridge.fetch_codex_app_server() is not None
    saved = json.loads((world.home / "logs" / "codex-plan-reading.json").read_text(encoding="utf-8"))
    assert saved["plan_type"] == "plus" and saved["single_weekly"] is False


def test_the_file_is_rewritten_when_the_plan_changes_and_not_for_nothing(world):
    bridge, path = world.bridge, world.home / "logs" / "codex-plan-reading.json"
    weekly = {"usage": 1, "usage_is_weekly": True, "plan_type": "prolite"}
    bridge._remember_codex_reading(weekly)
    first = path.read_text(encoding="utf-8")
    time.sleep(0.02)
    bridge._remember_codex_reading(dict(weekly))
    assert path.read_text(encoding="utf-8") == first
    bridge._remember_codex_reading({"usage": 1, "usage_is_weekly": False, "plan_type": "prolite"})
    assert json.loads(path.read_text(encoding="utf-8"))["single_weekly"] is False


def test_a_reading_older_than_a_day_is_refreshed(world):
    bridge, path = world.bridge, world.home / "logs" / "codex-plan-reading.json"
    path.write_text(json.dumps({"plan_type": "prolite", "single_weekly": True,
                                "observed_at": time.time() - 2 * 86400}), encoding="utf-8")
    bridge._remember_codex_reading({"usage": 1, "usage_is_weekly": True, "plan_type": "prolite"})
    assert time.time() - json.loads(path.read_text(encoding="utf-8"))["observed_at"] < 60


@pytest.mark.parametrize("name", ["pro lite", "../../x", "a" * 40, "pro\nlite", "", 7])
def test_a_plan_name_that_is_not_a_plain_word_is_not_kept(world, name):
    parsed = world.bridge._codex_parsed_from_rate_limits(
        {"plan_type": name, "primary": {"used_percent": 1, "window_minutes": 10080, "resets_at": NOW + 5}},
        {"plan_type": name, "primary": {}})
    assert parsed["plan_type"] is None


def test_a_failed_write_does_not_change_what_the_caller_reads(world, monkeypatch):
    monkeypatch.setattr(world.bridge, "CODEX_READING_FILE", world.home / "no" / "such" / "dir" / "r.json")
    parsed = {"usage": 1, "usage_is_weekly": True, "plan_type": "prolite"}
    assert world.bridge._remember_codex_reading(parsed) is parsed
