"""The remote provisioning of a new VPS, run end to end without a VPS.

What the desktop app does for a new server (desktop/src-tauri/src/onboarding.rs,
prepare_impl, VPS arm) is a fixed sequence of ``ssh`` calls:

  1. REMOTE_INSTALL   - the verified install.sh is piped on stdin and run with
                        ``--pairing-token-env``: Docker, wrapper, compose, host.env
  2. REMOTE_JHT_UP    - ``jht up``
  3. REMOTE_SNAPSHOT  - the state probe that proves the container is running
  4. REMOTE_USE_*     - ``jht providers use <provider>``
  5. REMOTE_UPDATE_*  - ``jht providers update <provider>``

Here the REAL commands are taken from onboarding.rs and executed through a fake
``ssh`` that behaves like OpenSSH under the app's options (BatchMode, strict
host-key checking against a private known_hosts file, exit 255 when it cannot
connect), against a sandbox that stands for the server: the real install.sh
and host-setup.sh, with a fake docker/apt/sudo, and ``file://`` as the download
base. What stays a stand-in: the OpenSSH client and server, the Docker daemon
and everything the container does (``jht`` after the install is a recorder).

The Rust side (pin probe/confirm, the mapping of exit codes to the user's
error codes) is covered by the unit tests in desktop/src-tauri.
"""

import hashlib
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ONBOARDING = ROOT / "desktop" / "src-tauri" / "src" / "onboarding.rs"
RUNTIME_HOST = ROOT / "desktop" / "src-tauri" / "src" / "runtime_host.rs"
INSTALL = ROOT / "scripts" / "install.sh"

TOKEN = "t0k-" + "a1b2c3d4e5f6" * 4  # looks like a pairing token, is not one
SERVER_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIserverkeyserverkeyserverkeyserver00"
OTHER_KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIattackerkeyattackerkeyattackerkey00"

# Tools the installer needs on the server, linked from the real system.
SYSTEM_TOOLS = (
    "awk bash basename cat chmod cp curl cut date dirname env grep head id ln "
    "ls mkdir mktemp mv printf readlink rm sed sh sort tail tee touch tr wc "
    "sha256sum shasum stat find xargs diff cmp tty ps sleep"
).split()

FAKE_SSH = r"""#!/bin/bash
# Stand-in for the OpenSSH client, as the app calls it (ssh_base_args).
# Every refusal is exit 255, like the real client.
log="$FAKE_LOG"
known="" ; strict="" ; batch="" ; global="" ; dest="" ; port=22
while [ $# -gt 0 ]; do
  case "$1" in
    -o) case "$2" in
          BatchMode=yes) batch=1 ;;
          StrictHostKeyChecking=yes) strict=1 ;;
          UserKnownHostsFile=*) known="${2#UserKnownHostsFile=}" ;;
          GlobalKnownHostsFile=/dev/null) global=1 ;;
        esac
        shift 2 ;;
    -i) shift 2 ;;
    -p) port="$2"; shift 2 ;;
    *) dest="$1"; shift; break ;;
  esac
done
cmd="$1"
if [ -z "$batch" ] || [ -z "$strict" ] || [ -z "$known" ] || [ -z "$global" ]; then
  echo "ssh-contract-violation" >> "$log"
  exit 255
fi
if [ "${FAKE_SSH_DOWN:-0}" = 1 ]; then
  echo "ssh: connect: Connection refused" >&2; echo "ssh-down" >> "$log"; exit 255
fi
if [ ! -f "$known" ]; then
  echo "No ED25519 host key is known for ${dest#*@} and you have requested strict checking." >&2
  echo "ssh-refused: no pin" >> "$log"; exit 255
fi
if ! grep -q " ssh-ed25519 ${FAKE_SERVER_KEY}\$" "$known"; then
  echo "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!" >&2
  echo "Host key verification failed." >&2
  echo "ssh-refused: pin changed" >> "$log"; exit 255
fi
printf 'ssh-run: %s\n' "$(printf '%s' "$cmd" | tr '\n' ';' | cut -c1-200)" >> "$log"
cd "$FAKE_REMOTE_HOME" || exit 255
exec env -i HOME="$FAKE_REMOTE_HOME" PATH="$FAKE_REMOTE_PATH" \
  JHT_RAW_BASE="$FAKE_RAW_BASE" FAKE_LOG="$log" FAKE_DOCKER="${FAKE_DOCKER:-up}" \
  FAKE_APT_INSTALLS_DOCKER="${FAKE_APT_INSTALLS_DOCKER:-1}" \
  FAKE_FREE_KB="${FAKE_FREE_KB:-}" TERM=dumb \
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" JHT_ETC_DIR="${JHT_ETC_DIR:-}" FAKE_UID="${FAKE_UID:-}" FAKE_UID_1001="${FAKE_UID_1001:-}" \
  FAKE_PODMAN_VERSION="${FAKE_PODMAN_VERSION:-}" FAKE_COMPOSE_VERSION="${FAKE_COMPOSE_VERSION:-}" \
  FAKE_ROOTLESS="${FAKE_ROOTLESS:-}" FAKE_PODMAN_INFO="${FAKE_PODMAN_INFO:-}" FAKE_LINGER="${FAKE_LINGER:-}" \
  FAKE_STATE="${FAKE_STATE:-}" FAKE_SUDO_PASSWORD="${FAKE_SUDO_PASSWORD:-}" \
  FAKE_APT_INSTALLS_PODMAN="${FAKE_APT_INSTALLS_PODMAN:-}" FAKE_LINGER_STUCK="${FAKE_LINGER_STUCK:-}" \
  FAKE_USERMOD_STUCK="${FAKE_USERMOD_STUCK:-}" JHT_RUN_USER_DIR="${JHT_RUN_USER_DIR:-}" FAKE_APT_LOCKED="${FAKE_APT_LOCKED:-}" \
  FAKE_REMOTE_ROOTLESS="${FAKE_REMOTE_ROOTLESS:-}" \
  ${CONTAINER_HOST+"CONTAINER_HOST=$CONTAINER_HOST"} ${CONTAINER_CONNECTION+"CONTAINER_CONNECTION=$CONTAINER_CONNECTION"} \
  /bin/bash -c "$cmd"
"""

FAKE_DOCKER = r"""#!/bin/bash
echo "docker $*" >> "$FAKE_LOG"
# What a user of the server could read about the process that called us: its
# arguments (world-readable) and whether the pairing token is in its environment.
echo "parent-args: $(ps -o args= -p $PPID 2>/dev/null)" >> "$FAKE_LOG"
echo "parent-env-token: $([ -n "${JHT_PAIRING_TOKEN:-}" ] && echo present || echo absent)" >> "$FAKE_LOG"
case "$1" in
  info) [ "${FAKE_DOCKER:-up}" = up ] ;;
  compose) [ "$2" = version ] ;;
  *) exit 0 ;;
esac
"""

FAKE_APT = r"""#!/bin/bash
echo "apt-get $*" >> "$FAKE_LOG"
case "$*" in
  *"install -y docker.io"*)
    [ "${FAKE_APT_INSTALLS_DOCKER:-1}" = 1 ] || exit 100
    cp "$(dirname "$0")/docker.real" "$(dirname "$0")/docker" ;;
  *"install -y"*)
    # Podman's packages: what is in stock/ comes out when it is installed.
    [ "${FAKE_APT_INSTALLS_PODMAN:-1}" = 1 ] || exit 100
    # unattended-upgrades holds the dpkg lock: without a wait apt-get fails at once.
    if [ "${FAKE_APT_LOCKED:-0}" = 1 ]; then
      case "$*" in *"DPkg::Lock::Timeout="*) ;; *) echo "E: Could not get lock /var/lib/dpkg/lock-frontend" >&2; exit 100 ;; esac
    fi
    d="$(dirname "$0")"
    for a in "$@"; do
      case "$a" in
        podman|podman-compose) [ -f "$d/stock/$a" ] && cp "$d/stock/$a" "$d/$a" ;;
        uidmap) cp "$d/stock/newuidmap" "$d/newuidmap"; cp "$d/stock/newgidmap" "$d/newgidmap" ;;
      esac
    done ;;
esac
exit 0
"""

# sudo never runs a privileged command in the sandbox: a test must not touch
# /swapfile, /etc or the CI runner, whoever it runs as.
FAKE_SUDO = r"""#!/bin/bash
echo "sudo $*" >> "$FAKE_LOG"
if [ "${FAKE_SUDO_PASSWORD:-0}" = 1 ]; then
  echo "sudo: a password is required" >&2; exit 1
fi
[ "$1" = "-n" ] && shift
case "$1" in
  apt-get|dnf|pacman|docker|env|usermod|loginctl) exec "$@" ;;
  *) exit 0 ;;
esac
"""

FAKE_LOGGER = r"""#!/bin/bash
echo "$(basename "$0") $*" >> "$FAKE_LOG"
exit 0
"""

FAKE_UNAME = r"""#!/bin/bash
[ "${1:-}" = "-s" ] && { echo Linux; exit 0; }
[ "${1:-}" = "-m" ] && { echo x86_64; exit 0; }
echo Linux
"""

FAKE_DF = r"""#!/bin/bash
# df -Pk <path>: report FAKE_FREE_KB free, or fall through to the real df
if [ -n "${FAKE_FREE_KB:-}" ]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
  printf '/dev/fake 100000000 %s %s 99%% /\n' "$((100000000 - FAKE_FREE_KB))" "$FAKE_FREE_KB"
  exit 0
fi
exec /bin/df "$@"
"""

# Rootless Podman as the server's administrator left it: podman, podman-compose
# and loginctl answer like the real ones, from variables the test sets.
FAKE_PODMAN = r"""#!/bin/bash
# Podman's own rule (cmd/podman/registry): CONTAINER_HOST or CONTAINER_CONNECTION
# in the environment, set even empty, makes the client talk to a remote service.
remote=""
[ -n "${CONTAINER_HOST+x}" ] && remote=1
[ -n "${CONTAINER_CONNECTION+x}" ] && remote=1
echo "podman $*${remote:+ [remote]}" >> "$FAKE_LOG"
case "$1" in
  --version) echo "podman version ${FAKE_PODMAN_VERSION:-5.7.0}" ;;
  info) [ -n "$remote" ] && { echo "${FAKE_REMOTE_ROOTLESS:-false}"; exit 0; }
    [ "${FAKE_PODMAN_INFO:-ok}" = fail ] && exit 125; echo "${FAKE_ROOTLESS:-true}" ;;
  *) exit 0 ;;
esac
"""

FAKE_PODMAN_COMPOSE = r"""#!/bin/bash
echo "podman-compose $*" >> "$FAKE_LOG"
echo "podman-compose version ${FAKE_COMPOSE_VERSION:-1.6.0}"
echo "podman version ${FAKE_PODMAN_VERSION:-5.7.0}"
"""

FAKE_LOGINCTL = r"""#!/bin/bash
echo "loginctl $*" >> "$FAKE_LOG"
case "$1" in
  enable-linger) [ "${FAKE_LINGER_STUCK:-0}" = 1 ] || touch "$FAKE_STATE/linger" ;;
  *) if [ -f "$FAKE_STATE/linger" ]; then echo "Linger=yes"; else echo "Linger=${FAKE_LINGER:-yes}"; fi ;;
esac
"""

# usermod writes the ranges where the installer reads them (JHT_ETC_DIR).
FAKE_USERMOD = r"""#!/bin/bash
echo "usermod $*" >> "$FAKE_LOG"
[ "${FAKE_USERMOD_STUCK:-0}" = 1 ] && exit 0
while [ $# -gt 0 ]; do
  case "$1" in
    --add-subuids) echo "app:${2%-*}:65536" >> "$JHT_ETC_DIR/subuid"; shift 2 ;;
    --add-subgids) echo "app:${2%-*}:65536" >> "$JHT_ETC_DIR/subgid"; shift 2 ;;
    *) shift ;;
  esac
done
"""

# The user is "app"; FAKE_UID=0 makes it root.
# `id -un <uid>` reads the fake server's accounts, never the machine running the test: on a
# GitHub runner uid 1001 is "runner", and the installer would stop at its uid 1001 guard.
# FAKE_UID_1001 names another account at uid 1001 on the fake server.
FAKE_ID = r"""#!/bin/bash
case "$*" in
  -u) echo "${FAKE_UID:-1000}" ;;
  -un) echo app ;;
  "-un "*)
    if [ "$2" = "${FAKE_UID:-1000}" ]; then echo app
    elif [ "$2" = 0 ]; then echo root
    elif [ "$2" = 1001 ] && [ -n "${FAKE_UID_1001:-}" ]; then echo "$FAKE_UID_1001"
    else echo "id: $2: no such user" >&2; exit 1
    fi ;;
  *) exec REAL_ID "$@" ;;
esac
"""

FAKE_JHT_RECORDER = r"""#!/bin/bash
echo "jht $*" >> "$FAKE_LOG"
exit 0
"""


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def rust_const(source: str, name: str) -> str:
    match = re.search(r'const %s: &str = r#"(.*?)"#;' % re.escape(name), source, re.S)
    assert match, f"{name} not found in onboarding.rs"
    return match.group(1)


def vps_arm_of_prepare(source: str) -> str:
    start = source.index("fn prepare_impl(")
    end = source.index("#[tauri::command]", start)
    return source[start:end]


class Server:
    """The sandbox that stands for the new VPS, and the ssh to reach it."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.home = tmp / "remote-home"
        self.home.mkdir()
        self.fake = tmp / "fake"
        self.fake.mkdir()
        self.tools = tmp / "tools"
        self.tools.mkdir()
        self.log = tmp / "calls.log"
        self.log.write_text("")
        self.known_hosts = tmp / "known_hosts"
        self.key = tmp / "id_ed25519"
        self.key.write_text("not a real key")
        for name in SYSTEM_TOOLS:
            real = shutil.which(name)
            if real:
                (self.tools / name).symlink_to(real)
        _write(self.fake / "ssh", FAKE_SSH)
        _write(self.fake / "docker.real", FAKE_DOCKER)
        _write(self.fake / "docker", FAKE_DOCKER)
        _write(self.fake / "apt-get", FAKE_APT)
        _write(self.fake / "sudo", FAKE_SUDO)
        _write(self.fake / "uname", FAKE_UNAME)
        _write(self.fake / "df", FAKE_DF)
        _write(self.fake / "groups", "#!/bin/bash\necho docker\n")
        _write(self.fake / "id", FAKE_ID.replace("REAL_ID", shutil.which("id")))
        self.etc = tmp / "etc"
        self.etc.mkdir()
        (self.etc / "subuid").write_text("app:100000:65536\n")
        (self.etc / "subgid").write_text("app:100000:65536\n")
        self.xdg = tmp / "xdg"
        self.xdg.mkdir()
        self.run = tmp / "run-user"
        self.run.mkdir()
        self.state = tmp / "state"
        self.state.mkdir()
        for name in ("fallocate", "dd", "mkswap", "swapon", "chown", "systemctl"):
            _write(self.fake / name, FAKE_LOGGER)
        self.env_extra: dict[str, str] = {}

    def pin(self, key: str = SERVER_KEY, host: str = "192.0.2.10") -> None:
        self.known_hosts.write_text(f"{host} ssh-ed25519 {key}\n")

    @property
    def remote_path(self) -> str:
        return f"{self.fake}:{self.tools}"

    def ssh(self, command: str, stdin: bytes = b"", **extra: str):
        env = {
            "PATH": f"{self.fake}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_SERVER_KEY": SERVER_KEY,
            "FAKE_REMOTE_HOME": str(self.home),
            "FAKE_REMOTE_PATH": self.remote_path,
            "FAKE_RAW_BASE": ROOT.as_uri(),
            "HOME": str(self.tmp),
            **self.env_extra,
            **extra,
        }
        argv = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=12",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={self.known_hosts}",
            "-o", "GlobalKnownHostsFile=/dev/null",
            "-i", str(self.key),
            "-p", "22",
            "app@192.0.2.10",
            command,
        ]
        return subprocess.run(
            argv, input=stdin, env=env, capture_output=True, timeout=120
        )

    def calls(self) -> list[str]:
        return self.log.read_text().splitlines()

    def installer_input(self, installer: bytes | None = None, digest: str | None = None,
                        token: str = TOKEN) -> bytes:
        body = installer if installer is not None else INSTALL.read_bytes()
        shown = digest or hashlib.sha256(body).hexdigest()
        return shown.encode() + b"\n" + token.encode() + b"\n" + body


@pytest.fixture
def source() -> str:
    return ONBOARDING.read_text(encoding="utf-8")


@pytest.fixture
def server(tmp_path) -> Server:
    s = Server(tmp_path)
    s.pin()
    return s


def install(server: Server, source: str, **kwargs):
    return server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(**kwargs))


# ── the sequence ──────────────────────────────────────────────────────────

def test_the_vps_arm_runs_install_then_up_then_snapshot_then_provider(source):
    arm = vps_arm_of_prepare(source)
    order = [
        arm.index("remote_install_command(channel_args)"),  # REMOTE_INSTALL, plus the channel's arguments
        arm.index("REMOTE_JHT_UP"),
        arm.index("snapshot_logged(&app, &scope, &validated, "),  # the Container step, its snapshot in the runtime log
        arm.index("REMOTE_USE_CLAUDE"),
        arm.index("REMOTE_UPDATE_CLAUDE"),
    ]
    assert order == sorted(order), "the provisioning sequence changed: update this test and the map"
    # The pairing token reaches the server on stdin, never in the ssh argv.
    assert "remote_install_input(installer, token)" in arm
    assert "Some(&input)" in arm


def test_the_ssh_options_the_fake_models_are_the_ones_the_app_uses():
    source = RUNTIME_HOST.read_text(encoding="utf-8")
    body = source[source.index("pub(crate) fn ssh_base_args"):source.index("pub(crate) fn run_ssh(")]
    for option in ("BatchMode=yes", "StrictHostKeyChecking=yes", "UserKnownHostsFile=",
                   "GlobalKnownHostsFile=/dev/null"):
        assert option in body


def test_a_new_server_goes_from_nothing_to_a_wrapper_a_compose_and_a_vps_host_env(server, source):
    done = install(server, source)
    assert done.returncode == 0, done.stderr.decode() + done.stdout.decode()
    home = server.home
    assert (home / ".local/bin/jht").is_file()
    runtime = home / ".local/share/job-hunter-team/host-runtime"
    assert (runtime / "docker-compose.yml").is_file()
    assert (runtime / "host-setup.sh").is_file()
    assert (runtime / ".runtime-integrity").is_file()
    env = (home / ".jht/host.env").read_text()
    assert "JHT_HOST_TYPE=vps" in env
    token_file = home / ".jht/.pairing-token"
    assert token_file.read_text() == TOKEN
    assert stat.S_IMODE(token_file.stat().st_mode) == 0o600


def test_the_token_is_not_printed_by_the_installer_nor_logged_by_the_fake_tools(server, source):
    done = install(server, source)
    assert done.returncode == 0
    assert TOKEN.encode() not in done.stdout + done.stderr
    assert TOKEN not in server.log.read_text()


def test_the_token_is_in_no_process_argument_on_the_server_and_not_in_its_children(server, source):
    done = install(server, source)
    assert done.returncode == 0, done.stderr.decode()
    seen = [c for c in server.calls() if c.startswith("parent-args:")]
    assert any("install" in c or "bash" in c for c in seen), "the probe saw no installer process"
    assert not any(TOKEN in c for c in seen)
    assert [c for c in server.calls() if c.startswith("parent-env-token:")] == \
        ["parent-env-token: absent"] * len([c for c in server.calls() if c.startswith("parent-env-token:")])


def test_the_remote_steps_after_the_install_reach_the_wrapper_in_order(server, source):
    assert install(server, source).returncode == 0
    jht = server.home / ".local/bin/jht"
    jht.write_text(FAKE_JHT_RECORDER)  # the container half is a stand-in
    jht.chmod(0o700)
    for name in ("REMOTE_JHT_UP", "REMOTE_USE_CLAUDE", "REMOTE_UPDATE_CLAUDE"):
        done = server.ssh(rust_const(source, name))
        assert done.returncode == 0, name
    jht_calls = [c for c in server.calls() if c.startswith("jht ")]
    assert jht_calls == ["jht up", "jht providers use claude", "jht providers update claude"]


# ── idempotency ───────────────────────────────────────────────────────────

def snapshot_tree(root: Path) -> dict[str, str]:
    out = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            out[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def test_running_the_install_twice_changes_nothing_the_second_time(server, source):
    first = install(server, source)
    assert first.returncode == 0
    before = snapshot_tree(server.home)
    second = install(server, source)
    assert second.returncode == 0, second.stderr.decode()
    assert snapshot_tree(server.home) == before


def test_a_second_install_with_a_new_token_replaces_only_the_token(server, source):
    assert install(server, source).returncode == 0
    before = snapshot_tree(server.home)
    new_token = "t0k-" + "ffeeddccbbaa" * 4
    assert install(server, source, token=new_token).returncode == 0
    after = snapshot_tree(server.home)
    assert (server.home / ".jht/.pairing-token").read_text() == new_token
    changed = {k for k in after if before.get(k) != after[k]}
    assert changed == {".jht/.pairing-token"}


def test_the_path_line_is_written_once_however_often_the_install_runs(server, source):
    (server.home / ".bashrc").write_text("# user rc\n")
    for _ in range(3):
        assert install(server, source).returncode == 0
    assert (server.home / ".bashrc").read_text().count("Added by JHT install.sh") == 1


# ── refusals ──────────────────────────────────────────────────────────────

def test_an_installer_that_does_not_match_its_digest_is_refused_before_anything_is_written(server, source):
    done = install(server, source, digest="0" * 64)
    assert done.returncode == 87
    assert list(server.home.iterdir()) == []


def test_a_tampered_installer_is_refused_even_with_the_right_looking_digest_of_another_file(server, source):
    done = install(server, source, installer=INSTALL.read_bytes() + b"\ntouch pwned\n",
                   digest=hashlib.sha256(INSTALL.read_bytes()).hexdigest())
    assert done.returncode == 87
    assert not (server.home / "pwned").exists()
    assert list(server.home.iterdir()) == []


def test_without_a_pin_ssh_refuses_and_nothing_runs_on_the_server(server, source):
    server.known_hosts.unlink()
    done = install(server, source)
    assert done.returncode == 255
    assert list(server.home.iterdir()) == []
    assert not any(c.startswith("ssh-run") for c in server.calls())


def test_with_a_changed_server_key_ssh_refuses_and_nothing_runs_on_the_server(server, source):
    server.pin(OTHER_KEY)
    done = install(server, source)
    assert done.returncode == 255
    assert b"HOST IDENTIFICATION HAS CHANGED" in done.stderr
    assert list(server.home.iterdir()) == []
    assert not any(c.startswith("ssh-run") for c in server.calls())


def test_a_server_that_cannot_be_reached_is_the_same_exit_255(server, source):
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_SSH_DOWN="1")
    assert done.returncode == 255
    assert list(server.home.iterdir()) == []


def test_docker_missing_is_installed_and_the_install_goes_on(server, source):
    (server.fake / "docker").unlink()
    done = install(server, source)
    assert done.returncode == 0, done.stdout.decode() + done.stderr.decode()
    assert any(c.startswith("apt-get") and "docker.io" in c for c in server.calls())
    assert (server.home / ".local/bin/jht").is_file()


def test_docker_that_cannot_be_installed_stops_before_any_file_or_token_is_written(server, source):
    (server.fake / "docker").unlink()
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_APT_INSTALLS_DOCKER="0")
    assert done.returncode != 0
    assert b"docker.io installation failed" in done.stderr
    assert not (server.home / ".local").exists()
    assert not (server.home / ".jht").exists()


def test_a_docker_daemon_that_does_not_answer_stops_before_any_file_or_token_is_written(server, source):
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(), FAKE_DOCKER="down")
    assert done.returncode != 0
    assert b"Docker daemon is not responding" in done.stderr
    assert not (server.home / ".local").exists()
    assert not (server.home / ".jht").exists()


def test_a_download_that_fails_stops_before_the_token_is_written(server, source, tmp_path):
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_RAW_BASE=(tmp_path / "nowhere").as_uri())
    assert done.returncode != 0
    assert b"Download failed" in done.stderr
    assert not (server.home / ".jht").exists()


# ── a disk that cannot hold the image ─────────────────────────────────────

def test_a_full_disk_is_refused_before_docker_is_installed_or_anything_is_written(server, source):
    (server.fake / "docker").unlink()  # Docker would have to be installed: it must not be
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_FREE_KB=str(512 * 1024))
    assert done.returncode != 0
    assert b"not enough free disk space" in done.stderr
    assert not any(c.startswith("apt-get") for c in server.calls())
    assert not (server.home / ".local").exists()
    assert not (server.home / ".jht").exists()


def test_a_disk_with_room_goes_on(server, source):
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_FREE_KB=str(40 * 1024 * 1024))
    assert done.returncode == 0, done.stderr.decode()


def test_another_account_at_uid_1001_on_the_server_stops_before_the_token_is_written(server, source):
    """The accounts are the fake server's: the same guard that a GitHub runner's own uid 1001 tripped."""
    done = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                      FAKE_UID_1001="backup")
    assert done.returncode != 0
    assert b"uid 1001 on this computer is the account 'backup'" in done.stderr
    assert not (server.home / ".jht/.pairing-token").exists()
    assert not (server.home / ".jht/host.env").exists()


# ── the token flag of the installer ───────────────────────────────────────

def parse_flag(tmp_path: Path, *args: str, env_token: str | None = None):
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}" "$@"\n'
        'printf "token=%s\\nleft=%s\\n" "$PAIRING_TOKEN" "${JHT_PAIRING_TOKEN:-}"\n'
    )
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)}
    if env_token is not None:
        env["JHT_PAIRING_TOKEN"] = env_token
    return subprocess.run(["bash", "-c", script, "install.sh", *args], env=env,
                          capture_output=True, text=True, timeout=30)


def test_the_token_can_come_from_the_environment_and_is_dropped_at_once(tmp_path):
    done = parse_flag(tmp_path, "--pairing-token-env", env_token=TOKEN)
    assert done.returncode == 0, done.stderr
    assert f"token={TOKEN}\n" in done.stdout
    assert "left=\n" in done.stdout


def test_the_environment_flag_without_a_token_in_the_environment_is_refused(tmp_path):
    done = parse_flag(tmp_path, "--pairing-token-env")
    assert done.returncode == 2
    assert "JHT_PAIRING_TOKEN" in done.stderr


def test_the_old_flag_with_the_token_as_an_argument_still_works_for_manual_use(tmp_path):
    done = parse_flag(tmp_path, "--pairing-token", TOKEN)
    assert done.returncode == 0, done.stderr
    assert f"token={TOKEN}\n" in done.stdout


# ── Podman rootless on a Linux server (--runtime podman) ──────────────────

def with_podman(server: Server, *, bare: bool = False, compose_in_stock: bool = True) -> None:
    """Docker is not there. Podman is, as an administrator left it, or (bare)
    only in the package stock, where apt-get takes it from; the user has no
    subordinate range and no linger yet."""
    (server.fake / "docker").unlink()
    (server.fake / "docker.real").unlink()
    stock = server.fake / "stock"
    stock.mkdir()
    _write(stock / "podman", FAKE_PODMAN)
    if compose_in_stock:
        _write(stock / "podman-compose", FAKE_PODMAN_COMPOSE)
    _write(stock / "newuidmap", FAKE_LOGGER)
    _write(stock / "newgidmap", FAKE_LOGGER)
    _write(server.fake / "loginctl", FAKE_LOGINCTL)
    _write(server.fake / "usermod", FAKE_USERMOD)
    if bare:
        (server.run / "1000").mkdir(exist_ok=True)
        (server.etc / "subuid").write_text("")
        (server.etc / "subgid").write_text("other:100000:65536\n")
    else:
        for name in ("podman", "podman-compose", "newuidmap", "newgidmap"):
            shutil.copy(stock / name, server.fake / name)


def install_podman(server: Server, source: str, **extra: str):
    command = rust_const(source, "REMOTE_INSTALL") + " --runtime podman"
    env = {
        "XDG_RUNTIME_DIR": str(server.xdg),
        "JHT_ETC_DIR": str(server.etc),
        "JHT_RUN_USER_DIR": str(server.run),
        "FAKE_STATE": str(server.state),
        **extra,
    }
    return server.ssh(command, server.installer_input(), **env)


def sudo_calls(server: Server) -> list[str]:
    swap = ("sudo fallocate", "sudo chmod 600 /swapfile", "sudo mkswap", "sudo swapon", "sudo tee -a /etc/fstab")
    return [c for c in server.calls() if c.startswith("sudo") and not c.startswith(swap)]


def test_with_podman_rootless_there_the_install_needs_no_docker_and_no_sudo(server, source):
    with_podman(server)
    done = install_podman(server, source)
    assert done.returncode == 0, done.stderr.decode() + done.stdout.decode()
    calls = server.calls()
    assert not [c for c in calls if c.startswith(("apt-get", "docker", "systemctl", "chown"))]
    # The one sudo left is host-setup.sh's swap on a small server (the sandbox
    # has no /proc/meminfo, so it looks small); the installer's own branch has none.
    assert not sudo_calls(server)
    runtime = server.home / ".local/share/job-hunter-team/host-runtime"
    assert (runtime / "container-runtime").read_text() == "podman\n"
    assert not (runtime / "podman-machine").exists()
    shim = (runtime / "bin/docker").read_text()
    assert "JHT_PODMAN_DOCKER_SHIM=1" in shim and "--connection" not in shim
    assert shim.splitlines()[-1] == f"exec '{server.fake / 'podman'}' \"$@\""
    manifest = dict(line.split("=", 1) for line in (runtime / ".runtime-integrity").read_text().splitlines())
    assert manifest["docker-shim"] == hashlib.sha256((runtime / "bin/docker").read_bytes()).hexdigest()
    assert manifest["container-runtime"] == hashlib.sha256(b"podman\n").hexdigest()
    assert "podman-machine" not in manifest
    assert (server.home / ".jht/.pairing-token").read_text() == TOKEN


def test_a_server_as_bought_gets_podman_a_range_and_linger_from_the_users_own_sudo_and_never_docker(server, source):
    with_podman(server, bare=True)
    done = install_podman(server, source, FAKE_LINGER="no", FAKE_APT_LOCKED="1")
    assert done.returncode == 0, done.stderr.decode() + done.stdout.decode()
    calls = server.calls()
    assert ("sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 "
            "install -y podman podman-compose uidmap") in calls
    # the range starts after the one somebody else already has
    assert "sudo -n usermod --add-subuids 165536-231071 --add-subgids 165536-231071 app" in calls
    assert (server.etc / "subuid").read_text() == "app:165536:65536\n"
    assert "podman system migrate" in calls
    assert "sudo -n loginctl enable-linger app" in calls
    assert not [c for c in calls if "docker" in c.split()[:3] or c.startswith("docker")]
    assert (server.home / ".local/share/job-hunter-team/host-runtime/container-runtime").read_text() == "podman\n"


def test_sudo_that_wants_a_password_stops_with_its_own_code_before_anything_is_written(server, source):
    with_podman(server, bare=True)
    done = install_podman(server, source, FAKE_SUDO_PASSWORD="1")
    assert done.returncode == 89, done.stderr.decode()
    assert b"JHT_ERROR podman_sudo_required\n" in done.stderr
    assert not [c for c in server.calls() if c.startswith(("apt-get", "docker"))]
    assert not (server.home / ".local").exists() and not (server.home / ".jht").exists()


def test_a_package_install_that_fails_leaves_with_its_own_code(server, source):
    with_podman(server, bare=True)
    done = install_podman(server, source, FAKE_APT_INSTALLS_PODMAN="0")
    assert done.returncode == 88, done.stderr.decode()
    assert b"JHT_ERROR podman_install_failed\n" in done.stderr
    assert not (server.home / ".jht").exists()


def test_a_podman_compose_the_system_does_not_have_is_named_after_the_install(server, source):
    with_podman(server, bare=True, compose_in_stock=False)
    done = install_podman(server, source, FAKE_LINGER="no")
    assert done.returncode == 92, done.stderr.decode()
    assert b"JHT_ERROR podman_compose_missing\n" in done.stderr
    assert not (server.home / ".jht").exists()


def test_a_range_or_linger_that_does_not_stick_is_named_after_the_attempt(server, source):
    with_podman(server, bare=True)
    stuck = install_podman(server, source, FAKE_USERMOD_STUCK="1", FAKE_LINGER="no")
    assert stuck.returncode == 96 and b"JHT_ERROR podman_subuid_missing\n" in stuck.stderr
    (server.etc / "subuid").write_text("app:100000:65536\n")
    (server.etc / "subgid").write_text("app:100000:65536\n")
    (server.state / "linger").unlink()
    lingering = install_podman(server, source, FAKE_LINGER="no", FAKE_LINGER_STUCK="1")
    assert lingering.returncode == 94 and b"JHT_ERROR podman_linger_missing\n" in lingering.stderr


def test_a_session_without_a_runtime_directory_is_given_the_one_linger_started(server, source):
    with_podman(server)
    (server.run / "1000").mkdir(exist_ok=True)
    done = install_podman(server, source, XDG_RUNTIME_DIR="")
    assert done.returncode == 0, done.stderr.decode()


REFUSALS = [
    ("podman_rootful_refused", 91, {"FAKE_UID": "0"}),
    ("podman_rootful_refused", 91, {"FAKE_ROOTLESS": "false"}),
    ("podman_version_unsupported", 93, {"FAKE_PODMAN_VERSION": "4.9.3"}),
    ("podman_version_unsupported", 93, {"FAKE_COMPOSE_VERSION": "1.0.6"}),
    ("podman_runtime_dir_missing", 95, {"XDG_RUNTIME_DIR": "/nonexistent-runtime-dir"}),
    ("podman_rootless_unavailable", 97, {"FAKE_PODMAN_INFO": "fail"}),
]


@pytest.mark.parametrize("code,exit_code,env", REFUSALS, ids=[f"{c}-{n}" for n, (c, *_rest) in enumerate(REFUSALS)])
def test_what_the_install_cannot_fix_leaves_with_its_own_code_before_anything_is_written(
    server, source, code, exit_code, env
):
    with_podman(server)
    done = install_podman(server, source, **env)
    assert done.returncode == exit_code, done.stderr.decode()
    assert f"JHT_ERROR {code}\n".encode() in done.stderr
    assert not [c for c in server.calls() if c.startswith(("apt-get", "docker"))]
    assert not sudo_calls(server)
    assert not (server.home / ".local").exists()
    assert not (server.home / ".jht").exists()


@pytest.mark.parametrize("inherited", [
    {"CONTAINER_HOST": "ssh://other@192.0.2.20/run/user/0/podman/podman.sock"},
    {"CONTAINER_CONNECTION": "another-server"},
    {"CONTAINER_HOST": "", "CONTAINER_CONNECTION": ""},
])
def test_a_remote_podman_in_the_users_environment_is_not_the_one_the_install_checks(server, source, inherited):
    # the remote service is rootful: asking it would refuse a server whose own Podman is rootless
    with_podman(server)
    done = install_podman(server, source, FAKE_REMOTE_ROOTLESS="false", **inherited)
    assert done.returncode == 0, done.stderr.decode()
    podman_calls = [c for c in server.calls() if c.startswith("podman ")]
    assert any(c.startswith("podman info") for c in podman_calls)
    assert not [c for c in podman_calls if c.endswith("[remote]")]


def test_a_second_install_without_the_option_keeps_podman(server, source):
    with_podman(server)
    assert install_podman(server, source).returncode == 0
    again = server.ssh(rust_const(source, "REMOTE_INSTALL"), server.installer_input(),
                       XDG_RUNTIME_DIR=str(server.xdg), JHT_ETC_DIR=str(server.etc),
                       JHT_RUN_USER_DIR=str(server.run), FAKE_STATE=str(server.state))
    assert again.returncode == 0, again.stderr.decode()
    runtime = server.home / ".local/share/job-hunter-team/host-runtime"
    assert (runtime / "container-runtime").read_text() == "podman\n"
    assert "docker-shim=" in (runtime / ".runtime-integrity").read_text()


def test_a_server_already_on_docker_asked_for_podman_stops_with_its_own_code_and_changes_nothing(server, source):
    # A VPS installed before Podman: the team runs on Docker (here the fake one).
    first = install(server, source)
    assert first.returncode == 0, first.stderr.decode()
    runtime = server.home / ".local/share/job-hunter-team/host-runtime"
    # the Docker path on Linux writes no marker: the completed install is what says Docker
    assert not (runtime / "container-runtime").exists() and (runtime / ".runtime-integrity").is_file()
    before = snapshot_tree(server.home)
    calls_before = len(server.calls())
    # The app installs again, as it does now on every VPS: --runtime podman.
    with_podman(server)
    done = install_podman(server, source)
    assert done.returncode == rust_exit(source, "REMOTE_INSTALL_RUNTIME_CHANGE_EXIT") == 85, done.stderr.decode()
    assert b"JHT_ERROR runtime_change_requires_migration\n" in done.stderr
    # Refused before anything: the Docker team, its files and its token are as they were.
    assert snapshot_tree(server.home) == before
    assert not [c for c in server.calls()[calls_before:] if c.startswith(("apt-get", "docker", "podman", "sudo"))]


def test_a_server_on_docker_installed_again_without_the_option_stays_on_docker(server, source):
    assert install(server, source).returncode == 0
    calls_before = len(server.calls())
    again = install(server, source)
    assert again.returncode == 0, again.stderr.decode()
    runtime = server.home / ".local/share/job-hunter-team/host-runtime"
    assert not (runtime / "container-runtime").exists()
    assert "docker-shim=" not in (runtime / ".runtime-integrity").read_text()
    assert not [c for c in server.calls()[calls_before:] if c.startswith("podman")]


def rust_exit(source: str, name: str) -> int:
    return int(re.search(rf"const {name}: i32 = (\d+);", source).group(1))


def test_a_range_is_chosen_after_the_one_readable_file_when_the_other_is_missing(server, source):
    with_podman(server, bare=True)
    (server.etc / "subuid").unlink()  # /etc/subuid absent, /etc/subgid there with someone's range
    done = install_podman(server, source, FAKE_LINGER="no")
    assert done.returncode == 0, done.stderr.decode()
    assert "sudo -n usermod --add-subuids 165536-231071 --add-subgids 165536-231071 app" in server.calls()
