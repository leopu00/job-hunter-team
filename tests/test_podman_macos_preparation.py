"""Non-runtime contracts for the opt-in macOS Podman preparation path."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SETUP = ROOT / "game" / "scripts" / "setup" / "setup_service.gd"
PANEL = ROOT / "game" / "scripts" / "ui" / "section_panel.gd"
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


def test_desktop_can_detect_select_and_start_the_preview_runtime():
    setup = _source(SETUP)
    panel = _source(PANEL)

    assert 'const RUNTIME_PODMAN := "podman"' in setup
    assert "_podman_adapter_ready()" in setup
    assert "_podman_adapter_ready_at" in setup
    assert "runtime_switch_requires_installer" in setup
    assert "_which_docker_without_jht_shim" in setup
    assert '"machine", "start", "--update-connection=false"' in setup
    assert "_podman_machine_name()" in setup
    assert 'path_join("podman-machine")' in setup
    assert 'var user_home := OS.get_environment("HOME").rstrip("/")' in setup
    assert "SetupService.RUNTIME_PODMAN" in panel
    assert "SetupService.runtime_switch_requires_installer" in panel
    assert 'UIStrings.t("setup.runtime_podman")' in panel

    runtime_block = setup[
        setup.index("const RUNTIME_COLIMA") : setup.index(
            "static func _container_is_running()"
        )
    ]
    assert "FileAccess.WRITE" not in runtime_block
    assert "remove_absolute" not in runtime_block


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
