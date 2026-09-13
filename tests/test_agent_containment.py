"""Containment is a declared lifecycle state, not an inferred missing pane."""
from __future__ import annotations
import re

import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parent.parent
ROSTER_PATH = ROOT / "shared" / "skills" / "team_roster.py"
TOOL_PATH = ROOT / "agents" / "_tools" / "jht-agent-contain"
WATCHDOG_PATH = ROOT / ".launcher" / "agent-watchdog.sh"


def _load_python(name: str, path: Path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


roster = _load_python("containment_roster", ROSTER_PATH)


def _state(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_containment_survives_an_ordinary_spawn_until_explicit_release(tmp_path):
    path = tmp_path / "team-roster.json"
    roster.record("scrittore", 2, src="initial", path=path)
    roster.contain("SCRITTORE-2", "CAPITANO", "unsafe output",
                   "/evidence/pane.txt", path=path)
    marker = roster.containment_marker("SCRITTORE-2", path)
    assert marker.exists()

    # start-agent records every successful spawn. That must not silently
    # revoke a safety decision.
    spawned = roster.record("scrittore", 2, src="manual-spawn", path=path)
    assert spawned["status"] == "contained"
    assert spawned["contained_by"] == "CAPITANO"
    assert spawned["contain_evidence"] == "/evidence/pane.txt"
    assert len(spawned["containment_spawn_attempts"]) == 1
    assert roster.contained_live(path=path, live={"SCRITTORE-2"}) == [spawned]

    # Even a stale concurrent roster write cannot clear the independent hold.
    state = _state(path)
    state["agents"]["SCRITTORE-2"]["status"] = "active"
    path.write_text(json.dumps(state), encoding="utf-8")
    assert roster.is_contained("SCRITTORE-2", path=path)

    released, original_by = roster.release(
        "SCRITTORE-2", "OPERATOR", "incident resolved", path=path)
    assert original_by == "CAPITANO"
    assert released["status"] == "active"
    assert released["released_by"] == "OPERATOR"
    assert released["respawns"] == []
    assert not marker.exists()
    assert [event["action"] for event in released["containment_history"]] == [
        "contained", "released"]


def test_containment_rejects_an_unknown_session_without_inventing_roster_state(tmp_path):
    path = tmp_path / "team-roster.json"
    with pytest.raises(ValueError, match="not in the expected roster"):
        roster.contain("SCRITTORE-9", "CAPITANO", "reason", "/evidence", path=path)
    assert not path.exists()


def test_tool_captures_before_declaring_and_killing(monkeypatch, tmp_path):
    tool = _load_python("jht_agent_contain_success", TOOL_PATH)
    calls = []

    class FakeRoster:
        @staticmethod
        def contain(session, actor, reason, evidence):
            calls.append(("contain", session, evidence))

    evidence = tmp_path / "pane.txt"
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(tool, "load_roster", lambda: FakeRoster)
    monkeypatch.setattr(tool, "session_alive", lambda _session: True)

    def fake_capture(session):
        calls.append(("capture", session))
        evidence.write_text("last pane", encoding="utf-8")
        return evidence

    def fake_tmux(*args):
        calls.append(("tmux", *args))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(tool, "capture", fake_capture)
    monkeypatch.setattr(tool, "exact_tmux", fake_tmux)
    monkeypatch.setattr(tool, "notify", lambda *args: calls.append(("notify", *args)))
    monkeypatch.setattr(tool, "journal", lambda event: calls.append(("journal", event["event"])))
    monkeypatch.setattr(sys, "argv", [str(TOOL_PATH), "SCRITTORE-2",
                                      "--by", "CAPITANO", "--reason", "unsafe output"])

    assert tool.main() == 0
    assert [call[0] for call in calls[:3]] == ["capture", "contain", "tmux"]
    assert calls[2] == ("tmux", "kill-session", "-t", "=SCRITTORE-2")


def test_capture_failure_aborts_before_state_change_or_kill(monkeypatch):
    tool = _load_python("jht_agent_contain_capture_fail", TOOL_PATH)
    calls = []

    class FakeRoster:
        @staticmethod
        def contain(*args):
            calls.append("contain")

    monkeypatch.setattr(tool, "load_roster", lambda: FakeRoster)
    monkeypatch.setattr(tool, "session_alive", lambda _session: True)
    monkeypatch.setattr(tool, "capture", lambda _session: (_ for _ in ()).throw(
        RuntimeError("capture failed")))
    monkeypatch.setattr(tool, "exact_tmux", lambda *args: calls.append(("tmux", args)))
    monkeypatch.setattr(sys, "argv", [str(TOOL_PATH), "SCOUT-1",
                                      "--reason", "incident"])

    assert tool.main() == 1
    assert calls == []


def _watchdog_function(name: str) -> str:
    source = WATCHDOG_PATH.read_text(encoding="utf-8")
    start = source.index(f"{name}() {{")
    end = source.index("\n}\n", start) + 3
    # On Windows the `bash` shim crosses a wsl.exe command-line boundary;
    # backticks inside comments can be expanded by that boundary. Comments
    # are irrelevant to executing the function contract under test.
    return "\n".join(
        line for line in source[start:end].splitlines()
        if not line.lstrip().startswith("#")
    )


def _executable(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\nset -eu\n" + body,
                    encoding="utf-8", newline="\n")
    path.chmod(0o755)
    return path


def _bash_path(path: Path) -> str:
    posix = path.resolve().as_posix()
    if len(posix) >= 3 and posix[1:3] == ":/":
        return f"/mnt/{posix[0].lower()}/{posix[3:]}"
    return posix


def test_watchdog_does_not_respawn_a_contained_core(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    roster_file = logs / "team-roster.json"
    roster_file.write_text(json.dumps({"version": 1, "agents": {
        "MENTOR": {"session": "MENTOR", "role": "mentor", "instance": None,
                   "status": "contained", "contained_by": "CAPITANO"}
    }}), encoding="utf-8")
    node_calls = tmp_path / "node-calls"
    node = _executable(tmp_path / "node", f'echo "$*" >> "{node_calls}"\n')
    script = "\n".join((
        f'JHT_HOME="{_bash_path(tmp_path)}"',
        f'ROSTER_TOOL="{_bash_path(ROSTER_PATH)}"',
        f'NODE_BIN="{_bash_path(node)}"',
        'JHT_BIN="/app/cli/bin/jht.js"',
        f'LOG="{_bash_path(logs / "watchdog.log")}"',
        'INTENTIONAL_RECREATE_SESSION=""',
        "log() { :; }",
        "notify_captain_recovery() { :; }",
        _watchdog_function("agent_is_contained"),
        _watchdog_function("ensure_agent"),
        "is_session_alive() { return 1; }",
        "ensure_agent mentor",
    ))
    script_path = tmp_path / "core-containment-test.sh"
    script_path.write_text(script, encoding="utf-8", newline="\n")
    result = subprocess.run(
        ["bash", _bash_path(script_path)], text=True, capture_output=True,
        env={**os.environ, "JHT_HOME": str(tmp_path), "JHT_NODE_BIN": str(node),
             "JHT_ROSTER_TOOL": str(ROSTER_PATH)},
    )
    assert result.returncode == 0, result.stderr
    assert not node_calls.exists(), "contained core was respawned"


def test_watchdog_recaptures_and_stops_a_contained_session_started_again(tmp_path):
    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / "team-roster.json").write_text(json.dumps({"version": 1, "agents": {
        "SCRITTORE-1": {"session": "SCRITTORE-1", "role": "scrittore", "instance": 1,
                        "status": "contained", "contained_by": "CAPITANO",
                        "contain_evidence": "/old/evidence.txt"}
    }}), encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    tmux_calls = tmp_path / "tmux-calls"
    sender_calls = tmp_path / "sender-calls"
    fake_roster = tmp_path / "fake-roster.py"
    fake_roster.write_text(
        "import sys\n"
        "if sys.argv[1:] == ['contained-live', '--tsv']:\n"
        "    print('SCRITTORE-1\\tCAPITANO\\t/old/evidence.txt')\n",
        encoding="utf-8", newline="\n",
    )
    script = "\n".join((
        f'JHT_HOME="{_bash_path(tmp_path)}"',
        f'ROSTER_TOOL="{_bash_path(fake_roster)}"',
        'TMUX_SENDER="fake_sender"',
        f'LOG="{_bash_path(logs / "watchdog.log")}"',
        "\n".join((
            "tmux() {",
            f'  echo "$*" >> "{_bash_path(tmux_calls)}"',
            '  case "$1" in',
            '    list-sessions) echo SCRITTORE-1 ;;',
            # Il doppio imita la RISOLUZIONE DEI TARGET, non solo i sottocomandi:
            # prima rispondeva a capture-pane qualunque fosse il target, cioe' era
            # piu' permissivo del tmux reale — ed e' il motivo per cui il bug del
            # prefisso `=` e' sopravvissuto a questo test ed e' finito in produzione.
            '''    list-panes) case "$3" in "=SCRITTORE-1"|SCRITTORE-1) echo "%7" ;; *) return 1 ;; esac ;;''',
            '''    capture-pane) case "$3" in %[0-9]*) echo "preserved pane before enforcement" ;; *) return 1 ;; esac ;;''',
            '    kill-session) return 0 ;;',
            '  esac',
            "}",
        )),
        f'fake_sender() {{ echo "$*" >> "{_bash_path(sender_calls)}"; }}',
        _watchdog_function("log"),
        _watchdog_function("capture_for_containment"),
        _watchdog_function("maybe_enforce_containments"),
        "maybe_enforce_containments",
    ))
    script_path = tmp_path / "reenforce-containment-test.sh"
    script_path.write_text(script, encoding="utf-8", newline="\n")
    result = subprocess.run(
        ["bash", _bash_path(script_path)], text=True, capture_output=True,
        env={**os.environ, "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
             "JHT_HOME": str(tmp_path), "JHT_ROSTER_TOOL": str(ROSTER_PATH),
             "JHT_TMUX_SENDER": "fake_sender"},
    )
    assert result.returncode == 0, result.stderr
    assert tmux_calls.exists(), f"stdout={result.stdout!r} stderr={result.stderr!r}"
    assert "kill-session -t =SCRITTORE-1" in tmux_calls.read_text(encoding="utf-8")
    evidence = list((logs / "containment").glob("*-SCRITTORE-1-reenforced.txt"))
    assert len(evidence) == 1
    assert "preserved pane" in evidence[0].read_text(encoding="utf-8")
    notice = sender_calls.read_text(encoding="utf-8")
    assert "CAPITANO [CONTAINMENT] SCRITTORE-1 was started despite" in notice


# ── Il target di capture-pane ────────────────────────────────────────────────
# Origine: trovato in produzione il 2026-09-04. `capture_for_containment` usava
# `tmux capture-pane -t "=$session"`, ma `=` e' un prefisso valido solo per i
# target SESSIONE/FINESTRA: su un target PANE tmux esce con "can't find pane".
# Con lo stderr scartato, il chiamante leggeva solo "cattura fallita" e per
# contratto NON uccideva la sessione — quindi il ri-contenimento non e' mai
# avvenuto. Evidenza: 24.340 righe "capture failed — NOT killing" nel log del
# watchdog e una sessione viva per 15 giorni contro un keep-down esplicito.

def test_capture_pane_is_never_targeted_with_the_session_prefix():
    """`=` su un target pane fa fallire capture-pane a ogni invocazione."""
    src = WATCHDOG_PATH.read_text(encoding="utf-8")
    offenders = [
        line.strip()
        for line in src.splitlines()
        if "capture-pane" in line
        and not line.strip().startswith("#")
        and re.search(r'-t\s+"=', line)
    ]
    assert not offenders, offenders


def test_the_containment_capture_resolves_an_exact_pane_id():
    """L'esattezza non va persa tornando al nome nudo: si risolve il pane_id
    con list-panes (target sessione, dove `=` e' valido) e si cattura quello,
    che e' univoco su tutto il server tmux."""
    src = WATCHDOG_PATH.read_text(encoding="utf-8")
    body = src[src.index("capture_for_containment()") :]
    body = body[: body.index("\n}\n") + 3]
    assert "list-panes -t \"=$session\"" in body, body
    assert "#{pane_id}" in body, body
    assert 'capture-pane -t "$pane_id"' in body, body
    # e una cattura vuota non deve passare per evidenza
    assert '[ ! -s "$evidence" ]' in body, body
