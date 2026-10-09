"""Non-runtime contracts for the opt-in macOS Podman preparation path.

Until 08/10 one more test read the Godot setup (game/: setup_service.gd and
section_panel.gd choosing the Podman runtime). Godot is abandoned and it went
with it.
"""

import subprocess
from pathlib import Path


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
    assert '"$podman_bin" machine init --now --update-connection=false' in block
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

    assert "the Podman machine and Colima are both kept" in source


def test_macos_podman_install_reports_the_desktop_phase_contract():
    source = _source(INSTALLER)
    helper = source[source.index("jht_phase()") : source.index("run()")]
    setup = source[
        source.index("install_podman_macos()") : source.index(
            "install_docker_linux()"
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
    assert result.stderr.strip() == (
        "homebrew_missing: Homebrew is required to prepare the macOS runtime."
    )
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
            "install_docker_linux()"
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
