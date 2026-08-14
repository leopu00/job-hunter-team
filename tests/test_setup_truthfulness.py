"""Contratti di verità visiva durante setup e team fermo.

Il run Windows del 2026-08-03 mostrava KPI demo e sedici etichette
``AL LAVORO`` mentre il setup era 1/4 e nessuna sessione LLM esisteva. Il
badge che avrebbe dichiarato la simulazione era coperto dal CTA del setup.
"""

import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SETUP_REFRESH_SECTIONS = frozenset(
    {"activation", "provider", "docker", "account", "team"}
)


def _src(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _gd_function(source: str, name: str) -> str:
    """Extract one GDScript function without depending on its line layout."""
    header = re.search(rf"(?m)^(?:static )?func {re.escape(name)}\b", source)
    assert header is not None, f"missing GDScript function: {name}"
    following = re.search(r"(?m)^(?:static )?func ", source[header.end() :])
    end = header.end() + following.start() if following is not None else len(source)
    return source[header.start() : end]


def _gd_membership_strings(function: str, subject: str) -> tuple[str, ...]:
    """Parse one complete GDScript membership guard/continuation line."""
    matches = re.findall(
        rf"(?m)^[ \t]+(?:if|and)[ \t]+{re.escape(subject)}[ \t]+in[ \t]+"
        rf"\[([^\]\r\n]*)\][ \t]*:[ \t]*$",
        function,
    )
    assert len(matches) == 1, f"expected one membership guard for {subject}"
    try:
        values = json.loads(f"[{matches[0]}]")
    except json.JSONDecodeError as error:
        raise AssertionError(
            f"membership guard for {subject} must contain only string literals"
        ) from error
    assert isinstance(values, list)
    assert all(type(value) is str for value in values), (
        f"membership guard for {subject} must contain only canonical strings"
    )
    assert len(values) == len(set(values)), (
        f"membership guard for {subject} contains duplicate strings"
    )
    return tuple(values)


def _assert_exact_membership(
    function: str, subject: str, required: frozenset[str]
) -> None:
    values = _gd_membership_strings(function, subject)
    assert len(values) == len(required), (
        f"membership guard for {subject} has the wrong cardinality: {values}"
    )
    assert frozenset(values) == required, (
        f"membership guard for {subject} differs: {values}"
    )


@pytest.mark.parametrize(
    "members",
    (
        '"activation", "provider", "docker", "account"',
        '"activation", "provider", "docker", "account", "team", "team"',
        '"activation", "provider", "docker", "account", SOME_OTHER_SECTION',
        '# if section in ["activation", "provider", "docker", "account", "team"]:',
        'if section in ["activation", "provider", "docker", "account", "team"] + EXTRA:',
        'if section in ["activation", "provider", "docker", "account", "team"] or true:',
    ),
    ids=(
        "omission",
        "duplicate",
        "expression",
        "comment-only",
        "trailing-expression",
        "or-true",
    ),
)
def test_setup_refresh_membership_parser_rejects_non_exact_contract(members: str):
    line = members if members.startswith(("# ", "if ")) else f"if section in [{members}]:"
    synthetic = f"func _on_setup_refresh():\n\t{line}\n\tpass\n"
    with pytest.raises(AssertionError):
        _assert_exact_membership(synthetic, "section", SETUP_REFRESH_SECTIONS)


def test_setup_cta_does_not_cover_truth_badge():
    sidebar = _src("game/scripts/ui/game_sidebar.gd")
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "Vector2(-190, 58)" in sidebar
    assert "position = Vector2((get_parent_area_size().x - size.x) / 2.0, 14)" in badge


def test_truth_badge_uses_fail_closed_three_state_provenance():
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "BackendBus.positions_updated.connect" in badge
    assert "enum DataState { LIVE, DEMO, UNAVAILABLE }" in badge
    assert "static func classify(" in badge
    assert "if demo_gate:" in badge
    assert "if backend_live and not positions_demo:" in badge
    assert "return DataState.UNAVAILABLE" in badge
    assert "visible = state == DataState.DEMO" in badge
    assert 'OS.get_environment("JHT_DEMO") == "1"' in badge


def test_untrusted_demo_marker_cannot_enable_synthetic_data():
    selftest = _src("game/scripts/office/office_selftests.gd")
    assert "[false, true, false, SimBadge.DataState.UNAVAILABLE]" in selftest
    assert "[true, true, false, SimBadge.DataState.UNAVAILABLE]" in selftest
    assert "[false, false, true, SimBadge.DataState.DEMO]" in selftest


def test_release_truthfulness_selftest_excludes_its_own_demo_fixture():
    badge = _src("game/scripts/ui/sim_badge.gd")
    selftest = _src("game/scripts/office/office_selftests.gd")
    assert 'OS.get_environment("JHT_TRUTHFULNESS_TEST") == "1"' in badge
    assert '"JHT_TRUTHFULNESS_TEST": "_truthfulness_selftest"' in selftest
    assert "func _truthfulness_selftest()" in selftest
    assert "var roster_empty: bool = office.agents.is_empty()" in selftest
    assert "var counterfeit_present: bool = BackendBus.positions_are_demo" in selftest
    assert "piles_empty" in selftest
    assert "piles_static" in selftest
    assert "inbox_hidden" in selftest
    assert "chat_live_state" in selftest
    assert "usage_live" in selftest
    assert '"PROTOTYPE", "MOCK", "SIMULATION", "SIMULAZIONE"' in selftest


def test_truthfulness_oracle_is_executed_by_matrix_and_release_workflow():
    row = (
        "truthfulness|run|gate|any|JHT_SCENE=office "
        "JHT_TRUTHFULNESS_TEST=1|-|TRUTHFULNESS-TEST PASS"
    )
    matrix = _src("game/tools/test-matrix.txt")
    release = _src(".github/workflows/release.yml")
    assert matrix.splitlines().count(row) == 1
    assert release.count(
        "JHT_SCENE=office JHT_TRUTHFULNESS_TEST=1 godot --headless --path game"
    ) == 1
    assert release.count('grep "TRUTHFULNESS-TEST PASS"') == 1


def test_unavailable_paper_piles_are_empty_static_and_not_reported():
    office = _src("game/scripts/office/office.gd")
    creation = office[
        office.index("var p := PaperPile.new(station.pile_spot())") :
        office.index("PaperPile.inbox[dept_id] = p")
    ]
    assert creation.count("if SimBadge.synthetic_data_allowed():") == 1
    assert creation.count("p.restock =") == 1
    assert creation.count("p.add_sheets(randi_range(1, 6))") == 1
    assert "else:\n\t\t\tp.set_target(0, true)" in creation
    sync = office[office.index("func _sync_piles(") : office.index("func _on_transitions(")]
    assert "SimBadge.DataState.UNAVAILABLE" in sync
    assert "PaperPile.inbox[dept_id].set_target(0, true)" in sync

    transitions = office[
        office.index("func _on_transitions(") :
        office.index("func _react_to_transition(")
    ]
    assert "if BackendBus.positions.is_empty():" in transitions
    assert transitions.index("if BackendBus.positions.is_empty():") < transitions.index(
        "_reseed_piles()"
    )
    assert "else:\n\t\t_sync_piles(" in transitions

    department = _src("game/scripts/ui/department_panel.gd")
    inbox = department[
        department.index("if PaperPile.inbox.has(dept_id)") :
        department.index("box.add_child(HSeparator.new())")
    ]
    assert "SimBadge.DataState.UNAVAILABLE" in inbox


def test_every_position_ui_consumer_uses_the_fail_closed_visible_snapshot():
    raw = re.compile(r"\bBackendBus\.positions\b")
    direct = {}
    for path in (ROOT / "game/scripts/ui").glob("*.gd"):
        code = "\n".join(
            line for line in path.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("#")
        )
        count = len(raw.findall(code))
        if count:
            direct[path.name] = count
    # Solo il rubinetto centrale puo' leggere lo snapshot grezzo.
    assert direct == {"sim_badge.gd": 1}

    for relative in (
        "game/scripts/ui/map_pins.gd",
        "game/scripts/ui/map_view.gd",
        "game/scripts/ui/world_map.gd",
        "game/scripts/ui/global_search.gd",
        "game/scripts/ui/positions_timeline.gd",
        "game/scripts/ui/pipeline_queue_panel.gd",
        "game/scripts/ui/output_archive_panel.gd",
        "game/scripts/ui/stats_charts.gd",
        "game/scripts/ui/registry_panel.gd",
        "game/scripts/ui/section_panel.gd",
    ):
        assert "SimBadge.visible_positions()" in _src(relative), relative


def test_open_chat_and_usage_views_react_to_provenance_changes():
    section = _src("game/scripts/ui/section_panel.gd")
    assert "BackendBus.connection_changed.connect(_on_provenance_refresh)" in section
    assert "BackendBus.positions_updated.connect(_on_positions_provenance_refresh)" in section
    for relative in (
        "game/scripts/ui/usage_history_view.gd",
        "game/scripts/ui/agent_usage_view.gd",
    ):
        source = _src(relative)
        assert "BackendBus.connection_changed.connect(_on_connection_changed)" in source
        assert "BackendBus.positions_updated.connect(_on_positions_provenance_changed)" in source
        assert 'UIStrings.t("common.connect_team")' in source
        assert "previous == int(SimBadge.DataState.UNAVAILABLE)" in source


def test_usage_responses_are_generation_bound_and_cleared_fail_closed():
    bus = _src("game/scripts/backend/backend_bus.gd")
    assert "var _active_usage_requests: Dictionary = {}" in bus
    assert "_active_usage_requests.clear()" in bus
    assert "_active_usage_requests[str(request_id)] = true" in bus
    assert "if not _active_usage_requests.has(request_id):" in bus

    for relative in (
        "game/scripts/backend/backend_adapter.gd",
        "game/scripts/backend/mock_backend.gd",
        "game/scripts/backend/vps_backend.gd",
    ):
        source = _src(relative)
        assert "request_id" in source, relative

    for relative in (
        "game/scripts/ui/usage_history_view.gd",
        "game/scripts/ui/agent_usage_view.gd",
    ):
        source = _src(relative)
        assert "var _provenance_generation := 0" in source
        assert "var _request_serial := 0" in source
        assert 'str(query.get("request_id", ""))' in source
        assert "SimBadge.current_state() == SimBadge.DataState.UNAVAILABLE" in source
        assert "func _clear_usage()" in source
        assert "_data = {}" in source


def test_live_empty_copy_is_distinct_and_shared_by_all_position_surfaces():
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "static func positions_empty_copy() -> String:" in badge
    assert 'UIStrings.t("common.positions_empty")' in badge
    for relative in (
        "game/scripts/ui/section_panel.gd",
        "game/scripts/ui/global_search.gd",
        "game/scripts/ui/world_map.gd",
    ):
        assert "SimBadge.positions_empty_copy()" in _src(relative), relative


def test_backend_reset_revokes_roster_in_bus_and_office():
    bus = _src("game/scripts/backend/backend_bus.gd")
    reset = bus[
        bus.index("func _reset_connection_snapshots()") :
        bus.index("func disconnect_backend()")
    ]
    assert "agents = []" in reset
    assert "agents_updated.emit(agents)" in reset
    assert reset.index("agents_updated.emit(agents)") < reset.index("backend_reset.emit()")

    office = _src("game/scripts/office/office.gd")
    reset_office = office[
        office.index("func _on_backend_reset()") :
        office.index("func _reseed_piles()")
    ]
    assert "sync_agents([])" in reset_office


def test_unavailable_copy_is_backend_neutral_in_every_locale():
    catalogs = [ROOT / "game/scripts/ui_strings.gd"]
    catalogs.extend(sorted((ROOT / "game/scripts/i18n").glob("ui_*.gd")))
    assert len(catalogs) == 7
    for path in catalogs:
        source = path.read_text(encoding="utf-8")
        assert source.count('"common.connect_team"') == 1, path.name
        assert source.count('"common.positions_empty"') == 1, path.name


def test_live_empty_database_never_falls_back_to_mock_kpis():
    hud = _src("game/scripts/office/team_hud.gd")
    assert "data_state == SimBadge.DataState.LIVE" in hud
    assert "data_state == SimBadge.DataState.UNAVAILABLE" in hud
    assert '_positions.text = "—"' in hud
    assert "BackendBus.kpi_summary()" in hud


def test_normal_office_never_materializes_showroom_or_demo_positions():
    office = _src("game/scripts/office/office.gd")
    assert (
        "BackendBus.agents.is_empty() and SimBadge.synthetic_data_allowed()"
        in office
    )
    assert "world == null or not SimBadge.synthetic_data_allowed()" in office
    assert "elif SimBadge.synthetic_data_allowed()" in office
    assert "elif BackendBus.positions_are_demo:" in office
    assert "BackendBus.clear_demo_positions()" in office


def test_wizard_declares_simulation_only_in_explicit_demo_state():
    wizard = _src("game/scripts/wizard.gd")
    assert wizard.count("SimBadge.current_state() == SimBadge.DataState.DEMO") == 2
    assert '"" if BackendBus.is_live() else UIStrings.t("wizard.sim_badge")' not in wizard


def test_teamdata_consumers_are_gated_by_demo_state():
    panel = _src("game/scripts/ui/section_panel.gd")
    assert "elif data_state == SimBadge.DataState.DEMO:" in panel
    assert "if data_state == SimBadge.DataState.UNAVAILABLE:" in panel
    assert "func _add_data_unavailable()" in panel

    for relative in (
        "game/scripts/ui/map_view.gd",
        "game/scripts/ui/registry_panel.gd",
        "game/scripts/ui/department_panel.gd",
        "game/scripts/ui/agent_card.gd",
        "game/scripts/characters/agent_npc.gd",
    ):
        source = _src(relative)
        assert "SimBadge." in source, relative


def test_every_teamdata_callsite_has_a_local_provenance_gate():
    call = re.compile(r"\bTeamData\.\w+\(")
    consumers = 0
    for path in (ROOT / "game/scripts").rglob("*.gd"):
        source = path.read_text(encoding="utf-8")
        for match in call.finditer(source):
            start = source.rfind("\nfunc ", 0, match.start())
            end = source.find("\nfunc ", match.end())
            function = source[start : len(source) if end < 0 else end]
            assert "SimBadge." in function, (
                f"TeamData consumer without provenance gate: {path.relative_to(ROOT)}"
            )
            consumers += 1
    assert consumers == 20


def test_showroom_agents_wait_until_operational_team_exists():
    office = _src("game/scripts/office/office.gd")
    assert "var harness_offline := TutorialHarness.enabled()" in office
    assert (
        'var team_running := false if harness_offline else bool(status.get("team_running", false))'
        in office
    )
    assert 'agent.set_backend_status("working" if team_running else "idle")' in office


def test_cli_started_team_is_not_labeled_inactive_while_setup_is_incomplete():
    """Roster live e checklist sono fatti distinti, non stati mutuamente esclusivi.

    Un config CLI migrato può restare 1/4 mentre tmux contiene già CAPITANO. Il
    pannello deve continuare a offrire il setup senza chiamare inattivo quel team.
    """
    panel = _src("game/scripts/ui/section_panel.gd")
    team = panel[panel.index("func _build_team()") : panel.index("func _build_agents()")]
    assert 'var running := SetupService._agents_have_operational_team(BackendBus.agents) or bool(' in team
    assert 'var banner_key := "setup.cta" if running else "setup.team_locked"' in team
    assert team.index("var running :=") < team.index('if not bool(SetupService.status.get("ready"')


def test_runtime_installer_keeps_tty_and_reports_command_failure():
    setup = _src("game/scripts/setup/setup_service.gd")
    terminal = _src("game/scripts/ui/embedded_terminal.gd")
    strings = _src("game/scripts/ui_strings.gd")
    runtime_command = setup[
        setup.index("static func _posix_runtime_install_command()") :
        setup.index("static func default_vps_key_path()")
    ]

    # curl|bash consegnava allo script uno stdin non-TTY: Homebrew passava in
    # non-interactive e sudo non poteva chiedere la password nella console.
    assert "jobhunterteam.ai/install.sh |" not in runtime_command
    assert r'install.sh -o \"$jht_installer\"' in runtime_command
    assert r'''trap 'rm -f \"$jht_installer\"; exit 129' HUP''' in runtime_command
    assert r'''trap 'rm -f \"$jht_installer\"; exit 130' INT''' in runtime_command
    assert r'''trap 'rm -f \"$jht_installer\"; exit 143' TERM''' in runtime_command
    assert '"trap - HUP INT TERM; "' in runtime_command
    assert "JHTExit=" in setup
    assert '"/v:on"' not in setup
    assert "_with_windows_exit_report(command, exit_report_token)" in setup
    windows_wrapper = setup[
        setup.index("static func _with_windows_exit_report(") :
        setup.index("static func _with_pty_size(")
    ]
    assert 'path = "powershell.exe"' in setup
    assert '"-NoProfile", "-NonInteractive", "-Command"' in setup
    assert "Marshalls.utf8_to_base64(command)" in windows_wrapper
    assert "[Convert]::FromBase64String" in windows_wrapper
    assert "$jht_hosted = '( ' + $jht_command + ' ) 1>&2'" in windows_wrapper
    assert "& $env:COMSPEC /d /s /c $jht_hosted" in windows_wrapper
    assert "$jht_command 1>&2" not in windows_wrapper
    assert "$jht_exit = [int]$LASTEXITCODE" in windows_wrapper
    assert "call set" not in windows_wrapper
    assert "errorlevel" not in windows_wrapper
    assert "( %s )" not in windows_wrapper
    assert '"reports_exit": true' in setup
    assert '"exit_report_token": exit_report_token' in setup
    assert '"where winget >nul 2>&1 & if errorlevel 1 "' in setup
    windows_install = setup[
        setup.index('if OS.get_name() == "Windows"') :
        setup.index("var command := _posix_runtime_install_command()")
    ]
    assert ") || " not in windows_install

    # EOF non equivale a successo: il codice riportato dal wrapper determina
    # uno stato rosso e un CTA di riprova, mai una dichiarazione dell'utente.
    assert 'code = _captured_exit_code()' in terminal
    assert 'str(spec.get("exit_report_token", ""))' in terminal
    assert 'UIStrings.t("term.status_cmd_failed") % code' in terminal
    assert 'UIStrings.t("term.close_retry")' in terminal
    assert '"term.done_plain": "CHIUDI CONSOLE"' in strings


def test_cloud_login_uses_native_browser_pairing_without_terminal_copy():
    setup = _src("game/scripts/setup/setup_service.gd")
    panel = _src("game/scripts/ui/section_panel.gd")
    terminal = _src("game/scripts/ui/embedded_terminal.gd")
    cloud_login = setup[
        setup.index("func open_cloud_login") : setup.index("func open_cloud_command")
    ]
    for key in (
        "setup.cloud_login_title",
        "setup.cloud_login_google_hint",
        "setup.cloud_login_hint",
    ):
        assert f'UIStrings.t("{key}")' in cloud_login
    for italian_literal in (
        "Account e cloud",
        "Apri il link, scegli ACCEDI CON GOOGLE",
        "Apri il link, accedi all'account",
    ):
        assert italian_literal not in cloud_login
    assert '"--ui-json"' in cloud_login
    assert '"--no-push"' in cloud_login
    assert '"cloud_pairing": true' in cloud_login
    assert '"prefer_google": prefer_google' in cloud_login
    refresh = _gd_function(panel, "_on_setup_refresh")
    _assert_exact_membership(refresh, "section", SETUP_REFRESH_SECTIONS)
    assert "return OS.shell_open(uri)" in terminal
    assert 'UIStrings.t("cloud_pairing.fallback")' in terminal
    assert 'UIStrings.t("term.copy_link")' in terminal
    assert '"already_used"' in terminal
    assert '"expired", "timeout"' in terminal


def test_runtime_upgrade_uses_only_the_host_json_contract():
    setup = _src("game/scripts/setup/setup_service.gd")
    panel = _src("game/scripts/ui/section_panel.gd")
    upgrade = setup[
        setup.index("func update_runtime()") : setup.index("## Dove vive il file compose")
    ]

    # Il gioco e' solo il client del deploy transazionale. Prima di invocare
    # qualunque host, scarica e valida il wrapper production: un v0.3.3 non
    # supporta il contratto JSON e un check diretto muterebbe il deploy.
    assert '"upgrade", _do_update_runtime.bind(_vps_config())' in upgrade
    assert "return _run_local_bootstrap_upgrade(jht, false)" in upgrade
    assert "return _run_local_bootstrap_upgrade(jht, true)" in upgrade
    assert "_posix_upgrade_bootstrap_with_target(" in upgrade
    assert "UPGRADE_BOOTSTRAP_PROTOCOL" in upgrade
    assert 'grep -Eq ' in upgrade
    assert 'JHT_BIN=\\\"$HOME/.local/bin/jht\\\"' in upgrade
    assert '[ -x \\\"$JHT_BIN\\\" ] || exit 127' in upgrade
    assert 'JHT_WRAPPER_PATH=\\\"$JHT_BIN\\\"' in upgrade
    assert '"upgrade-check", _do_check_runtime_update.bind(_vps_config())' in upgrade
    assert 'PackedStringArray(["upgrade", "--json"])' not in upgrade
    assert 'PackedStringArray(["upgrade", "--check", "--json"])' not in upgrade
    assert 'exec \\\"$JHT_BIN\\\" upgrade --json' not in upgrade
    assert 'exec \\\"$JHT_BIN\\\" upgrade --check --json' not in upgrade
    assert 'func runtime_update_check_state() -> String:' in upgrade
    assert 'return "available" if bool(last_upgrade_check.get("changed", false)) else "current"' in upgrade
    assert "docker exec" not in upgrade
    assert "_compose_stream" not in upgrade
    assert "_compose_up_with_progress" not in upgrade

    # stdout e' un unico frame; stderr viene drenato ma non interpretato come
    # JSON. Il codice di processo e `ok` devono restare coerenti.
    assert "static func parse_upgrade_result(stdout: String, exit_code: int)" in upgrade
    assert 'frame.contains("\\n")' in upgrade
    assert "(exit_code == 0) != bool(result[\"ok\"])" in upgrade
    assert '"unexpected", "check"]' in upgrade
    assert "var stderr: FileAccess = process[\"stderr\"]" in upgrade
    assert "stderr e' intenzionalmente scartato" in upgrade

    assert '"upgrade"' in panel[panel.index("const SETUP_ACTIONS") : panel.index("const SETUP_SECTIONS")]
    assert '"upgrade-check"' in panel[panel.index("const SETUP_ACTIONS") : panel.index("const SETUP_SECTIONS")]
    assert "setup.runtime_update_busy" in panel
    assert "setup.busy_upgrade" in panel
    assert "SetupService.check_runtime_update" in panel
    assert "setup.runtime_check" in panel

    # L'icona diretta e' sola navigazione: nessun check ad ogni apertura,
    # nessun polling e nessun uso di restartRequired come badge update.
    sidebar = _src("game/scripts/ui/game_sidebar.gd")
    assert '_docker_button.pressed.connect(func() -> void: _select("docker"))' in sidebar
    assert "static func docker_sidebar_state" in sidebar
    assert "SetupService.runtime_update_check_state()" in sidebar
    assert "check_runtime_update" not in sidebar
    assert "restartRequired" not in sidebar


def test_runtime_installer_cleans_download_when_interrupted(tmp_path):
    setup = _src("game/scripts/setup/setup_service.gd")
    function = setup[
        setup.index("static func _posix_runtime_install_command()") :
        setup.index("static func default_vps_key_path()")
    ]
    return_expression = function[function.index("return ") :]
    fragments = re.findall(r'"(?:\\.|[^"\\])*"', return_expression)
    command = "".join(json.loads(fragment) for fragment in fragments)

    installer = tmp_path / "installer.sh"
    command = command.replace(
        "https://jobhunterteam.ai/install.sh", installer.as_uri()
    )
    runtime_tmp = tmp_path / "runtime-tmp"
    runtime_tmp.mkdir()
    ready = tmp_path / "installer-ready"
    installer.write_text(
        '#!/bin/bash\ntouch "$READY_FILE"\nsleep 30\n', encoding="utf-8"
    )
    env = os.environ.copy()
    env["TMPDIR"] = str(runtime_tmp)
    env["READY_FILE"] = str(ready)
    for interrupt, expected_code in (
        (signal.SIGHUP, 129),
        (signal.SIGINT, 130),
        (signal.SIGTERM, 143),
    ):
        ready.unlink(missing_ok=True)
        process = subprocess.Popen(
            ["/bin/sh", "-c", command],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not ready.exists():
                assert process.poll() is None
                time.sleep(0.02)
            assert ready.exists()
            assert list(runtime_tmp.glob("jht-install.*"))
            os.killpg(process.pid, interrupt)
            assert process.wait(timeout=5) == expected_code
            assert not list(runtime_tmp.glob("jht-install.*"))
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


def test_macos_installer_finds_homebrew_from_finder_path():
    installer = _src("scripts/install.sh")
    block = installer[
        installer.index("install_brew_if_missing()") :
        installer.index("install_colima_macos()")
    ]
    assert "/opt/homebrew/bin/brew /usr/local/bin/brew" in block
    assert 'eval "$("$brew_bin" shellenv)"' in block
