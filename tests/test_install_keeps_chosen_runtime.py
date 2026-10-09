"""A re-run of install.sh never changes the runtime already chosen.

The marker container-runtime says which engine holds the container and its
volumes on a Mac. A re-run without --runtime used to rewrite it to docker:
a Podman install went back to Colima, where its volumes are empty. Now the
marker wins, and an explicit --runtime for the other engine is refused with
an error that says what would stay behind (nothing moves the volumes yet).
"""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INSTALL = ROOT / "scripts" / "install.sh"


def keep(tmp_path: Path, marker: str | None, *args: str, os_name: str = "macos",
         link: bool = False) -> subprocess.CompletedProcess:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    if marker is not None:
        target = runtime / "container-runtime"
        if link:
            real = tmp_path / "elsewhere"
            real.write_text(marker + "\n", encoding="utf-8")
            target.symlink_to(real)
        else:
            target.write_text(marker + "\n", encoding="utf-8")
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}" "$@"\n'
        f"OS={os_name}\n"
        "keep_chosen_runtime\n"
        'printf "choice=%s\\n" "$RUNTIME_CHOICE"\n'
    )
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return subprocess.run(
        ["bash", "-c", script, "install.sh", *args],
        env={"PATH": "/usr/bin:/bin", "HOME": str(home), "JHT_RUNTIME_DIR": str(runtime)},
        capture_output=True, text=True, timeout=30,
    )


def choice(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0, result.stderr
    return re.search(r"^choice=(.*)$", result.stdout, re.M).group(1)


def test_a_podman_mac_rerun_without_runtime_stays_podman(tmp_path):
    assert choice(keep(tmp_path, "podman")) == "podman"


@pytest.mark.parametrize("marker", ["docker", None])
def test_a_docker_mac_or_a_new_mac_keeps_the_default(tmp_path, marker):
    assert choice(keep(tmp_path, marker)) == ""


@pytest.mark.parametrize("marker,args", [
    ("podman", ("--runtime", "podman")),
    ("docker", ("--runtime", "colima")),
    ("docker", ("--runtime=docker-desktop",)),
])
def test_the_same_engine_asked_explicitly_goes_on(tmp_path, marker, args):
    assert choice(keep(tmp_path, marker, *args)) == args[-1].split("=")[-1]


@pytest.mark.parametrize("marker,args,wanted", [
    ("podman", ("--runtime", "colima"), "docker"),
    ("podman", ("--runtime=docker-desktop",), "docker"),
    ("docker", ("--runtime", "podman"), "podman"),
])
def test_switching_engine_is_refused_with_what_would_stay_behind(tmp_path, marker, args, wanted):
    result = keep(tmp_path, marker, *args)
    assert result.returncode == 1
    assert "choice=" not in result.stdout
    assert "runtime_change_requires_migration" in result.stderr
    assert f"runs JHT on {marker}" in result.stderr and f"start it on {wanted}" in result.stderr
    assert "jht-deps" in result.stderr and f"without --runtime to keep {marker}" in result.stderr
    assert (tmp_path / "runtime" / "container-runtime").read_text(encoding="utf-8") == marker + "\n"


def test_linux_keeps_ignoring_the_runtime_choice(tmp_path):
    assert choice(keep(tmp_path, "podman", os_name="linux")) == ""


def test_an_unsafe_or_unknown_marker_stops_the_installer(tmp_path):
    linked = keep(tmp_path, "podman", link=True)
    assert linked.returncode == 1 and "Unsafe JHT runtime selection marker" in linked.stderr
    other = tmp_path / "other"
    other.mkdir()
    unknown = keep(other, "colima")
    assert unknown.returncode == 1 and "Invalid JHT runtime selection marker" in unknown.stderr


def test_main_settles_the_runtime_before_anything_is_installed():
    text = INSTALL.read_text(encoding="utf-8")
    main = re.search(r"^main\(\) \{\n.*?^\}\n", text, re.S | re.M).group(0)
    assert main.index("keep_chosen_runtime") < main.index("header")
    assert main.index("keep_chosen_runtime") < main.index("main_docker")
    # The marker block then publishes podman for a kept podman choice.
    block = text[text.index('local selection_source="$RUNTIME_DIR/container-runtime"'):]
    assert block.index('if [ "$RUNTIME_CHOICE" = "podman" ]; then') < block.index("printf 'docker\\n'")


def test_the_published_copy_and_the_desktop_digest_follow_install_sh():
    import hashlib
    assert (ROOT / "web" / "public" / "install.sh").read_bytes() == INSTALL.read_bytes()
    digest = (ROOT / "desktop" / "src-tauri" / "installer.sha256").read_text(encoding="utf-8").strip()
    assert digest == hashlib.sha256(INSTALL.read_bytes()).hexdigest()
