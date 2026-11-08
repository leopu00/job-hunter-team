"""Exact compose boundary: lifecycle."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    HASH_PROBE_CHILD,
    MACHINE,
    PS_Q_CHILD,
    PS_UP_CHILD,
    Path,
    WEB_AUTHORISATION_INSPECTS,
    WEB_AUTHORISATION_LOOKUPS,
    _actual_compose_calls,
    _assert_hash_probes_are_read_only,
    _direct_podman_calls,
    _docker_calls,
    _podman_calls,
    _provider_podman_calls,
    _run,
    _runtime,
    os,
)


def test_up_starts_a_stopped_container_of_ours_instead_of_refusing_it(tmp_path: Path):
    # The old «stale» case: the container exists, Exited, every label and the hash as expected. podman-compose
    # 1.6.0 lists it (its `ps` is `podman ps -a`); it is ours and simply not running, so `up` goes on.
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "stale"

    result = _run(wrapper, env, "up")

    # the fixture's container stays Exited after `up` (it does not model the start), so the check after
    # `up` cannot pass here; what is decided is that the precheck did not refuse and `up` ran once
    assert "esistente non attestabile" not in result.stderr
    real_up = [args for _, args in _actual_compose_calls(env) if "up" in args and "--dry-run" not in args]
    assert len(real_up) == 1



def test_up_creates_only_when_precheck_finds_no_existing_project_container(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"

    result = _run(wrapper, env, "up")

    assert result.returncode == 0, result.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    assert [args for _, args in _provider_podman_calls(podman_log)] == [
        PS_Q_CHILD,
        PS_UP_CHILD,
        ["create", "jht"],
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        *WEB_AUTHORISATION_LOOKUPS,
    ]
    inspect_calls = [
        args
        for _, args in _docker_calls(env)
        if args and args[0] == "inspect"
    ]
    assert len(inspect_calls) == 1 + WEB_AUTHORISATION_INSPECTS
    assert ".Name" in " ".join(inspect_calls[0])
    _assert_hash_probes_are_read_only(env)



def test_up_makes_the_host_folder_the_compose_mounts_a_volume_in(tmp_path: Path):
    # docker-compose.yml mounts the volume jht-runtime-mask on /jht_home/runtime, inside the ~/.jht bind. On an
    # empty ~/.jht a Podman machine cannot make that mount point (smoke of the Mac: crun, Operation not permitted),
    # so `up` makes it before the engine is asked: private, never a chown, and left alone when it is there.
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"
    env["JHT_FIXTURE_REQUIRE_MOUNT_POINT"] = "1"
    jht_home = Path(env["HOME"]) / ".jht"
    jht_home.mkdir(mode=0o700)
    assert not (jht_home / "runtime").exists()

    result = _run(wrapper, env, "up")

    assert "Operation not permitted" not in result.stderr, result.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    assert (jht_home / "runtime").is_dir()
    assert (jht_home / "runtime").stat().st_mode & 0o777 == 0o700
    assert jht_home.stat().st_mode & 0o777 == 0o700
    assert jht_home.stat().st_uid == os.getuid()

    # idempotent, and a folder that is already there is not touched (its mode stays)
    (jht_home / "runtime").chmod(0o755)
    (jht_home / "runtime" / "kept").write_text("x", encoding="utf-8")
    create_marker.unlink()
    again = _run(wrapper, env, "up")
    assert "Operation not permitted" not in again.stderr, again.stderr
    assert (jht_home / "runtime").stat().st_mode & 0o777 == 0o755
    assert (jht_home / "runtime" / "kept").read_text(encoding="utf-8") == "x"



def test_up_makes_the_whole_data_folder_too_when_it_is_missing(tmp_path: Path):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"
    env["JHT_FIXTURE_REQUIRE_MOUNT_POINT"] = "1"
    jht_home = Path(env["HOME"]) / ".jht"
    assert not jht_home.exists()

    result = _run(wrapper, env, "up")

    assert "Operation not permitted" not in result.stderr, result.stderr
    # ~/.jht is made as the system makes any folder: on Linux with Docker it is handed to the container's user
    # right after, and a 700 there could not be read by the person; only the folder made here is private
    umask = os.umask(0)
    os.umask(umask)
    assert jht_home.stat().st_mode & 0o777 == 0o777 & ~umask
    assert (jht_home / "runtime").is_dir()
    assert (jht_home / "runtime").stat().st_mode & 0o777 == 0o700



def test_named_connection_incompatibility_propagates_125_without_create(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED"] = "0"

    result = _run(wrapper, env, "up")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == []
    assert _actual_compose_calls(env) == []
    assert ("", ["--connection", MACHINE, "info"]) in _direct_podman_calls(
        podman_log
    )



def test_machine_start_never_inherits_the_provider_connection(tmp_path: Path):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    env["JHT_FIXTURE_REQUIRE_WAKE"] = "1"

    result = _run(wrapper, env, "up")

    assert result.returncode == 0, result.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    calls = _podman_calls(podman_log)
    machine_calls = [
        (connection, args)
        for connection, args in calls
        if args and args[0] == "machine"
    ]
    provider_calls = _provider_podman_calls(podman_log)
    assert machine_calls == [
        ("", ["machine", "start", "--update-connection=false", MACHINE])
    ]
    assert provider_calls
    assert all(connection == MACHINE for connection, _ in provider_calls)
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert all(connection == "" for connection, _ in _docker_calls(env))
