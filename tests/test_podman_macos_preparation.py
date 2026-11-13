"""Non-runtime contracts for the macOS Podman preparation path, the only engine since 0.4.

Until 08/10 one more test read the Godot setup (game/: setup_service.gd and
section_panel.gd choosing the Podman runtime). Godot is abandoned and it went
with it.
"""

import os
import pty
import re
import subprocess

import pytest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
QUICKSTART = ROOT / "docs" / "guides" / "QUICKSTART.md"


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_podman_is_the_only_engine_and_the_default():
    source = _source(INSTALLER)

    assert '""|auto|podman) RUNTIME_CHOICE="podman" ;;' in source
    assert "macos) install_podman_macos ;;" in source
    assert "linux) check_podman_linux ;;" in source
    for gone in ("install_colima_macos", "install_docker_desktop_macos", "install_docker_linux",
                 "resolve_macos_docker_cli", "enable_docker_group_for_this_run", "ensure_docker_compose_macos",
                 "colima start", "brew install colima", "get.docker.com", "usermod -aG docker"):
        assert gone not in source, gone
    assert "Container (Podman)" in source and "preview" not in source.lower()


def test_public_podman_quickstart_uses_the_normal_release_path():
    quickstart = _source(QUICKSTART)

    assert "bash scripts/install.sh --runtime=podman" in quickstart
    assert "--runtime=podman --branch" not in quickstart
    assert "fullstack-1" not in quickstart


def test_macos_podman_setup_never_removes_or_stops_colima():
    source = _source(INSTALLER)
    block = source[
        source.index("install_podman_macos()") : source.index(
            "install_container_runtime()"
        )
    ]

    assert "brew install podman" in block
    assert "brew install podman-compose" in block
    assert '"$podman_bin" machine init --now --update-connection=false' in block
    assert "PODMAN_MACHINE_CPUS=2" in source
    assert "PODMAN_MACHINE_MEMORY_MIB=4096" in source
    assert "PODMAN_MACHINE_DISK_GIB=30" in source
    assert '--cpus "$PODMAN_MACHINE_CPUS"' in block
    assert '--memory "$PODMAN_MACHINE_MEMORY_MIB"' in block
    assert '--disk-size "$PODMAN_MACHINE_DISK_GIB"' in block
    assert '"$podman_bin" machine start --update-connection=false' in block
    assert "Colima retained" in block
    for destructive in (
        "brew uninstall colima",
        "brew remove colima",
        "colima stop",
        "colima delete",
        "podman machine rm",
        "podman machine reset",
    ):
        assert destructive not in block


def test_macos_podman_install_reports_the_desktop_phase_contract():
    source = _source(INSTALLER)
    helper = source[source.index("jht_phase()") : source.index("run()")]
    setup = source[
        source.index("install_podman_macos()") : source.index(
            "install_container_runtime()"
        )
    ]
    phases = {
        "homebrew_check",
        "podman_install",
        "compose_install",
        "machine_create",
        "image_pull",
        "machine_start",
    }

    assert "printf 'JHT_PHASE %s\\n' \"$1\"" in helper
    for phase in phases:
        assert phase in helper
        assert f"jht_phase {phase}" in setup
    assert setup.index("jht_phase podman_install") < setup.index("run brew install podman")
    assert setup.index("jht_phase compose_install") < setup.index(
        "run brew install podman-compose"
    )
    assert setup.rindex("jht_phase image_pull") < setup.index('pull "$IMAGE"')


def test_missing_homebrew_stops_with_the_desktop_exit_code_before_network_io(
    tmp_path: Path,
):
    source = _source(INSTALLER)
    isolated = source.replace(
        "/opt/homebrew/bin/brew /usr/local/bin/brew",
        f"{tmp_path}/missing-opt-brew {tmp_path}/missing-usr-brew",
    )
    installer = tmp_path / "install.sh"
    installer.write_text(isolated, encoding="utf-8")
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    curl_log = tmp_path / "curl.log"
    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {curl_log}\nexit 97\n",
        encoding="utf-8",
    )
    fake_curl.chmod(0o700)

    result = subprocess.run(
        ["bash", "-c", f'. "{installer}"; install_brew_if_missing'],
        env={
            "HOME": str(tmp_path / "home"),
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "JHT_INSTALLER_SOURCE_ONLY": "1",
        },
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 80
    message = result.stderr.strip()
    assert message.startswith("homebrew_missing: ") and "\n" not in message
    assert "Nothing was changed" in message
    assert "https://brew.sh" in message and "run this installer again" in message
    assert not curl_log.exists()
    assert "Homebrew/install/HEAD/install.sh" not in source


def test_macos_podman_setup_reports_another_running_machine_without_stopping_it():
    installer = _source(INSTALLER)
    wrapper = _source(WRAPPER)

    for source in (installer, wrapper):
        assert "only one VM can be active at a time" in source
        assert "podman_other_machine_running" in source
        assert "podman machine list" in source
        assert "podman machine stop $running" in source
        assert "JHT_OTHER_MACHINE %s" in source
        assert "exit 79" in source or "return 79" in source
    installer_conflict = installer[
        installer.index("running_podman_machine()") : installer.index(
            "install_container_runtime()"
        )
    ]
    wrapper_conflict = wrapper[
        wrapper.index("running_podman_machine()") : wrapper.index(
            "# `podman-machine-recreate --confirm`"
        )
    ]
    active_installer = "\n".join(
        line for line in installer_conflict.splitlines() if not line.lstrip().startswith("#")
    )
    active_wrapper = "\n".join(
        line for line in wrapper_conflict.splitlines() if not line.lstrip().startswith("#")
    )
    assert ' machine stop ' not in active_installer.replace(
        "'podman machine stop $running'", ""
    ).replace("'podman machine stop <nome>'", "")
    assert ' machine stop ' not in active_wrapper.replace(
        "'podman machine stop $running'", ""
    ).replace("'podman machine stop <nome>'", "")


def test_macos_uses_the_stock_weekly_trim_timer_without_starting_a_machine_for_it():
    installer = _source(INSTALLER)
    wrapper = _source(WRAPPER)

    for source in (installer, wrapper):
        trim = source[
            source.index("enable_podman_trim_timer()") : source.index(
                "}", source.index("enable_podman_trim_timer()")
            )
        ]
        assert "machine ssh" in trim
        assert "sudo systemctl enable --now fstrim.timer" in trim
        assert "machine start" not in trim
        assert "machine stop" not in trim
    assert "weekly disk trim timer" in installer
    assert "trim settimanale del disco" in wrapper


def test_jht_scoped_shim_and_runtime_selection_are_attested():
    installer = _source(INSTALLER)
    wrapper = _source(WRAPPER)

    for contract in (
        "# JHT_PODMAN_DOCKER_SHIM=1",
        'printf \'podman\\n\' > "$selection_file"',
        "container-runtime=%s",
        "podman-machine=%s",
        "docker-shim=%s",
    ):
        assert contract in installer

    assert 'CONTAINER_RUNTIME="docker"' in wrapper
    assert 'CONTAINER_RUNTIME" = "podman"' in wrapper
    assert 'export PATH="$PODMAN_ADAPTER_BIN:$PATH"' in wrapper
    assert 'PODMAN_ADAPTER_BIN="$RUNTIME_DIR/bin"' in wrapper
    assert "--update-connection=false" in wrapper
    assert "runtime_manifest_value docker-shim" in wrapper
    assert "JHT_PODMAN_DOCKER_SHIM=1" in wrapper
    assert 'if [ -f "$RUNTIME_SELECTION_FILE" ]; then' in wrapper


def test_no_docker_selection_is_published_and_private_podman_artifacts_are_never_retired():
    source = _source(INSTALLER)

    assert "printf 'docker\\n'" not in source
    assert "selection_publish" not in source
    assert 'rm -f -- "$shim_dest"' not in source
    assert 'rm -f -- "$machine_file"' not in source
    assert "legacy_shim" not in source
    assert "retire_podman_adapter" not in source


def test_transition_prevalidates_selection_and_private_adapter_paths():
    source = _source(INSTALLER)

    assert "Unsafe JHT runtime selection marker" in source
    assert "Invalid JHT runtime selection marker" in source
    assert '[ ! -L "$adapter_bin" ]' in source
    assert '[ "$(cd -P "$adapter_bin" && pwd -P)" = "$adapter_bin" ]' in source
    assert "Refusing to overwrite an unsafe or non-JHT executable" in source


def test_installer_verifies_destination_before_publishing_runtime_selection():
    source = _source(INSTALLER)
    main = source[source.index("main_docker()") : source.index("main_native()")]

    assert main.index("install_container_runtime") < main.index("verify_docker_works")
    assert main.index("verify_docker_works") < main.index("download_runtime_files")
    assert "retire_podman_adapter" not in source


def test_installer_and_wrapper_pin_the_supported_direct_podman_compose_pair():
    installer = _source(INSTALLER)
    wrapper = _source(WRAPPER)
    install_block = installer[
        installer.index("install_podman_macos()") : installer.index(
            "install_container_runtime()"
        )
    ]
    compose_block = wrapper[
        wrapper.index("podman_compose_pair_supported()") : wrapper.index(
            "container_up()"
        )
    ]

    # The same rule in both: the 6.1 series from 6.1.3, podman-compose 1.6.0 exactly (one set of constants each).
    for source in (installer, wrapper):
        assert 'PODMAN_MAC_SERIES="6.1"' in source and "PODMAN_MAC_MIN_PATCH=3" in source
        assert 'PODMAN_COMPOSE_MAC_VERSION="1.6.0"' in source
        assert "podman version 6.1.3" not in source
    for source in (install_block, compose_block):
        assert "podman_mac_version_supported" in source
        assert 'podman-compose version $PODMAN_COMPOSE_MAC_VERSION' in source
    assert 'CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME"' in install_block
    assert install_block.index("unset CONTAINER_CONNECTION") < install_block.index(
        "podman machine inspect"
    )
    assert install_block.index("podman_mac_version_supported") < install_block.index(
        "podman machine inspect"
    )
    assert install_block.index("podman-compose version $PODMAN_COMPOSE_MAC_VERSION") < install_block.index(
        "podman machine inspect"
    )
    assert '"$compose_bin" --version' in install_block
    assert 'podman --connection "$PODMAN_MACHINE_NAME" compose' not in installer
    assert 'unset CONTAINER_CONNECTION' in wrapper
    active_compose = "\n".join(
        line for line in compose_block.splitlines() if not line.lstrip().startswith("#")
    )
    assert "--podman-args" not in active_compose
    assert 'CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME"' in compose_block


def _phase_output(tmp_path: Path, *, terminal: bool, machine_output: str | None) -> str:
    """What `jht_phase image_pull` prints, on a pipe or on a pseudo-terminal."""
    env = {
        "HOME": str(tmp_path),
        "PATH": "/usr/bin:/bin",
        "JHT_INSTALLER_SOURCE_ONLY": "1",
        **({"JHT_MACHINE_OUTPUT": machine_output} if machine_output is not None else {}),
    }
    command = ["bash", "-c", f'. "{INSTALLER}"; jht_phase image_pull; echo done']
    if not terminal:
        return subprocess.run(command, env=env, text=True, capture_output=True, timeout=20, check=False).stdout
    master, slave = pty.openpty()
    try:
        process = subprocess.Popen(command, env=env, stdout=slave, stderr=slave, stdin=subprocess.DEVNULL)
        os.close(slave)
        chunks = []
        while True:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        process.wait(timeout=20)
    finally:
        os.close(master)
    return b"".join(chunks).decode("utf-8", "replace")


def test_the_phase_marker_goes_to_the_app_on_a_pipe_and_not_to_a_person_at_a_terminal(tmp_path: Path):
    assert "JHT_PHASE image_pull" in _phase_output(tmp_path, terminal=False, machine_output=None)
    on_terminal = _phase_output(tmp_path, terminal=True, machine_output=None)
    assert "JHT_PHASE" not in on_terminal and "done" in on_terminal
    # explicit wins in both directions: =1 on a terminal, =0 on a pipe
    assert "JHT_PHASE image_pull" in _phase_output(tmp_path, terminal=True, machine_output="1")
    assert "JHT_PHASE" not in _phase_output(tmp_path, terminal=False, machine_output="0")


def test_the_phase_time_line_comes_only_when_asked_and_never_changes_the_phase_line(tmp_path: Path):
    off = _phase_output(tmp_path, terminal=False, machine_output=None)
    assert "JHT_TIME" not in off and "JHT_PHASE image_pull\n" in off
    env = {"HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "JHT_INSTALLER_SOURCE_ONLY": "1", "JHT_PHASE_TIMES": "1"}
    command = ["bash", "-c", f'set -e; . "{INSTALLER}"; jht_phase image_pull; jht_phase machine_start; echo done']
    lines = subprocess.run(command, env=env, text=True, capture_output=True, timeout=20, check=False).stdout.splitlines()
    assert lines[0] == "JHT_PHASE image_pull" and lines[2] == "JHT_PHASE machine_start" and lines[-1] == "done"
    assert re.fullmatch(r"JHT_TIME \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ image_pull", lines[1]), lines
    assert lines[3].endswith(" machine_start")
    # asked for times, refused marker: nothing at all
    env["JHT_MACHINE_OUTPUT"] = "0"
    quiet = subprocess.run(command, env=env, text=True, capture_output=True, timeout=20, check=False)
    assert quiet.stdout == "done\n"


@pytest.mark.parametrize("folder", ['/tmp/a"b', "/tmp/a$b", "/tmp/a`b", "/tmp/a\\b", "/tmp/a\nb"])
def test_a_bin_folder_that_would_run_something_in_a_startup_file_is_refused_before_anything_is_written(tmp_path: Path, folder: str):
    result = subprocess.run(
        ["bash", "-c", f'. "{INSTALLER}"; echo reached'],
        env={"HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "JHT_INSTALLER_SOURCE_ONLY": "1", "JHT_BIN_DIR": folder},
        text=True, capture_output=True, timeout=20, check=False,
    )
    assert result.returncode == 2 and "reached" not in result.stdout
    assert "cannot be written safely into a shell startup file" in result.stderr
    assert list(tmp_path.iterdir()) == []


def test_a_bin_folder_with_a_space_is_accepted(tmp_path: Path):
    result = subprocess.run(
        ["bash", "-c", f'. "{INSTALLER}"; echo "[$BIN_DIR]"'],
        env={"HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "JHT_INSTALLER_SOURCE_ONLY": "1", "JHT_BIN_DIR": "/opt/Mary Ann/bin"},
        text=True, capture_output=True, timeout=20, check=False,
    )
    assert result.returncode == 0 and "[/opt/Mary Ann/bin]" in result.stdout


# ── the marker of a machine the installer created ──

def _adapter_run(tmp_path: Path, *, created: str, machine: str = "jht-giro-mac", before: str | None = None, created_id: str = "2026-11-10 16:46:00 +0100 CET"):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    if before is not None:
        (runtime / "podman-machine-created").write_text(before, encoding="utf-8")
    fakebin = tmp_path / "bin"
    fakebin.mkdir()
    (fakebin / "podman").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    (fakebin / "podman").chmod(0o755)
    text = _source(INSTALLER)
    body = re.search(r"^install_podman_adapter\(\) \{\n.*?^\}\n", text, re.S | re.M).group(0)
    script = f"""
set -eu
RUNTIME_DIR="{runtime.resolve()}"
PODMAN_MACHINE_NAME="{machine}"
PODMAN_MACHINE_CREATED={created}
PODMAN_MACHINE_CREATED_ID="{created_id}"
podman_machine_mode() {{ return 0; }}
podman_native_mode() {{ return 1; }}
fail() {{ echo "fail: $*" >&2; exit 1; }}
ok() {{ :; }}
{body}
install_podman_adapter
"""
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={"PATH": f"{fakebin}:/usr/bin:/bin"})
    return done, runtime


def test_the_installer_marks_a_machine_it_created_with_its_name(tmp_path: Path):
    done, runtime = _adapter_run(tmp_path, created="1")
    assert done.returncode == 0, done.stderr
    assert (runtime / "podman-machine").read_text(encoding="utf-8") == "jht-giro-mac\n"
    marker = runtime / "podman-machine-created"
    assert marker.read_text(encoding="utf-8") == "jht-giro-mac\n2026-11-10 16:46:00 +0100 CET\n"
    assert marker.stat().st_mode & 0o777 == 0o600


def test_the_marker_has_no_second_line_when_the_engine_did_not_say_when_it_was_created(tmp_path: Path):
    done, runtime = _adapter_run(tmp_path, created="1", created_id="")
    assert done.returncode == 0, done.stderr
    assert (runtime / "podman-machine-created").read_text(encoding="utf-8") == "jht-giro-mac\n"


def test_the_installer_does_not_mark_a_machine_that_was_already_there(tmp_path: Path):
    done, runtime = _adapter_run(tmp_path, created="0")
    assert done.returncode == 0, done.stderr
    assert (runtime / "podman-machine").read_text(encoding="utf-8") == "jht-giro-mac\n"
    assert not (runtime / "podman-machine-created").exists()


def test_a_marker_of_an_earlier_run_is_kept_when_the_machine_is_found_again(tmp_path: Path):
    done, runtime = _adapter_run(tmp_path, created="0", before="jht-giro-mac\n")
    assert done.returncode == 0, done.stderr
    assert (runtime / "podman-machine-created").read_text(encoding="utf-8") == "jht-giro-mac\n"


def test_the_created_flag_is_set_only_after_machine_init_succeeds():
    block = _source(INSTALLER)
    init = block.index('"$podman_bin" machine init --now --update-connection=false')
    failed = block.index('fail "Podman machine initialization failed; Colima was not changed."', init)
    flag = block.index("PODMAN_MACHINE_CREATED=1", failed)
    assert flag > failed and flag - failed < 160
    assert block.count("PODMAN_MACHINE_CREATED=1") == 1
    assert "machine inspect --format '{{.Created}}' \"$PODMAN_MACHINE_NAME\"" in block[flag:flag + 300]


@pytest.mark.parametrize("version,ok", [
    ("6.1.3", True), ("6.1.4", True), ("6.1.10", True),
    ("6.1.2", False), ("6.2.0", False), ("7.0.0", False), ("6.1", False), ("6.1.4-rc1", False), ("", False),
])
def test_the_installer_takes_the_6_1_series_from_6_1_3_on_a_mac(version: str, ok: bool):
    script = f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALLER}"; podman_mac_version_supported "{version}" && echo yes || echo no'
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=20,
                          env={"HOME": "/nonexistent", "PATH": "/usr/bin:/bin"})
    assert done.stdout.strip() == ("yes" if ok else "no"), done.stderr


def test_a_podman_out_of_the_series_is_refused_with_the_version_found_and_what_to_do():
    source = _source(INSTALLER)
    assert "podman_version_unsupported: JHT on a Mac needs Podman $PODMAN_MAC_SERIES.$PODMAN_MAC_MIN_PATCH or a later" in source
    assert "this Mac has ${podman_version:-" in source and "nothing of JHT was installed" in source
    wrapper = _source(WRAPPER)
    assert "sul Mac servono podman $PODMAN_MAC_SERIES.$PODMAN_MAC_MIN_PATCH" in wrapper and "(trovato: $(podman_version_number" in wrapper


@pytest.mark.parametrize("lang,words", [("it_IT.UTF-8", "su questo Mac non c'e'"), ("en_US.UTF-8", "which is not on this Mac")])
def test_missing_homebrew_is_said_in_the_language_of_the_person(tmp_path: Path, lang: str, words: str):
    isolated = _source(INSTALLER).replace("/opt/homebrew/bin/brew /usr/local/bin/brew", f"{tmp_path}/a {tmp_path}/b")
    installer = tmp_path / "install.sh"
    installer.write_text(isolated, encoding="utf-8")
    done = subprocess.run(["bash", "-c", f'. "{installer}"; install_brew_if_missing'],
                          env={"HOME": str(tmp_path / "home"), "PATH": "/usr/bin:/bin", "LANG": lang,
                               "JHT_INSTALLER_SOURCE_ONLY": "1"},
                          capture_output=True, text=True, timeout=10)
    assert done.returncode == 80 and done.stderr.startswith("homebrew_missing: ") and words in done.stderr
    assert "https://brew.sh" in done.stderr
