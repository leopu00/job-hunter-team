"""install.sh on Linux: the docker group added a moment ago works in the SAME run.

`usermod -aG docker` only takes effect at the next login. Until then every docker command of the installer's process said
«permission denied»: the pull of the test image, the ownership repair in a one-shot container, the compose of the setup
wizard. The first run of a clean server ended with an error and the second one worked. Now the installer runs docker
through `sg docker` (a private `docker` first in PATH), and says so in words when it cannot.

The production functions run in bash with a fake `docker` that refuses without the group, a fake `sg` that gives it,
and a fake `id` that lists the groups of the account in the user database. Nothing is installed.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"

FAKE_DOCKER = """#!/bin/sh
if [ "$FAKE_GROUP" != 1 ] && [ "$FAKE_ALWAYS_OK" != 1 ]; then
  echo "permission denied while trying to connect to the Docker daemon socket" >&2
  exit 1
fi
for a in "$@"; do printf '[%s]' "$a"; done >> "$FAKE_LOG"
printf '\\n' >> "$FAKE_LOG"
exit 0
"""
# sg docker -c "<command>": the command runs with the group
FAKE_SG = """#!/bin/sh
[ "$1" = docker ] && [ "$2" = -c ] || exit 64
FAKE_GROUP=1 exec /bin/sh -c "$3"
"""
FAKE_ID = """#!/bin/sh
if [ "$1" = -nG ]; then echo "$FAKE_GROUPS"; exit 0; fi
exec /usr/bin/id "$@"
"""
FAKE_SUDO = """#!/bin/sh
[ "$1" = docker ] || exit 1
FAKE_GROUP=1 exec "$@"
"""


def run(tmp_path: Path, body: str, *, groups="app docker", sg=True, ok_already=False, sudo=True):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    tools = {"docker": FAKE_DOCKER, "id": FAKE_ID}
    if sg:
        tools["sg"] = FAKE_SG
    if sudo:
        tools["sudo"] = FAKE_SUDO
    for name, text in tools.items():
        path = bin_dir / name
        path.write_text(text, encoding="utf-8")
        path.chmod(0o755)
    log = tmp_path / "docker-argv.txt"
    log.write_text("", encoding="utf-8")
    script = (f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
              "OS=linux\nRUNTIME_CHOICE=\nDOCKER_CLI=docker\nDRY_RUN=0\nUSER=app\n" + body)
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path), "FAKE_LOG": str(log), "FAKE_GROUPS": groups,
           "FAKE_ALWAYS_OK": "1" if ok_already else "0", "TMPDIR": str(tmp_path)}
    done = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30)
    return done, log.read_text(encoding="utf-8")


def test_a_group_added_a_moment_ago_works_in_the_same_run(tmp_path):
    done, argv = run(tmp_path, 'verify_docker_works\ndocker pull "ghcr.io/x/jht:test"\ndocker ps\necho went-on')
    assert done.returncode == 0, done.stdout + done.stderr
    assert "went-on" in done.stdout and "docker group active for this run" in done.stdout
    assert argv.splitlines()[-2:] == ["[pull][ghcr.io/x/jht:test]", "[ps]"]


def test_the_commands_the_installer_runs_after_it_get_the_group_too(tmp_path):
    """The test channel's pull and inspect, the ownership repair's `docker run`, and a child process (the wizard)."""
    body = ('verify_docker_works\n'
            '"${DOCKER_CLI}" pull "img:tag" >/dev/null || echo PULL-FAILED\n'
            'docker run --rm -v "/home/a b/.jht:/jht_home" --entrypoint /bin/sh "img:tag" -c "echo it'"'"'s done" || echo RUN-FAILED\n'
            'bash -c "docker ps -a" || echo CHILD-FAILED')
    done, argv = run(tmp_path, body)
    assert "FAILED" not in done.stdout + done.stderr, done.stdout + done.stderr
    lines = argv.splitlines()
    assert "[pull][img:tag]" in lines
    assert "[run][--rm][-v][/home/a b/.jht:/jht_home][--entrypoint][/bin/sh][img:tag][-c][echo it's done]" in lines, lines
    assert "[ps][-a]" in lines


def test_the_exit_status_of_docker_reaches_the_caller_through_the_group(tmp_path):
    (tmp_path / "bin").mkdir(exist_ok=True)
    done, _ = run(tmp_path, 'verify_docker_works\nFAKE_ALWAYS_OK=1 docker ps >/dev/null; echo "rc=$?"')
    assert "rc=0" in done.stdout
    # a docker that refuses for another reason still refuses
    bad = tmp_path / "bin" / "docker"
    bad.write_text("#!/bin/sh\n[ \"$1\" = info ] && [ \"$FAKE_GROUP\" = 1 ] && exit 0\n[ \"$FAKE_GROUP\" = 1 ] && exit 7\nexit 1\n")
    bad.chmod(0o755)
    again = subprocess.run(["bash", "-c", f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS=linux\nRUNTIME_CHOICE=\nDOCKER_CLI=docker\nUSER=app\n'
                           'verify_docker_works >/dev/null; docker pull x || echo "rc=$?"'],
                           env={"PATH": f"{tmp_path}/bin:/usr/bin:/bin", "HOME": str(tmp_path), "FAKE_GROUPS": "app docker",
                                "TMPDIR": str(tmp_path)}, capture_output=True, text=True, timeout=30)
    assert "rc=7" in again.stdout, again.stdout + again.stderr


def test_a_docker_that_already_answers_is_left_alone(tmp_path):
    done, _ = run(tmp_path, 'before="$PATH"\nverify_docker_works\n[ "$PATH" = "$before" ] && echo PATH-UNCHANGED\n'
                            '[ -z "${DOCKER_SHIM_DIR:-}" ] && echo NO-SHIM', ok_already=True)
    assert "PATH-UNCHANGED" in done.stdout and "NO-SHIM" in done.stdout and "docker daemon reachable" in done.stdout


@pytest.mark.parametrize("case", [
    {"sg": False},                          # no sg on this system
    {"groups": "app adm"},                  # the account is not in the group at all (usermod failed)
])
def test_when_the_group_cannot_be_given_the_installer_stops_and_says_what_to_do(tmp_path, case):
    done, argv = run(tmp_path, "verify_docker_works\necho went-on", **case)
    assert done.returncode != 0 and "went-on" not in done.stdout, done.stdout
    text = done.stdout + done.stderr
    assert "docker_group_not_active" in text and "newgrp docker" in text and "Nothing was installed" in text
    assert "usermod -aG docker" in text
    assert "[pull]" not in argv and "[ps]" not in argv, "no docker command of the installer went through"


def test_a_daemon_that_is_down_is_still_a_daemon_message(tmp_path):
    done, _ = run(tmp_path, "verify_docker_works", groups="app adm", sudo=False)
    assert done.returncode != 0 and "docker_group_not_active" not in done.stdout + done.stderr
    assert "The Docker daemon is not responding" in done.stdout + done.stderr


def test_the_shim_is_private_and_goes_away_with_the_installer(tmp_path):
    done, _ = run(tmp_path, 'verify_docker_works\necho "SHIM=$DOCKER_SHIM_DIR"')
    shim = [line for line in done.stdout.splitlines() if line.startswith("SHIM=")][0][5:]
    assert shim and not Path(shim).exists(), "removed when the installer exits"
