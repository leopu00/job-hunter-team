"""The bash wrapper on a profile where nothing has been started yet: it answers, it names what to do, it changes nothing.

T319 class: a state the code reads only exists after a first pass, and the machine the code was tried on already had it.
Here the home is empty, the runtime folder is trusted but no container, no volume and no helper has ever been made, and
the container engine is a fake that answers "nothing there" to everything and records every call.

  - every command that only reads or reports ends with a message that says what to do (`jht up`, `jht upgrade`),
    never with a shell error (unbound variable, command not found, a raw "No such file");
  - not one of them starts, stops, removes or creates anything in the engine;
  - a runtime folder whose integrity manifest is GONE (a half install) is untrusted like a tampered one: the wrapper
    stops before it asks the engine anything (the tamper cases are in test_host_env_security.py; the deleted one was not).

Made-up homes and a fake engine only.

Run:
    pytest tests/test_pristine_profile_wrapper.py -v
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_host_env_security import WRAPPER, wrapper_runtime_env, write_trusted_runtime  # noqa: E402

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the bash wrapper and its POSIX folders; the PowerShell wrapper has its own tests")

MUTATING = {"restart", "stop", "down", "rm", "up", "kill", "create", "run", "pull", "start", "recreate", "build", "exec"}
SHELL_ERRORS = ("unbound variable", "command not found", "syntax error", "No such file or directory", "bad substitution")

# (the command, the exit codes that are an answer). 1 is "there is nothing to read yet", said in words; 0 is the read-only answer
# "not installed yet" of the commands the app reads.
PRISTINE_COMMANDS = [
    (["help"], {0}),
    (["version"], {0}),
    (["status"], {0, 1}),
    (["logs"], {1}),
    (["restart"], {1}),
    (["recreate"], {1}),
    (["down"], {0}),
    (["providers", "plan"], {1}),
    (["integration", "list"], {0}),
    (["screen", "status"], {0}),   # the live screen: «not installed yet», in the words of the integrations
    (["tools", "status"], {1}),
    (["uninstall"], {2}),          # asks for --confirm and says so; removes nothing
]


def pristine(tmp_path):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    runtime = tmp_path / "protected" / "host-runtime"
    write_trusted_runtime(runtime)
    runtime = runtime.resolve()
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    log = tmp_path / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$JHT_TEST_DOCKER_LOG"\nexit 0\n', encoding="utf-8")
    docker.chmod(0o755)
    return home, runtime, fake_bin, log


def run_wrapper(tmp_path, *args):
    home, runtime, fake_bin, log = pristine(tmp_path)
    done = subprocess.run(["bash", str(WRAPPER), *args], env=wrapper_runtime_env(home, runtime, fake_bin, log),
                          capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls, runtime


@pytest.mark.parametrize(("command", "answers"), PRISTINE_COMMANDS, ids=[" ".join(c) for c, _ in PRISTINE_COMMANDS])
def test_a_command_on_a_pristine_profile_answers_in_words_and_changes_nothing(tmp_path, command, answers):
    done, calls, _ = run_wrapper(tmp_path, *command)
    text = done.stdout + done.stderr
    assert done.returncode in answers, (done.returncode, text[-400:])
    assert not [line for line in text.splitlines() if any(error in line for error in SHELL_ERRORS)], text[-600:]
    changed = [call for call in calls if MUTATING & set(call.split())]
    assert changed == [], changed
    if done.returncode != 0:
        assert text.strip(), "an error with no words"


@pytest.mark.parametrize("command", [["logs"], ["restart"], ["recreate"]])
def test_a_command_that_needs_the_container_says_which_command_starts_it_or_that_it_is_not_there(tmp_path, command):
    done, _, _ = run_wrapper(tmp_path, *command)
    text = (done.stdout + done.stderr).lower()
    assert done.returncode == 1 and ("non attestabile" in text or "non attivo" in text or "jht up" in text), text


@pytest.mark.parametrize("command", [["status"], ["providers", "plan"]])
def test_the_status_and_the_plan_of_a_team_never_started_say_the_container_is_not_active(tmp_path, command):
    done, _, _ = run_wrapper(tmp_path, *command)
    assert "non attivo" in (done.stdout + done.stderr), done.stdout + done.stderr


@pytest.mark.parametrize(("command", "code"), [(["integration", "list"], 0), (["screen", "status"], 0), (["tools", "status"], 1)])
def test_the_helpers_not_installed_yet_are_named_with_the_command_that_installs_them(tmp_path, command, code):
    done, calls, _ = run_wrapper(tmp_path, *command)
    text = done.stdout + done.stderr
    assert done.returncode == code and "jht upgrade" in text and "non ancora installato" in text, text
    assert calls == [], "the helper is looked for before the engine is asked anything"


def test_a_runtime_folder_without_its_integrity_manifest_is_untrusted_and_stops_before_the_engine(tmp_path):
    home, runtime, fake_bin, log = pristine(tmp_path)
    (runtime / ".runtime-integrity").unlink()
    done = subprocess.run(["bash", str(WRAPPER), "up"], env=wrapper_runtime_env(home, runtime, fake_bin, log),
                          capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL)
    assert done.returncode != 0
    assert not log.exists(), log.read_text(encoding="utf-8") if log.exists() else ""
    assert (done.stdout + done.stderr).strip()


def test_screen_without_a_known_word_says_its_usage_and_asks_the_engine_nothing(tmp_path):
    done, calls, _ = run_wrapper(tmp_path, "screen", "toggle")
    assert done.returncode == 2 and "jht screen on | off | status" in done.stderr, done.stderr
    assert calls == []


def test_screen_help_is_the_fixed_text_and_starts_nothing(tmp_path):
    done, calls, _ = run_wrapper(tmp_path, "screen", "--help")
    assert done.returncode == 0 and "jht screen" in done.stdout and "sola visione" in done.stdout, done.stdout
    assert calls == []
