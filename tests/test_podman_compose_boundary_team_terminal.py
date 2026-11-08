"""Exact compose boundary: team terminal."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    Path,
    _run,
    _run_in_terminal,
    _runtime,
    _team,
)


def test_team_stop_works_for_a_container_that_only_its_hash_does_not_attest(tmp_path: Path):
    """A container made with another key is not «exactly ours» for `status`, and `jht team stop --all` answered «avvio automatico
    negato»: the person could not stop the team. Every other label still attests it, as for `jht down`."""
    result, created = _team(tmp_path, "stop", "--all", key="sk-test-terminal", made_with="sk-another")
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert "avvio automatico negato" not in result.stderr and "config_changed_while_running" in result.stderr
    assert not created.exists()



def test_team_stop_still_refuses_a_container_that_is_not_ours_by_any_other_label(tmp_path: Path):
    wrapper, env, _, created = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "wrong-working-dir"
    result = _run(wrapper, env, "team", "stop", "--all")
    assert result.returncode != 0 and not created.exists()



def test_other_team_commands_still_need_the_exact_attestation(tmp_path: Path):
    result, created = _team(tmp_path, "status", key="sk-test-terminal", made_with="sk-another")
    assert result.returncode != 0 and "avvio automatico negato" in result.stderr
    assert not created.exists()



def test_status_at_a_terminal_is_a_screen_with_the_next_step_and_on_a_pipe_it_is_what_the_app_reads(tmp_path: Path):
    import re
    wrapper, env, _podman_log, _create_marker = _runtime(tmp_path)
    env["JHT_LANG"] = "en"
    code, out = _run_in_terminal(wrapper, env, "status")
    plain = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", out)
    assert code == 0, plain
    assert "status=running" not in plain and "name=" not in plain
    assert re.search(r"Container\s+running since ", plain) and re.search(r"Image\s+\S+", plain)
    assert "→ Who is working: jht agents" in plain
    piped = _run(wrapper, env, "status")
    assert piped.returncode == 0 and "name=jht status=running" in piped.stdout
    forced_code, forced = _run_in_terminal(wrapper, {**env, "JHT_MACHINE_OUTPUT": "1"}, "status")
    assert forced_code == 0 and "status=running" in forced



def test_status_of_a_team_that_is_not_there_says_what_to_do_at_a_terminal(tmp_path: Path):
    import re
    wrapper, env, _podman_log, _create_marker = _runtime(tmp_path)
    env["JHT_LANG"] = "en"
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"                 # the project lists no container
    code, out = _run_in_terminal(wrapper, env, "status")
    plain = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", out)
    assert code == 1 and "The team's container is not running." in plain and "→ Start it with: jht up" in plain
    assert "non attivo" not in plain
    piped = _run(wrapper, env, "status")
    assert piped.returncode != 0 and "non attivo" in piped.stdout  # the app and the scripts keep the line they read
