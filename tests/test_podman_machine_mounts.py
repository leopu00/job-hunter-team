"""The JHT Podman machine on macOS sees only ~/.jht and ~/Documents/Job Hunter Team.

Without --volume, `podman machine init` on macOS mounts /Users (every user's
home), /private, /var/folders and ~/.config/containers into the VM (measured
on 08/10/2026, Podman 6.1.3): the VM, and a container with a wrong bind,
would see the whole Mac. Live check on an Apple Silicon Mac with a throwaway
machine created with the two --volume flags: inside the VM /Users and
/var/folders do not exist, a container bind outside the two folders fails
with `statfs ...: no such file or directory`, and a declared folder that does
not exist keeps the machine from booting.

Here, against the real wrapper and installer with fake binaries:
- a machine whose config mounts anything else is refused by `up`, `status`
  and every container command (exit 78, before anything starts), and an
  unreadable config is refused too;
- `up` creates the two folders before starting the machine;
- `podman-machine-recreate` does nothing without --confirm, and with it
  rebuilds the machine with exactly the two folders, preserves the broker
  state byte-for-byte, drops its secrets, and restores the person's default
  Podman connection;
- the installer creates a new machine with exactly the two folders.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess

import pytest

from podman_machine_fixture import MACOS_DEFAULT_SOURCES, jht_mount_sources, write_machine_config
from test_desktop_chat_wrapper import _runtime

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the wrapper is a POSIX script")

RICH_PODMAN = """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\\n' 'podman version 6.1.3'; exit 0; fi
printf 'podman %s\\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
if [ "$1:$2:$3" = --connection:jht-podman:volume ]; then
  case "$4" in
    ls)
      [ -f "$JHT_TEST_BROKER_STATE_PRESENT" ] && printf '%s\\n' jht_jht-broker-state
      exit 0 ;;
    export)
      [ "$5" = jht_jht-broker-state ] || exit 96
      cat "$JHT_TEST_BROKER_STATE"
      exit 0 ;;
    create)
      for last; do :; done
      [ "$last" = jht_jht-broker-state ] || exit 97
      : > "$JHT_TEST_BROKER_STATE"
      : > "$JHT_TEST_BROKER_STATE_PRESENT"
      printf '%s\\n' "$last"
      exit 0 ;;
    import)
      [ "$5:$6" = jht_jht-broker-state:- ] || exit 98
      cat > "$JHT_TEST_BROKER_STATE"
      exit 0 ;;
  esac
fi
if [ "$1:$2:$3" = --connection:jht-podman:pull ]; then exit 0; fi
if [ "$1:$2:$3" = --connection:jht-podman:run ]; then
  case "$*" in
    *"jht_jht-broker-state:/jht_broker_state:ro"*) cat "$JHT_TEST_BROKER_STATE" ;;
    *"jht_jht-broker-state:/jht_broker_state"*) cat > "$JHT_TEST_BROKER_STATE" ;;
    *) exit 99 ;;
  esac
  exit 0
fi
case "$1:$2" in
  machine:start)
    [ "${JHT_TEST_WAKE_SUCCESS:-0}" = 1 ] || exit 93
    for dir in "$HOME/.jht" "$HOME/Documents/Job Hunter Team"; do
      [ -d "$dir" ] || { printf 'missing %s\\n' "$dir" >> "$JHT_TEST_DOCKER_LOG"; exit 125; }
    done
    : > "$JHT_TEST_RUNTIME_STATE"; exit 0 ;;
  machine:stop) exit 0 ;;
  machine:rm)
    rm -f "$JHT_TEST_MACHINE_CONFIG" "$JHT_TEST_BROKER_STATE_PRESENT"
    : > "$JHT_TEST_BROKER_STATE"
    : > "$JHT_TEST_BROKER_SECRETS"
    exit 0 ;;
  machine:init)
    shift 2
    mounts=""
    while [ $# -gt 1 ]; do
      case "$1" in
        --volume) source="${2%%:*}"; mounts="$mounts{\\"Source\\":\\"$source\\",\\"Target\\":\\"$source\\"},"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf '{"Mounts":[%s],"Name":"%s"}' "${mounts%,}" "$1" > "$JHT_TEST_MACHINE_CONFIG"
    : > "$JHT_TEST_RUNTIME_STATE"; exit 0 ;;
  system:connection)
    case "$3" in
      list) printf '%s\\n' "$(cat "$JHT_TEST_DEFAULT_CONNECTION") true" "jht-podman false" ;;
      default) printf '%s\\n' "$4" > "$JHT_TEST_DEFAULT_CONNECTION" ;;
    esac
    exit 0 ;;
esac
if [ "$1:$2:$3" = --connection:jht-podman:info ]; then
  [ "${JHT_TEST_RUNTIME_READY:-0}" = 1 ] || [ -f "$JHT_TEST_RUNTIME_STATE" ]
  exit $?
fi
exit 93
"""


def _wrapper(tmp_path: Path, sources: tuple[str, ...] | None = None):
    wrapper, env, log = _runtime(tmp_path)
    home = Path(env["HOME"])
    config = write_machine_config(home, env, sources=sources)
    podman = wrapper.parent / "podman"
    podman.write_text(RICH_PODMAN, encoding="utf-8")
    podman.chmod(0o700)
    provider = wrapper.parent / "podman-compose"
    provider_source = provider.read_text(encoding="utf-8")
    provider_source = provider_source.replace(
        'case "$*" in\n',
        'case "$*" in\n  *" config --images") printf \'%s\\n\' test-broker-image ;;\n',
    )
    provider.write_text(
        provider_source.replace('  *" up -d")', '  *" down") exit 0 ;;\n  *" up -d")'),
        encoding="utf-8",
    )
    state = tmp_path / "broker-state.volume"
    state.write_text(
        '{"policy":"allowlist","allowed_domains":["alerts.invalid"],'
        '"authorisations":["approved-1"],"journal":["sent-1"],"drafts":["draft-1"]}\n',
        encoding="utf-8",
    )
    state_present = tmp_path / "broker-state.present"
    state_present.write_text("", encoding="utf-8")
    secrets = tmp_path / "broker-secrets.volume"
    secrets.write_text("mail-password-and-linkedin-session\n", encoding="utf-8")
    default = tmp_path / "default-connection"
    default.write_text("hht-podman\n", encoding="utf-8")
    env["JHT_TEST_MACHINE_CONFIG"] = str(config)
    env["JHT_TEST_DEFAULT_CONNECTION"] = str(default)
    env["JHT_TEST_BROKER_STATE"] = str(state)
    env["JHT_TEST_BROKER_STATE_PRESENT"] = str(state_present)
    env["JHT_TEST_BROKER_SECRETS"] = str(secrets)
    return wrapper, env, log, home, config


def _run(wrapper: Path, env: dict[str, str], *argv: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([str(wrapper), *argv], env=env, text=True, capture_output=True, timeout=20, check=False)


def _calls(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


@pytest.mark.parametrize("argv", [("up",), ("status",), ("providers", "current"), ("team", "start")])
def test_a_machine_that_sees_the_whole_mac_is_refused_before_anything_runs(tmp_path: Path, argv):
    wrapper, env, log, home, _ = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_WAKE_SUCCESS"] = "1"

    result = _run(wrapper, env, *argv)

    assert result.returncode == 78, result.stderr
    assert "vede piu' cartelle del Mac" in result.stderr
    assert "jht podman-machine-recreate --confirm" in result.stderr
    calls = _calls(log)
    assert not any("machine start" in line for line in calls)
    assert not any(line.startswith(("docker exec", "podman-compose")) for line in calls)


@pytest.mark.parametrize(
    "extra",
    [
        "/Users",
        # One extra folder next to the two allowed ones is enough to refuse.
        "{home}/Desktop",
        # A parent of an allowed folder sees everything below it.
        "{home}",
    ],
)
def test_any_folder_beyond_the_two_is_refused(tmp_path: Path, extra: str):
    wrapper, env, log, home, _ = _wrapper(tmp_path)
    write_machine_config(home, env, sources=(*jht_mount_sources(home), extra.format(home=home)))

    result = _run(wrapper, env, "status")

    assert result.returncode == 78, result.stderr


@pytest.mark.parametrize(
    "config_text",
    [
        None,  # no config file at all
        '{"Name":"jht-podman"}',  # no Mounts key
        '{"Mounts":[{"Source":"/Users/a\\\\"b","Target":"/x"}],"Name":"jht-podman"}',  # unreadable Source
    ],
)
def test_an_unverifiable_machine_is_refused_too(tmp_path: Path, config_text):
    wrapper, env, log, home, config = _wrapper(tmp_path)
    if config_text is None:
        config.unlink()
    else:
        config.write_text(config_text, encoding="utf-8")
    env["JHT_TEST_WAKE_SUCCESS"] = "1"

    result = _run(wrapper, env, "up")

    assert result.returncode == 1, result.stderr
    assert "Non riesco a verificare quali cartelle" in result.stderr
    assert not any("machine start" in line for line in _calls(log))


def test_a_confined_machine_is_used_and_up_creates_both_folders_before_starting(tmp_path: Path):
    wrapper, env, log, home, _ = _wrapper(tmp_path)
    env["JHT_TEST_WAKE_SUCCESS"] = "1"
    assert not (home / ".jht").exists()

    result = _run(wrapper, env, "up")

    calls = _calls(log)
    assert any(line.startswith("podman machine start --update-connection=false jht-podman") for line in calls), calls
    assert not any(line.startswith("missing ") for line in calls), calls
    assert (home / ".jht").is_dir() and (home / "Documents" / "Job Hunter Team").is_dir()
    assert oct((home / ".jht").stat().st_mode & 0o777) == "0o700"
    assert result.returncode != 78


def test_an_empty_mount_list_is_confined(tmp_path: Path):
    wrapper, env, log, home, _ = _wrapper(tmp_path, sources=())
    env["JHT_TEST_RUNTIME_READY"] = "1"

    result = _run(wrapper, env, "status")

    assert result.returncode != 78, result.stderr
    assert "cartelle del Mac" not in result.stderr


def test_recreate_without_confirmation_touches_nothing(tmp_path: Path):
    wrapper, env, log, home, config = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)

    result = _run(wrapper, env, "podman-machine-recreate")

    assert result.returncode == 2
    assert "jht podman-machine-recreate --confirm" in result.stderr
    assert "La configurazione e lo stato della posta restano" in result.stderr
    assert "reinserire la password della posta" in result.stderr
    assert "rifare il login LinkedIn" in result.stderr
    assert not any(line.startswith("podman machine") for line in _calls(log))
    assert config.is_file()


def test_recreate_rebuilds_the_machine_with_only_the_two_folders_and_keeps_the_default(tmp_path: Path):
    wrapper, env, log, home, config = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    marker = Path(env["JHT_RUNTIME_DIR"]) / ".broker-legacy-migrated"
    marker.write_text("", encoding="utf-8")
    state_before = Path(env["JHT_TEST_BROKER_STATE"]).read_bytes()

    result = _run(wrapper, env, "podman-machine-recreate", "--confirm")

    assert result.returncode == 0, result.stderr
    calls = [line for line in _calls(log) if line.startswith("podman machine")]
    jht_home, jht_docs = jht_mount_sources(home)
    assert calls == [
        "podman machine stop jht-podman",
        "podman machine rm -f jht-podman",
        f"podman machine init --now --update-connection=false --volume {jht_home}:{jht_home} "
        f"--volume {jht_docs}:{jht_docs} jht-podman",
    ]
    assert [m["Source"] for m in json.loads(config.read_text(encoding="utf-8"))["Mounts"]] == [jht_home, jht_docs]
    all_calls = _calls(log)
    export = next(i for i, line in enumerate(all_calls) if "jht_jht-broker-state:/jht_broker_state:ro" in line)
    remove = all_calls.index("podman machine rm -f jht-podman")
    create = next(i for i, line in enumerate(all_calls) if "volume create" in line and "jht_jht-broker-state" in line)
    imported = next(
        i for i, line in enumerate(all_calls)
        if "jht_jht-broker-state:/jht_broker_state" in line and ":ro" not in line
    )
    assert export < remove < create < imported
    assert not any("jht-secrets:" in line for line in all_calls)
    # The person's default connection (another project's machine) is put back.
    assert (tmp_path / "default-connection").read_text(encoding="utf-8").strip() == "hht-podman"
    assert "podman system connection default hht-podman" in _calls(log)
    assert not marker.exists()
    assert Path(env["JHT_TEST_BROKER_STATE"]).read_bytes() == state_before
    assert Path(env["JHT_TEST_BROKER_SECRETS"]).read_bytes() == b""
    assert not list(Path(env["JHT_RUNTIME_DIR"]).glob(".broker-state-recreate.*"))
    assert "Lo stato del broker e' stato conservato" in result.stderr
    assert "reinserisci la password della posta" in result.stderr
    assert "rifai il login LinkedIn" in result.stderr
    assert _run(wrapper, env, "status").returncode != 78


def test_recreate_starts_a_stopped_machine_before_exporting_state(tmp_path: Path):
    wrapper, env, log, _, _ = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_WAKE_SUCCESS"] = "1"
    state_before = Path(env["JHT_TEST_BROKER_STATE"]).read_bytes()

    result = _run(wrapper, env, "podman-machine-recreate", "--confirm")

    assert result.returncode == 0, result.stderr
    calls = _calls(log)
    start = calls.index("podman machine start --update-connection=false jht-podman")
    export = next(i for i, line in enumerate(calls) if "jht_jht-broker-state:/jht_broker_state:ro" in line)
    remove = calls.index("podman machine rm -f jht-podman")
    assert start < export < remove
    assert Path(env["JHT_TEST_BROKER_STATE"]).read_bytes() == state_before


def test_recreate_refuses_a_changed_state_archive_before_import_and_cleans_it(tmp_path: Path):
    wrapper, env, log, _, _ = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    counter = tmp_path / "state-hash-count"
    fake_hash = wrapper.parent / "sha256sum"
    fake_hash.write_text(
        """#!/bin/sh
case "$1" in
  */.broker-state-recreate.*/state.tar)
    count=$(cat "$JHT_TEST_STATE_HASH_COUNT" 2>/dev/null || echo 0)
    count=$((count + 1))
    printf '%s\\n' "$count" > "$JHT_TEST_STATE_HASH_COUNT"
    if [ "$count" -gt 1 ]; then
      printf '%064d  %s\\n' 0 "$1"
      exit 0
    fi ;;
esac
exec /usr/bin/shasum -a 256 "$1"
""",
        encoding="utf-8",
    )
    fake_hash.chmod(0o700)
    env["JHT_TEST_STATE_HASH_COUNT"] = str(counter)

    result = _run(wrapper, env, "podman-machine-recreate", "--confirm")

    assert result.returncode == 1
    calls = _calls(log)
    assert "podman --connection jht-podman volume create --label io.podman.compose.project=jht " \
        "--label com.docker.compose.project=jht jht_jht-broker-state" not in calls
    assert not any(
        "jht_jht-broker-state:/jht_broker_state" in line and ":ro" not in line
        for line in calls
    )
    assert "non ha superato la verifica/importazione" in result.stderr
    assert not list(Path(env["JHT_RUNTIME_DIR"]).glob(".broker-state-recreate.*"))


def test_the_installer_creates_a_machine_with_only_the_two_folders(tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    fakes = {
        "brew": "exit 0",
        "podman": (
            'printf "podman %s\\n" "$*" >> "$LOG"\n'
            'case "$1" in --version) echo "podman version 6.1.3"; exit 0 ;; esac\n'
            'case "$1:$2" in machine:inspect) exit 125 ;; machine:init) exit 0 ;; esac\n'
            'exit 0'
        ),
        "podman-compose": 'echo "podman-compose version 1.6.0"',
    }
    for name, body in fakes.items():
        path = bin_dir / name
        path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
        path.chmod(0o700)
    env = {
        "HOME": str(home),
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "LOG": str(log),
        "JHT_INSTALLER_SOURCE_ONLY": "1",
    }
    script = f'. "{INSTALLER}"; DRY_RUN=0; PODMAN_MACHINE_NAME=jht-podman; install_podman_macos'

    result = subprocess.run(["bash", "-c", script], env=env, text=True, capture_output=True, timeout=30, check=False)

    assert result.returncode == 0, result.stdout + result.stderr
    init = [line for line in log.read_text(encoding="utf-8").splitlines() if line.startswith("podman machine init")]
    jht_home, jht_docs = jht_mount_sources(home)
    assert init == [
        f"podman machine init --now --update-connection=false --volume {jht_home}:{jht_home} "
        f"--volume {jht_docs}:{jht_docs} jht-podman"
    ]
    assert (home / ".jht").is_dir() and (home / "Documents" / "Job Hunter Team").is_dir()


def test_upgrade_refuses_a_machine_that_sees_the_whole_mac_in_its_own_json(tmp_path: Path):
    wrapper, env, log, home, _ = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    result = _run(wrapper, env, "upgrade", "--json")

    assert result.returncode == 78, result.stderr
    answer = json.loads(result.stdout.strip().splitlines()[-1])
    assert answer["ok"] is False
    assert "podman-machine-recreate --confirm" in answer["message"]
    assert not any(line.startswith(("docker exec", "podman-compose")) for line in _calls(log))


def test_probes_do_not_use_a_machine_that_sees_the_whole_mac(tmp_path: Path):
    wrapper, env, log, home, _ = _wrapper(tmp_path, sources=MACOS_DEFAULT_SOURCES)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    snapshot = _run(wrapper, env, "onboarding-snapshot")

    assert "containerRunning=0" in snapshot.stdout
    assert not any(line.startswith("docker exec") for line in _calls(log))
