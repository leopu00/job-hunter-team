"""Call-time home resolution: real producers/readers, private inputs, no daemons."""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
from jht_home import jht_home  # noqa: E402

CASES = [
    ("agent_pause", "shared/skills/agent_pause.py", "logs/agent-pauses.jsonl"),
    ("sentinel", ".launcher/sentinel-bridge.py", "logs/sentinel-data.jsonl"),
    ("burn_intent", "shared/skills/burn_intent.py", ".burn-intent.flag"),
    ("burst", "shared/skills/burst.py", "logs/burst.jsonl"),
    ("captain_diary", "shared/skills/captain_diary.py", "logs/captain-diary-2026-11-08.md"),
    ("first_run", "shared/skills/first_run.py", "state/first-run.json"),
    ("host_vitals", "shared/skills/host_vitals.py", "logs/vitals.jsonl"),
    ("pace_guard", "shared/skills/pace_guard.py", "logs/sentinel-data.jsonl"),
    ("rate_budget", "shared/skills/rate_budget.py", "logs/sentinel-data.jsonl"),
    ("standby", "shared/skills/standby.py", ".team-standby.flag"),
    ("usage_record", "shared/skills/usage_record.py", "logs/sentinel-data.jsonl"),
    ("window_ratio_meter", "shared/skills/window_ratio_meter.py", "logs/window-ratio-state.json"),
    ("format_time", "shared/skills/format_time.py", "host.env"),
]


def load(path):
    spec = importlib.util.spec_from_file_location("private_home_" + path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_user(monkeypatch, home):
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))


def exercise(name, module, home, relative, monkeypatch, index):
    value = {"synthetic": name, "index": index}
    if name == "agent_pause":
        module.log_event("synthetic", index=index)
    elif name == "sentinel":
        module.write_jsonl(value)
    elif name == "burn_intent":
        module.grant(hours=1, reason="synthetic", now=datetime(2026, 11, 8, tzinfo=timezone.utc))
    elif name == "burst":
        module._audit("synthetic", index=index)
    elif name == "captain_diary":
        monkeypatch.setattr(module, "_now_local", lambda: datetime(2026, 11, 8, tzinfo=timezone.utc))
        assert module.add("synthetic") == 0
    elif name == "first_run":
        module._write(value)
    elif name == "host_vitals":
        monkeypatch.setattr(module, "read_vitals", lambda: value)
        module.append_sample()
    elif name in ("pace_guard", "rate_budget"):
        (home / "logs").mkdir(parents=True)
        (home / relative).write_text(json.dumps(value) + "\n", encoding="utf-8")
        assert module.load_last_sample() == value
    elif name == "standby":
        module._atomic_write(value)
    elif name == "usage_record":
        module.append_sample(value)
    elif name == "window_ratio_meter":
        module._write_state(value)
    elif name == "format_time":
        home.mkdir(parents=True)
        zone = "UTC" if index == 1 else "Europe/Paris"
        (home / relative).write_text("JHT_USER_TZ=" + zone + "\n", encoding="utf-8")
        assert module._read_profile_timezone() == zone
    else:
        raise AssertionError("unknown synthetic scenario")
    assert (home / relative).is_file()
    assert (home / relative).stat().st_size > 0


@pytest.mark.parametrize("name,path,relative", CASES, ids=[row[0] for row in CASES])
def test_import_before_isolation_then_use_two_homes_without_reload(name, path, relative, tmp_path, monkeypatch):
    original = tmp_path / "original-home"
    fake_user(monkeypatch, tmp_path / "original-user")
    monkeypatch.setenv("JHT_HOME", str(original))
    monkeypatch.delenv("JHT_HOST_ENV_FILE", raising=False)
    monkeypatch.delenv("JHT_USER_TZ", raising=False)

    class WatchedEnvironment(dict):
        home_reads = 0

        def get(self, key, default=None):
            if key == "JHT_HOME":
                self.home_reads += 1
            return super().get(key, default)

    watched = WatchedEnvironment(os.environ)
    with monkeypatch.context() as during_import:
        during_import.setattr(os, "environ", watched)
        module = load(ROOT / path)
    assert watched.home_reads == 0
    assert not original.exists()
    first = tmp_path / "call-one"
    second = tmp_path / "call-two"
    monkeypatch.setenv("JHT_HOME", str(first))
    fake_user(monkeypatch, tmp_path / "isolated-user")
    exercise(name, module, first, relative, monkeypatch, 1)
    first_bytes = (first / relative).read_bytes()
    monkeypatch.setenv("JHT_HOME", str(second))
    exercise(name, module, second, relative, monkeypatch, 2)
    assert (first / relative).read_bytes() == first_bytes
    assert not original.exists()


def test_empty_mapping_and_empty_value_preserve_explicit_policy(tmp_path, monkeypatch):
    user = tmp_path / "user"
    fake_user(monkeypatch, user)
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "environment"))
    assert jht_home() == tmp_path / "environment"
    assert jht_home({}) == user / ".jht"
    assert jht_home({"JHT_HOME": ""}) == user / ".jht"
    assert jht_home({"JHT_HOME": ""}, empty_is_unset=False) == Path(".")
    assert jht_home({}, fallback="/jht_home", empty_is_unset=False) == Path("/jht_home")


def test_explicit_home_and_absolute_override_do_not_evaluate_fallback(tmp_path, monkeypatch):
    def forbidden(cls):
        raise AssertionError("fallback evaluated despite an explicit destination")
    monkeypatch.setattr(Path, "home", classmethod(forbidden))
    assert jht_home({"JHT_HOME": str(tmp_path)}) == tmp_path
    paths = {"LOGS_DIR": tmp_path / "custom", "DATA": ("LOGS_DIR", "sample.json")}
    assert jht_home({}, paths=paths, key="DATA") == tmp_path / "custom" / "sample.json"


@pytest.mark.parametrize("paths,key,error", [
    ({"A": ("B", "x"), "B": ("A", "y")}, "A", ValueError),
    ({}, "missing", KeyError),
])
def test_missing_or_cyclic_path_spec_is_an_error(paths, key, error):
    with pytest.raises(error):
        jht_home({}, paths=paths, key=key)


def test_context_paths_stay_live_and_real_delivery_cache_writes_back(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "before"))
    module = load(ROOT / ".launcher/sentinel-bridge.py")
    context = module._delivery_context()
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "after"))
    assert context.LOGS_DIR == tmp_path / "after" / "logs"
    part = module._delivery_part("sentinel_delivery")
    state = part._state(context)
    state["synthetic"] = 1
    assert module._delivery_notice_state is state
    assert part._state(module._delivery_context())["synthetic"] == 1
    custom = tmp_path / "custom-parent"
    monkeypatch.setitem(module._PATHS, "LOGS_DIR", custom)
    assert context.DATA_JSONL == custom / "sentinel-data.jsonl"
    module.write_jsonl({"synthetic": True})
    assert json.loads((custom / "sentinel-data.jsonl").read_text()) == {"synthetic": True}
    missing = tmp_path / "missing" / "role-usage.json"
    monkeypatch.setitem(module._PATHS, "ROLE_USAGE_FILE", missing)
    assert context.ROLE_USAGE_FILE == missing
    assert not missing.parent.exists()


def test_module_path_overrides_are_not_shared_between_instances(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "home"))
    first = load(ROOT / "shared/skills/burn_intent.py")
    second = load(ROOT / "shared/skills/burn_intent.py")
    monkeypatch.setitem(first._PATHS, "INTENT_FLAG", tmp_path / "custom")
    assert first._path("INTENT_FLAG") == tmp_path / "custom"
    assert second._path("INTENT_FLAG") == tmp_path / "home" / ".burn-intent.flag"


def test_cooldown_loads_at_first_use_and_follows_the_current_home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "old"))
    module = load(ROOT / ".launcher/sentinel-bridge.py")
    for index in (1, 2):
        home = tmp_path / str(index)
        (home / "logs").mkdir(parents=True)
        expiry = 4000000000 + index
        (home / "logs" / "claude-429-cooldown").write_text(str(expiry))
        monkeypatch.setenv("JHT_HOME", str(home))
        assert module.fetch_claude_api() == "RATE_LIMIT"
        assert module._claude_429_until == expiry
        assert module._claude_429_path == home / "logs" / "claude-429-cooldown"


@pytest.mark.parametrize("writer,relative", [
    (lambda m: m._save_claude_429_cooldown(1234), "claude-429-cooldown"),
    (lambda m: m._save_weekly_reset_cache("synthetic", 1234), "weekly-reset-cache.json"),
    (lambda m: m._remember_codex_reading({"plan_type": "pro", "usage_is_weekly": True}),
     "codex-plan-reading.json"),
])
def test_first_cache_write_creates_logs_at_call_time(writer, relative, tmp_path, monkeypatch):
    home = tmp_path / "new-home"
    monkeypatch.setenv("JHT_HOME", str(home))
    module = load(ROOT / ".launcher/sentinel-bridge.py")
    assert not home.exists()
    writer(module)
    assert (home / "logs" / relative).stat().st_size > 0
