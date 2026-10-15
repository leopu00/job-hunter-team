"""The remote provisioning of a new VPS, run end to end without a VPS.

What the desktop app does for a new server (desktop/src-tauri/src/onboarding.rs,
prepare_impl, VPS arm) is a fixed sequence of ``ssh`` calls:

  1. REMOTE_INSTALL   - the verified install.sh is piped on stdin and run with
                        ``--pairing-token``: Docker, wrapper, compose, host.env
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
    "sha256sum shasum stat find xargs diff cmp tty"
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
  /bin/bash -c "$cmd"
"""

FAKE_DOCKER = r"""#!/bin/bash
echo "docker $*" >> "$FAKE_LOG"
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
esac
exit 0
"""

# sudo never runs a privileged command in the sandbox: a test must not touch
# /swapfile, /etc or the CI runner, whoever it runs as.
FAKE_SUDO = r"""#!/bin/bash
echo "sudo $*" >> "$FAKE_LOG"
case "$1" in
  apt-get|dnf|pacman|docker) exec "$@" ;;
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
        arm.index("REMOTE_INSTALL"),
        arm.index("REMOTE_JHT_UP"),
        arm.index("snapshot_impl(&app, &scope, &validated)"),
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
