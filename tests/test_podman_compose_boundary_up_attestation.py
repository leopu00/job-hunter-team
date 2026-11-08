"""Exact compose boundary: up attestation."""

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
    _docker_calls,
    _provider_podman_calls,
    _run,
    _runtime,
    pytest,
)


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    tuple(case for case in UNTRUSTED_CONTAINER_CASES if case[0] not in ("zero", "stale")),
)
def test_up_rejects_untrusted_existing_container_before_any_mutation(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case

    result = _run(wrapper, env, "up")

    assert result.returncode != 0
    assert not create_marker.exists()
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
        # The refusal then looks, read-only, twice more: whether it is a container of ours that only
        # stopped with the hash of an earlier compose (the one `up` recreates), and for one that
        # only changed its config-hash (stale_config_hint): two more id listings.
        expected_provider_calls.append((MACHINE, PS_Q_CHILD))
        expected_provider_calls.append((MACHINE, PS_Q_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    compose_calls = _actual_compose_calls(env)
    _assert_literal_project(compose_calls)
    ps_calls = [call for call in compose_calls if call[1][-2:] == ["ps", "-q"]]
    assert len(ps_calls) == (3 if inspect_expected else 1)
    assert not any("up" in args and "--dry-run" not in args for _, args in compose_calls)
    inspect_calls = [
        args
        for _, args in _docker_calls(env)
        if args and args[0] == "inspect"
    ]
    assert bool(inspect_calls) is inspect_expected
    if inspect_expected:
        _assert_hash_probes_are_read_only(env)
