"""Exact compose boundary: upgrade flow."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    HASH_PROBE_CHILD,
    MACHINE,
    PODMAN_UNIT,
    PS_Q_CHILD,
    Path,
    _actual_compose_calls,
    _assert_hash_probes_are_read_only,
    _assert_literal_project,
    _assert_only_podman_path_option,
    _compose_calls,
    _direct_podman_calls,
    _docker_calls,
    _events,
    _provider_podman_calls,
    _run,
    _runtime,
    hashlib,
    json,
    pytest,
)


def test_upgrade_with_a_stopped_team_of_ours_counts_it_as_absent_and_never_asks_for_volumes(tmp_path: Path):
    # Decision: an upgrade with the team stopped takes the baseline as «absent» (nothing runs, nothing to put
    # back) and goes on; the stopped container is not a reason to refuse. The app is told the team is «ferma»,
    # not «non-installata», and a failed upgrade removes the new container without ever touching the volumes.
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "stale"
    # the emulated container never starts, so the verification of the new runtime fails by design: two
    # observations are enough to say so (twenty took 40-50 s, close to the 60 s of WRAPPER_TIMEOUT_S, and
    # timed out on a busy machine)
    env["JHT_UPGRADE_VERIFY_TRIES"] = "2"

    result = _run(wrapper, env, "upgrade", "--apply", "--json")

    report = json.loads(result.stdout)
    assert report["message"] != "Container esistente non attestabile"
    assert report["phase"] != "preflight"
    assert report["previous"] == {"version": "ferma", "image": "none"}
    assert report["rolledBack"] is False
    compose_calls = [args for _, args in _actual_compose_calls(env)]
    assert any("up" in args and "--dry-run" not in args for args in compose_calls)
    rollback = [args for args in compose_calls if "rm" in args]
    assert rollback and all(args[-2:] == ["-sf", "jht"] for args in rollback)
    assert not any(
        flag in args for args in compose_calls for flag in ("-v", "--volumes", "-fsv", "-sfv")
    )



@pytest.mark.parametrize("inherited_connection", [None, "user-default-machine"])
def test_upgrade_check_uses_the_same_exact_version_named_connection_contract(
    tmp_path: Path, inherited_connection: str | None
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    if inherited_connection is not None:
        env["CONTAINER_CONNECTION"] = inherited_connection

    result = _run(wrapper, env, "upgrade", "--check", "--json")

    assert result.returncode == 0, result.stderr
    assert '"ok":true' in result.stdout
    assert not create_marker.exists()
    compose_calls = _actual_compose_calls(env)
    assert any(args[-2:] == ["config", "-q"] for _, args in compose_calls)
    assert any(args[-2:] == ["pull", "jht"] for _, args in compose_calls)
    # the image comes from the normalized config: podman-compose 1.6.0 refuses `config --images`
    assert any(args[-1:] == ["config"] for _, args in compose_calls)
    _assert_only_podman_path_option(compose_calls)
    _assert_literal_project(compose_calls)
    assert all(connection == MACHINE for connection, _ in _compose_calls(env))
    calls = _provider_podman_calls(podman_log)
    assert calls == [
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, ["pull", "jht"]),
    ]
    _assert_hash_probes_are_read_only(env)
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert all(connection == "" for connection, _ in _docker_calls(env))



def test_upgrade_activate_commits_canonical_project_metadata_for_later_probes(
    tmp_path: Path,
):
    wrapper, env, _, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    runtime = Path(env["JHT_RUNTIME_DIR"])
    canonical_path = runtime / "docker-compose.yml"
    canonical_compose = str(canonical_path)
    baseline_bytes = canonical_path.read_bytes()
    candidate_path = Path(env["JHT_FIXTURE_CANDIDATE_COMPOSE"])
    candidate_bytes = candidate_path.read_bytes()
    assert baseline_bytes != candidate_bytes

    upgraded = _run(wrapper, env, "upgrade", "--apply", "--json")

    assert upgraded.returncode == 0, upgraded.stderr
    assert '"ok":true' in upgraded.stdout
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    metadata = json.loads(
        Path(env["JHT_FIXTURE_CONTAINER_METADATA"]).read_text(encoding="utf-8")
    )
    assert metadata["name"] == "jht"
    assert metadata["io_project"] == metadata["com_project"] == "jht"
    assert metadata["working_dir"] == str(runtime)
    assert metadata["config_files"] == canonical_compose
    assert metadata["io_service"] == metadata["com_service"] == "jht"
    assert metadata["container_number"] == "1"
    assert metadata["provider_version"] == "1.6.0"
    assert metadata["systemd_unit"] == PODMAN_UNIT
    assert metadata["config_hash"] == env["JHT_FIXTURE_CANDIDATE_CONFIG_HASH"]
    assert metadata["image_digest"] == env["JHT_FIXTURE_IMAGE_DIGEST"]
    assert metadata["compose_digest"] == hashlib.sha256(candidate_bytes).hexdigest()
    assert ".upgrade-stage." not in json.dumps(metadata)
    assert canonical_path.read_bytes() == candidate_bytes

    up_calls = [
        args
        for _, args in _actual_compose_calls(env)
        if "up" in args and "--dry-run" not in args
    ]
    assert len(up_calls) == 1
    assert up_calls[0][up_calls[0].index("-f") + 1] == canonical_compose
    assert up_calls[0][up_calls[0].index("-p") + 1] == "jht"
    assert up_calls[0][up_calls[0].index("up") + 1 :] == [
        "-d",
        "--force-recreate",
        "jht",
    ]
    stage_calls = [
        args
        for _, args in _actual_compose_calls(env)
        if ".upgrade-stage." in " ".join(args)
    ]
    assert stage_calls
    assert all("up" not in args for args in stage_calls)
    assert all(
        any(command in args for command in ("config", "pull")) for args in stage_calls
    )

    events = _events(env)
    create_index = next(
        index
        for index, event in enumerate(events)
        if event["tool"] == "podman" and event["args"] == ["create", "jht"]
    )
    ownership_inspects = [
        index
        for index, event in enumerate(events)
        if event["tool"] == "docker"
        and event["args"]
        and event["args"][0] == "inspect"
        and ".Name" in " ".join(event["args"])
    ]
    assert any(index < create_index for index in ownership_inspects)
    assert any(index > create_index for index in ownership_inspects)

    chat = _run(wrapper, env, "desktop-chat", "probe")
    snapshot = _run(wrapper, env, "onboarding-snapshot")

    assert chat.returncode == 0, chat.stderr
    assert chat.stdout == "true\n"
    assert snapshot.returncode == 0, snapshot.stderr
    assert "runtimeInstalled=1" in snapshot.stdout
    assert "containerRunning=1" in snapshot.stdout
    assert all(connection == "" for connection, _ in _docker_calls(env))
