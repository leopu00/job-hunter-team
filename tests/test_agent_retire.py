"""`jht-agent-retire`: un worker ritirato di proposito non viene rianimato.

Il watchdog rianima un worker che il roster dà ancora `active` appena la sua
sessione sparisce. Fermare la sessione prima di dichiararlo tolto (o senza
dichiararlo) lo riporta in vita entro un tick: il comando scrive `retired` nel
roster, lo rilegge, e SOLO allora chiude la sessione. Un crash, cioè una
sessione morta senza passare di qui, resta `active` e viene rianimato come
prima.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
ROSTER_PATH = ROOT / "shared" / "skills" / "team_roster.py"
TOOL_PATH = ROOT / "agents" / "_tools" / "jht-agent-retire.py"


def _load_python(name: str, path: Path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


roster = _load_python("retire_roster", ROSTER_PATH)
NOW = datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def world(monkeypatch, tmp_path):
    """JHT_HOME finto, un roster vero e un tmux finto che registra le chiamate."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    tool = _load_python("jht_agent_retire_under_test", TOOL_PATH)
    events: list = []
    alive = {"SCOUT-4"}
    roster_file = roster.roster_path()

    # Il roster del tool è lo stesso modulo caricato qui: stesso file su disco.
    monkeypatch.setattr(tool, "load_roster", lambda: roster)
    monkeypatch.setattr(tool, "session_alive", lambda session: session in alive)

    def fake_tmux(*args):
        events.append(("tmux", *args))
        if args[:1] == ("kill-session",):
            # Al momento della kill il roster deve già dire `retired`.
            events.append(("roster-at-kill", _status("SCOUT-4")))
            alive.discard(args[2].lstrip("="))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(tool, "exact_tmux", fake_tmux)
    roster.record("scout", 4, src="test")
    return tool, events, alive, roster_file


def _status(session: str):
    return roster.load().get("agents", {}).get(session, {}).get("status")


def _run(tool, monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", [str(TOOL_PATH), *argv])
    return tool.main()


def _decide(alive: set):
    """Quale worker rianimerebbe il watchdog adesso (SCOUT-4 era appena attivo)."""
    state = roster.load()
    activity = {"SCOUT-4": NOW - timedelta(minutes=2)}
    entry, reason, _ = roster.decide_respawn(
        state, alive, NOW, activity, in_window=True, halted="")
    return entry, reason


def test_retire_marks_the_roster_before_closing_the_session(world, monkeypatch):
    tool, events, _, _ = world
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 0
    assert ("tmux", "kill-session", "-t", "=SCOUT-4") in events
    assert ("roster-at-kill", "retired") in events
    entry = roster.load()["agents"]["SCOUT-4"]
    assert entry["status"] == "retired"
    assert entry["retire_reason"] == "scale-down"


def test_a_retired_worker_is_not_revived_but_a_crash_is(world, monkeypatch):
    tool, _, alive, _ = world

    # Crash: la sessione sparisce senza passare dal comando → resta `active`.
    crashed_entry, crashed_reason = _decide(set())
    assert crashed_reason == "respawn"
    assert crashed_entry["session"] == "SCOUT-4"

    # Ritiro dichiarato: stessa sessione sparita, stessa attività recente.
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 0
    assert "SCOUT-4" not in alive
    retired_entry, retired_reason = _decide(alive)
    assert retired_entry is None
    assert retired_reason == "no-candidate"


def test_session_stopped_first_is_revived_which_is_why_the_order_matters(world):
    """La procedura sbagliata (kill e basta): il roster dà ancora `active`."""
    _, _, alive, _ = world
    alive.discard("SCOUT-4")
    assert _status("SCOUT-4") == "active"
    entry, reason = _decide(alive)
    assert reason == "respawn" and entry["session"] == "SCOUT-4"


def test_session_is_not_closed_when_the_roster_cannot_be_written(world, monkeypatch):
    tool, events, alive, _ = world
    # `save` fallisce in silenzio (fail-open): `retire` dice True, il file no.
    monkeypatch.setattr(roster, "save", lambda *args, **kwargs: False)
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 1
    assert not [e for e in events if e[:2] == ("tmux", "kill-session")]
    assert "SCOUT-4" in alive
    assert _status("SCOUT-4") == "active"


def test_a_contained_worker_is_refused_and_keeps_its_hold(world, monkeypatch):
    tool, events, alive, _ = world
    evidence = roster.roster_path().parent / "pane.txt"
    evidence.write_text("pane", encoding="utf-8")
    roster.contain("SCOUT-4", "CAPITANO", "unsafe output", str(evidence))
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 1
    assert _status("SCOUT-4") == "contained"
    assert not [e for e in events if e[:2] == ("tmux", "kill-session")]
    assert "SCOUT-4" in alive


def _hold(by):
    evidence = roster.roster_path().parent / "pane.txt"
    evidence.write_text("pane", encoding="utf-8")
    roster.contain("SCOUT-4", by, "reason", str(evidence))


def test_a_hold_set_by_the_user_is_said_so_and_never_offered_for_release(
        world, monkeypatch, capsys):
    tool, events, alive, _ = world
    _hold("user")
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 1
    err = capsys.readouterr().err
    assert "stopped by the user" in err
    assert "neither retired nor released" in err
    assert "--release" not in err and "jht-agent-contain" not in err
    assert _status("SCOUT-4") == "contained"
    assert not [e for e in events if e[:2] == ("tmux", "kill-session")]


@pytest.mark.parametrize("by", ["CAPITANO", "SENTINELLA", "unknown"])
def test_a_safety_hold_sends_to_whoever_set_it_without_inviting_a_release(
        world, monkeypatch, capsys, by):
    tool, events, _, _ = world
    _hold(by)
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 1
    err = capsys.readouterr().err
    assert "ask whoever set the hold" in err
    assert "--release" not in err and "jht-agent-contain" not in err
    assert "stopped by the user" not in err
    assert not [e for e in events if e[:2] == ("tmux", "kill-session")]


def test_the_hold_marker_alone_counts_even_if_the_entry_says_active(world, monkeypatch, capsys):
    tool, _, _, _ = world
    _hold("user")
    state = roster.load()
    state["agents"]["SCOUT-4"]["status"] = "active"
    state["agents"]["SCOUT-4"].pop("contained_by")
    roster.save(state)
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 1
    assert "stopped by the user" in capsys.readouterr().err
    assert _status("SCOUT-4") == "active"


def test_the_reason_is_one_clean_line(world, monkeypatch):
    tool, _, _, _ = world
    dirty = "queue\u202e empty,\n\tscale-down\x00\u200b   now"
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", dirty) == 0
    stored = roster.load()["agents"]["SCOUT-4"]["retire_reason"]
    assert stored == "queue empty, scale-down now"


@pytest.mark.parametrize("reason", ["x" * 201, "\u202e\u200b \n\t", ""])
def test_a_reason_too_long_or_empty_changes_nothing(world, monkeypatch, capsys, reason):
    tool, events, alive, _ = world
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", reason) == 1
    assert "--reason" in capsys.readouterr().err
    assert _status("SCOUT-4") == "active"
    assert events == [] and "SCOUT-4" in alive


def test_a_reason_at_the_limit_is_accepted(world, monkeypatch):
    tool, _, _, _ = world
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "x" * 200) == 0
    assert len(roster.load()["agents"]["SCOUT-4"]["retire_reason"]) == 200


@pytest.mark.parametrize("session", ["CAPITANO", "SENTINELLA", "MENTOR", "ASSISTENTE",
                                     "CRITICO-S1", "SCOUT", "scout; rm -rf", ""])
def test_only_numbered_workers_can_be_retired(world, monkeypatch, session):
    tool, events, _, _ = world
    assert _run(tool, monkeypatch, session, "--reason", "x") == 1
    assert events == []
    assert _status("SCOUT-4") == "active"


def test_a_worker_never_recorded_is_closed_without_inventing_a_roster_entry(world, monkeypatch):
    tool, events, alive, _ = world
    alive.add("SCORER-2")
    assert _run(tool, monkeypatch, "SCORER-2", "--reason", "scale-down") == 0
    assert ("tmux", "kill-session", "-t", "=SCORER-2") in events
    assert "SCORER-2" not in roster.load()["agents"]


def test_an_already_stopped_worker_is_still_declared_retired(world, monkeypatch):
    tool, events, alive, _ = world
    alive.discard("SCOUT-4")
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 0
    assert _status("SCOUT-4") == "retired"
    assert not [e for e in events if e[:2] == ("tmux", "kill-session")]
    entry, _ = _decide(alive)
    assert entry is None


def test_the_retirement_is_journaled(world, monkeypatch, tmp_path):
    tool, _, _, _ = world
    assert _run(tool, monkeypatch, "SCOUT-4", "--reason", "scale-down") == 0
    lines = (tmp_path / "logs" / "agent-retirements.jsonl").read_text().splitlines()
    event = json.loads(lines[-1])
    assert event["event"] == "retired" and event["session"] == "SCOUT-4"
    assert event["declared"] is True and event["closed"] is True


def test_the_tool_is_executable_so_it_lands_on_the_agents_path():
    # Il Dockerfile espone in /usr/local/bin solo i file di _tools con il bit x.
    assert TOOL_PATH.stat().st_mode & 0o111


@pytest.mark.parametrize("locale", ["", ".it", ".es", ".fr", ".de", ".pt", ".hu"])
def test_the_captain_prompt_retires_with_the_command_in_every_language(locale):
    text = (ROOT / "agents" / "capitano" / f"capitano{locale}.md").read_text(encoding="utf-8")
    rule = text[text.index("**C-28"):]
    rule = rule[:rule.index("\n---\n")]
    assert "jht-agent-retire" in rule
    assert "tmux kill-session" in rule
    assert "start-agent.sh" in rule


@pytest.mark.skipif(sys.platform == "win32", reason="il Dockerfile gira su Linux")
@pytest.mark.parametrize("locale", ["", ".it", ".es", ".fr", ".de", ".pt", ".hu"])
def test_the_command_in_the_prompt_resolves_on_path_as_the_image_installs_it(
        tmp_path, monkeypatch, locale):
    """Esegue il vero ciclo del Dockerfile che espone `_tools` in /usr/local/bin e
    cerca sul PATH il nome scritto nella regola C-28, in ogni lingua."""
    import re
    import shutil

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    start = dockerfile.index("for f in /app/agents/_tools/*; do")
    loop = dockerfile[start:dockerfile.index("done", start) + len("done")]
    loop = loop.replace("\\\n", " ").replace("/app/agents/_tools", str(ROOT / "agents" / "_tools"))
    bindir = tmp_path / "usr-local-bin"
    bindir.mkdir()
    loop = loop.replace("/usr/local/bin", str(bindir))
    done = subprocess.run(["bash", "-c", loop], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr

    prompt = (ROOT / "agents" / "capitano" / f"capitano{locale}.md").read_text(encoding="utf-8")
    rule = prompt[prompt.index("**C-28"):]
    rule = rule[:rule.index("\n---\n")]
    written = re.search(r"^(jht-agent-retire)\s", rule, re.MULTILINE)
    assert written, "the rule shows the command in a block"

    path = f"{bindir}:/usr/bin:/bin"
    found = shutil.which(written.group(1), path=path)
    assert found, f"{written.group(1)} does not resolve on PATH"
    monkeypatch.setenv("PATH", path)
    helped = subprocess.run([written.group(1), "--help"], capture_output=True, text=True)
    assert helped.returncode == 0, helped.stderr
    assert "retired" in helped.stdout
    # I tool senza estensione di prima continuano a comparire con il loro nome.
    assert shutil.which("jht-send", path=path)
    assert not (bindir / "jht-agent-retire.py").exists()
