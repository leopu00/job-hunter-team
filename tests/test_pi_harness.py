"""The scout can run on the pi harness, behind JHT_AGENT_HARNESS_SCOUT=pi.

pi (`@earendil-works/pi-coding-agent`) is a second harness for the same
provider: `active_provider` still says which account pays, the variable says
which CLI drives the agent. Without the variable nothing changes.

What these tests hold, each on the launcher's real code:
- the variable is per role, only `pi` is known, only the scout may use it;
- only active_provider=openai starts; a Claude subscription is refused,
  because Anthropic bills a subscription used from pi per token;
- the command carries `--tui-mode regular` (pi's default fullscreen mode
  draws on the alternate screen: capture-pane, the watchdogs and the evidence
  capture would see only the visible window), the identity file and the
  skills by explicit path, the model and effort of the scout;
- AGENTS.md must exist: `--append-system-prompt` takes a missing path as text;
- pi's settings are merged, never rewritten;
- the pinned version is enforced;
- Ctrl-S, which only Kimi's CLI wants, never reaches a pi session;
- the meters declare the pi sessions they do not count.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

from test_agent_model_override import _bash, _function


ROOT = Path(__file__).resolve().parents[1]
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
SENDER = ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="the launcher runs in the Linux container"
)


def _clean_env(**extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_AGENT_HARNESS_")}
    env.update(extra)
    return env


def _block(source: str, start: str, end: str, include_end: bool = False) -> str:
    """The launcher's text from the line starting with `start` up to `end`."""
    begin = source.index(start)
    stop = source.index(end, begin)
    if include_end:
        stop = source.index("\n", stop)
    return source[begin:stop]


def _launcher_blocks() -> tuple[str, str]:
    source = START_AGENT.read_text(encoding="utf-8")
    choose = _block(
        source,
        "# ── Harness per ruolo (prototipo pi)",
        "# Override sperimentale e ROLE-SCOPED",
    )
    compose = _block(
        source,
        "# pi: identità e skill passano per percorso.",
        'FULL_CMD="${CLI_ENV_PREFIX}',
        include_end=True,
    )
    return choose, compose


def _workdir(tmp_path: Path, identity: bool = True, skills: bool = True) -> Path:
    agent_dir = tmp_path / "agents" / "scout-1"
    agent_dir.mkdir(parents=True)
    if identity:
        (agent_dir / "AGENTS.md").write_text("# Scout\n", encoding="utf-8")
    if skills:
        (agent_dir / ".agents" / "skills" / "tmux-send").mkdir(parents=True)
    return agent_dir


def _launch(tmp_path: Path, *, role: str = "scout", provider: str = "openai",
            auth: str = "subscription", harness: str | None = "pi",
            agent_dir: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run the launcher's provider-to-command chain and print FULL_CMD."""
    source = START_AGENT.read_text(encoding="utf-8")
    choose, compose = _launcher_blocks()
    agent_dir = agent_dir or _workdir(tmp_path)
    script = "\n".join([
        "set -euo pipefail",
        f'source "{SPAWN_LIB}"',
        _function(source, "get_agent_info"),
        _function(source, "resolve_codex_model"),
        f"ROLE={role}",
        f'IFS="|" read -r session_prefix effort model_override <<< "$(get_agent_info {role})"',
        f"PROVIDER={provider}",
        f"AUTH_METHOD={auth}",
        # What the provider branch left behind: the harness of today.
        'CLI_BIN=codex',
        'CLI_ARGS="--yolo --model gpt-5.6-terra"',
        'CLI_ENV_PREFIX=""',
        choose,
        f"AGENT_DIR='{agent_dir}'",
        compose,
        'printf "%s\\n" "$FULL_CMD"',
    ])
    env = _clean_env(JHT_HOME=str(tmp_path / "home"))
    if harness is not None:
        env[f"JHT_AGENT_HARNESS_{role.upper()}"] = harness
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True,
                          check=False, env=env)


def _argv(full_cmd: str) -> tuple[dict[str, str], list[str]]:
    """Split FULL_CMD as the pane's shell would: env assignments, then argv."""
    words = shlex.split(full_cmd)
    env = {}
    while words and re.match(r"^[A-Z_][A-Z0-9_]*=", words[0]):
        key, value = words.pop(0).split("=", 1)
        env[key] = value
    return env, words


def _after(argv: list[str], flag: str) -> str:
    assert flag in argv, f"{flag} missing from {argv}"
    return argv[argv.index(flag) + 1]


# ── the variable ─────────────────────────────────────────────────────────


def _harness(role: str, value: str | None) -> subprocess.CompletedProcess[str]:
    env = _clean_env()
    if value is not None:
        env[f"JHT_AGENT_HARNESS_{role.upper()}"] = value
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_agent_harness {role}'],
        capture_output=True, text=True, check=False, env=env,
    )


def test_without_the_variable_the_harness_is_today_s() -> None:
    result = _harness("scout", None)
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_the_scout_may_ask_for_pi() -> None:
    result = _harness("scout", "pi")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "pi"


@pytest.mark.parametrize("role", ["analista", "capitano", "scorer", "assistente"])
def test_pi_on_another_role_stops_the_start(role: str) -> None:
    result = _harness(role, "pi")
    assert result.returncode == 2
    assert "only for the scout" in result.stderr


def test_an_unknown_harness_stops_the_start_instead_of_falling_back() -> None:
    result = _harness("scout", "opencode")
    assert result.returncode == 2
    assert "not a known agent harness" in result.stderr


# ── the command ──────────────────────────────────────────────────────────


def test_without_the_variable_the_scout_command_is_untouched(tmp_path: Path) -> None:
    result = _launch(tmp_path, harness=None)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "codex --yolo --model gpt-5.6-terra"


def test_the_pi_command_is_readable_by_tmux_and_carries_the_scout(tmp_path: Path) -> None:
    agent_dir = _workdir(tmp_path)
    result = _launch(tmp_path, agent_dir=agent_dir)
    assert result.returncode == 0, result.stderr
    env, argv = _argv(result.stdout.strip())

    assert argv[0] == "pi"
    # Fullscreen is pi's default: without this the pane is the alternate screen.
    assert _after(argv, "--tui-mode") == "regular"
    # Identity and skills by explicit path, nothing discovered around them.
    assert "-nc" in argv
    assert _after(argv, "--append-system-prompt") == f"{agent_dir}/AGENTS.md"
    assert {"-na", "-ns"} <= set(argv)
    assert _after(argv, "--skill") == f"{agent_dir}/.agents/skills"
    assert _after(argv, "--tools") == "read,bash,edit,write,grep,find,ls"
    assert {"--no-mcp", "-ne"} <= set(argv)
    # The scout's class and effort, as on Codex.
    assert _after(argv, "--provider") == "openai"
    assert _after(argv, "--model") == "gpt-5.6-terra"
    assert _after(argv, "--thinking") == "high"
    assert env == {
        "PI_CODING_AGENT_DIR": str(tmp_path / "home" / ".pi" / "agent"),
        "PI_SKIP_VERSION_CHECK": "1",
        "PI_TELEMETRY": "0",
    }


def test_an_openai_api_key_still_reaches_pi(tmp_path: Path) -> None:
    source = START_AGENT.read_text(encoding="utf-8")
    choose, _compose = _launcher_blocks()
    script = "\n".join([
        f'source "{SPAWN_LIB}"',
        _function(source, "resolve_codex_model"),
        "ROLE=scout PROVIDER=openai AUTH_METHOD=api_key model_override=sonnet",
        "CLI_ENV_PREFIX=\"OPENAI_API_KEY='sk-fixture' \"",
        choose,
        'printf "%s\\n" "$CLI_ENV_PREFIX"',
    ])
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True,
                            check=False, env=_clean_env(JHT_AGENT_HARNESS_SCOUT="pi",
                                                        JHT_HOME=str(tmp_path)))
    assert result.returncode == 0, result.stderr
    assert "OPENAI_API_KEY='sk-fixture'" in result.stdout


@pytest.mark.parametrize("auth", ["subscription", "oauth", ""])
def test_a_claude_subscription_is_refused_not_billed(tmp_path: Path, auth: str) -> None:
    result = _launch(tmp_path, provider="claude", auth=auth)
    assert result.returncode != 0
    assert result.stdout == ""
    assert "Claude subscription" in result.stderr
    assert "per token" in result.stderr


@pytest.mark.parametrize("provider", ["kimi", "moonshot", "anthropic-api", ""])
def test_other_providers_are_refused(tmp_path: Path, provider: str) -> None:
    result = _launch(tmp_path, provider=provider, auth="api_key")
    assert result.returncode != 0
    assert result.stdout == ""
    assert "only active_provider=openai" in result.stderr


def test_a_missing_identity_file_stops_the_start(tmp_path: Path) -> None:
    result = _launch(tmp_path, agent_dir=_workdir(tmp_path, identity=False))
    assert result.returncode != 0
    assert result.stdout == ""
    assert "AGENTS.md" in result.stderr


def test_missing_skills_stop_the_start(tmp_path: Path) -> None:
    result = _launch(tmp_path, agent_dir=_workdir(tmp_path, skills=False))
    assert result.returncode != 0
    assert ".agents/skills" in result.stderr


# ── settings, version, skills ────────────────────────────────────────────


def _settings(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_pi_settings "{path}"'],
        capture_output=True, text=True, check=False, env=_clean_env(),
    )


def test_settings_are_merged_keeping_what_pi_wrote(tmp_path: Path) -> None:
    path = tmp_path / ".pi" / "agent" / "settings.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"deviceId": "fixture-device", "tuiMode": "fullscreen"}),
                    encoding="utf-8")

    result = _settings(path)

    assert result.returncode == 0, result.stderr
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "deviceId": "fixture-device",
        "tuiMode": "regular",
        "defaultProjectTrust": "never",
        "enableInstallTelemetry": False,
    }
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_settings_are_created_when_missing(tmp_path: Path) -> None:
    path = tmp_path / ".pi" / "agent" / "settings.json"
    assert _settings(path).returncode == 0
    assert json.loads(path.read_text(encoding="utf-8"))["tuiMode"] == "regular"


def test_unreadable_settings_stop_the_start_and_stay_as_they_are(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text("{not json", encoding="utf-8")
    result = _settings(path)
    assert result.returncode != 0
    assert "unreadable" in result.stderr
    assert path.read_text(encoding="utf-8") == "{not json"


def _fake_pi(tmp_path: Path, version: str) -> dict[str, str]:
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    fake = bindir / "pi"
    fake.write_text(f"#!/usr/bin/env bash\necho {version}\n", encoding="utf-8")
    fake.chmod(0o755)
    return _clean_env(PATH=f"{bindir}:{os.environ.get('PATH', '')}")


def _version_check(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_pi_version_check'],
        capture_output=True, text=True, check=False, env=env,
    )


def test_the_pinned_pi_starts(tmp_path: Path) -> None:
    pinned = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
        capture_output=True, text=True, check=True,
    ).stdout
    assert re.fullmatch(r"\d+\.\d+\.\d+", pinned)
    assert _version_check(_fake_pi(tmp_path, pinned)).returncode == 0


def test_another_pi_version_is_refused_with_the_install_command(tmp_path: Path) -> None:
    result = _version_check(_fake_pi(tmp_path, "1.2.0"))
    assert result.returncode != 0
    assert "pi 1.2.0 found" in result.stderr
    assert "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@" in result.stderr


def test_pi_gets_only_the_agent_skills_tree(tmp_path: Path) -> None:
    workdir = tmp_path / "scout-1"
    workdir.mkdir()
    (workdir / ".claude" / "skills" / "stale").mkdir(parents=True)
    result = subprocess.run(
        [_bash(), "-c",
         f'source "{SPAWN_LIB}"; jht_spawn_copy_skills scout "{workdir}" test pi'],
        capture_output=True, text=True, check=False,
        env=_clean_env(JHT_APP_ROOT=str(ROOT), JHT_HOME=str(tmp_path / "home"), JHT_LANG="it"),
    )
    assert result.returncode == 0, result.stderr
    assert not (workdir / ".claude" / "skills").exists()
    skill = workdir / ".agents" / "skills" / "tmux-send" / "SKILL.md"
    assert skill.read_text(encoding="utf-8").startswith("---\nname: tmux-send\n")


# ── Ctrl-S only for Kimi's CLI ───────────────────────────────────────────


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(("harness", "ctrl_s"), [("pi", False), ("", True)])
def test_stepcap_sends_ctrl_s_only_to_kimi_s_cli(tmp_path: Path, monkeypatch,
                                                harness: str, ctrl_s: bool) -> None:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_STEPCAP_PASTE_SETTLE", "0")
    wd = _load("stepcap_watchdog_pi_test", ROOT / ".launcher" / "stepcap-watchdog.py")
    calls = []

    def fake_tmux(*args, timeout=20):
        calls.append(args)
        if args[0] == "show-options":
            return harness + "\n"
        return ""

    monkeypatch.setattr(wd, "_tmux", fake_tmux)
    monkeypatch.setattr(wd, "_active_provider", lambda: "kimi")

    assert wd.send_resume("SCOUT-1", "scout-1", "[FROM @SYSTEM TO @SCOUT-1] go on")

    assert ("show-options", "-qv", "-t", "=SCOUT-1", "@jht_harness") in calls
    sent_ctrl_s = any(c[0] == "send-keys" and c[-1] == "C-s" for c in calls)
    assert sent_ctrl_s is ctrl_s


def _tmux_send(tmp_path: Path, harness: str) -> str:
    """Run the real jht-tmux-send against a fake tmux; return the tmux calls."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "tmux-calls.log"
    fake = bindir / "tmux"
    fake.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "$@" >> "{log}"\n'
        f'state="{tmp_path / "submitted"}"\n'
        'case "$1" in\n'
        '  has-session) exit 0 ;;\n'
        f'  show-options) printf "%s\\n" "{harness}"; exit 0 ;;\n'
        '  capture-pane)\n'
        '    if [ -f "$state" ]; then printf "> done\\n> \\n";\n'
        '    else printf "> done\\n> [DA @SISTEMA A @SCOUT-3] [RIPRENDI] Riprendi\\n"; fi\n'
        '    exit 0 ;;\n'
        '  send-keys)\n'
        '    for a in "$@"; do [ "$a" = "Enter" ] && : > "$state"; done\n'
        '    exit 0 ;;\n'
        'esac\n'
        'exit 0\n',
        encoding="utf-8",
    )
    fake.chmod(0o755)
    home = tmp_path / "home"
    home.mkdir()
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "kimi"}),
                                          encoding="utf-8")
    env = _clean_env(PATH=f"{bindir}:{os.environ.get('PATH', '')}", JHT_HOME=str(home))
    result = subprocess.run(
        [str(SENDER), "SCOUT-3", "[DA @SISTEMA A @SCOUT-3] [RIPRENDI] Riprendi"],
        env=env, capture_output=True, text=True, timeout=180,
    )
    assert result.returncode == 0, result.stderr
    return log.read_text(encoding="utf-8")


@pytest.mark.parametrize(("harness", "ctrl_s"), [("pi", False), ("", True)])
def test_tmux_send_sends_ctrl_s_only_to_kimi_s_cli(tmp_path: Path, harness: str,
                                                   ctrl_s: bool) -> None:
    calls = _tmux_send(tmp_path, harness)
    assert "show-options -qv -t =SCOUT-3 @jht_harness" in calls
    sent_ctrl_s = any(line.startswith("send-keys") and line.split()[-1] == "C-s"
                      for line in calls.splitlines())
    assert sent_ctrl_s is ctrl_s


def test_the_launcher_marks_the_pi_session() -> None:
    """The mark both readers above depend on is written where the session is born."""
    source = START_AGENT.read_text(encoding="utf-8")
    born = source.index('tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"')
    mark = source.index('set-option -t "=$SESSION" @jht_harness pi', born)
    typed = source.index('send-keys -t "$SESSION" "$FULL_CMD" C-m', born)
    assert mark < typed


# ── the meters declare what they do not count ────────────────────────────


def _pi_session(home: Path, name: str = "s.jsonl", age: float = 0) -> Path:
    folder = home / ".pi" / "agent" / "sessions" / "--jht_home-agents-scout-1--"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text("{}\n", encoding="utf-8")
    if age:
        old = time.time() - age
        os.utime(path, (old, old))
    return path


def test_the_gap_module_looks_where_the_launcher_puts_pi(tmp_path: Path) -> None:
    gap = _load("uncounted_usage_test", ROOT / "shared" / "skills" / "uncounted_usage.py")
    agent_dir = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_pi_agent_dir'],
        capture_output=True, text=True, check=True, env=_clean_env(JHT_HOME=str(tmp_path)),
    ).stdout.strip()
    assert Path(agent_dir) / "sessions" == tmp_path.joinpath(*gap.PI_SESSIONS)


def test_the_gap_counts_recent_pi_sessions_only(tmp_path: Path) -> None:
    gap = _load("uncounted_usage_test", ROOT / "shared" / "skills" / "uncounted_usage.py")
    assert gap.declared_gap(tmp_path) is None
    _pi_session(tmp_path, "new.jsonl")
    _pi_session(tmp_path, "old.jsonl", age=8 * 3600)
    (tmp_path / ".pi" / "agent" / "sessions" / "notes.txt").write_text("x", encoding="utf-8")

    assert gap.declared_gap(tmp_path) == {"pi_sessions": 2, "note": gap.NOTE}
    assert gap.declared_gap(tmp_path, time.time() - 5 * 3600)["pi_sessions"] == 1


def test_the_usage_bridge_publishes_the_gap(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    bridge = _load("sentinel_bridge_pi_test", ROOT / ".launcher" / "sentinel-bridge.py")

    bridge._write_state_file({}, None, None, 10)
    assert json.loads(bridge.STATE_FILE.read_text(encoding="utf-8"))["uncounted"] is None

    _pi_session(tmp_path)
    bridge._write_state_file({}, None, None, 10)
    published = json.loads(bridge.STATE_FILE.read_text(encoding="utf-8"))["uncounted"]
    assert published["pi_sessions"] == 1


@pytest.mark.skipif(shutil.which("python3") is None, reason="python3 required")
def test_the_token_meter_declares_the_gap(tmp_path: Path) -> None:
    _pi_session(tmp_path)
    state = tmp_path / "logs" / "token-meter-state.json"
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "shared" / "skills" / "token-meter.py")],
        env=_clean_env(JHT_HOME=str(tmp_path)),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        deadline = time.time() + 20
        while time.time() < deadline and not state.exists():
            time.sleep(0.2)
    finally:
        proc.terminate()
        output, _ = proc.communicate(timeout=10)
    assert state.exists(), output
    assert json.loads(state.read_text(encoding="utf-8"))["uncounted"]["pi_sessions"] == 1
    assert "WARN 1 pi sessions are not counted" in output
