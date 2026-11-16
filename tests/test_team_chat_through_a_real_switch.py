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


# the stand-in REPL: `node <entry> team chat assistente` says it is there and reads the person's lines until its input ends,
# and a stand-in tmux: the agent's session is there once the container runs (the container's pid1 starts it in production)
BOOT = ("printf '#!/bin/sh\\necho REPL-OPEN\\nwhile read -r line; do echo \"you: $line\"; done\\n' > /usr/local/bin/node; "
        "printf '#!/bin/sh\\nexit 0\\n' > /usr/local/bin/tmux; chmod 755 /usr/local/bin/node /usr/local/bin/tmux; exec sleep 600")


def _run_container(name: str):
    _docker("run", "-d", "--name", name, "--label", "jht-probe=1", IMAGE, "sh", "-c", BOOT)


@pytest.fixture()
def container(tmp_path):
    if _docker("image", "inspect", IMAGE, check=False).returncode != 0:
        _docker("pull", IMAGE, timeout=300)
    name = f"jht-probe-{uuid.uuid4().hex[:10]}"
    _run_container(name)
    try:
        yield name
    finally:
        _docker("rm", "-f", "-v", name, check=False)   # with its anonymous volumes


def _running(name: str) -> bool:
    return _docker("inspect", "-f", "{{.State.Running}}", name, check=False).stdout.strip() == "true"


def _chat(tmp_path, name: str):
    """`jht team chat assistente` through the wrapper's own team arm, from a file (the wrapper starts itself again after a switch).
    As the real wrapper does, it believes only the container it found when it started: a container made again by the switch is
    not ours to a wrapper that started before it (giro Linux: «cannot be confirmed as ours; automatic start refused»)."""
    from wrapper_texts import say_functions
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    wrapper = tmp_path / "chat-wrapper.sh"
    wrapper.write_text(
        "set -euo pipefail\n" + say_functions("en") + 'info() { printf "%s\\n" "$*" >&2; }\n'
        + "".join(_function(fn) for fn in ("team_chat_ended_by_switch", "wait_for_tools_switch", "team_chat_agent_back",
                                            "team_chat_through_switch", "team_chat_resume"))
        + f'RUNTIME_DIR="{runtime}"\nEXEC_FLAGS="-i"\nJHT_HOST_TYPE=linux\nNODE_ENTRY=/app/cli.js\nWRAPPER_PATH="{wrapper}"\n'
        + f'NAME="{name}"\nSTART_ID="$(docker inspect -f "{{{{.Id}}}}" "$NAME" 2>/dev/null || true)"\n'
        'container_up() {\n  local id\n  id="$(docker inspect -f "{{if .State.Running}}{{.Id}}{{end}}" "$NAME" 2>/dev/null || true)"\n'
        '  [ -n "$id" ] && [ "$id" = "$START_ID" ] || return 1\n  ATTESTED_CONTAINER_ID="$NAME"\n}\n'
        'require_compose_file() { :; }\nrequire_docker() { :; }\nensure_up_for_stop() { :; }\n'
        'ensure_up() { wait_for_tools_switch; container_up || { echo "unattestable: automatic start refused" >&2; exit 1; }; }\n'
        'case "$1" in\n' + _team_arm() + "esac\n", encoding="utf-8")
    chat = subprocess.Popen(["bash", str(wrapper), "team", "chat", "assistente"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, "JHT_TOOLS_CHAT_RECONNECT_MAX": "30"})
    first = chat.stdout.readline()
    assert first.strip() == "REPL-OPEN", first + (chat.stderr.read() if chat.poll() is not None else "")
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
    switch_wrapper = tmp_path / "stand-in-wrapper.sh"
    # the switch makes the container again, as compose does on the full image: a new container, the same name
    boot = tmp_path / "boot.sh"
    boot.write_text(BOOT, encoding="utf-8")
    run = f'docker run -d --name "{container}" --label jht-probe=1 "{IMAGE}" sh -c "$(cat "{boot}")"'
    switch_wrapper.write_text("#!/bin/sh\n"
                              f'case "$1" in down) docker rm -f -v "{container}" >/dev/null ;; up) sleep 2; {run} >/dev/null ;; esac\n'
                              f'echo "$1" >> "{tmp_path}/switch-calls"\n', encoding="utf-8")
    switch_wrapper.chmod(0o755)
    job = ("set -u\n"
           f'RUNTIME_DIR="{runtime}"\nRUNTIME_TIER_FILE="{runtime}/runtime-tier"\nRUNTIME_TIER_INTEGRITY="{runtime}/.runtime-tier-integrity"\n'
           f'WRAPPER_PATH="{switch_wrapper}"\nJHT_HOME_HOST="{home}"\nDEFAULT_RUNTIME_IMAGE="{IMAGE}"\nerr() {{ echo "error: $*" >&2; }}\n'
           f'source "{TOOLS}"\ntools_switch_auto\n')
    started = time.time()
    switch = subprocess.run(["bash", "-c", job], capture_output=True, text=True, timeout=120,
                            env={**os.environ, "JHT_TOOLS_QUIET_MAX": "10"})
    assert switch.returncode == 0, switch.stderr
    try:
        again = chat.stdout.readline()                                      # the REPL of the same agent, open again by itself
        assert again.strip() == "REPL-OPEN", again + chat.stderr.read()
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
    assert "Open it again" not in said and "refused" not in said
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
