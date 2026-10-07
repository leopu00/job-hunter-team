"""Non-runtime contracts for the opt-in macOS Podman preparation path.

Until 08/10 one more test read the Godot setup (game/: setup_service.gd and
section_panel.gd choosing the Podman runtime). Godot is abandoned and it went
with it.
"""

import os
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
QUICKSTART = ROOT / "docs" / "guides" / "QUICKSTART.md"


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_macos_podman_is_opt_in_while_colima_remains_the_default():
    source = _source(INSTALLER)

    assert '""|auto) RUNTIME_CHOICE=""' in source
    assert "colima|podman|docker-desktop" in source
    assert 'podman) install_podman_macos ;;' in source
    assert '*) install_colima_macos ;;' in source
    assert 'RUNTIME_CHOICE" != "podman"' in source
    assert "Container (Podman preview)" in source


def test_public_podman_quickstart_uses_the_normal_release_path():
    quickstart = _source(QUICKSTART)

    assert "bash scripts/install.sh --runtime=podman" in quickstart
    assert "--runtime=podman --branch" not in quickstart
    assert "fullstack-1" not in quickstart


def test_macos_podman_setup_never_removes_or_stops_colima():
    source = _source(INSTALLER)
    block = source[
        source.index("install_podman_macos()") : source.index(
            "install_docker_linux()"
        )
    ]

    assert "brew install podman" in block
    assert "brew install podman-compose" in block
    assert "podman machine init --now --update-connection=false" in block
    assert "podman machine start --update-connection=false" in block
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

    assert "the Podman machine and Colima are both kept" in source


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


def test_docker_transition_keeps_private_podman_artifacts_inert_and_fails_closed():
    source = _source(INSTALLER)
    block = source[
        source.index("download_runtime_files()") : source.index(
            "install_dep()"
        )
    ]

    assert 'selection_publish="$(mktemp "$RUNTIME_DIR/.container-runtime.XXXXXX")"' in block
    assert "printf 'docker\\n' > \"$selection_publish\"" in block
    assert block.index('mv -f "$manifest_tmp" "$manifest_dest"') < block.index(
        'mv -f "$selection_publish" "$RUNTIME_DIR/container-runtime"'
    )
    assert "private Podman artifacts kept inert" in block
    assert 'rm -f -- "$shim_dest"' not in source
    assert 'rm -f -- "$machine_file"' not in source
    assert "legacy_shim" not in source
    assert "retire_podman_adapter" not in source


def test_transition_prevalidates_selection_and_private_adapter_paths():
    source = _source(INSTALLER)

    assert '[ -f "$selection_source" ] && [ ! -L "$selection_source" ]' in source
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
    assert "resolve_macos_docker_cli" in source

    resolver = source[
        source.index("resolve_macos_docker_cli()") : source.index(
            "verify_docker_works()"
        )
    ]
    assert "JHT_PODMAN_DOCKER_SHIM=1" in resolver
    assert "[ ! -L" not in resolver
    assert 'DOCKER_CLI="$resolved"' in resolver
    assert 'if [ -z "$DOCKER_CLI" ]; then' in source


def test_installer_and_wrapper_pin_the_supported_direct_podman_compose_pair():
    installer = _source(INSTALLER)
    wrapper = _source(WRAPPER)
    install_block = installer[
        installer.index("install_podman_macos()") : installer.index(
            "install_docker_linux()"
        )
    ]
    compose_block = wrapper[
        wrapper.index("podman_compose_pair_supported()") : wrapper.index(
            "container_up()"
        )
    ]

    for source in (install_block, compose_block):
        assert "podman version 6.1.3" in source
        assert "podman-compose version 1.6.0" in source
    assert 'CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME"' in install_block
    assert install_block.index("unset CONTAINER_CONNECTION") < install_block.index(
        "podman machine inspect"
    )
    assert install_block.index("podman version 6.1.3") < install_block.index(
        "podman machine inspect"
    )
    assert install_block.index("podman-compose version 1.6.0") < install_block.index(
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


@pytest.mark.parametrize(
    ("podman_version", "compose_version"),
    (
        ("podman version 6.2.0", "podman-compose version 1.6.0"),
        ("podman version 6.1.3", "podman-compose version 1.7.0"),
    ),
)
def test_installer_version_mismatch_stops_before_machine_lifecycle(
    tmp_path: Path, podman_version: str, compose_version: str
):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    log = tmp_path / "argv.log"
    for name, version in (
        ("podman", podman_version),
        ("podman-compose", compose_version),
    ):
        executable = fake_bin / name
        executable.write_text(
            "#!/bin/sh\n"
            f"printf '{name} env=%s argv=%s\\n' \"$CONTAINER_CONNECTION\" \"$*\" >> \"$JHT_TEST_ARGV_LOG\"\n"
            f"if [ \"$1\" = --version ]; then printf '%s\\n' '{version}'; exit 0; fi\n"
            "exit 99\n",
            encoding="utf-8",
        )
        executable.chmod(0o700)
    brew = fake_bin / "brew"
    brew.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
    brew.chmod(0o700)
    env = {
        **os.environ,
        "HOME": str(tmp_path / "home"),
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "CONTAINER_CONNECTION": "external-default",
        "JHT_INSTALLER_SOURCE_ONLY": "1",
        "JHT_TEST_ARGV_LOG": str(log),
    }
    command = (
        f"source {INSTALLER!s}; "
        "OS=macos; DRY_RUN=0; PODMAN_MACHINE_NAME=jht-podman; "
        "install_podman_macos"
    )

    result = subprocess.run(
        ["/bin/bash", "-c", command],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    calls = log.read_text(encoding="utf-8")
    assert "podman env= argv=--version" in calls
    if podman_version == "podman version 6.1.3":
        assert "podman-compose env=jht-podman argv=--version" in calls
    assert "machine" not in calls
    assert " info" not in calls
