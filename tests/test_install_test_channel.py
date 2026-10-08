"""Test channel of install.sh and of the host wrapper.

A desktop test build installs one commit's files and one image digest:
`install.sh --source-sha <40 hex> --image <ref> --expected-image-digest
sha256:<64>`. The installer refuses an image whose RepoDigests do not carry
the digest, pins the canonical ref in the host runtime under the integrity
manifest, and every later `jht` runs exactly that image with no environment
variable. A production install drops the pin.
"""

import hashlib
import os
import shlex
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SHA = "b" * 40
DIGEST = "sha256:" + "a" * 64
OTHER_DIGEST = "sha256:" + "c" * 64
PINNED = f"ghcr.io/leopu00/jht@{DIGEST}"
TAG = "ghcr.io/leopu00/jht:master-arthur"
RAW = f"https://raw.githubusercontent.com/leopu00/job-hunter-team/{SHA}"


def _fake_bin(tmp_path: Path, repo_digests: str, *, pull_ok: bool = True) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    curl = fake_bin / "curl"
    # Serves the files of this checkout as if they were raw/<SHA>/<path>.
    curl.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "out=''; url=''\n"
        'while [ $# -gt 0 ]; do\n'
        '  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac\n'
        "done\n"
        'printf \'%s\\n\' "$url" >> "$JHT_TEST_CURL_LOG"\n'
        f'case "$url" in {RAW}/*) ;; *) exit 22 ;; esac\n'
        f'src="$JHT_TEST_REPO/${{url#{RAW}/}}"\n'
        '[ -f "$src" ] || exit 22\n'
        'if [ -n "$out" ]; then cat "$src" > "$out"; else cat "$src"; fi\n',
        encoding="utf-8",
    )
    curl.chmod(0o755)
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        'printf \'JHT_IMAGE=%s %s\\n\' "${JHT_IMAGE:-}" "$*" >> "$JHT_TEST_DOCKER_LOG"\n'
        'case "$1" in\n'
        f"  pull) exit {0 if pull_ok else 1} ;;\n"
        f"  image) printf '%s' {shlex.quote(repo_digests)} ;;\n"
        "esac\n"
        'case " $* " in\n'
        '  *" ps -q jht "*) printf \'aaaaaaaaaaaa\\n\' ;;\n'
        '  " inspect --type container aaaaaaaaaaaa "*) printf \'true jht\\n\' ;;\n'
        "esac\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return fake_bin


def _env(tmp_path: Path, fake_bin: Path) -> dict[str, str]:
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    runtime = (tmp_path / "rt").resolve()
    return {
        **{k: v for k, v in os.environ.items() if not k.startswith("JHT_")},
        "HOME": str(home),
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_BIN_DIR": str((tmp_path / "wbin").resolve()),
        "JHT_TEST_REPO": str(ROOT),
        "JHT_TEST_CURL_LOG": str(tmp_path / "curl.log"),
        "JHT_TEST_DOCKER_LOG": str(tmp_path / "docker.log"),
    }


def _install(env: dict[str, str], *args: str) -> subprocess.CompletedProcess:
    # Only the steps of the test channel on a VPS (Linux): the image check,
    # then publication.
    script = (
        f"JHT_INSTALLER_SOURCE_ONLY=1 . {shlex.quote(str(INSTALLER))} {' '.join(map(shlex.quote, args))}\n"
        'OS=linux; DOCKER_CLI="$(command -v docker)"\n'
        "verify_test_image\n"
        "download_runtime_files\n"
    )
    return subprocess.run(
        ["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30
    )


def _channel(image: str = TAG, digest: str = DIGEST) -> list[str]:
    return ["--source-sha", SHA, "--image", image, "--expected-image-digest", digest]


@pytest.mark.parametrize(
    "args",
    [
        ["--source-sha", SHA],
        ["--source-sha", SHA, "--image", TAG],
        _channel()[:2] + ["--image", TAG, "--expected-image-digest", "sha256:short"],
        ["--source-sha", "B" * 40, "--image", TAG, "--expected-image-digest", DIGEST],
        _channel(image=f"ghcr.io/leopu00/jht@{OTHER_DIGEST}"),
        _channel(image="ghcr.io/someone/jht:master-arthur"),
        _channel(image="ghcr.io/leopu00/jht:bad tag"),
        _channel() + ["--no-docker"],
    ],
)
def test_partial_or_malformed_channel_is_refused_before_any_io(tmp_path, args):
    fake_bin = _fake_bin(tmp_path, f"{PINNED}\n")
    env = _env(tmp_path, fake_bin)

    result = subprocess.run(
        ["bash", str(INSTALLER), *args],
        env=env, capture_output=True, text=True, timeout=30,
    )

    assert result.returncode == 2, result.stdout + result.stderr
    assert not (tmp_path / "curl.log").exists()
    assert not (tmp_path / "docker.log").exists()
    assert not Path(env["JHT_RUNTIME_DIR"]).exists()


def test_image_without_the_expected_digest_publishes_nothing(tmp_path):
    fake_bin = _fake_bin(tmp_path, f"ghcr.io/leopu00/jht@{OTHER_DIGEST}\n")
    env = _env(tmp_path, fake_bin)

    result = _install(env, *_channel())

    assert result.returncode != 0
    assert "nothing was installed" in result.stderr
    assert not Path(env["JHT_RUNTIME_DIR"]).exists()
    assert not (tmp_path / "curl.log").exists()


def test_channel_installs_the_commit_files_and_pins_the_digest(tmp_path):
    fake_bin = _fake_bin(tmp_path, f"ghcr.io/other/x@{OTHER_DIGEST}\n{PINNED}\n")
    env = {**_env(tmp_path, fake_bin), "JHT_RAW_BASE": "https://example.invalid/elsewhere"}

    result = _install(env, *_channel())

    assert result.returncode == 0, result.stdout + result.stderr
    urls = (tmp_path / "curl.log").read_text(encoding="utf-8").split()
    assert urls and all(u.startswith(RAW + "/") for u in urls), urls
    assert not any("api.github.com" in u for u in urls)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    pin = runtime / "runtime-image"
    assert pin.read_text(encoding="utf-8") == PINNED + "\n"
    assert pin.stat().st_mode & 0o777 == 0o600
    manifest = (runtime / ".runtime-integrity").read_text(encoding="utf-8")
    assert f"runtime-image={hashlib.sha256(pin.read_bytes()).hexdigest()}" in manifest.splitlines()
    docker_log = (tmp_path / "docker.log").read_text(encoding="utf-8")
    assert f"pull {TAG}" in docker_log


def _nothing_published(env: dict[str, str]) -> None:
    runtime = Path(env["JHT_RUNTIME_DIR"])
    for name in ("docker-compose.yml", "host-setup.sh", ".runtime-integrity", "runtime-image"):
        assert not (runtime / name).exists(), name
    assert not (Path(env["JHT_BIN_DIR"]) / "jht").exists()


def test_a_commit_that_does_not_exist_publishes_nothing(tmp_path):
    # raw.githubusercontent.com answers 404 for a commit nobody pushed: the
    # install stops at the first download, with no runtime half published.
    fake_bin = _fake_bin(tmp_path, f"{PINNED}\n")
    env = _env(tmp_path, fake_bin)
    missing = "c" * 40

    result = _install(env, "--source-sha", missing, "--image", TAG, "--expected-image-digest", DIGEST)

    assert result.returncode != 0
    urls = (tmp_path / "curl.log").read_text(encoding="utf-8").split()
    assert urls and all(f"/{missing}/" in url for url in urls), urls
    _nothing_published(env)


def test_network_down_at_the_image_pull_publishes_nothing(tmp_path):
    fake_bin = _fake_bin(tmp_path, f"{PINNED}\n", pull_ok=False)
    env = _env(tmp_path, fake_bin)

    result = _install(env, *_channel())

    assert result.returncode != 0
    assert "Cannot pull the test image" in result.stderr
    assert not (tmp_path / "curl.log").exists()
    _nothing_published(env)


def _installed(tmp_path: Path) -> tuple[dict[str, str], Path]:
    fake_bin = _fake_bin(tmp_path, f"{PINNED}\n")
    env = _env(tmp_path, fake_bin)
    result = _install(env, *_channel())
    assert result.returncode == 0, result.stdout + result.stderr
    (tmp_path / "docker.log").unlink()
    wrapper = Path(env["JHT_BIN_DIR"]) / "jht"
    return env, wrapper


def _run_wrapper(env: dict[str, str], wrapper: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(wrapper), *args],
        env={**env, "JHT_WRAPPER_PATH": str(wrapper)},
        capture_output=True, text=True, timeout=30,
    )


@pytest.mark.parametrize("shell_override", [None, "ghcr.io/leopu00/jht:latest"])
def test_installed_wrapper_runs_the_pinned_image_without_environment(tmp_path, shell_override):
    env, wrapper = _installed(tmp_path)
    # Even an explicit override from the shell loses against the pin.
    if shell_override:
        env["JHT_IMAGE"] = shell_override

    _run_wrapper(env, wrapper, "up")

    compose_calls = [
        line for line in (tmp_path / "docker.log").read_text(encoding="utf-8").splitlines()
        if " compose " in f" {line} "
    ]
    assert compose_calls
    assert all(line.startswith(f"JHT_IMAGE={PINNED} ") for line in compose_calls), compose_calls


@pytest.mark.parametrize("tamper", ["content", "removed", "symlink", "noncanonical"])
def test_tampered_pin_stops_before_docker(tmp_path, tamper):
    env, wrapper = _installed(tmp_path)
    pin = Path(env["JHT_RUNTIME_DIR"]) / "runtime-image"
    if tamper == "content":
        pin.write_text(f"ghcr.io/leopu00/jht@{OTHER_DIGEST}\n", encoding="utf-8")
    elif tamper == "noncanonical":
        # Even with a matching manifest only the canonical by-digest ref passes.
        pin.write_text("ghcr.io/someone/jht:latest\n", encoding="utf-8")
        manifest = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-integrity"
        lines = [
            line for line in manifest.read_text(encoding="utf-8").splitlines()
            if not line.startswith("runtime-image=")
        ]
        lines.append(f"runtime-image={hashlib.sha256(pin.read_bytes()).hexdigest()}")
        manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    elif tamper == "removed":
        pin.unlink()
    else:
        target = tmp_path / "elsewhere"
        target.write_text(pin.read_text(encoding="utf-8"), encoding="utf-8")
        pin.unlink()
        pin.symlink_to(target)

    result = _run_wrapper(env, wrapper, "up")

    assert result.returncode != 0
    log = tmp_path / "docker.log"
    assert not log.exists() or " compose " not in log.read_text(encoding="utf-8")


def test_upgrade_refuses_a_test_channel_install(tmp_path):
    env, wrapper = _installed(tmp_path)

    result = _run_wrapper(env, wrapper, "upgrade", "--json")

    assert result.returncode != 0
    assert "canale di test" in result.stdout + result.stderr


def test_production_install_drops_an_earlier_pin(tmp_path):
    env, _ = _installed(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    assert (runtime / "runtime-image").exists()

    prod = {**env, "JHT_RAW_BASE": RAW}
    result = _install(prod)

    assert result.returncode == 0, result.stdout + result.stderr
    assert not (runtime / "runtime-image").exists()
    assert "runtime-image=" not in (runtime / ".runtime-integrity").read_text(encoding="utf-8")


def test_image_is_verified_before_anything_is_published():
    source = INSTALLER.read_text(encoding="utf-8")
    main = source[source.index("main_docker() {") : source.index("main_native() {")]

    assert main.index("verify_docker_works") < main.index("verify_test_image")
    assert main.index("verify_test_image") < main.index("download_runtime_files")
