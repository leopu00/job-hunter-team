"""`jht team chat` open while the switch of the tools stops the core team and starts it again, on a REAL container engine.

The chat comes back by itself on the same agent once the container runs again (the session of the agent is a stand-in tmux here).

The REPL of the chat runs in the container (`docker exec ... node ... team chat`): the down of the switch stops the container, and
the REPL ends under the person's eyes. This runs the wrapper's own `team)` arm and the library's own tools_switch_auto against a
throwaway container of its own (label jht-probe, removed at the end): a stand-in `node` in it is the REPL (it reads its input),
and a stand-in wrapper does `down`/`up` with `docker stop`/`docker start`.

Opt-in (JHT_TEST_REAL_ENGINE=1, with an engine the user can use and JHT_TEST_REAL_IMAGE, default alpine:3.20, there or pullable):
the gates have no engine to spare, the remote Linux machines do.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
TOOLS = ROOT / "scripts" / "jht-tools.sh"
IMAGE = os.environ.get("JHT_TEST_REAL_IMAGE", "alpine:3.20")

pytestmark = pytest.mark.skipif(os.environ.get("JHT_TEST_REAL_ENGINE") != "1" or not shutil.which("docker"),
                                reason="opt-in: JHT_TEST_REAL_ENGINE=1 and a docker the user can use")

sys.path.insert(0, str(ROOT / "tests"))


def _docker(*args, check=True, timeout=120):
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout, check=check)


def _team_arm() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    start = text.index("\n  team)\n") + 1
    return text[start:text.index("\n    ;;\n", start) + len("\n    ;;\n")]


def _function(name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", WRAPPER.read_text(encoding="utf-8"), re.S | re.M)
    assert match, name
    return match.group(0)


@pytest.fixture()
def container(tmp_path):
    if _docker("image", "inspect", IMAGE, check=False).returncode != 0:
        _docker("pull", IMAGE, timeout=300)
    name = f"jht-probe-{uuid.uuid4().hex[:10]}"
    # the stand-in REPL: `node <entry> team chat assistente` says it is there and reads the person's lines until its input ends
    # and a stand-in tmux: the agent's session is there once the container runs (the container's pid1 starts it in production)
    boot = ("printf '#!/bin/sh\\necho REPL-OPEN\\nwhile read -r line; do echo \"you: $line\"; done\\n' > /usr/local/bin/node; "
            "printf '#!/bin/sh\\nexit 0\\n' > /usr/local/bin/tmux; chmod 755 /usr/local/bin/node /usr/local/bin/tmux; exec sleep 600")
    _docker("run", "-d", "--name", name, "--label", "jht-probe=1", IMAGE, "sh", "-c", boot)
    try:
        yield name
    finally:
        _docker("rm", "-f", "-v", name, check=False)   # with its anonymous volumes


def _running(name: str) -> bool:
    return _docker("inspect", "-f", "{{.State.Running}}", name, check=False).stdout.strip() == "true"


def _chat(tmp_path, name: str):
    from wrapper_texts import say_functions
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    script = ("set -euo pipefail\n" + say_functions("en") + 'info() { printf "%s\\n" "$*" >&2; }\n'
              + "".join(_function(name) for name in ("team_chat_ended_by_switch", "wait_for_tools_switch", "team_chat_agent_back",
                                                      "team_chat_through_switch"))
              + f'RUNTIME_DIR="{runtime}"\nEXEC_FLAGS="-i"\nJHT_HOST_TYPE=linux\nATTESTED_CONTAINER_ID="{name}"\nNODE_ENTRY=/app/cli.js\n'
              'require_compose_file() { :; }\nrequire_docker() { :; }\nensure_up_for_stop() { :; }\n'
              # ensure_up of the wrapper waits for the switch (wait_for_tools_switch), then the container is running
              'ensure_up() { wait_for_tools_switch; until [ "$(docker inspect -f "{{.State.Running}}" "$ATTESTED_CONTAINER_ID")" = true ]; do sleep 1; done; }\n'
              'case "$1" in\n' + _team_arm() + "esac\n")
    chat = subprocess.Popen(["bash", "-c", script, "jht", "team", "chat", "assistente"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 30
    first = chat.stdout.readline()
    assert first.strip() == "REPL-OPEN", first + (chat.stderr.read() if chat.poll() is not None else "")
    assert time.time() < deadline
    chat.stdin.write("hello\n")
    chat.stdin.flush()
    assert chat.stdout.readline().strip() == "you: hello"
    return chat, runtime


def test_a_chat_open_through_the_switch_comes_back_by_itself_on_the_same_agent(tmp_path, container):
    chat, runtime = _chat(tmp_path, container)
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    (home / "profile" / "ready.flag").write_text("2026-11-15T21:10:19Z\n", encoding="utf-8")
    (runtime / "runtime-tier").write_text("core\n", encoding="utf-8")
    wrapper = tmp_path / "stand-in-wrapper.sh"
    wrapper.write_text("#!/bin/sh\n"
                       f'case "$1" in down) docker stop -t 1 "{container}" ;; up) sleep 3; docker start "{container}" ;; esac\n'
                       f'echo "$1" >> "{tmp_path}/switch-calls"\n', encoding="utf-8")
    wrapper.chmod(0o755)
    job = ("set -u\n"
           f'RUNTIME_DIR="{runtime}"\nRUNTIME_TIER_FILE="{runtime}/runtime-tier"\nRUNTIME_TIER_INTEGRITY="{runtime}/.runtime-tier-integrity"\n'
           f'WRAPPER_PATH="{wrapper}"\nJHT_HOME_HOST="{home}"\nDEFAULT_RUNTIME_IMAGE="{IMAGE}"\nerr() {{ echo "error: $*" >&2; }}\n'
           f'source "{TOOLS}"\ntools_switch_auto\n')
    started = time.time()
    switch = subprocess.run(["bash", "-c", job], capture_output=True, text=True, timeout=120,
                            env={**os.environ, "JHT_TOOLS_QUIET_MAX": "10"})
    assert switch.returncode == 0, switch.stderr
    try:
        again = chat.stdout.readline()                                      # the REPL of the same agent, open again by itself
        assert again.strip() == "REPL-OPEN", again
        chat.stdin.write("where were we\n")
        chat.stdin.flush()
        assert chat.stdout.readline().strip() == "you: where were we"
        chat.stdin.close()                                                  # the person ends the chat
        rc = chat.wait(timeout=60)
    finally:
        chat.kill()
    said = chat.stderr.read()
    print(f"switch and chat back in {time.time() - started:.1f}s; chat rc={rc}; chat said: {said!r}")
    assert (tmp_path / "switch-calls").read_text(encoding="utf-8").split() == ["down", "up"]
    assert rc == 0, said
    assert said.index("so the chat stops for a moment") < said.index("let's pick up again")
    assert "Open it again" not in said
    assert not (runtime / ".tools-switching").exists() and not (runtime / "runtime-tier").exists()


def test_a_chat_whose_container_someone_else_stops_keeps_its_own_end(tmp_path, container):
    """The other way the REPL ends with the container gone, with no switch running: no line about the tools, the code of docker."""
    chat, _ = _chat(tmp_path, container)
    _docker("stop", "-t", "1", container)
    try:
        rc = chat.wait(timeout=60)
    finally:
        chat.kill()
    said = chat.stderr.read()
    print(f"chat rc={rc}; chat said: {said!r}")
    assert rc != 0 and "Scouts' full tools" not in said
