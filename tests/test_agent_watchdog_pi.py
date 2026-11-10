"""agent-watchdog.sh with Pi as the harness: its login is Pi's own, and its pane is not a zombie."""
import json

from test_launcher_tmux_targets_anchored import _run, tmux  # noqa: F401  (the fixture)


def test_a_pane_running_pi_is_alive_in_both_names_it_can_have(capable_bash, tmux):
    tmux.add("SCOUT-1", "pi")
    tmux.add("SCOUT-2", "node")
    result = _run(capable_bash, tmux,
                  'is_session_alive SCOUT-1 && echo ONE=alive\nis_session_alive SCOUT-2 && echo TWO=alive')
    assert "ONE=alive" in result.stdout and "TWO=alive" in result.stdout, result.stdout + result.stderr
    assert "ZOMBIE" not in result.stdout


PI_OPENAI = json.dumps({"openai": {"type": "oauth", "access": "synthetic"}})


def _ready(capable_bash, tmux, config, *, files=(), env="", pi_login=PI_OPENAI):
    home = tmux.tmp / "home"
    for name in files:
        (home / name).parent.mkdir(parents=True, exist_ok=True)
        (home / name).write_text(pi_login if name == ".pi/agent/auth.json" else "{}", encoding="utf-8")
    cfg = tmux.tmp / "jht.config.json"
    cfg.write_text(json.dumps(config), encoding="utf-8")
    result = _run(capable_bash, tmux, f"{env}\nCONFIG='{cfg}'\nconfig_ready; echo \"ready=$?\"")
    assert "ready=" in result.stdout, result.stdout + result.stderr
    return result.stdout.split("ready=")[1].strip()[0] == "0"


def test_openai_with_pi_is_ready_on_pis_login_not_on_codexs(capable_bash, tmux):
    for config, env in (({"active_provider": "openai", "harness": "pi"}, ""),
                        ({"active_provider": "openai"}, "export JHT_AGENT_HARNESS_SCOUT=pi")):
        assert _ready(capable_bash, tmux, config, files=[".pi/agent/auth.json"], env=env)


def test_pis_login_does_not_make_a_codex_team_ready_and_codexs_still_does(capable_bash, tmux):
    assert not _ready(capable_bash, tmux, {"active_provider": "openai"}, files=[".pi/agent/auth.json"])
    assert _ready(capable_bash, tmux, {"active_provider": "openai"}, files=[".codex/auth.json"])


def test_pi_without_any_login_is_not_ready(capable_bash, tmux):
    assert not _ready(capable_bash, tmux, {"active_provider": "openai", "harness": "pi"})


def test_a_codex_login_does_not_make_a_pi_team_ready_however_pi_was_chosen(capable_bash, tmux):
    """A team that runs on Pi is not ready on the login of Codex: the config field and the per-role variable alike."""
    assert not _ready(capable_bash, tmux, {"active_provider": "openai", "harness": "pi"}, files=[".codex/auth.json"])
    assert not _ready(capable_bash, tmux, {"active_provider": "openai"}, files=[".codex/auth.json"],
                      env="export JHT_AGENT_HARNESS_SCOUT=pi")
    assert _ready(capable_bash, tmux, {"active_provider": "openai"}, files=[".codex/auth.json"],
                  env="export JHT_AGENT_HARNESS_SCOUT=codex")


def test_a_pi_file_with_only_another_service_does_not_make_the_openai_team_ready(capable_bash, tmux):
    """A Claude subscription used from Pi (billed per token) made the file «there» and the watchdog respawned agents on it."""
    config = {"active_provider": "openai", "harness": "pi"}
    only_anthropic = json.dumps({"anthropic": {"type": "oauth", "access": "synthetic"}})
    assert not _ready(capable_bash, tmux, config, files=[".pi/agent/auth.json"], pi_login=only_anthropic)
    for login in ("{}", "not json", json.dumps({"openai": {}}), json.dumps(["openai"])):
        assert not _ready(capable_bash, tmux, config, files=[".pi/agent/auth.json"], pi_login=login), login
    assert _ready(capable_bash, tmux, config, files=[".pi/agent/auth.json"], pi_login=json.dumps({"anthropic": {"a": 1}, "openai-codex": {"a": 1}}))


def test_the_names_the_watchdog_looks_for_are_the_ones_of_the_shared_list():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    watchdog = (root / ".launcher" / "agent-watchdog.sh").read_text(encoding="utf-8")
    listed = next(line for line in (root / "shared" / "runtime" / "pi-login-keys.list").read_text(encoding="utf-8").splitlines() if line.startswith("openai|"))
    assert tuple(listed.split("|")[1].split(",")) == ("openai-codex", "openai")
    assert "('openai-codex', 'openai')" in watchdog
