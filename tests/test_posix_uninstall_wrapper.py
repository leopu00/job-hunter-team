"""macOS/Linux `jht uninstall`: the Windows contract on the Bash wrapper.

Same protocol as `jht.ps1 uninstall --confirm`: one explicit confirmation,
stable `JHT_PHASE`/`JHT_LEFT` lines on stdout, exit 0, 2 or 24, idempotent.
Only what the installer put is removed: the jht-podman machine by its exact
name, or the containers, networks and volumes of the Compose project jht by
label; then the host runtime, the PATH lines install.sh appended and the jht
command, last. ~/.jht, Documents, Podman, Docker, Colima and foreign machines,
volumes and commands stay.

Everything runs against the real wrapper with fake podman, docker, uname and
launchctl. The copy under test points UNINSTALL_TOOL_DIRS at the fake tools,
so no test can ever reach the real Podman or Docker of the machine it runs on.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SOURCE = WRAPPER.read_text(encoding="utf-8")
TOOL_DIRS_LINE = next(line for line in SOURCE.splitlines() if line.startswith("UNINSTALL_TOOL_DIRS="))
MAC_RUNTIME = Path("Library/Application Support/Job Hunter Team/host-runtime")
LINUX_RUNTIME = Path(".local/share/job-hunter-team/host-runtime")
RC_BLOCK = '\n# Added by JHT install.sh\nexport PATH="$PATH:{bin}"\n'
LOSS = "la password della posta e i token di Telegram"
STAYS = "la sessione LinkedIn salvata (secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds"

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the wrapper is a POSIX script")

FAKE_UNAME = """#!/bin/sh
[ "$1" = -s ] && { printf '%s\\n' "$FAKE_UNAME"; exit 0; }
exec /usr/bin/uname "$@"
"""

FAKE_LAUNCHCTL = """#!/bin/sh
printf 'launchctl %s\\n' "$*" >> "$FAKE_LOG"
exit 0
"""

# Machines: one name per line in $FAKE_STATE/machines, `*` marks the default.
FAKE_PODMAN = """#!/bin/sh
printf 'podman %s\\n' "$*" >> "$FAKE_LOG"
machines="$FAKE_STATE/machines"
case "$1:$2" in
  machine:list)
    [ ! -f "$FAKE_STATE/podman-down" ] || exit 125
    [ "$3:$4" = "--format:{{.Name}}" ] || exit 91
    [ ! -f "$machines" ] || cat "$machines"
    exit 0 ;;
  machine:rm)
    [ "$3" = --force ] && [ $# -eq 4 ] || exit 92
    [ ! -f "$FAKE_STATE/podman-rm-fails" ] || exit 1
    grep -v -x -e "$4" -e "$4\\*" "$machines" > "$machines.new" || true
    mv "$machines.new" "$machines"
    exit 0 ;;
esac
exit 90
"""

# Objects: one "<kind> <id> <project> <logical>" per line in $FAKE_STATE/objects;
# <logical> is the Compose service, network or volume name.
FAKE_DOCKER = """#!/bin/sh
printf 'docker %s\\n' "$*" >> "$FAKE_LOG"
objects="$FAKE_STATE/objects"
touch "$objects"
list() {
  kind="$1"; shift
  case "$1:$3" in --filter:--filter) ;; *) exit 93 ;; esac
  case "$2" in label=com.docker.compose.project=*) project="${2#*=*=}" ;; *) exit 93 ;; esac
  case "$kind:$4" in
    container:label=com.docker.compose.service=*|network:label=com.docker.compose.network=*|volume:label=com.docker.compose.volume=*)
      logical="${4#*=*=}" ;;
    *) exit 93 ;;
  esac
  awk -v kind="$kind" -v project="$project" -v logical="$logical" \\
    '$1 == kind && $3 == project && $4 == logical { print $2 }' "$objects"
}
drop() {
  awk -v kind="$1" -v id="$2" '!($1 == kind && $2 == id)' "$objects" > "$objects.new"
  mv "$objects.new" "$objects"
}
case "$1" in
  context)
    [ "$2:$3:$4" = "inspect:--format:{{.Endpoints.docker.Host}}" ] || exit 98
    [ ! -f "$FAKE_STATE/context-fails" ] || exit 1
    if [ -f "$FAKE_STATE/endpoint" ]; then cat "$FAKE_STATE/endpoint"; else echo unix:///var/run/docker.sock; fi
    exit 0 ;;
  info) [ ! -f "$FAKE_STATE/docker-down" ] || exit 1; exit 0 ;;
  ps) [ "$2" = -aq ] || exit 94; shift 2; list container "$@" ;;
  rm) [ "$2" = -f ] || exit 95; drop container "$3" ;;
  network|volume)
    kind="$1"
    case "$2" in
      ls) [ "$3" = -q ] || exit 96; shift 3; list "$kind" "$@" ;;
      rm)
        # A volume still mounted by a JHT container of its project cannot go:
        # removal order matters.
        if [ "$kind" = volume ] && awk -v id="$3" '
            $1 == "volume" && $2 == id { project = $3 }
            $1 == "container" && $4 ~ /^jht(-broker|-telegram)?$/ { owners[$3] = 1 }
            END { exit !(project in owners) }' "$objects"; then exit 1; fi
        drop "$kind" "$3" ;;
      *) exit 97 ;;
    esac ;;
  run)
    # The one-shot container `jht uninstall --confirm --purge` empties a data folder with: it runs as the folder's
    # owner (1001), keeps no capability, has no network, a read-only root and ONLY that folder mounted.
    [ ! -f "$FAKE_STATE/run-fails" ] || exit 1
    src=""
    case "$*" in
      "run --rm --pull never --user 1001:1001 --cap-drop ALL --network none --security-opt no-new-privileges --read-only -v "*":/purge --entrypoint /bin/sh "*" -c find /purge -mindepth 1 -xdev -delete") ;;
      *) exit 99 ;;
    esac
    for arg in "$@"; do case "$arg" in *:/purge) src="${arg%:/purge}" ;; esac; done
    [ -d "$src" ] || exit 100
    printf 'mode-seen-by-the-container %s\n' "$(ls -ld "$src" | cut -c1-10)" >> "$FAKE_LOG"
    # As the owner would: the folder is his, so he can open it. Nothing is changed on the way in or out for the host.
    chmod -R u+rwx "$src" && find "$src" -mindepth 1 -delete ;;
  *) exit 90 ;;
esac
"""


class Box:
    def __init__(self, tmp_path: Path, kernel: str) -> None:
        self.home = tmp_path / "home"
        self.tools = tmp_path / "tools"
        self.state = tmp_path / "state"
        self.log = tmp_path / "calls.log"
        self.kernel = kernel
        for directory in (self.home, self.tools, self.state):
            directory.mkdir(parents=True)
        # The system tools, minus any real podman or docker the runner has.
        self.system = tmp_path / "system"
        self.system.mkdir()
        for directory in (Path("/usr/bin"), Path("/bin")):
            for entry in directory.iterdir():
                if entry.name in {"podman", "docker", "uname", "launchctl"}:
                    continue
                link = self.system / entry.name
                if not link.exists() and not link.is_symlink():
                    link.symlink_to(entry)
        self.bin = self.home / ".local" / "bin"
        self.bin.mkdir(parents=True)
        self.runtime = self.home / (MAC_RUNTIME if kernel == "Darwin" else LINUX_RUNTIME)
        self.runtime.mkdir(parents=True)
        for name, source in (
            ("uname", FAKE_UNAME), ("launchctl", FAKE_LAUNCHCTL),
            ("podman", FAKE_PODMAN), ("docker", FAKE_DOCKER),
        ):
            tool = self.tools / name
            tool.write_text(source, encoding="utf-8")
            tool.chmod(0o755)
        assert TOOL_DIRS_LINE in SOURCE
        self.wrapper = self.bin / "jht"
        self.wrapper.write_text(
            SOURCE.replace(TOOL_DIRS_LINE, f'UNINSTALL_TOOL_DIRS="{self.tools}"'),
            encoding="utf-8",
        )
        self.wrapper.chmod(0o700)
        (self.runtime / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
        (self.runtime / ".runtime-integrity").write_text("version=1\n", encoding="utf-8")
        self.data = self.home / ".jht" / "profile.json"
        self.data.parent.mkdir()
        self.data.write_text("keep\n", encoding="utf-8")
        self.documents = self.home / "Documents" / "Job Hunter Team" / "cv.txt"
        self.documents.parent.mkdir(parents=True)
        self.documents.write_text("keep\n", encoding="utf-8")

    def select(self, runtime: str) -> None:
        (self.runtime / "container-runtime").write_text(f"{runtime}\n", encoding="utf-8")

    def machines(self, *names: str) -> None:
        (self.state / "machines").write_text("".join(f"{name}\n" for name in names), encoding="utf-8")

    def objects(self, *rows: str) -> None:
        (self.state / "objects").write_text("".join(f"{row}\n" for row in rows), encoding="utf-8")

    def run(self, *args: str, **extra_env: str) -> subprocess.CompletedProcess[str]:
        env = {
            "JHT_LANG": "it",  # the asserted texts are the Italian ones; the English ones have their own tests below
            **extra_env,
            "HOME": str(self.home),
            "PATH": f"{self.tools}:{self.system}",
            "FAKE_UNAME": self.kernel,
            "FAKE_STATE": str(self.state),
            "FAKE_LOG": str(self.log),
            "LANG": "C",
        }
        return subprocess.run(
            [str(self.wrapper), *args], capture_output=True, text=True, env=env, timeout=60,
        )

    def calls(self) -> list[str]:
        return self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []

    def remaining(self, name: str) -> str:
        path = self.state / name
        return path.read_text(encoding="utf-8") if path.exists() else ""


def phases(result: subprocess.CompletedProcess[str]) -> list[str]:
    return [line for line in result.stdout.splitlines() if line.startswith(("JHT_PHASE", "JHT_LEFT"))]


def assert_user_data_kept(box: Box) -> None:
    assert box.data.read_text(encoding="utf-8") == "keep\n"
    assert box.documents.read_text(encoding="utf-8") == "keep\n"


@pytest.mark.parametrize("args", [(), ("--yes",), ("--CONFIRM",), ("--confirm", "--confirm")])
def test_without_exactly_one_confirmation_nothing_moves(tmp_path: Path, args: tuple[str, ...]) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    box.machines("jht-podman*")

    result = box.run("uninstall", *args)

    assert result.returncode == 2
    assert "uso: jht uninstall --confirm [--purge]" in result.stderr
    assert LOSS in result.stderr
    assert STAYS in result.stderr  # il testo dice dove resta la sessione e come si toglie
    assert box.calls() == []
    assert box.runtime.is_dir() and box.wrapper.is_file()


def test_mac_podman_removes_only_the_jht_machine_and_is_idempotent(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    (box.runtime / "podman-machine").write_text("jht-podman\n", encoding="utf-8")
    shim_dir = box.runtime / "bin"
    shim_dir.mkdir()
    shim = shim_dir / "docker"
    shim.write_text("#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 99\n", encoding="utf-8")
    shim.chmod(0o700)
    box.machines("other-podman", "jht-podman*", "somebody-else")
    zshrc = box.home / ".zshrc"
    zshrc.write_text("alias ll='ls -l'\n" + RC_BLOCK.format(bin=box.bin) + "export EDITOR=vim\n", encoding="utf-8")
    zshrc.chmod(0o640)

    first = box.run("uninstall", "--confirm")

    assert first.returncode == 0, first.stderr
    assert phases(first) == [
        "JHT_PHASE uninstall_machine", "JHT_PHASE uninstall_runtime", "JHT_PHASE uninstall_commands",
    ]
    assert LOSS in first.stderr
    assert box.remaining("machines").splitlines() == ["other-podman", "somebody-else"]
    removals = [call for call in box.calls() if call.startswith("podman machine rm")]
    assert removals == ["podman machine rm --force jht-podman"]
    assert not any(call.startswith("launchctl") for call in box.calls())
    assert not box.runtime.exists()
    assert not box.runtime.parent.exists()  # "Job Hunter Team" in Application Support, now empty
    assert not box.wrapper.exists()
    assert zshrc.read_text(encoding="utf-8") == "alias ll='ls -l'\nexport EDITOR=vim\n"
    assert zshrc.stat().st_mode & 0o777 == 0o640
    assert_user_data_kept(box)

    # Retry from a copy of the wrapper, as the desktop does: nothing left.
    box.wrapper.write_text(SOURCE.replace(TOOL_DIRS_LINE, f'UNINSTALL_TOOL_DIRS="{box.tools}"'), encoding="utf-8")
    box.wrapper.chmod(0o700)
    second = box.run("uninstall", "--confirm")
    assert second.returncode == 0, second.stderr
    assert not [line for line in phases(second) if line.startswith("JHT_LEFT")]
    assert [call for call in box.calls() if call.startswith("podman machine rm")] == removals


@pytest.mark.parametrize("kernel", ["Darwin", "Linux"])
@pytest.mark.parametrize("project", ["host-runtime", "jht"])
def test_docker_runtime_removes_the_jht_project_with_its_volumes(tmp_path: Path, kernel: str, project: str) -> None:
    """Docker names the project after the runtime folder (host-runtime) because
    compose_file passes --project-directory; Podman and `name: jht` use jht."""
    box = Box(tmp_path, kernel)
    if kernel == "Darwin":
        box.select("docker")  # Colima: install.sh writes the marker on macOS only
        box.machines("colima-default*")
    p = project
    box.objects(
        f"container c1 {p} jht", f"container c2 {p} jht-broker", f"container c3 {p} jht-telegram",
        f"network n1 {p} default",
        f"volume {p}_jht-secrets {p} jht-secrets",
        f"volume {p}_jht-telegram-secrets {p} jht-telegram-secrets",
        f"volume {p}_jht-runtime-mask {p} jht-runtime-mask",
        # Someone else's project, and someone else's things inside a project
        # that happens to share the generic name.
        "container other1 someone jht", "volume other_data someone jht-secrets",
        f"container stranger {p} web", f"volume {p}_cache {p} cache", f"network n2 {p} frontend",
    )

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 0, result.stderr
    assert box.remaining("objects").splitlines() == [
        "container other1 someone jht", "volume other_data someone jht-secrets",
        f"container stranger {p} web", f"volume {p}_cache {p} cache", f"network n2 {p} frontend",
    ]
    assert not any("prune" in call for call in box.calls())
    assert not any(call.startswith("podman machine rm") for call in box.calls())
    assert not box.runtime.exists() and not box.wrapper.exists()
    assert_user_data_kept(box)


def test_the_cleanup_names_match_the_compose_file() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    services = re.findall(r"^  ([a-z][a-z0-9-]*):\n", compose.split("\nvolumes:\n")[0], re.M)
    volumes = re.findall(r"^  ([a-z][a-z0-9-]*):\s*$", compose.split("\nvolumes:\n", 1)[1].split("\n\n")[0], re.M)
    line = lambda name: next(l for l in SOURCE.splitlines() if l.startswith(f"{name}=")).split("=", 1)[1].strip('"').split()
    assert sorted(line("UNINSTALL_SERVICES")) == sorted(services)
    assert sorted(line("UNINSTALL_VOLUMES")) == sorted(volumes)
    assert "--project-directory \"$RUNTIME_DIR\"" in SOURCE  # why host-runtime is a project name
    assert line("UNINSTALL_PROJECTS") == ["jht", "host-runtime"]


@pytest.mark.parametrize(
    ("context", "docker_host", "named"),
    [
        ("ssh://me@my-vps.invalid", None, "ssh://me@my-vps.invalid"),
        (None, "tcp://my-vps.invalid:2376", "tcp://my-vps.invalid:2376"),
        ("unix:///var/run/docker.sock", "ssh://me@my-vps.invalid", "ssh://me@my-vps.invalid"),
    ],
    ids=["remote-context", "remote-docker-host", "docker-host-wins-over-context"],
)
def test_a_docker_that_is_not_this_computer_is_never_cleaned(
    tmp_path: Path, context: str | None, docker_host: str | None, named: str
) -> None:
    box = Box(tmp_path, "Linux")
    box.objects("container c1 host-runtime jht", "volume v1 host-runtime jht-secrets")
    if context:
        (box.state / "endpoint").write_text(context + "\n", encoding="utf-8")
    extra = {"DOCKER_HOST": docker_host} if docker_host else {}

    result = box.run("uninstall", "--confirm", **extra)

    assert result.returncode == 24
    assert phases(result) == ["JHT_PHASE uninstall_machine", "JHT_LEFT machine", "JHT_LEFT runtime", "JHT_LEFT commands"]
    assert named in result.stderr
    assert box.remaining("objects").splitlines() == ["container c1 host-runtime jht", "volume v1 host-runtime jht-secrets"]
    assert not any(call.split()[1:2] in (["rm"], ["volume"], ["network"], ["ps"]) for call in box.calls())
    assert box.runtime.is_dir() and box.wrapper.is_file()


def test_an_unknown_docker_endpoint_is_never_cleaned(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    box.objects("volume v1 host-runtime jht-secrets")
    (box.state / "context-fails").write_text("", encoding="utf-8")

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 24
    assert "JHT_LEFT machine" in result.stdout
    assert box.remaining("objects") == "volume v1 host-runtime jht-secrets\n"


def test_mac_podman_skips_a_remote_docker_and_still_removes_the_machine(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    box.machines("jht-podman*")
    box.objects("volume v1 host-runtime jht-secrets")
    (box.state / "endpoint").write_text("ssh://me@my-vps.invalid\n", encoding="utf-8")

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 0, result.stderr
    assert box.remaining("machines") == ""
    assert box.remaining("objects") == "volume v1 host-runtime jht-secrets\n"


def test_a_docker_daemon_that_does_not_answer_keeps_everything_for_retry(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    box.objects("container c1 host-runtime jht", "volume v1 host-runtime jht-secrets")
    (box.state / "docker-down").write_text("", encoding="utf-8")
    profile = box.home / ".profile"
    profile.write_text(RC_BLOCK.format(bin=box.bin), encoding="utf-8")

    stuck = box.run("uninstall", "--confirm")

    assert stuck.returncode == 24
    assert phases(stuck) == ["JHT_PHASE uninstall_machine", "JHT_LEFT machine", "JHT_LEFT runtime", "JHT_LEFT commands"]
    assert "segreti" in stuck.stderr
    assert box.runtime.is_dir() and box.wrapper.is_file()
    assert "export PATH" in profile.read_text(encoding="utf-8")
    assert "volume v1 host-runtime jht-secrets" in box.remaining("objects")

    (box.state / "docker-down").unlink()
    retried = box.run("uninstall", "--confirm")
    assert retried.returncode == 0, retried.stderr
    assert box.remaining("objects") == ""
    assert profile.read_text(encoding="utf-8") == ""


@pytest.mark.parametrize("failure", ["podman-down", "podman-rm-fails"])
def test_a_jht_machine_that_cannot_be_removed_keeps_runtime_and_wrapper(tmp_path: Path, failure: str) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    box.machines("jht-podman")
    (box.state / failure).write_text("", encoding="utf-8")

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 24
    assert "JHT_LEFT machine" in result.stdout
    assert "JHT_LEFT runtime" in result.stdout
    assert "JHT_LEFT commands" in result.stdout
    assert box.runtime.is_dir() and box.wrapper.is_file()


def test_a_foreign_command_keeps_the_shared_bin_on_path(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    foreign = box.bin / "another-tool"
    foreign.write_text("#!/bin/sh\n", encoding="utf-8")
    bashrc = box.home / ".bashrc"
    bashrc.write_text("set -o vi\n" + RC_BLOCK.format(bin=box.bin), encoding="utf-8")

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 0, result.stderr
    assert foreign.exists()
    assert not box.wrapper.exists()
    assert RC_BLOCK.format(bin=box.bin) in bashrc.read_text(encoding="utf-8")


def test_a_symlinked_rc_with_the_block_keeps_the_wrapper_for_retry(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    target = tmp_path / "dotfiles-zshrc"
    target.write_text(RC_BLOCK.format(bin=box.bin), encoding="utf-8")
    (box.home / ".zshrc").symlink_to(target)

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 24
    assert phases(result)[-1] == "JHT_LEFT commands"
    assert box.wrapper.is_file()
    assert target.read_text(encoding="utf-8") == RC_BLOCK.format(bin=box.bin)


def test_an_unreadable_runtime_choice_is_non_mutating(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("docker-desktop")
    box.machines("jht-podman")

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 24
    assert phases(result) == ["JHT_LEFT runtime", "JHT_LEFT commands"]
    assert box.calls() == []
    assert box.runtime.is_dir() and box.wrapper.is_file()


def test_a_foreign_jht_command_is_not_ours_to_remove(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    # The wrapper runs from elsewhere; ~/.local/bin/jht is a different program
    # (no protocol line), so it is neither removed nor reported as left.
    elsewhere = tmp_path / "elsewhere" / "jht"
    elsewhere.parent.mkdir()
    box.wrapper.rename(elsewhere)
    box.wrapper = elsewhere
    stranger = box.bin / "jht"
    stranger.write_text("#!/bin/sh\necho hi\n", encoding="utf-8")
    stranger.chmod(0o755)

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 0, result.stderr
    assert stranger.read_text(encoding="utf-8") == "#!/bin/sh\necho hi\n"


def test_without_podman_a_podman_runtime_reports_the_machine_left(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    (box.tools / "podman").unlink()

    result = box.run("uninstall", "--confirm")

    assert result.returncode == 24
    assert "JHT_LEFT machine" in result.stdout
    assert box.runtime.is_dir() and box.wrapper.is_file()


def test_uninstall_runs_before_every_runtime_check_and_has_no_override() -> None:
    dispatch = SOURCE.index('if [ "$SUB" = "uninstall" ]; then')
    assert dispatch < SOURCE.index("# Il gate informativo precede TUTTI i rami")
    block = SOURCE[SOURCE.index("JHT_UNINSTALL_PROTOCOL=1"):dispatch]
    for override in ("JHT_RUNTIME_DIR", "JHT_BIN_DIR", "JHT_PODMAN_MACHINE", "JHT_COMPOSE_FILE"):
        assert override not in block
    assert "prune" not in block
    assert "launchctl" not in block.replace("Nessun LaunchAgent", "")
    assert shutil.which("bash")


# ── --purge: the data folders ──────────────────────────────────────────────

needs_non_root = pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="root can delete a folder mode 000")


def hide_data_from_the_host(box: Box) -> None:
    """What Docker on Linux leaves: ~/.jht owned by another uid (the container's 1001) and mode 700, so that this
    account can neither list it nor empty it. Mode 000 under a normal account is the same wall."""
    (box.home / ".jht").chmod(0o000)


def restore_if_left(box: Box) -> None:
    for path in (box.home / ".jht",):
        if path.exists():
            path.chmod(0o700)


@pytest.mark.parametrize("args", [("--purge",), ("--purge", "--purge"), ("--confirm", "--purge", "--purge"), ("--confirm", "--purge", "x")])
def test_purge_needs_the_confirmation_and_nothing_else(tmp_path: Path, args: tuple[str, ...]) -> None:
    box = Box(tmp_path, "Linux")
    result = box.run("uninstall", *args)
    assert result.returncode == 2
    assert "--purge" in result.stderr
    assert box.calls() == []
    assert_user_data_kept(box)
    assert box.runtime.is_dir() and box.wrapper.is_file()


@pytest.mark.parametrize("order", [("--confirm", "--purge"), ("--purge", "--confirm")])
def test_purge_on_the_mac_deletes_the_two_folders_directly(tmp_path: Path, order: tuple[str, ...]) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("docker")
    box.machines("colima-default*")
    result = box.run("uninstall", *order)
    assert result.returncode == 0, result.stderr
    assert "uninstall_data" in " ".join(phases(result))
    assert not (box.home / ".jht").exists() and not (box.home / "Documents" / "Job Hunter Team").exists()
    assert (box.home / "Documents").is_dir()  # only the product's folder goes
    assert not [call for call in box.calls() if call.startswith("docker run")]
    assert not box.runtime.exists() and not box.wrapper.exists()


@needs_non_root
def test_purge_empties_a_folder_the_host_cannot_open_through_a_one_shot_container(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    box.select("docker")
    (box.runtime / "runtime-image").write_text("example.invalid/jht@sha256:" + "1" * 64 + "\n", encoding="utf-8")
    hide_data_from_the_host(box)
    try:
        result = box.run("uninstall", "--confirm", "--purge")
    finally:
        restore_if_left(box)
    assert result.returncode == 0, result.stdout + result.stderr
    assert phases(result) == [
        "JHT_PHASE uninstall_machine", "JHT_PHASE uninstall_data",
        "JHT_PHASE uninstall_runtime", "JHT_PHASE uninstall_commands",
    ]
    assert not (box.home / ".jht").exists() and not (box.home / "Documents" / "Job Hunter Team").exists()
    runs = [call for call in box.calls() if call.startswith("docker run")]
    assert len(runs) == 1, runs
    # the pinned image, never a pull, never root, no capability, no network, and the one folder only
    assert "example.invalid/jht@sha256:" + "1" * 64 in runs[0]
    assert "--pull never" in runs[0] and "--user 1001:1001" in runs[0] and "--cap-drop ALL" in runs[0]
    assert "--cap-add" not in runs[0] and "--privileged" not in runs[0] and "--network none" in runs[0]
    assert runs[0].count(" -v ") == 1 and f"-v {box.home}/.jht:/purge" in runs[0]
    # the wrapper did not open the folder for the container: the mode it saw is the one the host had
    assert "mode-seen-by-the-container d---------" in box.calls()
    assert not box.runtime.exists() and not box.wrapper.exists()


@needs_non_root
def test_a_purge_that_cannot_run_keeps_the_wrapper_and_the_runtime_for_the_retry(tmp_path: Path) -> None:
    box = Box(tmp_path, "Linux")
    box.select("docker")
    hide_data_from_the_host(box)
    (box.state / "run-fails").write_text("1", encoding="utf-8")
    try:
        result = box.run("uninstall", "--confirm", "--purge")
        left = (box.home / ".jht").exists()
    finally:
        restore_if_left(box)
    assert result.returncode == 24
    assert "JHT_LEFT data" in result.stdout
    assert left, "the folder cannot have gone"
    assert box.runtime.is_dir() and box.wrapper.is_file(), "no retry would be possible without the command"
    assert "jht uninstall --confirm --purge" in result.stderr


def test_purge_never_follows_a_link_in_place_of_a_data_folder(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("docker")
    box.machines("colima-default*")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "precious.txt").write_text("keep\n", encoding="utf-8")
    shutil.rmtree(box.home / ".jht")
    (box.home / ".jht").symlink_to(elsewhere)
    result = box.run("uninstall", "--confirm", "--purge")
    assert result.returncode == 24
    assert "JHT_LEFT data" in result.stdout
    assert (elsewhere / "precious.txt").read_text(encoding="utf-8") == "keep\n"
    assert box.wrapper.is_file()


def test_purge_refuses_folders_other_than_the_fixed_two(tmp_path: Path) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("docker")
    box.machines("colima-default*")
    other = tmp_path / "other-jht"
    other.mkdir()
    (other / "x").write_text("keep\n", encoding="utf-8")
    result = box.run("uninstall", "--confirm", "--purge", JHT_HOME_HOST=str(other))
    assert result.returncode == 24
    assert (other / "x").exists()
    assert_user_data_kept(box)
    assert box.wrapper.is_file()


def test_the_purge_flag_is_not_known_to_the_desktop_call() -> None:
    """The desktop runs `uninstall --confirm` and nothing else: data is only ever deleted by a person who typed --purge."""
    desktop = (ROOT / "desktop" / "src-tauri" / "src" / "onboarding.rs").read_text(encoding="utf-8")
    assert "--purge" not in desktop


@needs_non_root
@pytest.mark.parametrize("pinned", ["--privileged", "-v/:/host", "-"])
def test_a_pinned_image_that_looks_like_an_option_is_never_handed_to_docker(tmp_path: Path, pinned: str) -> None:
    """The pin is a file next to the runtime: whatever it holds, `docker run` gets the default image or a real reference,
    never a word that docker would read as one of its options."""
    box = Box(tmp_path, "Linux")
    box.select("docker")
    (box.runtime / "runtime-image").write_text(pinned + "\n", encoding="utf-8")
    hide_data_from_the_host(box)
    try:
        result = box.run("uninstall", "--confirm", "--purge")
    finally:
        restore_if_left(box)
    assert result.returncode == 0, result.stdout + result.stderr
    run = next(call for call in box.calls() if call.startswith("docker run"))
    default = re.search(r'^DEFAULT_RUNTIME_IMAGE="([^"]+)"$', SOURCE, re.M).group(1)
    assert f"--entrypoint /bin/sh {default} -c " in run


# ── the texts speak the language of the installation (B4, B5 of the Linux retest) ─────────────────────────────────

ITALIAN_MARKS = ("e' ", "uso:", "Vengono", "restano", "Restano", "rimoss", "Non cancellati", "non valida")


@pytest.mark.parametrize("lang", ["en", "hu", "de", ""])
def test_an_installation_that_is_not_italian_gets_english_from_uninstall(tmp_path: Path, lang: str) -> None:
    box = Box(tmp_path, "Darwin")
    box.select("podman")
    box.machines("jht-podman*")
    result = box.run("uninstall", "--yes", JHT_LANG=lang)
    assert result.returncode == 2
    assert "usage: jht uninstall --confirm [--purge]" in result.stderr
    assert "mail password and Telegram tokens" in result.stderr
    assert not [mark for mark in ITALIAN_MARKS if mark in result.stderr], result.stderr


def test_without_purge_the_folders_are_said_to_stay_and_with_purge_they_are_not(tmp_path: Path) -> None:
    """B4: `--purge` printed «~/.jht e Documenti restano» and, the line after, «con --purge vengono cancellati»."""
    for lang, stays, purge_says in (("it", "~/.jht e Documenti restano", "Con --purge vengono cancellati anche ~/.jht"),
                                    ("en", "~/.jht and Documents stay", "With --purge ~/.jht and ~/Documents/Job Hunter Team are deleted")):
        plain = Box(tmp_path / f"plain-{lang}", "Darwin")
        plain.select("docker")
        plain.machines("colima-default*")
        said = plain.run("uninstall", "--confirm", JHT_LANG=lang)
        assert said.returncode == 0, said.stderr
        assert stays in said.stderr and purge_says not in said.stderr

        purged = Box(tmp_path / f"purge-{lang}", "Darwin")
        purged.select("docker")
        purged.machines("colima-default*")
        said = purged.run("uninstall", "--confirm", "--purge", JHT_LANG=lang)
        assert said.returncode == 0, said.stderr
        assert purge_says in said.stderr
        assert stays not in said.stderr, "the same output says the folders stay and that they are deleted"
        assert "restano" not in said.stderr and " stay" not in said.stderr
        assert LOSS in said.stderr if lang == "it" else "mail password and Telegram tokens" in said.stderr


def test_the_usage_still_tells_both_sides_because_it_says_which_flag_does_what(tmp_path: Path) -> None:
    for lang, stays, purge_says in (("it", "restano", "Con --purge"), ("en", "stay", "With --purge")):
        box = Box(tmp_path / lang, "Darwin")      # a box per language: the first run records its language
        box.select("podman")
        box.machines("jht-podman*")
        said = box.run("uninstall", JHT_LANG=lang).stderr
        assert stays in said and purge_says in said
