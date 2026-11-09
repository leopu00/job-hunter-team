"""A provider with no quota data is a declared mode, not an outage: no [BRIDGE FAILURE], no FATAL cascade, no pause.

Synthetic config, rollouts and transports; nothing here talks to a provider or a tmux server.
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "tests"))
import fake_sentinel_loop  # noqa: E402
import quota_data  # noqa: E402
import sentinel_loop as loop  # noqa: E402

NOW = 1_000_000.0
API_KEY = {"active_provider": "openai", "providers": {"openai": {"auth_method": "api_key"}}}
SUBSCRIPTION = {"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}}


def rollout(sessions, name, lines, age_sec=60):
    import time
    moment = time.gmtime(NOW)
    day = sessions / ("%04d" % moment.tm_year) / ("%02d" % moment.tm_mon) / ("%02d" % moment.tm_mday)
    day.mkdir(parents=True, exist_ok=True)
    path = day / name
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    import os
    os.utime(path, (NOW - age_sec, NOW - age_sec))
    return path


TOKEN_COUNT = {"payload": {"type": "token_count", "info": {"total_token_usage": {"total_tokens": 5}}}}
WITH_LIMITS = {"payload": {"type": "token_count", "rate_limits": {"primary": {"used_percent": 12}}}}


@pytest.fixture(autouse=True)
def no_real_user_notice(monkeypatch):
    """The real notifier runs a tool of the repo: a test never reaches it."""
    sent = []
    monkeypatch.setattr(quota_data, "_notify_user", lambda text, reason: sent.append((text, reason)))
    return sent


@pytest.fixture
def sessions(tmp_path):
    return tmp_path / ".codex" / "sessions"


# --- what counts as «no data exists» -------------------------------------------------------------------------

def test_an_api_key_has_no_windows_whatever_the_provider():
    for provider in ("openai", "claude", "kimi"):
        config = {"providers": {provider: {"auth_method": "api_key"}}}
        assert quota_data.no_quota_reason(provider, config, None, NOW) == "api_key"


def test_codex_pointed_at_another_model_provider_has_no_rate_limits(sessions):
    (sessions.parent).mkdir(parents=True)
    (sessions.parent / "config.toml").write_text('model = "glm-5.3"\nmodel_provider = "zai"\n', encoding="utf-8")
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) == "custom_model_provider"


def test_the_openai_model_provider_alone_is_not_proof(sessions):
    sessions.parent.mkdir(parents=True)
    (sessions.parent / "config.toml").write_text('model_provider = "openai"\n', encoding="utf-8")
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_a_live_rollout_with_token_counts_and_no_limits_is_structural(sessions):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) == "no_rate_limits_in_rollouts"


def test_an_old_or_empty_rollout_dir_may_be_an_outage(sessions):
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT], age_sec=3 * 3600)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None
    rollout(sessions, "rollout-b.jsonl", [{"payload": {"type": "agent_message"}}], age_sec=10)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_one_event_with_a_reading_keeps_a_failed_fetch_an_outage(sessions):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT, WITH_LIMITS, TOKEN_COUNT])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None
    nested = {"payload": {"type": "token_count", "info": {"rate_limits": {"secondary": {"used_percent": 0}}}}}
    rollout(sessions, "rollout-b.jsonl", [nested], age_sec=5)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_missing_null_or_empty_rate_limits_are_no_data(sessions):
    empty = {"payload": {"type": "token_count", "rate_limits": {}}}
    nulls = {"payload": {"type": "token_count", "rate_limits": None}}
    nested = {"payload": {"type": "token_count", "info": {"rate_limits": {}}}}
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT, empty, nulls, nested])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) == "no_rate_limits_in_rollouts"


@pytest.mark.parametrize("shape", [
    {"five_hour": {"pct": 3}},                       # names and fields changed
    {"primary": None, "secondary": {}},              # windows with no reading, but the key is there
    {"limit_id": "codex", "primary": {"pct": 1}},
    [{"window": 300, "used": 4}],                    # not even a dict
])
def test_any_non_empty_rate_limits_shape_keeps_a_failed_fetch_an_outage(sessions, shape):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT, {"payload": {"type": "token_count", "rate_limits": shape}}])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None
    rollout(sessions, "rollout-b.jsonl", [{"payload": {"type": "token_count", "info": {"rate_limits": shape}}}], age_sec=5)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_only_recent_day_folders_are_read(sessions):
    old = sessions / "2020" / "01" / "01"
    old.mkdir(parents=True)
    (old / "rollout-x.jsonl").write_text(json.dumps(TOKEN_COUNT) + "\n", encoding="utf-8")
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_other_providers_with_a_subscription_are_never_called_structural(sessions):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT])
    assert quota_data.no_quota_reason("claude", SUBSCRIPTION, sessions, NOW) is None
    assert quota_data.no_quota_reason("kimi", {}, sessions, NOW) is None


def test_unreadable_evidence_keeps_the_outage_reason():
    api = SimpleNamespace(time=SimpleNamespace(time=lambda: NOW))
    api._read_config_json = lambda: (_ for _ in ()).throw(OSError("unreadable"))
    api._path = lambda name: Path("/nonexistent")
    assert quota_data.classify_failure(api, "openai", "codex_rollout_none") == "codex_rollout_none"


# --- the loop --------------------------------------------------------------------------------------------------

class Wire:
    def __init__(self, config, sessions=None, ok=True):
        self.sent, self.users, self.ok, self.clock = [], [], ok, {"now": NOW}
        self.api = SimpleNamespace(
            time=SimpleNamespace(time=lambda: self.clock["now"]),
            session_exists=lambda s: True,
            jht_tmux_send=lambda session, text: self.sent.append((session, text)) or self.ok,
            CAPITANO_SESSION="CAPITANO", SENTINELLA_SESSION="SENTINELLA", FETCH_FAIL_THRESHOLD=2, ANCHOR_TICK_MIN=5,
            _read_config_json=lambda: config, _path=lambda name: sessions,
        )

    def run(self, reason="codex_rollout_none", within_hours=True):
        return SimpleNamespace(fail_streak=0, capitano_alerted=False, sentinel_alerted=False, state={},
                               within_hours=within_hours, fail_reason=reason, override_min=None, provider="openai")


def test_a_failed_fetch_with_a_live_reading_in_the_rollout_stays_on_todays_failure_path(sessions):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT, WITH_LIMITS])
    wire = Wire(SUBSCRIPTION, sessions)
    run = wire.run()
    run.fail_reason = quota_data.classify_failure(wire.api, "openai", "codex_rollout_none")
    assert run.fail_reason == "codex_rollout_none"
    loop._failure(wire.api, run)
    loop._failure(wire.api, run)
    assert run.fail_streak == 2 and run.capitano_alerted
    assert any("[BRIDGE FAILURE]" in t for _, t in wire.sent)


def test_failure_branch_declares_instead_of_failing(no_real_user_notice):
    wire = Wire(API_KEY)
    run = wire.run()
    users = no_real_user_notice
    run.fail_reason = quota_data.classify_failure(wire.api, "openai", run.fail_reason)
    assert run.fail_reason == "no_quota_data:api_key"
    for _ in range(5):  # the old path would have alerted the Captain at the 2nd tick (threshold 2)
        loop._failure(wire.api, run)
        wire.clock["now"] += 300
    texts = [text for _, text in wire.sent]
    assert not any("BRIDGE FAILURE" in t or "BRIDGE ALERT" in t for t in texts)
    assert [s for s, _ in wire.sent] == ["CAPITANO"]  # declared once, not every tick, and the Sentinella is not woken
    assert "NO-QUOTA MODE" in texts[0] and "NOT an outage" in texts[0]
    assert run.fail_streak == 0 and not run.capitano_alerted
    assert len(users) == 1 and users[0][1] == "api_key"


def test_a_burn_intent_in_force_is_not_touched_by_the_mode():
    wire = Wire(API_KEY)
    run = wire.run()
    run._bi_on = True
    run.fail_reason = quota_data.classify_failure(wire.api, "openai", run.fail_reason)
    loop._failure(wire.api, run)
    assert all("BRIDGE FAILURE" not in t for _, t in wire.sent)
    assert "burn-intent in force is not cancelled" in wire.sent[0][1]


def test_a_failed_notice_is_retried_and_the_state_resets_when_data_returns(monkeypatch):
    wire = Wire(API_KEY, ok=False)
    run = wire.run()
    attempts = []

    def user(text, reason):
        attempts.append(reason)
        if len(attempts) == 1:
            raise RuntimeError("jht-notify-user is unavailable")
    monkeypatch.setattr(quota_data, "_notify_user", user)
    run.fail_reason = "no_quota_data:api_key"
    loop._failure(wire.api, run)
    assert not run.state["no_quota_declared"].get("user") and not run.state["no_quota_declared"].get("captain")
    wire.ok = True
    wire.clock["now"] += 600
    loop._failure(wire.api, run)
    assert run.state["no_quota_declared"]["user"] and run.state["no_quota_declared"]["captain"]
    quota_data.clear(run.state)
    assert "no_quota_declared" not in run.state


def test_a_transient_failure_keeps_the_fallback_path_as_today():
    wire = Wire(SUBSCRIPTION)  # subscription, no rollout evidence: could be an outage
    run = wire.run()
    run.fail_reason = quota_data.classify_failure(wire.api, "openai", "codex_rollout_none")
    assert run.fail_reason == "codex_rollout_none"
    loop._failure(wire.api, run)
    loop._failure(wire.api, run)
    texts = [text for _, text in wire.sent]
    assert any("[BRIDGE FAILURE]" in t for t in texts)  # the Sentinella still gets the cascade for a real outage
    assert any("[BRIDGE ALERT]" in t for t in texts)


def test_real_data_never_reaches_the_failure_path():
    api, run, events = fake_sentinel_loop.context(parsed={"usage": 97, "weekly_usage": 40})
    classified = []
    api.read_config = lambda: (None, "openai")
    api.__dict__.setdefault("_read_config_json", lambda: classified.append(1) or API_KEY)
    loop._before_tick(api, run)
    assert run.parsed == {"usage": 97, "weekly_usage": 40} and run.fail_reason == "fixture" and not classified


def test_before_tick_classifies_a_failed_fetch_for_an_api_key():
    api, run, events = fake_sentinel_loop.context(parsed=None)
    api.read_config = lambda: (None, "openai")
    api._read_config_json = lambda: API_KEY
    api._path = lambda name: None
    api.time.time = lambda: NOW
    loop._before_tick(api, run)
    assert run.fail_reason == "no_quota_data:api_key"


def test_the_declared_ceiling_is_repeated_to_the_captain_and_to_the_person():
    cfg = dict(API_KEY, no_quota_cap={"eur": 10, "tokens_per_hour": 500000})
    assert quota_data._declared_ceiling(cfg) == "10 EUR; 500000 tokens/hour"
    assert quota_data._declared_ceiling(API_KEY) == ""
    assert "declared: 10 EUR; 500000 tokens/hour" in quota_data.captain_text("api_key", "10 EUR; 500000 tokens/hour")
    assert "no ceiling declared" in quota_data.captain_text("api_key")
    assert quota_data._declared_ceiling(dict(API_KEY, no_quota_cap={"eur": True, "tokens_per_hour": -3})) == ""


@pytest.mark.parametrize("lang", ["en", "it", "de", "es", "fr", "hu", "pt"])
def test_the_person_notice_exists_in_every_language(lang, monkeypatch):
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    assert catalog["quota_mode.noquota"].count("%s") == 1 and catalog["quota_mode.no_ceiling"]
    monkeypatch.setenv("JHT_LANG", lang)
    import i18n
    i18n._load.cache_clear() if hasattr(i18n, "_load") else None
    text = quota_data.user_text("10 EUR")
    assert "10 EUR" in text and "quota_mode." not in text


# --- the pi harness: agents that write no Codex rollout ------------------------------------------------------

def pi_session(home, age_sec=60, name="one.jsonl"):
    import os
    folder = home / ".pi" / "agent" / "sessions" / "--jht_home-agents-scout-1--"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(json.dumps({"type": "session", "version": 3, "id": "s1", "cwd": "/jht_home/agents/scout-1"}) + "\n",
                    encoding="utf-8")
    os.utime(path, (NOW - age_sec, NOW - age_sec))
    return path


def test_a_team_on_the_pi_harness_has_no_files_to_read_the_windows_from(tmp_path, sessions):
    pi_session(tmp_path)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW, tmp_path) == "harness_pi"


def test_without_the_home_the_harness_is_not_told(tmp_path, sessions):
    pi_session(tmp_path)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW) is None


def test_a_pi_session_that_went_quiet_may_be_an_outage(tmp_path, sessions):
    pi_session(tmp_path, age_sec=3 * 3600)
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW, tmp_path) is None


def test_no_pi_session_at_all_is_not_the_pi_harness(tmp_path, sessions):
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW, tmp_path) is None


def test_a_codex_rollout_with_limits_alive_beside_pi_keeps_a_failed_fetch_an_outage(tmp_path, sessions):
    pi_session(tmp_path)
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT, WITH_LIMITS])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW, tmp_path) is None


def test_a_codex_rollout_without_limits_beside_pi_keeps_its_own_reason(tmp_path, sessions):
    pi_session(tmp_path)
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT])
    assert quota_data.no_quota_reason("openai", SUBSCRIPTION, sessions, NOW, tmp_path) == "no_rate_limits_in_rollouts"


def test_pi_does_not_make_other_providers_structural(tmp_path, sessions):
    pi_session(tmp_path)
    assert quota_data.no_quota_reason("claude", SUBSCRIPTION, sessions, NOW, tmp_path) is None
    assert quota_data.no_quota_reason("kimi", {}, sessions, NOW, tmp_path) is None


def test_the_failed_fetch_of_a_pi_team_is_declared_not_an_outage(tmp_path, sessions):
    pi_session(tmp_path)
    api = SimpleNamespace(time=SimpleNamespace(time=lambda: NOW))
    api._read_config_json = lambda: SUBSCRIPTION
    api._path = lambda name: sessions if name == "CODEX_SESSIONS_DIR" else tmp_path
    assert quota_data.classify_failure(api, "openai", "codex_rollout_none") == "no_quota_data:harness_pi"


def test_an_api_that_cannot_name_the_home_still_classifies_the_rest(tmp_path, sessions):
    rollout(sessions, "rollout-a.jsonl", [TOKEN_COUNT])
    api = SimpleNamespace(time=SimpleNamespace(time=lambda: NOW))
    api._read_config_json = lambda: SUBSCRIPTION

    def path(name):
        if name == "JHT_HOME":
            raise OSError("no home")
        return sessions

    api._path = path
    assert quota_data.classify_failure(api, "openai", "codex_rollout_none") == "no_quota_data:no_rate_limits_in_rollouts"
