"""SENTINELLA-WORKER (Claude Code idle che legge /usage) solo con l'abbonamento Claude, mai con una chiave API.

JHT-T350, collaudo W1 del 26/11 (F-06, F-07): con `auth_method: api_key` il bridge rilanciava il worker ogni 20 minuti
anche in modalita' senza quota; il controllo d'avvio dichiarava «started» con la finestra di fiducia aperta, che un
Enter chiudeva su «No, exit», e `/usage` finiva digitato in una shell.
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / ".launcher" / "sentinel-bridge.py"
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"

SUBSCRIPTION = {"active_provider": "claude", "providers": {"claude": {"auth_method": "subscription"}}}
API_KEY = {"active_provider": "claude", "providers": {"claude": {"auth_method": "api_key", "api_key": "sk-fake"}}}


def _load_bridge(tmp_path, monkeypatch, config):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    if config is not None:
        (tmp_path / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("sentinel_bridge_t350", BRIDGE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── bridge ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("config,expected", [
    (SUBSCRIPTION, True),
    (API_KEY, False),
    ({"active_provider": "claude", "providers": {"claude": {}}}, False),
    ({"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}}, False),
    (None, False),
])
def test_the_bridge_allows_the_worker_only_on_a_claude_subscription(tmp_path, monkeypatch, config, expected):
    bridge = _load_bridge(tmp_path, monkeypatch, config)
    assert bridge._claude_worker_allowed() is expected


def test_with_an_api_key_the_fetch_never_touches_the_worker_and_stops_a_leftover(tmp_path, monkeypatch):
    bridge = _load_bridge(tmp_path, monkeypatch, API_KEY)
    calls = []
    monkeypatch.setattr(bridge, "_try_claude_tui_parser", lambda: calls.append("tui") or {"usage": 1})
    monkeypatch.setattr(bridge, "fetch_claude_api", lambda: None)

    def fake_run(argv, **_kw):
        calls.append(" ".join(argv))
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(bridge.subprocess, "run", fake_run)
    parsed, reason = bridge._do_fetch("claude")
    assert parsed is None and reason == "claude_tui_fail+claude_api_none"
    assert "tui" not in calls
    assert "tmux kill-session -t =SENTINELLA-WORKER" in calls
    assert not any("start-agent.sh" in c for c in calls)


def test_with_the_subscription_the_fetch_still_reads_the_tui(tmp_path, monkeypatch):
    bridge = _load_bridge(tmp_path, monkeypatch, SUBSCRIPTION)
    monkeypatch.setattr(bridge, "_try_claude_tui_parser", lambda: {"usage": 7})
    assert bridge._do_fetch("claude") == ({"usage": 7}, None)


def test_a_worker_left_as_a_bare_shell_is_killed_for_the_next_tick(tmp_path, monkeypatch, capsys):
    bridge = _load_bridge(tmp_path, monkeypatch, SUBSCRIPTION)
    fake_usage = SimpleNamespace(
        WORKER_BOOT_WAIT_S=0, tmux_has_session=lambda _s: True, query_claude_worker=lambda: "",
        parse_claude_usage=lambda _b: None)
    fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _m: None))
    monkeypatch.setattr(bridge.importlib.util, "spec_from_file_location", lambda *_a: fake_spec)
    monkeypatch.setattr(bridge.importlib.util, "module_from_spec", lambda _s: fake_usage)
    killed = []
    monkeypatch.setattr(bridge, "_kill_worker", lambda: killed.append(True))
    assert bridge._try_claude_tui_parser() is None
    assert killed == [True]


# ── launcher ──────────────────────────────────────────────────────────────

# tmux finto: ogni chiamata in un log; il pane di SENTINELLA-WORKER segue uno script di schermate (una per lettura).
FAKE_TMUX = r'''#!/bin/sh
echo "$*" >> "$T_LOG"
case "$1" in
  has-session) [ -f "$T_DIR/alive" ] && exit 0; exit 1 ;;
  new-session) touch "$T_DIR/alive"; exit 0 ;;
  kill-session) rm -f "$T_DIR/alive"; exit 0 ;;
  display-message)
    [ -f "$T_DIR/alive" ] || exit 1
    n=$(cat "$T_DIR/step" 2>/dev/null || echo 0)
    f="$T_DIR/cmd.$n"; [ -f "$f" ] || f="$T_DIR/cmd.last"
    cat "$f"; exit 0 ;;
  capture-pane)
    n=$(cat "$T_DIR/step" 2>/dev/null || echo 0)
    f="$T_DIR/pane.$n"; [ -f "$f" ] || f="$T_DIR/pane.last"
    cat "$f"; echo $((n + 1)) > "$T_DIR/step"; exit 0 ;;
  send-keys)
    case "$*" in *Enter*) [ -f "$T_DIR/exit_on_enter" ] && echo bash > "$T_DIR/cmd.last" ;; esac
    exit 0 ;;
esac
exit 0
'''

TRUST_DIALOG = (
    "Quick safety check: Is this a project you created or one you trust?\n"
    " ❯ 1. No, exit\n"
    "   2. Yes, I trust this folder\n"
)
READY = "╭──────╮\n│ >    │\n╰──────╯\n  ? for shortcuts\n"


def _launch(tmp_path, config, screens, cmds, timeout_s=6, exit_on_enter=False):
    if sys.platform == "win32":
        pytest.skip("il launcher gira nel container Linux")
    home = tmp_path / "home"
    home.mkdir()
    if config is not None:
        (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    state = tmp_path / "state"
    state.mkdir()
    for i, text in enumerate(screens):
        (state / f"pane.{i}").write_text(text, encoding="utf-8")
    (state / "pane.last").write_text(screens[-1], encoding="utf-8")
    for i, text in enumerate(cmds):
        (state / f"cmd.{i}").write_text(text + "\n", encoding="utf-8")
    (state / "cmd.last").write_text(cmds[-1] + "\n", encoding="utf-8")
    if exit_on_enter:
        (state / "exit_on_enter").write_text("1", encoding="utf-8")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "tmux").write_text(FAKE_TMUX, encoding="utf-8")
    (bindir / "tmux").chmod(0o755)
    log = tmp_path / "tmux.log"
    env = dict(os.environ, PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}", JHT_HOME=str(home),
               T_DIR=str(state), T_LOG=str(log), JHT_WORKER_READY_TIMEOUT_S=str(timeout_s),
               JHT_SPAWN_SRC="t350-test", HOME=str(tmp_path / "userhome"))
    done = subprocess.run(["bash", str(LAUNCHER), "worker"], cwd=ROOT, env=env,
                          capture_output=True, text=True, timeout=90)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls, home


@pytest.mark.parametrize("config", [API_KEY, {"active_provider": "openai", "providers": {}}, None])
def test_the_launcher_refuses_the_worker_without_a_claude_subscription(tmp_path, config, healthy_disk):
    done, calls, _home = _launch(tmp_path, config, [READY], ["claude"])
    assert done.returncode == 1, done.stdout + done.stderr
    assert "is not one" in done.stderr
    assert not any(c.startswith(("new-session", "send-keys")) for c in calls), calls


def test_the_launcher_starts_claude_without_bypass_and_presets_the_trust(tmp_path, healthy_disk):
    done, calls, home = _launch(tmp_path, SUBSCRIPTION, [READY], ["claude"])
    assert done.returncode == 0, done.stdout + done.stderr
    assert "SENTINELLA-WORKER started" in done.stdout
    typed = [c for c in calls if c.startswith("send-keys")]
    assert any(c.endswith(" claude C-m") for c in typed), typed
    assert not any("dangerously-skip-permissions" in c or "IS_SANDBOX" in c for c in typed), typed
    trust = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    assert trust["projects"][str(home)]["hasTrustDialogAccepted"] is True


def test_the_trust_dialog_is_answered_on_yes_never_with_a_blind_enter(tmp_path, healthy_disk):
    done, calls, _home = _launch(tmp_path, SUBSCRIPTION, [TRUST_DIALOG, READY], ["claude"])
    assert done.returncode == 0, done.stdout + done.stderr
    keys = [c.split()[-1] for c in calls if c in (
        "send-keys -t SENTINELLA-WORKER Down", "send-keys -t SENTINELLA-WORKER Up", "send-keys -t SENTINELLA-WORKER Enter")]
    assert keys == ["Down", "Enter"], calls


def test_a_cli_that_exits_on_the_dialog_is_not_declared_started(tmp_path, healthy_disk):
    """Il caso W1: il CLI vive sulla finestra, poi esce e resta bash. Prima: «started» dopo il primo secondo."""
    done, calls, _home = _launch(tmp_path, SUBSCRIPTION, [TRUST_DIALOG], ["claude"], exit_on_enter=True)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "started" not in done.stdout
    assert "REPL did not start" in done.stderr
    assert any(c.startswith("kill-session -t =SENTINELLA-WORKER") for c in calls), calls


def test_a_cli_still_on_a_dialog_at_the_deadline_is_not_declared_started(tmp_path, healthy_disk):
    stuck = "Something new\n ❯ 1. Continue\n   2. Quit\n Bypass Permissions mode\n"
    done, _calls, _home = _launch(tmp_path, SUBSCRIPTION, [stuck], ["claude"], timeout_s=3)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "REPL did not start" in done.stderr
