"""start-agent.sh writes who the agent is on its own tmux session.

The launcher's real code runs here: jht_agent_identity (the values the CLI
really gets, filtered) and the block that writes them as user options of the
session (@jht-cli, @jht-model, @jht-effort). The block runs against a real
tmux on a private server (its own TMUX_TMPDIR and -L name, TMUX unset), never
the one the machine's other sessions live on.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from private_tmux import close_dir, private_dir

ROOT = Path(__file__).resolve().parents[1]
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
SERVER = "jht-identity-test"


def _bash() -> str:
    found = shutil.which("bash")
    assert found, "bash is required for launcher tests"
    return found


def _function(source: str, name: str) -> str:
    match = re.search(rf"^{re.escape(name)}\(\) \{{.*?^\}}", source, re.DOTALL | re.MULTILINE)
    assert match, f"{name} is no longer in start-agent.sh"
    return match.group(0)


def _write_block(source: str) -> str:
    start = source.index("# ── Chi è l'agente, sulla sua sessione")
    end = source.index("\ndone\n", start) + len("\ndone\n")
    return source[start:end]


def _identity(*args: str) -> str:
    source = START_AGENT.read_text(encoding="utf-8")
    quoted = " ".join("'" + a.replace("'", "'\\''") + "'" for a in args)
    done = subprocess.run(
        [_bash(), "-c", f"{_function(source, 'jht_agent_identity')}\njht_agent_identity {quoted}"],
        capture_output=True, text=True, check=False,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        # claude gets the role's alias, or opus when the map leaves it empty
        (("claude", "sonnet", "", "", "high"), "claude|sonnet|high"),
        (("claude", "", "", "", "high"), "claude|opus|high"),
        # codex and pi get the model the launcher resolved for them
        (("codex", "sonnet", "gpt-5.6-terra", "", "high"), "codex|gpt-5.6-terra|high"),
        (("pi", "", "", "gpt-5.6-sol", "medium"), "pi|gpt-5.6-sol|medium"),
        # the mode's low effort is the effort the CLI gets
        (("codex", "", "gpt-5.6-sol", "", "low"), "codex|gpt-5.6-sol|low"),
        # kimi gets no model nor effort (its own default and «thinking»); the local scorer neither
        (("kimi", "", "", "", "high"), "kimi||"),
        (("python3", "", "", "", "high"), "local||"),
        # a value out of shape is not written
        (("codex", "", "-gpt", "", "extreme"), "codex||"),
        (("claude", "opus; rm -rf /", "", "", "high"), "claude||high"),
        (("unknown-cli", "x", "x", "x", "high"), "||"),
    ],
)
def test_the_identity_is_what_the_cli_really_gets(args, expected):
    assert _identity(*args) == expected


@pytest.fixture
def private_tmux(tmp_path):
    real = shutil.which("tmux")
    if real is None:
        pytest.skip("tmux is not installed")
    # short: the socket path must fit in a sun_path
    root = private_dir("identity")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    shim = bin_dir / "tmux"
    shim.write_text(f'#!/bin/sh\nPATH="$ORIGINAL_PATH" exec "{real}" -L {SERVER} "$@"\n')
    shim.chmod(0o755)
    env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}
    env.update(PATH=f"{bin_dir}{os.pathsep}{env['PATH']}", ORIGINAL_PATH=env["PATH"], TMUX_TMPDIR=str(root))
    run = lambda *a: subprocess.run([str(shim), *a], capture_output=True, text=True, env=env, check=False)
    # The server goes on every path: a session that does not start, a red
    # test, a timeout. Not only after a green one.
    try:
        for name in ("SCOUT-1", "SCOUT-12"):
            assert run("new-session", "-d", "-s", name, "sleep 600").returncode == 0
        yield env, run
    finally:
        close_dir(root)


def _spawn_block(env: dict, **values: str) -> subprocess.CompletedProcess:
    source = START_AGENT.read_text(encoding="utf-8")
    script = "\n".join(
        [
            "jht_timeout() { shift; \"$@\"; }",
            _function(source, "jht_agent_identity"),
            *(f"{key}='{value}'" for key, value in values.items()),
            _write_block(source),
            "echo spawn-goes-on",
        ]
    )
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, env={**env, "JHT_SPAWN_TMUX_PROBE_SEC": "5"}, check=False)


def _options(run) -> dict:
    out = run("list-sessions", "-F", "#{session_name}\t#{@jht-cli}\t#{@jht-model}\t#{@jht-effort}").stdout
    return {line.split("\t")[0]: line.split("\t")[1:] for line in out.splitlines()}


def test_the_spawn_writes_the_identity_on_that_session_only(private_tmux):
    env, run = private_tmux
    done = _spawn_block(env, SESSION="SCOUT-1", CLI_BIN="codex", model_override="sonnet", codex_model="gpt-5.6-terra", pi_model="", effort="high")
    assert done.returncode == 0, done.stderr
    assert "spawn-goes-on" in done.stdout
    options = _options(run)
    assert options["SCOUT-1"] == ["codex", "gpt-5.6-terra", "high"]
    # the exact session: not the one whose name only starts the same
    assert options["SCOUT-12"] == ["", "", ""]


def test_a_value_out_of_shape_is_not_written_and_kimi_writes_only_its_cli(private_tmux):
    env, run = private_tmux
    assert _spawn_block(env, SESSION="SCOUT-1", CLI_BIN="codex", model_override="", codex_model="-bad", pi_model="", effort="extreme").returncode == 0
    assert _options(run)["SCOUT-1"] == ["codex", "", ""]
    assert _spawn_block(env, SESSION="SCOUT-12", CLI_BIN="kimi", model_override="", codex_model="", pi_model="", effort="high").returncode == 0
    assert _options(run)["SCOUT-12"] == ["kimi", "", ""]


def test_a_write_that_fails_does_not_stop_the_spawn(private_tmux):
    env, run = private_tmux
    done = _spawn_block(env, SESSION="GONE-1", CLI_BIN="claude", model_override="", codex_model="", pi_model="", effort="high")
    assert done.returncode == 0, done.stderr
    assert "spawn-goes-on" in done.stdout
