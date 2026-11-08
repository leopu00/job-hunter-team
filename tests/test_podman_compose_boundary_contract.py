"""Exact compose boundary: contract."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    CONTAINER_ID,
    HASH_PROBE_CHILD,
    MACHINE,
    PS_Q_CHILD,
    PS_UP_CHILD,
    Path,
    WEB_AUTHORISATION_INSPECTS,
    WEB_AUTHORISATION_LOOKUPS,
    _actual_compose_calls,
    _assert_hash_probes_are_read_only,
    _assert_literal_project,
    _assert_only_podman_path_option,
    _compose_calls,
    _direct_podman_calls,
    _docker_calls,
    _provider_podman_calls,
    _run,
    _runtime,
    pytest,
    subprocess,
)


@pytest.mark.parametrize("inherited_connection", [None, "user-default-machine"])
@pytest.mark.parametrize("machine_override", [None, MACHINE])
def test_exact_supported_versions_use_named_connection_for_real_ps_and_up(
    tmp_path: Path,
    inherited_connection: str | None,
    machine_override: str | None,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    if inherited_connection is None:
        env.pop("CONTAINER_CONNECTION", None)
    else:
        env["CONTAINER_CONNECTION"] = inherited_connection
    if machine_override is not None:
        env["JHT_PODMAN_MACHINE"] = machine_override

    podman_version = subprocess.run(
        ["podman", "--version"], env=env, text=True, capture_output=True, check=False
    )
    compose_version = subprocess.run(
        ["podman-compose", "--version"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert podman_version.stdout.strip() == "podman version 6.1.3"
    assert compose_version.stdout.strip() == "podman-compose version 1.6.0"
    podman_log.unlink()
    Path(env["JHT_FIXTURE_COMPOSE_LOG"]).unlink()

    probe = _run(wrapper, env, "desktop-chat", "probe")
    up = _run(wrapper, env, "up")

    assert probe.returncode == 0, probe.stderr
    assert probe.stdout == "true\n"
    assert up.returncode == 0, up.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    assert any(args == ["--version"] for _, args in _compose_calls(env))
    _assert_only_podman_path_option(_compose_calls(env))
    assert all(connection == MACHINE for connection, _ in _compose_calls(env))
    _assert_literal_project(_actual_compose_calls(env))
    calls = _provider_podman_calls(podman_log)
    assert [args for _, args in calls] == [
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        PS_UP_CHILD,
        ["create", "jht"],
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        *WEB_AUTHORISATION_LOOKUPS,
    ]
    assert all(connection == MACHINE for connection, _ in calls)
    direct_calls = _direct_podman_calls(podman_log)
    assert direct_calls
    assert all(connection == "" for connection, _ in direct_calls)
    assert any(
        args == ["--connection", MACHINE, "info"] for _, args in direct_calls
    )
    assert all(
        not any(arg == "--connection" or arg.startswith("--connection=") for arg in args[1:])
        for _, args in calls
    )
    _assert_hash_probes_are_read_only(env)
    docker_calls = _docker_calls(env)
    assert any(args and args[0] == "info" for _, args in docker_calls)
    assert any(args and args[0] == "inspect" for _, args in docker_calls)
    assert all(connection == "" for connection, _ in docker_calls)
    inspect = [args for _, args in docker_calls if args and args[0] == "inspect"]
    assert len(inspect) == 3 + WEB_AUTHORISATION_INSPECTS
    for inspect_call in inspect:
        assert inspect_call[1:3] == ["--type", "container"]
        inspect_argv = " ".join(inspect_call)
        for field in (
            ".Name",
            "io.podman.compose.project",
            "com.docker.compose.project",
            "com.docker.compose.project.working_dir",
            "com.docker.compose.project.config_files",
            "io.podman.compose.service",
            "com.docker.compose.service",
            "com.docker.compose.container-number",
            "io.podman.compose.version",
            "PODMAN_SYSTEMD_UNIT",
            "io.podman.compose.config-hash",
        ):
            assert field in inspect_argv



def test_exact_1_6_fixture_accepts_ps_q_and_rejects_service_operand(tmp_path: Path):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    compose_file = Path(env["JHT_RUNTIME_DIR"]) / "docker-compose.yml"
    common = [
        "podman-compose",
        "--podman-path",
        "podman",
        "-f",
        str(compose_file),
        "-p",
        "jht",
        "ps",
        "-q",
    ]
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    accepted = subprocess.run(
        common,
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )
    rejected = subprocess.run(
        [*common, "jht"],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert accepted.returncode == 0
    assert accepted.stdout.strip() == CONTAINER_ID
    assert rejected.returncode == 2
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == [(MACHINE, PS_Q_CHILD)]



def test_exact_1_6_dry_run_hash_probe_executes_only_read_only_podman_output(
    tmp_path: Path,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    compose_file = Path(env["JHT_COMPOSE_FILE"])
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    result = subprocess.run(
        [
            "podman-compose",
            "--verbose",
            "--dry-run",
            "--project-name",
            "jht",
            "--podman-path",
            "podman",
            "-f",
            str(compose_file),
            "up",
            "-d",
            "--force-recreate",
            "jht",
        ],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert f"io.podman.compose.config-hash={env['JHT_FIXTURE_CONFIG_HASH']}" in result.stderr
    assert _provider_podman_calls(podman_log) == [(MACHINE, HASH_PROBE_CHILD)]
    assert not create_marker.exists()
    _assert_hash_probes_are_read_only(env)



def test_exact_1_6_rejects_connection_injected_after_ps_with_exit_125(
    tmp_path: Path,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    result = subprocess.run(
        [
            "podman-compose",
            "--podman-path",
            "podman",
            "--podman-args",
            f"--connection {MACHINE}",
            "-f",
            env["JHT_COMPOSE_FILE"],
            "-p",
            "jht",
            "ps",
            "-q",
        ],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 125
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == [
        (
            MACHINE,
            [
                "ps",
                "--connection",
                MACHINE,
                "-a",
                "--filter",
                "label=io.podman.compose.project=jht",
                "--format",
                "{{.ID}}",
            ],
        )
    ]
