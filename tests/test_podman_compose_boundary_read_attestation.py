"""Exact compose boundary: read attestation."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    HASH_PROBE_CHILD,
    MACHINE,
    PS_Q_CHILD,
    Path,
    UNTRUSTED_CONTAINER_CASES,
    _actual_compose_calls,
    _assert_hash_probes_are_read_only,
    _assert_literal_project,
    _direct_podman_calls,
    _docker_calls,
    _podman_calls,
    _provider_podman_calls,
    _run,
    _runtime,
    json,
    pytest,
    shutil,
    subprocess,
)


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    UNTRUSTED_CONTAINER_CASES,
)
def test_read_only_ps_rejects_unowned_ambiguous_or_stale_ids_without_create(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case

    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert not create_marker.exists()
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert not any(args and args[0] == "machine" for _, args in _podman_calls(podman_log))
    compose_calls = _actual_compose_calls(env)
    _assert_literal_project(compose_calls)
    ps_calls = [call for call in compose_calls if call[1][-2:] == ["ps", "-q"]]
    assert len(ps_calls) == 1
    assert ps_calls[0][0] == MACHINE
    docker_calls = _docker_calls(env)
    inspect_calls = [args for _, args in docker_calls if args and args[0] == "inspect"]
    assert bool(inspect_calls) is inspect_expected
    assert all(connection == "" for connection, _ in docker_calls)
    if inspect_expected:
        _assert_hash_probes_are_read_only(env)



def test_literal_project_does_not_adopt_a_stage_compose_container(tmp_path: Path):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    stage = runtime / ".upgrade-stage.fixture"
    stage.mkdir()
    stage_compose = stage / "docker-compose.yml"
    shutil.copy2(env["JHT_COMPOSE_FILE"], stage_compose)
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    staged_up = subprocess.run(
        [
            "podman-compose",
            "--podman-path",
            "podman",
            "-f",
            str(stage_compose),
            "-p",
            "jht",
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
    assert staged_up.returncode == 0, staged_up.stderr
    assert create_marker.exists()
    metadata = json.loads(
        Path(env["JHT_FIXTURE_CONTAINER_METADATA"]).read_text(encoding="utf-8")
    )
    assert metadata["io_project"] == metadata["com_project"] == "jht"
    assert metadata["working_dir"] == str(stage)
    assert metadata["config_files"] == str(stage_compose)
    assert metadata["config_hash"] == env["JHT_FIXTURE_CONFIG_HASH"]

    creates_before_probe = sum(
        args == ["create", "jht"] for _, args in _provider_podman_calls(podman_log)
    )
    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert sum(
        args == ["create", "jht"] for _, args in _provider_podman_calls(podman_log)
    ) == creates_before_probe
    assert any(
        args == PS_Q_CHILD for _, args in _provider_podman_calls(podman_log)
    )



def test_read_only_ps_fails_closed_without_create_on_connection_incompatibility(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED"] = "0"

    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == []
    assert _actual_compose_calls(env) == []
    assert ("", ["--connection", MACHINE, "info"]) in _direct_podman_calls(
        podman_log
    )
