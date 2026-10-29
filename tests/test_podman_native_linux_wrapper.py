"""Podman rootless on native Linux: the versions are a MINIMUM, the container keeps the user's uid.

macOS and Windows stay on the exact Podman 6.1.3 / podman-compose 1.6.0 (see
test_podman_compose_exact_version_boundary.py). On native Linux the wrapper accepts podman >= 5.0.0 and
podman-compose >= 1.1.0 (the same minimums as install.sh), and `compose` passes a second file that maps
the host user onto uid 1001 (`keep-id:uid=1001,gid=1001`) so `~/.jht` stays writable.

The production functions are cut out of scripts/jht-wrapper.sh and run in bash with fake `podman` and
`podman-compose`; nothing real is touched.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"

FUNCTIONS = (
    "version_leading_numbers", "version_at_least", "podman_version_number", "podman_compose_version_number",
    "podman_compose_pair_supported", "podman_native_override_path", "podman_native_override_ensure",
    "compose_project_name", "podman_binary", "podman_compose_binary", "podman_native_rootless", "compose_file", "compose_file_run", "attest_cache_clear", "attest_cache_path", "attest_cache_folder_ok",
    "podman_native_no_pod_arg", "podman_expected_config_hash", "runtime_image_pin_value",
)


def _source() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    parts = []
    for name in FUNCTIONS:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        parts.append(match.group(0))
    constants = re.findall(r'^PODMAN_(?:COMPOSE_)?NATIVE_MIN_VERSION="[0-9.]+"$', text, re.M)
    assert len(constants) == 2
    cap = re.search(r"^PODMAN_NATIVE_UP_TIMEOUT=300\ncase .*?^esac\n", text, re.S | re.M)
    assert cap
    constants.append(cap.group(0))
    return "\n".join(constants + parts)


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    log = tmp_path / "compose-argv.txt"

    def tools(podman: str, compose: str):
        (bin_dir / "podman").write_text(
            f'#!/bin/sh\nif [ "$1" = --version ]; then echo "podman version {podman}"; exit 0; fi\n'
            'if [ "$1" = info ]; then echo "true false"; fi\nexit 0\n', encoding="utf-8"
        )
        (bin_dir / "podman-compose").write_text(
            "#!/bin/sh\n"
            f'if [ "$1" = --version ]; then echo "podman-compose version {compose}"; echo "podman version {podman}"; exit 0; fi\n'
            f'printf "%s\\n" "$*" >> "{log}"\nexit 0\n',
            encoding="utf-8",
        )
        for tool in ("podman", "podman-compose"):
            (bin_dir / tool).chmod(0o755)

    base = runtime / "docker-compose.yml"
    base.write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    image: y\n  jht-telegram:\n    image: z\n", encoding="utf-8")

    def run(mode: str, body: str, podman: str = "5.7.0", compose: str = "1.5.0", timeout: float = 60, fakes=None,
            up_cap: str = "3"):
        tools(podman, compose)
        if fakes:
            fakes()
        script = (
            f"set -u\nJHT_PODMAN_UP_TIMEOUT_S={up_cap}\n"
            f'PATH="{bin_dir}:/usr/bin:/bin"\nRUNTIME_DIR="{runtime}"\nRUNTIME_IMAGE_PIN="{runtime}/runtime-image"\n'
            f"PODMAN_RUNTIME_MODE={mode}\nPODMAN_MACHINE_NAME=jht-podman\n"
            "CONTAINER_RUNTIME=podman\nHOST_UID=1000\nPODMAN_NATIVE_REMOTE=0\nerr() { echo \"error: $*\" >&2; }\n" + _source() + "\n" + body
        )
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"},
                              timeout=timeout)

    return type("Box", (), {"run": run, "runtime": runtime, "log": log, "base": base, "bin": bin_dir, "tools": tools})


SUPPORTED = 'podman_compose_pair_supported "$(command -v podman)" "$(command -v podman-compose)" && echo yes || echo no'


@pytest.mark.parametrize(
    ("podman", "compose", "expected"),
    [
        ("5.7.0", "1.5.0", "yes"),   # Ubuntu 26.04 from apt
        ("5.0.0", "1.1.0", "yes"),   # the minimums themselves
        ("5.10.0", "1.12.3", "yes"),  # 10 > 9: numeric, not alphabetical
        ("6.1.3", "1.6.0", "yes"),
        ("4.9.9", "1.5.0", "no"),
        ("5.7.0", "1.0.6", "no"),
        ("5.7.0", "1.0.99", "no"),
        # The same reading as install.sh: the leading numbers count, a suffix after them is dropped.
        ("5.4.2+ds1", "1.5.0", "yes"),    # how Ubuntu and Debian package it
        ("5.7.0", "1.1.0~rc1", "yes"),
        ("5.7.0-dev", "1.5.0", "yes"),
        ("5.7", "1.5.0rc1", "yes"),       # missing components are zero: 5.7.0
        ("4.9.9+ds1", "1.5.0", "no"),
        ("5.7.0", "1.0.99+ds1", "no"),
        ("5..7", "1.5.0", "no"),
        ("dev", "1.5.0", "no"),
    ],
)
def test_native_linux_accepts_the_minimum_and_anything_above(box, podman, compose, expected):
    done = box.run("native", SUPPORTED, podman, compose)
    assert done.stdout.strip() == expected, done.stderr


@pytest.mark.parametrize(("podman", "compose", "expected"), [("6.1.3", "1.6.0", "yes"), ("5.7.0", "1.5.0", "no"), ("6.1.4", "1.6.0", "no"), ("6.1.3", "1.6.1", "no")])
def test_macos_machine_keeps_the_exact_versions(box, podman, compose, expected):
    done = box.run("machine", SUPPORTED, podman, compose)
    assert done.stdout.strip() == expected, done.stderr


def test_the_override_maps_the_host_user_onto_1001_for_every_service_the_file_has(box):
    done = box.run("native", f'podman_native_override_ensure "{box.base}"')
    assert done.returncode == 0, done.stderr
    path = Path(done.stdout.strip())
    assert path == box.runtime / "docker-compose.podman-linux.yml"
    text = path.read_text(encoding="utf-8")
    for service in ("jht", "jht-broker", "jht-telegram"):
        assert re.search(rf'^  {service}:\n    userns_mode: "keep-id:uid=1001,gid=1001"$', text, re.M), service
    assert "network" not in text  # the network is not touched
    assert path.stat().st_mode & 0o077 == 0


def test_the_override_names_only_services_the_compose_has_and_is_rewritten_when_altered(box):
    box.base.write_text("services:\n  jht:\n    image: x\n", encoding="utf-8")
    done = box.run("native", f'podman_native_override_ensure "{box.base}"')
    path = Path(done.stdout.strip())
    assert path.read_text(encoding="utf-8").count("userns_mode") == 1
    path.write_text("services:\n  jht:\n    privileged: true\n", encoding="utf-8")
    box.run("native", f'podman_native_override_ensure "{box.base}"')
    assert "privileged" not in path.read_text(encoding="utf-8")
    path.unlink()
    path.symlink_to(box.runtime / "elsewhere")
    assert box.run("native", f'podman_native_override_ensure "{box.base}"').returncode == 1  # never written through a link


def test_up_on_native_linux_passes_the_base_file_then_the_override(box):
    done = box.run("native", f'compose_file "{box.base}" up -d jht')
    assert done.returncode == 0, done.stderr
    (argv,) = box.log.read_text(encoding="utf-8").splitlines()
    override = box.runtime / "docker-compose.podman-linux.yml"
    assert f"-f {box.base} -f {override} up -d jht" in argv
    assert "--podman-path" in argv and "-p jht" in argv


def test_a_missing_provider_names_the_package_to_install(box):
    done = box.run("native", f'podman_compose_binary() {{ return 1; }}; compose_file "{box.base}" ps -q', podman="5.7.0")
    assert done.returncode != 0
    assert "podman-compose" in done.stderr and "apt install podman-compose" in done.stderr


def test_a_version_below_the_minimum_says_what_was_found_and_what_is_needed(box):
    done = box.run("native", f'compose_file "{box.base}" ps -q', podman="4.9.4", compose="1.0.6")
    assert done.returncode == 1
    assert "podman >= 5.0.0" in done.stderr and "4.9.4" in done.stderr
    assert "podman-compose >= 1.1.0" in done.stderr and "1.0.6" in done.stderr
    assert not box.log.exists()  # nothing was run


def test_the_override_is_written_through_an_unpredictable_name_with_no_leftover(box):
    done = box.run("native", f'podman_native_override_ensure "{box.base}"')
    assert done.returncode == 0, done.stderr
    path = Path(done.stdout.strip())
    assert sorted(p.name for p in box.runtime.iterdir()) == ["docker-compose.podman-linux.yml", "docker-compose.yml"]
    assert path.stat().st_mode & 0o777 == 0o600
    function = re.search(r"^podman_native_override_ensure\(\) \{\n.*?^\}\n", WRAPPER.read_text(encoding="utf-8"), re.S | re.M).group(0)
    assert 'tmp="$(mktemp "$target.XXXXXX")"' in function and "$$" not in function


# ── no pod: podman refuses a per-container userns inside a pod ──
#
# The fake below behaves as podman-compose does with the keep-id override: in a pod every container
# fails with «--userns and --pod cannot be set together», and then (1.3.0 and later) `up -d` waits for
# the never-created dependency forever. Which flag turns the pod off depends on the version:
# 1.1.x reads --in-pod with Python's bool() (any non-empty string is true), from 1.2.0 «false» works
# and an empty value means the default, a pod.

PODLESS_COMPOSE = r"""#!/bin/sh
if [ "$1" = --version ]; then echo "podman-compose version {compose}"; echo "podman version 5.7.0"; exit 0; fi
printf "%s\n" "$*" >> "{log}"
pod=1
for arg in "$@"; do
  case "{compose}:$arg" in
    1.1.*:--in-pod=) pod=0 ;;
    1.1.*:--in-pod=*) pod=1 ;;
    *:--in-pod=false|*:--in-pod=0) pod=0 ;;
  esac
done
case " $* " in
  *" --dry-run "*) echo "podman create --name=jht-telegram --label io.podman.compose.config-hash=$(printf '%064d' 7) x"; echo "podman create --name=jht --label io.podman.compose.config-hash={hash} jht"; exit 0 ;;
  *" up "*)
    if [ "$pod" -eq 1 ]; then
      echo "Error: --userns and --pod cannot be set together" >&2
      echo "Error: no container with name or ID \"jht-telegram\" found: no such container" >&2
      {hang}
    fi
    echo up-done ;;
esac
exit 0
"""

HASH = "a" * 64


def _podless(box, compose: str, hang: str = "while :; do sleep 1; done") -> None:
    box.tools("5.7.0", compose)
    path = box.bin / "podman-compose"
    path.write_text(PODLESS_COMPOSE.replace("{compose}", compose).replace("{log}", str(box.log))
                    .replace("{hash}", HASH).replace("{hang}", hang), encoding="utf-8")
    path.chmod(0o755)
    if not any(Path(d, "timeout").exists() for d in ("/usr/bin", "/bin")):
        # This Mac has no coreutils `timeout`; native Linux (the only place this path runs) always has it.
        fake = box.bin / "timeout"
        fake.write_text(f"""#!{sys.executable}
import os, signal, subprocess, sys
args = sys.argv[1:]
kill_after = float(args.pop(0).split("=", 1)[1]) if args[0].startswith("--kill-after=") else 0
limit = float(args.pop(0))
child = subprocess.Popen(args, start_new_session=True)
try:
    sys.exit(child.wait(timeout=limit))
except subprocess.TimeoutExpired:
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=kill_after)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        sys.exit(137)
    sys.exit(124)
""", encoding="utf-8")
        fake.chmod(0o755)


def run_podless(box, body: str, compose: str, timeout: float = 30, hang: str = "while :; do sleep 1; done"):
    # The cap at 3 s (box.run): a regression that keeps the pod ends in seconds, not at the 300 s default.
    return box.run("native", body, compose=compose, timeout=timeout, fakes=lambda: _podless(box, compose, hang))


@pytest.mark.parametrize(("compose", "flag"), [("1.1.0", "--in-pod="), ("1.1.9", "--in-pod="), ("1.2.0", "--in-pod=false"),
                                               ("1.5.0", "--in-pod=false"), ("1.12.0", "--in-pod=false")])
def test_up_runs_without_a_pod_with_the_flag_each_version_understands(box, compose, flag):
    done = run_podless(box, f'compose_file "{box.base}" up -d', compose)
    assert done.returncode == 0, done.stderr
    assert "up-done" in done.stdout and "cannot be set together" not in done.stderr
    (argv,) = box.log.read_text(encoding="utf-8").splitlines()
    # a global option: before every other argument, so before the subcommand
    assert argv.split(" ")[0] == flag


def test_every_native_call_and_the_attestation_dry_run_see_the_same_choice(box):
    done = run_podless(box, f'compose_file "{box.base}" ps -q && compose_file "{box.base}" down && '
                            f'podman_expected_config_hash "{box.base}" jht', "1.5.0")
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip().splitlines()[-1] == HASH
    calls = box.log.read_text(encoding="utf-8").splitlines()
    assert len(calls) == 3 and all(call.split(" ")[0] == "--in-pod=false" for call in calls), calls
    assert "--dry-run" in calls[2]


def test_a_hung_up_is_stopped_at_the_cap_with_a_code_and_a_message(box):
    # The pod still there (a flag the version reads as «pod»), and the endless wait for the dependency after it.
    body = f'podman_native_no_pod_arg() {{ echo --in-pod=true; }}; compose_file "{box.base}" up -d; echo "exit=$?"'
    started = time.monotonic()
    done = run_podless(box, body, "1.5.0", timeout=40)
    assert time.monotonic() - started < 20
    assert "exit=124" in done.stdout, done.stdout + done.stderr
    assert "cannot be set together" in done.stderr  # what Podman said stays visible
    assert "compose_up_timeout" in done.stderr and "3s" in done.stderr


@pytest.mark.parametrize(("given", "cap"), [("", "300"), ("45", "45"), ("0", "300"), ("3601", "300"), ("12s", "300"),
                                            ("1;id", "300"), ("09", "9")])
def test_the_cap_is_300_seconds_unless_a_valid_value_is_given(box, given, cap):
    done = box.run("native", 'echo "$PODMAN_NATIVE_UP_TIMEOUT"', up_cap=f"'{given}'")
    assert done.stdout.strip() == cap, done.stderr


def test_an_up_that_fails_says_so_and_keeps_its_exit(box):
    body = f'podman_native_no_pod_arg() {{ echo --in-pod=true; }}; compose_file "{box.base}" up -d; echo "exit=$?"'
    done = run_podless(box, body, "1.2.0", hang="exit 7")
    assert "exit=7" in done.stdout, done.stdout + done.stderr
    assert "compose_up_failed" in done.stderr and "7" in done.stderr


# ── the attestation's config-hash: one per project, with the image of `up` ──
#
# podman-compose computes io.podman.compose.config-hash from the merged compose, the same for every
# container of the project; the dry-run of `up --force-recreate jht` creates jht and its dependency
# jht-telegram, so 1.5.0 prints it twice. The compose interpolates ${JHT_IMAGE:-...}: `up` runs with
# the test channel's pin (require_trusted_runtime), and the attestation must hash the same file.

DRY_RUN_COMPOSE = r"""#!/bin/sh
if [ "$1" = --version ]; then echo "podman-compose version 1.5.0"; echo "podman version 5.7.0"; exit 0; fi
printf "%s\n" "${JHT_IMAGE:-unset}" >> "{log}"
hash="$(printf '%s' "${JHT_IMAGE:-default}" | shasum -a 256 2>/dev/null | cut -c1-64)"
[ -n "$hash" ] || hash="$(printf '%s' "${JHT_IMAGE:-default}" | sha256sum | cut -c1-64)"
for line in {lines}; do
  case "$line" in
    same) echo "podman create --name=jht --label io.podman.compose.config-hash=$hash jht" ;;
    other) echo "podman create --name=jht-telegram --label io.podman.compose.config-hash={other} x" ;;
    differ) echo "podman create --name=jht --label io.podman.compose.config-hash={other} jht" ;;
  esac
done
exit 0
"""

PIN = "ghcr.io/leopu00/jht@sha256:" + "c" * 64


def _image_hash(image: str) -> str:
    import hashlib
    return hashlib.sha256(image.encode()).hexdigest()


def config_hash(box, lines: str, pin: str | None = None):
    def fakes():
        path = box.bin / "podman-compose"
        path.write_text(DRY_RUN_COMPOSE.replace("{log}", str(box.log)).replace("{lines}", lines)
                        .replace("{other}", "b" * 64), encoding="utf-8")
        path.chmod(0o755)
        if pin is not None:
            (box.runtime / "runtime-image").write_text(pin + "\n", encoding="utf-8")
    return box.run("native", f'podman_expected_config_hash "{box.base}" jht', fakes=fakes)


def test_the_same_hash_printed_for_a_service_and_its_dependency_is_one_hash(box):
    done = config_hash(box, "same same")
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == _image_hash("default")


def test_the_dependency_has_its_own_hash_and_it_is_not_the_services(box):
    # podman-compose 1.6.0 hashes each service's own configuration: the dry-run of jht prints the
    # create of jht-telegram (another hash) and then the create of jht; the label of jht's container
    # is the second one
    done = config_hash(box, "other same")
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == _image_hash("default")
    done = config_hash(box, "same other")
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == _image_hash("default")


def test_two_different_hashes_for_the_service_are_refused(box):
    done = config_hash(box, "same differ")
    assert done.returncode == 1 and done.stdout.strip() == ""


def test_a_plan_without_the_create_of_the_service_is_refused(box):
    # a dependency's hash is never taken for the service's
    done = config_hash(box, "other")
    assert done.returncode == 1 and done.stdout.strip() == ""


def test_the_attestation_hashes_the_compose_with_the_test_channels_image(box):
    done = config_hash(box, "same same", pin=PIN)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == _image_hash(PIN)  # the hash `up` wrote, not the compose default's
    assert box.log.read_text(encoding="utf-8").splitlines() == [PIN]
    # an invalid pin is never replaced by the default: the attestation refuses
    done = config_hash(box, "same", pin="ghcr.io/someone/else:latest")
    assert done.returncode == 1 and done.stdout.strip() == ""
