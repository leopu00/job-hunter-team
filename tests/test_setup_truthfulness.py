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

ROOT = Path(__file__).resolve().parent.parent


def _src(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_setup_cta_does_not_cover_truth_badge():
    sidebar = _src("game/scripts/ui/game_sidebar.gd")
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "Vector2(-190, 58)" in sidebar
    assert "position = Vector2((get_parent_area_size().x - size.x) / 2.0, 14)" in badge


def test_truth_badge_tracks_demo_data_not_only_connection():
    badge = _src("game/scripts/ui/sim_badge.gd")
    assert "BackendBus.positions_updated.connect" in badge
    assert "BackendBus.is_live() and not BackendBus.positions_are_demo" in badge


def test_live_empty_database_never_falls_back_to_mock_kpis():
    hud = _src("game/scripts/office/team_hud.gd")
    assert "BackendBus.is_live() and not BackendBus.positions_are_demo" in hud
    assert "BackendBus.kpi_summary()" in hud


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
