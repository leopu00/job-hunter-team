"""Exact compose boundary: upgrade attestation."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    HASH_PROBE_CHILD,
    MACHINE,
    PS_Q_CHILD,
    Path,
    UNTRUSTED_CONTAINER_CASES,
    _actual_compose_calls,
    _actual_podman_calls,
    _provider_podman_calls,
    _run,
    _runtime,
    pytest,
)


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    tuple(case for case in UNTRUSTED_CONTAINER_CASES if case[0] not in ("zero", "stale")),
)
def test_upgrade_rejects_untrusted_baseline_before_publish_or_up(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case
    canonical = Path(env["JHT_COMPOSE_FILE"])
    baseline_bytes = canonical.read_bytes()

    result = _run(wrapper, env, "upgrade", "--apply", "--json")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert canonical.read_bytes() == baseline_bytes
    assert not any(
        "up" in args and "--dry-run" not in args
        for _, args in _actual_compose_calls(env)
    )
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    assert not any(
        args and args[0] == "machine" for _, args in _actual_podman_calls(podman_log)
    )
    assert not any(
        command in args
        for _, args in _actual_compose_calls(env)
        for command in ("config", "pull")
    )
