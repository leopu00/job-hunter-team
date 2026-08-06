"""Contratti dello spegnimento desktop bounded e localmente corretto."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SETUP = ROOT / "game/scripts/setup/setup_service.gd"
GAME = ROOT / "game/scripts/game.gd"
CLIENT_CONTROL = ROOT / "game/scripts/client_control.gd"


def test_shutdown_worker_is_joined_but_every_docker_command_is_bounded():
    game = GAME.read_text(encoding="utf-8")
    setup = SETUP.read_text(encoding="utf-8")

    assert "WorkerThreadPool.wait_for_task_completion(_shutdown_task)" in game
    runner = setup[
        setup.index("static func _run_shutdown_command") :
        setup.index("func shutdown_team")
    ]
    assert 'OS.create_process("docker", argv, false)' in runner
    assert "OS.is_process_running(pid)" in runner
    assert "SHUTDOWN_COMMAND_TIMEOUT_MS" in runner
    assert "OS.kill(pid)" in runner

    shutdown = setup[
        setup.index("func shutdown_team") : setup.index("func _vps_config")
    ]
    assert "_run_shutdown_command(argv)" in shutdown
    assert '_run("docker", argv)' not in shutdown


def test_local_live_backend_never_inherits_stale_vps_shutdown_policy():
    setup = SETUP.read_text(encoding="utf-8")
    vps_config = setup[setup.index("func _vps_config") :]
    assert "BackendBus.is_remote()" in vps_config
    assert "BackendBus.is_live()" not in vps_config.split("\n\n", 1)[0]


def test_cli_stop_detaches_without_stopping_team_and_targets_instance_nonce():
    game = GAME.read_text(encoding="utf-8")
    control = CLIENT_CONTROL.read_text(encoding="utf-8")
    detach = game[game.index("func detach_from_cli") : game.index("func _do_quit")]

    assert "HeadlessSession.record_exit(true)" in detach
    assert "_do_quit(false)" in detach
    assert "shutdown_team" not in detach
    assert game.count("get_tree().quit()") == 1
    for seam in (
        "target_instance_id",
        "instance_id",
        "request_id",
        "DisplayServer.window_move_to_foreground()",
        "DisplayServer.window_request_attention()",
        "DisplayServer.window_is_focused()",
        'DisplayServer.get_name() == "headless"',
        'OS.get_environment("JHT_GAME_CONTROL_DIR")',
        "OS.get_cmdline_user_args()",
    ):
        assert seam in control
