"""The context of a session is read without leaving a panel open on it.

A first run, 29/10: the Dottore's round typed `/status` into the pane of every session and pressed ONE Escape without
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
PANEL_DRAFT = "\n".join(["  Context Usage", "  claude-opus-4  24.9k/1m tokens (2%)", "", "╭" + "─" * 46 + "╮",
                         "│ ❯ [DA @SISTEMA A @SCORER-2] [RIPRENDI] wake │", "╰" + "─" * 46 + "╯", "  ? for shortcuts"])
if a[0] == "capture-pane":
    print({"idle": IDLE, "panel": PANEL, "busy": BUSY, "panel_draft": PANEL_DRAFT}[s["mode"]])
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


def test_escape_is_never_pressed_on_a_draft_that_appeared_while_the_panel_was_open(pane):
    make, seen, keys = pane
    make(after_enter="panel_draft")       # the panel is open and somebody's text is in the composer
    out = session_context.read("SCORER-2", "claude")
    assert "Escape" not in keys() and out["closed"] is False and out["reason"] == "draft"


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


# ── the share USED, and the decision to recreate (31/10: three coordinators 8-42% used were recreated) ──────────

def test_a_card_that_says_the_free_share_is_read_as_the_used_one():
    # Codex: «Context window: 80% left (51.7K used / 258K)» is 20% USED, not 80
    assert session_context.used_from_text("  Context window:  80% left (51.7K used / 258K)") == 20.0
    assert session_context.used_from_text("Context window: 14% left") == 86.0
    # Claude's panel already says the used share
    assert session_context.used_from_text("claude-opus-4  24.9k/1m tokens (2%)") == 2.0
    # the used form wins when a screen has both
    assert session_context.used_from_text("24.9k/1m tokens (2%)\n  98% left") == 2.0
    assert session_context.used_from_text("Free space: 758.5k (75.8%)") is None
    assert session_context.used_from_text("nothing about the context") is None


def test_the_panel_of_a_session_with_a_free_share_card_gives_the_used_share(pane, monkeypatch):
    make, seen, keys = pane
    make(mode="idle", after_enter="panel")
    shown = "  Context window:  80% left (51.7K used / 258K)\n  Esc to cancel"
    monkeypatch.setattr(session_context.agent_chat, "capture_pane",
                        lambda _s: shown if seen()["mode"] == "panel" else "╭" + "─" * 46 + "╮\n│ ❯  │\n╰" + "─" * 46 + "╯\n  ? for shortcuts")
    out = session_context.pct_from_panel("SCORER-2", "/context")
    assert out["pct"] == 20.0


def test_a_session_at_twenty_percent_used_is_not_recreated():
    for age in (0.7, 3.0, 11.9):
        verdict = session_context.decide(20.0, age)
        assert verdict == {"action": "skip", "reason": "lowctx", "used_pct": 20.0, "left_pct": 80.0}, age


def test_only_more_than_half_used_asks_for_a_recreation():
    assert session_context.decide(50.0, 3.0)["action"] == "skip"
    assert session_context.decide(50.1, 3.0) == {"action": "refresh", "reason": "context", "used_pct": 50.1, "left_pct": 49.9}
    assert session_context.decide(86.0, 3.0)["reason"] == "context"


def test_a_context_that_was_not_measured_is_a_skip_not_a_recreation_on_age():
    verdict = session_context.decide(None, 5.0)
    assert verdict == {"action": "skip", "reason": "unmeasured", "used_pct": None, "left_pct": None}


def test_the_ttl_overrides_a_low_context_and_an_unmeasured_one():
    assert session_context.decide(4.0, 30.0)["reason"] == "ttl"
    assert session_context.decide(None, 12.0) == {"action": "refresh", "reason": "ttl", "used_pct": None, "left_pct": None}
    assert session_context.decide(4.0, 30.0, ttl_h=48.0)["action"] == "skip"


def test_a_codex_log_at_twenty_percent_of_its_window_is_twenty_used_not_eighty():
    import agent_state
    window, used = 258400, 51680
    lines = [json.dumps({
        "timestamp": "2026-10-31T21:00:00.000Z", "type": "event_msg",
        "payload": {"type": "token_count", "info": {
            "total_token_usage": {"total_tokens": 4 * used},
            "last_token_usage": {"input_tokens": used - 400, "output_tokens": 400, "total_tokens": used},
            "model_context_window": window}},
    })]
    pct = agent_state.parse_codex(lines).context["pct"]
    assert pct == 20.0
    assert session_context.decide(pct, 3.0)["action"] == "skip"


def test_the_command_line_carries_the_decision_and_touches_no_pane_for_a_session_at_twenty(pane, monkeypatch, capsys):
    make, seen, keys = pane
    make()
    monkeypatch.setattr(session_context, "pct_from_log", lambda *_a, **_k: 20.0)
    assert session_context.main(["ASSISTENTE", "--provider", "codex", "--age-h", "3.0"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["pct"] == 20.0
    assert out["decision"] == {"action": "skip", "reason": "lowctx", "used_pct": 20.0, "left_pct": 80.0}
    assert seen()["calls"] == [], "nothing is typed, nothing is killed"
    # without --age-h the answer is what it always was
    assert session_context.main(["ASSISTENTE", "--provider", "codex"]) == 0
    assert "decision" not in json.loads(capsys.readouterr().out)


def test_the_skill_says_the_decision_comes_from_the_script_in_every_language():
    for skill in sorted((SKILLS_DIR.parent.parent / "agents" / "_skills" / "session-refresh").glob("SKILL*.md")):
        text = skill.read_text(encoding="utf-8")
        assert "--age-h" in text and "decision.used_pct" in text and "decision.action" in text, skill.name
        assert "skipped_unmeasured" in text, skill.name
        assert "ctx=unparsed" not in text, skill.name
