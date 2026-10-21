"""Who each agent is, in the agents' panel list: cli, model and effort.

start-agent.sh writes them as user options on the agent's own tmux session
(@jht-cli, @jht-model, @jht-effort). The agent can rewrite those options, and
tmux prints them as they are, a newline or a tab included. So read_list reads
them in a list-sessions of their own, never in the call that lists the
sessions and their times: here tmux is played by a stand-in that renders the
-F format the way tmux does, raw values and all, and a model written as «x»,
a newline and «FAKE-1\t0\t0» must make up no session and move no time.
"""

from __future__ import annotations

import ast
import importlib.machinery
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "shared" / "skills" / "agent_control.py"


def _load():
    loader = importlib.machinery.SourceFileLoader("agent_control_identity_under_test", str(TOOL))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class FakeTmux:
    """list-sessions -F, rendered as tmux renders it: every #{...} replaced, nothing escaped."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, str]] = {}
        self.calls: list[tuple[str, ...]] = []

    def add(self, name: str, created: int, activity: int, **options: str) -> None:
        values = {"session_name": name, "session_created": str(created), "session_activity": str(activity)}
        values.update({f"@jht-{key}": value for key, value in options.items()})
        self.sessions[name] = values

    def __call__(self, *args: str, timeout: int = 8) -> subprocess.CompletedProcess:
        self.calls.append(args)
        if args[:2] != ("list-sessions", "-F"):
            return subprocess.CompletedProcess(args, 1, "", "unexpected")
        fmt = args[2]
        lines = [re.sub(r"#\{([^}]+)\}", lambda m: values.get(m.group(1), ""), fmt) for values in self.sessions.values()]
        return subprocess.CompletedProcess(args, 0, "".join(line + "\n" for line in lines), "")


@pytest.fixture
def tool(monkeypatch, tmp_path):
    module = _load()
    tmux = FakeTmux()
    monkeypatch.setattr(module, "_tmux", tmux)
    # no agent_state.py here: its states stay unknown, which is not what these tests look at
    monkeypatch.setattr(module, "AGENT_STATE", tmp_path / "missing_agent_state.py")
    module.fake_tmux = tmux
    return module


def _items(tool) -> dict:
    reply = tool.read_list()
    assert reply["ok"] is True, reply
    return {item["name"]: item for item in reply["data"]["items"]}


def test_the_list_says_who_each_agent_is(tool):
    tool.fake_tmux.add("SCOUT-1", 100, 200, cli="codex", model="gpt-5.6-terra", effort="high")
    tool.fake_tmux.add("ASSISTENTE", 110, 210, cli="kimi")
    tool.fake_tmux.add("CAPITANO", 120, 220)
    items = _items(tool)
    assert items["SCOUT-1"]["identity"] == {"cli": "codex", "model": "gpt-5.6-terra", "effort": "high"}
    # kimi gets no model nor effort from the launcher: null, not invented
    assert items["ASSISTENTE"]["identity"] == {"cli": "kimi", "model": None, "effort": None}
    # a session started before the launcher wrote them: no identity («non so»)
    assert items["CAPITANO"]["identity"] is None


def test_a_value_out_of_shape_is_null(tool):
    tool.fake_tmux.add("SCOUT-1", 100, 200, cli="claude", model="opus; rm -rf /", effort="extreme")
    tool.fake_tmux.add("SCOUT-2", 100, 200, cli="gpt", model="x", effort="low")
    tool.fake_tmux.add("SCOUT-3", 100, 200, cli="pi", model="-opus", effort="low")
    items = _items(tool)
    assert items["SCOUT-1"]["identity"] == {"cli": "claude", "model": None, "effort": None}
    assert items["SCOUT-2"]["identity"] is None
    assert items["SCOUT-3"]["identity"] == {"cli": "pi", "model": None, "effort": "low"}


@pytest.mark.parametrize(
    "model",
    [
        "x\nFAKE-1\t0\t0",  # a whole made-up session
        "x\nCAPITANO\tclaude\topus\thigh",  # a made-up identity for another, real, session
        "a\tb",  # one field too many
    ],
)
def test_options_the_agent_rewrites_make_up_no_session_nor_time(tool, model):
    tool.fake_tmux.add("CAPITANO", 1_760_000_000, 1_760_000_100, cli="codex", model="gpt-5.6-sol", effort="high")
    tool.fake_tmux.add("SCOUT-1", 1_760_000_000, 1_760_000_200, cli="claude", model=model, effort="high")
    items = _items(tool)
    # the sessions and their times are the real ones
    assert sorted(items) == ["CAPITANO", "SCOUT-1"]
    assert (items["CAPITANO"]["created"], items["CAPITANO"]["activity"]) == (1_760_000_000, 1_760_000_100)
    assert (items["SCOUT-1"]["created"], items["SCOUT-1"]["activity"]) == (1_760_000_000, 1_760_000_200)
    # the writer's own line is broken, so it has no identity
    assert items["SCOUT-1"]["identity"] is None
    if "CAPITANO" in model:
        # a line made up for a real session makes it come twice: then it has none
        assert items["CAPITANO"]["identity"] is None
    else:
        assert items["CAPITANO"]["identity"] == {"cli": "codex", "model": "gpt-5.6-sol", "effort": "high"}


def test_the_session_list_is_still_the_call_it_was(tool):
    tool.fake_tmux.add("SCOUT-1", 100, 200, cli="codex", model="gpt-5.6-terra", effort="high")
    tool.read_list()
    formats = [call[2] for call in tool.fake_tmux.calls if call[:2] == ("list-sessions", "-F")]
    assert "#{session_name}\t#{session_created}\t#{session_activity}" in formats
    # the options are read apart, and never together with the times
    for fmt in formats:
        assert not ("@jht-" in fmt and "session_created" in fmt), fmt


def test_no_decision_reads_the_identity():
    """Only to be shown: the functions that name it are the read's own, and no other."""
    source = TOOL.read_text(encoding="utf-8")
    tree = ast.parse(source)
    naming = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and re.search(r"identit|@jht-|IDENTITY_", ast.get_source_segment(source, node) or "", re.I)
    }
    assert naming == {"_identity", "_identities", "read_list"}


def test_the_reply_stays_json(tool):
    tool.fake_tmux.add("SCOUT-1", 100, 200, cli="codex", model="gpt-5.6-terra", effort="high")
    json.dumps(tool.read_list())
