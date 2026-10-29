"""The context of a session is read without leaving a panel open on it.

vega, 29/10: the Dottore's round typed `/status` into the pane of every session and pressed ONE Escape without
looking; a card that stayed open under the composer made every wake-up of the throttle come back rc=3 until the
session was recreated. `session_context.py` reads the context from the logs of the CLI (no key at all) and, for the
one provider whose logs do not say it, opens the panel and closes it UNTIL THE SCREEN SHOWS THE COMPOSER AGAIN.

Run:
    pytest tests/test_session_context.py -v
"""

import json
import os
import stat
import sys
from pathlib import Path

import pytest

SKILLS_DIR = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import session_context  # noqa: E402

FAKE = r'''#!/usr/bin/env python3
import json, os, sys
STATE = os.environ["FAKE_STATE"]
s = json.load(open(STATE))
a = sys.argv[1:]
s["calls"].append(a)
IDLE = "\n".join(["  earlier output", "╭" + "─" * 46 + "╮", "│ ❯  │", "╰" + "─" * 46 + "╯", "  ? for shortcuts"])
if s.get("draft"):
    IDLE = IDLE.replace("│ ❯  │", "│ ❯ something the person was typing │")
PANEL = "\n".join(["  Context Usage", "  claude-opus-4  24.9k/1m tokens (2%)", "", "  Esc to cancel"])
BUSY = "Working… (esc to interrupt)\n"
if a[0] == "capture-pane":
    print({"idle": IDLE, "panel": PANEL, "busy": BUSY}[s["mode"]])
elif a[0] == "send-keys":
    key = a[-1]
    if "-l" in a:
        s["typed"] = key
    elif key == "Enter":
        if s.get("typed") == "/context":
            s["mode"] = s.get("after_enter", "panel")
        s["typed"] = ""
    elif key == "Escape":
        s["escapes"] += 1
        if s["mode"] == "panel" and s["escapes"] >= s["esc_needed"]:
            s["mode"] = "idle"
json.dump(s, open(STATE, "w"))
'''


@pytest.fixture
def pane(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "tmux"
    exe.write_text(FAKE, encoding="utf-8")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    state = tmp_path / "state.json"
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_STATE", str(state))
    monkeypatch.setattr(session_context.time, "sleep", lambda _s: None)
    monkeypatch.setattr(session_context, "pct_from_log", lambda *_a, **_k: None)

    def make(**fields):
        state.write_text(json.dumps({"mode": "idle", "calls": [], "escapes": 0, "esc_needed": 1, **fields}))

    def seen():
        return json.loads(state.read_text())

    def keys():
        return [c[-1] for c in seen()["calls"] if c[0] == "send-keys"]

    return make, seen, keys


def test_a_claude_context_is_read_and_the_panel_is_closed_with_the_screen_checked(pane):
    make, seen, keys = pane
    make()
    out = session_context.read("SCORER-2", "claude")
    assert out["pct"] == 2.0 and out["source"] == "panel" and out["closed"] is True
    assert keys() == ["/context", "Enter", "Escape"] and seen()["mode"] == "idle"


def test_a_panel_that_needs_two_escapes_gets_two_and_one_that_never_closes_is_reported_not_forgotten(pane):
    make, seen, keys = pane
    make(esc_needed=2)
    out = session_context.read("SCORER-2", "claude")
    assert out["closed"] is True and keys().count("Escape") == 2

    make(esc_needed=99)
    out = session_context.read("SCORER-2", "claude")
    assert out["closed"] is False and out["reason"] == "panel_still_open" and out["pct"] == 2.0
    assert keys().count("Escape") == session_context.CLOSE_PRESSES, "never an unlimited number of keys"
    make(esc_needed=99)
    assert session_context.main(["SCORER-2", "--provider", "claude"]) == 4, "the Dottore sees a non-zero exit"


def test_nothing_is_typed_into_a_session_that_is_not_idle_with_an_empty_composer(pane):
    make, seen, keys = pane
    make(draft=True)                      # the person's text is in the composer
    out = session_context.read("SCORER-2", "claude")
    assert out["reason"] == "not_idle" and out["closed"] is True and keys() == []
    make(mode="busy")                     # a turn is running
    assert session_context.read("SCORER-2", "claude")["reason"] == "not_idle" and keys() == []


def test_escape_is_never_pressed_on_a_turn_that_started(pane):
    make, seen, keys = pane
    make(after_enter="busy")              # the command started a turn: Escape would interrupt it
    out = session_context.read("SCORER-2", "claude")
    assert "Escape" not in keys() and out["closed"] is False and out["reason"] == "turn_started"


def test_codex_and_kimi_without_a_log_reading_get_no_key_at_all(pane):
    make, seen, keys = pane
    make()
    for provider in ("codex", "kimi", "openai", ""):
        out = session_context.read("SCORER-2", provider)
        assert out["pct"] is None and out["source"] == "none" and out["closed"] is True
    assert keys() == [], "/status is not typed any more"


def test_the_log_answer_touches_no_pane(pane, monkeypatch):
    make, seen, keys = pane
    make()
    monkeypatch.setattr(session_context, "pct_from_log", lambda *_a, **_k: 41.0)
    out = session_context.read("SCORER-2", "codex")
    assert out == {"session": "scorer-2", "pct": 41.0, "source": "log", "closed": True, "reason": "read"}
    assert seen()["calls"] == []


def test_the_percentage_of_a_codex_session_comes_from_the_window_its_log_writes(tmp_path, monkeypatch):
    import agent_state
    home = tmp_path / "home"
    (home / "agents" / "scorer-2").mkdir(parents=True)
    monkeypatch.setattr(agent_state, "tmux_sessions", lambda: {"scorer-2": 1.0})
    monkeypatch.setattr(agent_state, "derive", lambda *a, **k: {"state": "idle", "context": {"pct": 63.5}})
    monkeypatch.setattr(agent_state, "agent_dir", lambda h, u: home / "agents" / u)
    sys.modules.pop("session_context_real", None)
    import importlib.util
    spec = importlib.util.spec_from_file_location("session_context_real", SKILLS_DIR / "session_context.py")
    real = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(real)
    assert real.pct_from_log("SCORER-2", home) == 63.5
    monkeypatch.setattr(agent_state, "tmux_sessions", lambda: {})
    assert real.pct_from_log("SCORER-2", home) is None


def test_the_skill_of_the_round_calls_the_helper_and_types_no_slash_command_in_any_language():
    for skill in sorted((SKILLS_DIR.parent.parent / "agents" / "_skills" / "session-refresh").glob("SKILL*.md")):
        text = skill.read_text(encoding="utf-8")
        assert "session_context.py" in text, skill.name
        assert 'send-keys -t "$S" "/context"' not in text and 'send-keys -t "$S" "/status"' not in text, skill.name
