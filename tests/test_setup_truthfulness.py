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
    assert 'var team_running := bool(status.get("team_running", false))' in office
    assert 'agent.set_backend_status("working" if team_running else "idle")' in office


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
    assert r'''call set JHT_EXIT_CODE=^%%errorlevel^%%''' in setup
    assert r'''call set \"JHT_EXIT_CODE=''' not in setup
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
