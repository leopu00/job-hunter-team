"""Exact compose boundary: gates."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    CONTAINER_ID,
    MACHINE,
    OPERATIONS,
    Path,
    WRAPPER,
    _actual_compose_calls,
    _actual_podman_calls,
    _attest_machine,
    _compose_calls,
    _docker_calls,
    _docker_runtime_target,
    _minimal_path,
    _podman_calls,
    _probe_version,
    _run,
    _run_installer_podman_preflight,
    _runtime,
    _tools_outside_path,
    _wrapper_functions,
    hashlib,
    os,
    pytest,
    shutil,
    subprocess,
)


@pytest.mark.parametrize(
    "operation",
    (
        ("logs", "--tail", "1"),
        ("status",),
        ("shell",),
        ("providers", "current"),
    ),
)
def test_runtime_operations_use_only_the_attested_container_id(
    tmp_path: Path, operation: tuple[str, ...]
):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_CONTAINER_NAME"] = "same-name-decoy"

    result = _run(wrapper, env, *operation)

    assert result.returncode == 0, result.stderr
    targets = [
        target
        for _, args in _docker_calls(env)
        if (target := _docker_runtime_target(args)) is not None
    ]
    assert targets
    assert set(targets) == {CONTAINER_ID}
    assert all(
        "same-name-decoy" not in args and "jht" not in args
        for _, args in _docker_calls(env)
    )



def test_host_download_is_checked_on_the_host_and_never_calls_the_container(
    tmp_path: Path,
):
    # The download used to be copied from the attested container (docker cp, cleaned up there): it is now fetched and checked
    # by the host from the release, in a private folder, and the container is no longer part of the command.
    import threading
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    asset = b"verified release bytes\n"
    release = tmp_path / "site" / "v0.4.0"
    release.mkdir(parents=True)
    (release / "job-hunter-team-macos-universal.dmg").write_bytes(asset)
    (release / "SHA256SUMS").write_text(
        f"{hashlib.sha256(asset).hexdigest()}  job-hunter-team-macos-universal.dmg\n", encoding="utf-8"
    )

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(tmp_path / "site")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        wrapper, env, _, _ = _runtime(tmp_path)
        env["JHT_CONTAINER_NAME"] = "same-name-decoy"
        env["JHT_RELEASE_BASE_URL"] = f"http://127.0.0.1:{server.server_port}"
        env["JHT_DOWNLOAD_HOST"] = "darwin-arm64"
        # the fixture's curl only knows the runtime files of the upgrade: the download needs the real one
        real_curl = shutil.which("curl", path=os.environ["PATH"])
        assert real_curl, "curl is needed to download"
        real_bin = tmp_path / "real-curl-bin"
        real_bin.mkdir()
        (real_bin / "curl").symlink_to(real_curl)
        env["PATH"] = f"{real_bin}{os.pathsep}{env['PATH']}"
        destination = tmp_path / "downloads" / "desktop.dmg"

        result = _run(
            wrapper,
            env,
            "download",
            "--os",
            "macos",
            "--version",
            "0.4.0",
            "--output",
            str(destination),
        )
    finally:
        server.shutdown()
        server.server_close()

    assert result.returncode == 0, result.stderr
    assert destination.read_bytes() == asset
    assert hashlib.sha256(asset).hexdigest() in result.stdout
    # no call to any container engine for the download: not an exec, not a cp, not an inspect of the attested id or of a name
    assert _docker_calls(env) == []
    assert not [p for p in destination.parent.iterdir() if ".part" in p.name]



@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize(
    ("variable", "unsupported"),
    (
        ("JHT_FIXTURE_COMPOSE_VERSION", "1.5.0"),
        ("JHT_FIXTURE_PODMAN_VERSION", "6.2.0"),
    ),
)
def test_unsupported_exact_version_fails_before_any_compose_operation(
    tmp_path: Path,
    operation: tuple[str, ...],
    variable: str,
    unsupported: str,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env[variable] = unsupported

    result = _run(wrapper, env, *operation)

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _actual_compose_calls(env) == []
    assert _actual_podman_calls(podman_log) == []
    compose_calls = _compose_calls(env)
    assert all(connection == MACHINE for connection, _ in compose_calls)
    if variable == "JHT_FIXTURE_COMPOSE_VERSION":
        assert compose_calls
    assert all(connection == "" for connection, _ in _podman_calls(podman_log))



@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize(
    "machine_state",
    ("override-mismatch", "missing", "empty", "invalid"),
)
def test_unattested_or_ambiguous_machine_name_fails_before_compose(
    tmp_path: Path,
    operation: tuple[str, ...],
    machine_state: str,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    machine = Path(env["JHT_RUNTIME_DIR"]) / "podman-machine"
    if machine_state == "override-mismatch":
        env["JHT_PODMAN_MACHINE"] = "other-machine"
    elif machine_state == "missing":
        machine.unlink()
    elif machine_state == "empty":
        _attest_machine(env, "")
    else:
        _attest_machine(env, "invalid/name\n")

    result = _run(wrapper, env, *operation)

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _compose_calls(env) == []
    assert _actual_podman_calls(podman_log) == []



@pytest.mark.parametrize(
    ("variable", "unsupported"),
    (
        ("JHT_FIXTURE_COMPOSE_VERSION", "1.5.0"),
        ("JHT_FIXTURE_PODMAN_VERSION", "6.2.0"),
    ),
)
def test_installer_version_mismatch_precedes_every_machine_or_provider_action(
    tmp_path: Path,
    variable: str,
    unsupported: str,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    env[variable] = unsupported

    result = _run_installer_podman_preflight(env)

    assert result.returncode != 0
    assert not create_marker.exists()
    podman_calls = _podman_calls(podman_log)
    compose_calls = _compose_calls(env)
    assert podman_calls
    assert all(call == ("", ["--version"]) for call in podman_calls)
    assert all(call == (MACHINE, ["--version"]) for call in compose_calls)
    if variable == "JHT_FIXTURE_COMPOSE_VERSION":
        assert compose_calls



def test_the_version_probe_of_podman_compose_works_when_podman_is_not_on_the_callers_path(tmp_path: Path):
    done = _probe_version(tmp_path, ensure=True)
    assert done.returncode == 0 and done.stdout.strip() == "1.6.0", (done.stdout, done.stderr)



def test_without_the_directory_of_podman_the_probe_fails_which_is_the_case_of_the_report(tmp_path: Path):
    done = _probe_version(tmp_path, ensure=False)
    assert done.stdout.strip() == "", done.stdout



def test_the_directory_of_podman_goes_at_the_end_of_the_path_and_only_once(tmp_path: Path):
    tools = _tools_outside_path(tmp_path)
    minimal = _minimal_path(tmp_path)
    script = (
        f'PATH="{minimal}"\npodman_binary() {{ printf "%s\\n" "{tools}/podman"; }}\n'
        + _wrapper_functions("podman_ensure_on_path")
        + "\npodman_ensure_on_path; podman_ensure_on_path; printf '%s' \"$PATH\"\n"
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)
    assert done.stdout == f"{minimal}:{tools}", done.stdout



def test_every_call_of_the_provider_makes_sure_podman_is_on_the_path():
    text = WRAPPER.read_text(encoding="utf-8")
    for name in ("podman_compose_version_number", "podman_compose_pair_supported", "podman_expected_config_hash"):
        body = _wrapper_functions(name)
        assert "podman_ensure_on_path" in body, name
    assert "podman_ensure_on_path\n    podman_bin=\"$(podman_binary)\"" in text            # compose_file
