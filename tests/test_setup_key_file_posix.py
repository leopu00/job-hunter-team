"""`jht setup --api-key-file <file on the host>` for glm and kimi on Linux and macOS: the same way as the Windows wrapper.

The setup runs in the container; the wrapper reads the file on the host and sends the key on the standard input of the setup
(`--api-key-stdin`), so the key is in no argument, no environment and no log. The two functions are taken from the wrapper and run with
bash under `set -euo pipefail`, like the wrapper; `docker` is a stand-in on PATH that records what it was given (its arguments, its
environment and its input). The Windows twin is tests/test_setup_key_file_windows.py. Keys are made up, built from parts.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
KEY = "-".join(["synthetic", "glm", "key", "ab" * 8])
BASHES = [b for b in dict.fromkeys(filter(None, [shutil.which("bash"), "/bin/bash"])) if os.path.exists(b)]

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the POSIX wrapper")


def _function(name: str) -> str:
    return re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", WRAPPER, re.S | re.M).group(0)


PRELUDE = """set -euo pipefail
err()  { printf 'error: %s\\n' "$*" >&2; }
warn() { printf 'warn: %s\\n' "$*" >&2; }
info() { printf 'info: %s\\n' "$*" >&2; }
""" + _function("jht_text_en") + _function("jht_text_it") + _function("jht_say") + _function("convert_setup_key_args") + _function("setup_exec_container")

CONVERT = PRELUDE + """
if convert_setup_key_args "$@"; then echo "RC=0"; else echo "RC=1"; fi
echo "KEY=${SETUP_KEY_VALUE}"
echo "ARGS=$(IFS='|'; echo "${SETUP_KEY_ARGS[*]}")"
"""

FAKE_DOCKER = """#!/bin/sh
{ printf 'ARGS='; for a in "$@"; do printf '%s ' "$a"; done; printf '\\n'; env | sed 's/^/ENV:/'; } >> "$FAKE_LOG"
printf 'STDIN=' >> "$FAKE_LOG"; cat >> "$FAKE_LOG" || true
exit "${FAKE_RC:-0}"
"""


@pytest.fixture(params=BASHES, ids=lambda b: b)
def bash(request):
    return request.param


def _run(bash: str, tmp_path: Path, script: str, *args: str, **env: str) -> subprocess.CompletedProcess:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    (tmp_path / "log.txt").touch()
    return subprocess.run([bash, "-c", script, "wrapper", *args], text=True, capture_output=True, timeout=60, cwd=tmp_path,
                          env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_LOG": str(tmp_path / "log.txt"), **env})


def _convert(bash, tmp_path, *args):
    done = _run(bash, tmp_path, CONVERT, *args)
    lines = done.stdout.splitlines()
    field = lambda name: next((line[len(name) + 1:] for line in lines if line.startswith(name + "=")), None)  # noqa: E731
    return field("RC"), field("KEY"), field("ARGS"), done.stderr


def _file(tmp_path: Path, data: bytes, name="key.txt", mode=0o600) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    path.chmod(mode)
    return path


def test_a_file_on_the_host_becomes_the_stdin_flag_and_the_path_leaves_the_arguments(bash, tmp_path):
    path = _file(tmp_path, (KEY + "\n").encode())
    rc, key, args, err = _convert(bash, tmp_path, "setup", "--non-interactive", "--provider", "glm", "--harness", "pi",
                                  "--api-key-file", str(path), "--skip-health")
    assert (rc, key) == ("0", KEY)
    assert args == "setup|--non-interactive|--provider|glm|--harness|pi|--api-key-stdin|--skip-health"
    assert str(path) not in args and KEY not in args + err


def test_the_equals_form_works_too(bash, tmp_path):
    path = _file(tmp_path, KEY.encode())
    rc, key, args, _ = _convert(bash, tmp_path, "setup", "--provider=kimi", f"--api-key-file={path}")
    assert (rc, key, args) == ("0", KEY, "setup|--provider=kimi|--api-key-stdin")


@pytest.mark.parametrize("data", [(KEY + "\r\n").encode(), b"\xef\xbb\xbf" + KEY.encode() + b"\n", ("  " + KEY + "  \n").encode(),
                                  (KEY + "\nsecond line\n").encode()])
def test_a_file_written_by_other_tools_is_read_as_text(bash, tmp_path, data):
    rc, key, _, _ = _convert(bash, tmp_path, "setup", "--api-key-file", str(_file(tmp_path, data)))
    assert (rc, key) == ("0", KEY)


def test_a_path_of_the_container_goes_through_untouched(bash, tmp_path):
    for args in (["--api-key-file", "/jht_user/key.txt"], ["--api-key-file=/jht_home/key.txt"]):
        rc, key, out, _ = _convert(bash, tmp_path, "setup", *args)
        assert (rc, key, out) == ("0", "", "|".join(["setup", *args]))


def test_without_the_flag_nothing_changes(bash, tmp_path):
    rc, key, out, _ = _convert(bash, tmp_path, "setup", "--non-interactive", "--provider", "openai", "--api-key-stdin")
    assert (rc, key, out) == ("0", "", "setup|--non-interactive|--provider|openai|--api-key-stdin")


@pytest.mark.parametrize("what, data, said", [
    ("empty", b"", "empty or too big"),
    ("too big", b"a" * 4097, "empty or too big"),
    ("with a space", ("one two " + KEY).encode(), "one line of 16 to 512"),
    ("too short", b"short", "one line of 16 to 512"),
    ("not ASCII", ("clé-" + KEY).encode(), "one line of 16 to 512"),
    ("too long", b"a" * 513, "one line of 16 to 512"),
])
def test_a_file_that_cannot_hold_a_key_is_refused_without_the_key(bash, tmp_path, what, data, said):
    rc, key, _, err = _convert(bash, tmp_path, "setup", "--api-key-file", str(_file(tmp_path, data)))
    assert rc == "1" and key == "" and said in err, what
    assert "ab" * 8 not in err


def test_a_missing_file_a_folder_and_a_second_source_are_refused(bash, tmp_path):
    assert "cannot be read" in _convert(bash, tmp_path, "setup", "--api-key-file", "nope.txt")[3]
    assert "regular file" in _convert(bash, tmp_path, "setup", "--api-key-file", str(tmp_path))[3]
    path = _file(tmp_path, KEY.encode())
    assert "not both" in _convert(bash, tmp_path, "setup", "--api-key-file", str(path), "--api-key-stdin")[3]
    assert "twice" in _convert(bash, tmp_path, "setup", "--api-key-file", str(path), "--api-key-file", str(path))[3]
    assert "cannot be read" in _convert(bash, tmp_path, "setup", "--api-key-file", "")[3]


def test_a_link_is_refused_even_to_a_good_file(bash, tmp_path):
    target = _file(tmp_path, KEY.encode())
    link = tmp_path / "link.txt"
    link.symlink_to(target)
    assert "not a folder or a link" in _convert(bash, tmp_path, "setup", "--api-key-file", str(link))[3]


def test_a_key_file_others_can_read_is_said_not_refused(bash, tmp_path):
    rc, key, _, err = _convert(bash, tmp_path, "setup", "--api-key-file", str(_file(tmp_path, KEY.encode(), mode=0o644)))
    assert (rc, key) == ("0", KEY) and "can be read by other users" in err
    _, _, _, quiet = _convert(bash, tmp_path, "setup", "--api-key-file", str(_file(tmp_path, KEY.encode(), name="own.txt")))
    assert "other users" not in quiet


def test_the_key_file_sentences_are_said_in_the_language_of_the_person(bash, tmp_path):
    # the same sentences in Italian when the person's language is Italian (jht_say, as every other text of the wrapper)
    env = {**os.environ, "JHT_SAY_LANG": "it"}
    script = PRELUDE + 'convert_setup_key_args "$@" || true\n'
    loose = _file(tmp_path, KEY.encode(), mode=0o644)
    said = subprocess.run([bash, "-c", script, "wrapper", "setup", "--api-key-file", str(loose)], capture_output=True, text=True, env=env, timeout=30)
    assert "lo possono leggere anche altri utenti: chmod 600 sul file." in said.stderr, said.stderr


EXEC = PRELUDE + """
JHT_HOST_TYPE=local; ATTESTED_CONTAINER_ID=jhtid; NODE_ENTRY=/app/cli/bin/jht.js; EXEC_FLAGS="-it"
convert_setup_key_args "$@"
rc=0; setup_exec_container "$@" || rc=$?
echo "RC=$rc"
"""


def test_the_setup_pipes_the_key_to_docker_and_never_puts_it_in_an_argument_or_the_environment(bash, tmp_path):
    path = _file(tmp_path, (KEY + "\n").encode())
    done = _run(bash, tmp_path, EXEC, "setup", "--non-interactive", "--provider", "glm", "--harness", "pi", "--api-key-file", str(path))
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    log = (tmp_path / "log.txt").read_text(encoding="utf-8")
    assert "STDIN=" + KEY in log
    args = next(line for line in log.splitlines() if line.startswith("ARGS="))
    assert args.strip() == "ARGS=exec -i -e JHT_HOST_TYPE=local jhtid node /app/cli/bin/jht.js setup --non-interactive --provider glm --harness pi --api-key-stdin"
    assert KEY not in args and str(path) not in args
    assert KEY not in "".join(line for line in log.splitlines() if line.startswith("ENV:")), "the key is in the environment of docker"
    assert KEY not in done.stdout + done.stderr
    # the person is told the file on the computer can go, once the setup has the key
    assert "you can delete the file on this computer" in done.stderr and str(path) in done.stderr


def test_when_the_setup_fails_the_key_is_gone_and_the_file_is_not_called_deletable(bash, tmp_path):
    path = _file(tmp_path, KEY.encode())
    done = _run(bash, tmp_path, EXEC, "setup", "--api-key-file", str(path), FAKE_RC="3")
    assert "RC=3" in done.stdout and "you can delete" not in done.stderr


def test_without_a_host_file_the_setup_runs_exactly_as_before(bash, tmp_path):
    done = _run(bash, tmp_path, EXEC, "setup", "--non-interactive", "--api-key-file", "/jht_user/key.txt", "--provider", "glm")
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    log = (tmp_path / "log.txt").read_text(encoding="utf-8")
    args = next(line for line in log.splitlines() if line.startswith("ARGS="))
    assert args.strip() == "ARGS=exec -it -e JHT_HOST_TYPE=local jhtid node /app/cli/bin/jht.js setup --non-interactive --api-key-file /jht_user/key.txt --provider glm"
    assert log.splitlines()[-1] == "STDIN="


def test_the_setup_branch_uses_both_functions_before_it_touches_docker():
    branch = re.search(r"^  setup\)\n(.*?)^    ;;\n", WRAPPER, re.S | re.M).group(1)
    assert branch.index("convert_setup_key_args") < branch.index("require_compose_file") < branch.index("setup_exec_container")
    assert "docker exec" not in branch
