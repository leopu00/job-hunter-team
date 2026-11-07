"""Managed launchers execute a fake Codex and preserve its exact argv contract."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from test_agent_model_override import _bash, _codex_branch, _function

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / ".launcher/spawn-lib.sh"
START = ROOT / ".launcher/start-agent.sh"
FAKE_CODEX = '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
Path(os.environ["ARGV_FILE"]).write_text(json.dumps(args))
required = {"notice.hide_rate_limit_model_nudge=true", "check_for_update_on_startup=false"}
overrides = {args[i + 1] for i, value in enumerate(args[:-1]) if value == "-c"}
if not required <= overrides:
    print("Approaching rate limits: Keep current model")
    raise SystemExit(5)
Path(os.environ["READY_FILE"]).write_text("ready")
'''
FAKE_TMUX = '''import shlex, subprocess, sys
assert sys.argv[1:3] == ["send-keys", "-t"]
raise SystemExit(subprocess.run(shlex.split(sys.argv[-2])).returncode)
'''


@pytest.fixture
def runtime(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, source in (("codex", FAKE_CODEX), ("tmux", FAKE_TMUX)):
        path = bin_dir / name
        path.write_text(f"#!{sys.executable}\n" + source)
        path.chmod(0o755)
    env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
           "JHT_HOME": str(tmp_path / "home"), "ARGV_FILE": str(tmp_path / "argv.json"),
           "READY_FILE": str(tmp_path / "ready"), "JHT_SPAWN_MODEL_OVERRIDE": "fake-model-a"}
    return tmp_path, env


def run(runtime, body):
    _, env = runtime
    return subprocess.run([_bash(), "-c", body], env=env, capture_output=True, text=True, timeout=20)


@pytest.mark.parametrize("entry", ["worker", "doctor", "maintainer"])
def test_all_managed_entries_reach_ready_without_the_model_or_update_dialog(runtime, entry):
    root, _ = runtime
    body = f'set -e\nsource "{LIB}"\n'
    if entry == "worker":
        source = START.read_text()
        body += _function(source, "resolve_codex_model") + "\n"
        body += "ROLE=scorer; role_model=terra; model_override=; effort=high; AUTH_METHOD=subscription; API_KEY=\n"
        body += _codex_branch(source) + '\n"$CLI_BIN" $CLI_ARGS\n'
    else:
        path = ROOT / ".launcher" / ("spawn-doctor.sh" if entry == "doctor" else "spawn-maintainer.sh")
        variable = "DOCTOR_CMD" if entry == "doctor" else "MANT_CMD"
        source = path.read_text()
        match = re.search(rf'^{variable}=.*\n.*tmux send-keys.*$', source, re.MULTILINE)
        assert match, "the real REPL launch block is required"
        body += 'ACTIVE_PROVIDER=codex; SESSION=SYNTHETIC\n' + match.group() + "\n"
    result = run(runtime, body)
    assert result.returncode == 0, result.stderr
    assert (root / "ready").read_text() == "ready" and "Approaching" not in result.stdout
    args = json.loads((root / "argv.json").read_text())
    overrides = [args[index + 1] for index, value in enumerate(args[:-1]) if value == "-c"]
    assert overrides == ["model_reasoning_effort=high", "project_doc_max_bytes=131072",
                         "notice.hide_rate_limit_model_nudge=true", "check_for_update_on_startup=false"]
    model_flag = "--model" if entry == "worker" else "-m"
    assert args[args.index(model_flag) + 1] == ("gpt-5.6-terra" if entry == "worker" else "fake-model-a")
    assert args[0] == "--yolo" and "--search" not in args


def test_the_fake_cli_control_blocks_without_the_policy(runtime):
    root, _ = runtime
    result = run(runtime, "codex --yolo")
    assert result.returncode == 5 and "Keep current model" in result.stdout
    assert not (root / "ready").exists()


def test_policy_failure_is_not_hidden_by_a_successful_repl_command(runtime):
    root, env = runtime
    env["JHT_SPAWN_LIB_DIR"] = str(root / "missing")
    result = run(runtime, f'source "{LIB}"; jht_spawn_repl_cmd codex')
    assert result.returncode != 0 and "codex_launch_policy.py" in result.stderr
    assert not (root / "ready").exists()
