"""Source-level parity contract for the real CLI and desktop local adapter.

These tests intentionally inspect the production entrypoints.  They do not
replace the executable Rust tests: their job is to fail when the two public
orchestrators drift, or when the desktop starts owning a second Podman setup.
"""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLI_SETUP = ROOT / "cli" / "wizard" / "setup.js"
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
DESKTOP = ROOT / "desktop" / "src-tauri" / "src" / "onboarding.rs"
DASHBOARD = ROOT / "desktop" / "src" / "dashboard" / "DashboardApp.tsx"


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _rust_item(source: str, marker: str) -> str:
    """Return one Rust function/impl body, including its signature."""

    start = source.index(marker)
    opening = source.index("{", start)
    depth = 0
    for offset, character in enumerate(source[opening:], start=opening):
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start : offset + 1]
    raise AssertionError(f"unterminated Rust item: {marker}")


def _function(source: str, name: str) -> str:
    return _rust_item(source, f"fn {name}(")


def _in_order(source: str, *needles: str) -> None:
    cursor = -1
    for needle in needles:
        cursor = source.index(needle, cursor + 1)


def _shell_function(source: str, name: str) -> str:
    start = source.index(f"\n{name}() {{") + 1
    end = source.index("\n}\n", start) + 2
    return source[start:end]


def _shell_function_spans(source: str) -> dict[str, tuple[int, int]]:
    spans = {}
    for declaration in re.finditer(
        r"^([a-zA-Z_][a-zA-Z0-9_]*)\(\) \{$", source, re.M
    ):
        start = declaration.start()
        end = source.index("\n}\n", start) + 2
        spans[declaration.group(1)] = (start, end)
    return spans


def _assert_shell_helper_only_reachable_from(
    source: str,
    helper: str,
    allowed: tuple[int, int],
    spans: dict[str, tuple[int, int]],
    visiting: frozenset[str] = frozenset(),
) -> None:
    assert helper not in visiting, f"recursive mutator call graph: {helper}"
    calls = list(
        re.finditer(rf"^[ \t]*{re.escape(helper)}(?:[ \t]|$)", source, re.M)
    )
    assert calls, f"unreachable mutator helper: {helper}"
    for call in calls:
        if allowed[0] <= call.start() < allowed[1]:
            continue
        callers = [
            name for name, span in spans.items() if span[0] <= call.start() < span[1]
        ]
        assert len(callers) == 1, f"mutator {helper} has a non-up call site"
        _assert_shell_helper_only_reachable_from(
            source,
            callers[0],
            allowed,
            spans,
            visiting | {helper},
        )


def _case_arm(source: str, label: str, after: str) -> tuple[str, int, int]:
    start = source.index(f"\n  {label})", source.index(after)) + 1
    following = re.search(r"\n  [^\s#][^\n]*\)\n", source[start + 1 :])
    if following is None:
        raise AssertionError(f"unterminated shell case arm: {label}")
    end = start + 1 + following.start()
    return source[start:end], start, end


def _without_shell_comments(source: str) -> str:
    return "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )


def test_cli_canonical_local_sequence_and_provider_ids_are_explicit():
    cli = _source(CLI_SETUP)

    for mapping in (
        "claude: 'claude'",
        "openai: 'codex'",
        "kimi: 'kimi'",
    ):
        assert mapping in cli

    _in_order(
        cli,
        "runJhtSubcommand(['providers', 'update', updateProviderId]",
        "waitForOauthCredentials(oauthCmd",
        "runJhtSubcommand(['team', 'start']",
    )
    assert "spawnSync(process.execPath, [entry, ...args]" in cli
    assert "result.status !== 0" in cli


def test_desktop_local_plan_uses_the_authoritative_wrapper_commands_in_order():
    desktop = _source(DESKTOP)
    operations = _rust_item(desktop, "impl LocalCliOperation")
    providers = _rust_item(desktop, "impl SubscriptionProvider")
    container = _function(desktop, "start_and_verify_local_container_with")
    prepare = _function(desktop, "prepare_impl")
    login = _function(desktop, "onboarding_provider_login")
    team = _function(desktop, "start_team_impl")

    _in_order(
        operations,
        'Self::Up => vec!["up"]',
        'Self::Status => vec!["status"]',
        'Self::ProviderUse(provider) => vec!["providers", "use", provider.cli_id()]',
        'Self::ProviderUpdate(provider) => vec!["providers", "update", provider.cli_id()]',
        'Self::OauthLogin => vec!["oauth-login"]',
        'Self::TeamStart => vec!["team", "start"]',
        'Self::Snapshot => vec!["onboarding-snapshot"]',
    )
    _in_order(container, "LocalCliOperation::Up", "LocalCliOperation::Status")
    _in_order(
        prepare,
        "LocalCliOperation::ProviderUse(submission.provider)",
        "LocalCliOperation::ProviderUpdate(submission.provider)",
    )
    assert "LocalCliOperation::OauthLogin" in login
    assert "LocalCliOperation::TeamStart" in team

    for mapping in (
        'Self::Claude => "claude"',
        'Self::Codex => "codex"',
        'Self::Kimi => "kimi"',
    ):
        assert mapping in providers

    # Local setup commands cross one boundary only: the attested host wrapper.
    for block in (container, prepare, login, team):
        assert "/app/cli/bin/jht.js" not in block
        assert "docker exec" not in block
        assert "podman compose" not in block


def test_desktop_delegates_podman_machine_orchestration_to_host_entrypoints():
    installer = _source(INSTALLER)
    desktop = _source(DESKTOP).split("#[cfg(test)]", 1)[0]
    podman_install = installer[
        installer.index("install_podman_macos()") : installer.index(
            "install_docker_linux()"
        )
    ]

    _in_order(
        podman_install,
        'podman machine inspect "$PODMAN_MACHINE_NAME"',
        'podman machine start --update-connection=false "$PODMAN_MACHINE_NAME"',
    )
    assert (
        'podman machine init --now --update-connection=false "$PODMAN_MACHINE_NAME"'
        in podman_install
    )
    assert 'podman --connection "$PODMAN_MACHINE_NAME" info' in podman_install

    assert re.search(r'"--runtime"\s*,\s*"podman"', desktop)
    for duplicate in (
        "fn ensure_local_podman(",
        "fn ensure_local_podman_with(",
        "fn ensure_local_podman_with_retry(",
    ):
        assert duplicate not in desktop
    assert not re.search(r'"machine"\s*,\s*"(?:start|init)"', desktop)


def test_local_commands_are_scoped_exit_checked_and_effect_verified():
    desktop = _source(DESKTOP)
    wrapper_command = _function(desktop, "local_wrapper_command")
    scoped = _function(desktop, "run_scoped_local")
    ensure_success = _function(desktop, "ensure_success")
    snapshot = _function(desktop, "snapshot_impl")
    verify_team = _function(desktop, "verified_team_snapshot")
    team_command = _function(desktop, "onboarding_team_start")
    resume_command = _function(desktop, "onboarding_resume_team_start")

    assert 'PathBuf::from("/usr/bin/env")' in wrapper_command
    for path in ("/opt/homebrew/bin", "/usr/local/bin", "/opt/podman/bin"):
        assert path in wrapper_command
    assert "validate_local_runtime(app, scope)?" in scoped
    assert "value.success()" in ensure_success
    assert "LocalCliOperation::Snapshot" in snapshot
    assert "!snapshot.assistant_running || !snapshot.captain_running" in verify_team
    for command in (team_command, resume_command):
        _in_order(command, "start_team_impl(", "verified_team_snapshot(")


def test_wrapper_keeps_host_and_node_cli_responsibilities_separate():
    wrapper = _source(WRAPPER)

    assert re.search(r"^  up(?:\|start-container)?\)$", wrapper, re.M)
    assert "oauth-login|claude-login)" in wrapper
    default = wrapper[wrapper.rindex("# ── Operativita'") :]
    _in_order(
        default,
        "*)",
        "ensure_up",
        'docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" "$@"',
    )


def test_status_and_gui_probes_cannot_start_a_stopped_runtime():
    wrapper = _source(WRAPPER)
    desktop = _source(DESKTOP)
    lifecycle = "# ── Lifecycle: parlano direttamente al daemon Docker"
    status, _, _ = _case_arm(wrapper, "status", lifecycle)
    up_label = (
        "up" if re.search(r"^  up\)$", wrapper[wrapper.index(lifecycle) :], re.M)
        else "up|start-container"
    )
    up, up_start, up_end = _case_arm(wrapper, up_label, lifecycle)
    chat_probe = _shell_function(wrapper, "desktop_chat_container_id")
    runtime_probe = _shell_function(wrapper, "read_only_container_id")
    onboarding_probe = _shell_function(wrapper, "onboarding_snapshot")
    reachable = _shell_function(wrapper, "docker_reachable")
    snapshot = _function(desktop, "snapshot_impl")

    for read_only in map(
        _without_shell_comments,
        (status, chat_probe, runtime_probe, onboarding_probe, reachable),
    ):
        for mutator in (
            "require_docker",
            "ensure_up",
            "machine start",
            "machine init",
            "compose up",
        ):
            assert mutator not in read_only

    assert "docker_reachable" in status
    assert "read_only_container_id" in chat_probe
    assert "docker_reachable" in runtime_probe
    assert "read_only_container_id" in onboarding_probe
    assert "LocalCliOperation::Snapshot" in snapshot
    assert "compose up -d" in up

    # If the wrapper can wake Podman, that mutator must be called directly and
    # exclusively by the explicit `up` arm.  A status/probe fallback through a
    # shared helper would add another call site and fail this reachability gate.
    spans = _shell_function_spans(wrapper)
    for machine_start in re.finditer(
        r"^[^#\n]*\bmachine[ \t]+start\b", wrapper, re.M
    ):
        if up_start <= machine_start.start() < up_end:
            continue
        owners = [
            name
            for name, span in spans.items()
            if span[0] <= machine_start.start() < span[1]
        ]
        assert len(owners) == 1, "Podman wake is outside the explicit up path"
        _assert_shell_helper_only_reachable_from(
            wrapper,
            owners[0],
            (up_start, up_end),
            spans,
        )


def test_dashboard_mount_resume_is_probe_only_and_click_owns_team_start():
    dashboard = _source(DASHBOARD)
    resume_start = dashboard.index("const resumeAssistant = useCallback")
    resume_end = dashboard.index("const resumeTeam = useCallback", resume_start)
    resume = dashboard[resume_start:resume_end]
    team_end = dashboard.index("const connectResumedAssistant", resume_end)
    resume_team = dashboard[resume_end:team_end]
    connect_end = dashboard.index("const connectExistingTeam", team_end)
    resumed_chat = dashboard[team_end:connect_end]
    mount_start = dashboard.index("useEffect(() => {", connect_end)
    mount_end = dashboard.index("const runtimeAction", mount_start)
    mount = dashboard[mount_start:mount_end]
    action_start = mount_end
    retry_start = dashboard.index("const retry = useCallback", action_start)
    runtime_action = dashboard[action_start:retry_start]
    retry_end = dashboard.index("if (!identityKey", retry_start)
    retry = dashboard[retry_start:retry_end]

    assert "resumeOnboardingSnapshot" in resume
    assert "resumeOnboardingTeamStart" not in resume
    assert "reconnectDirectChat" not in resume
    assert "resumeAssistant" in mount
    assert "resumeOnboardingTeamStart" not in mount
    assert "resumeOnboardingTeamStart" in resume_team
    assert "reconnectDirectChat" not in resume_team
    assert "resumeOnboardingTeamStart" not in resumed_chat
    assert "reconnectDirectChat" in resumed_chat
    assert "resumeTeam" in runtime_action
    assert "resumeTeam" in retry
