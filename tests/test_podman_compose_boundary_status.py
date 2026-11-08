"""Exact compose boundary: status."""

from __future__ import annotations

from test_podman_compose_exact_version_boundary import (
    Path,
    ROOT,
    WRAPPER,
    _run,
    _runtime,
    _status,
)


def test_a_key_exported_in_the_terminal_does_not_make_the_running_team_inactive(tmp_path: Path):
    result, created = _status(tmp_path, key="sk-test-terminal", label_made_with=None)   # made clean, asked with a key
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert "non attivo" not in result.stdout and "status=running" in result.stdout
    assert not created.exists()



def test_the_same_container_with_no_key_anywhere_is_as_before(tmp_path: Path):
    result, _ = _status(tmp_path, key=None, label_made_with=None)
    assert result.returncode == 0 and "status=running" in result.stdout



def test_a_container_made_with_the_same_key_is_still_ours_for_that_terminal(tmp_path: Path):
    result, _ = _status(tmp_path, key="sk-test-terminal", label_made_with="sk-test-terminal")
    assert result.returncode == 0 and "status=running" in result.stdout



def test_a_container_made_with_another_key_is_not_a_free_pass(tmp_path: Path):
    result, _ = _status(tmp_path, key="sk-test-terminal", label_made_with="sk-another")
    assert result.returncode != 0
    # a container that is there and cannot be attested is not «non attivo»: it says so and names the variable (not its value)
    assert "non attestabile" in result.stdout and "non attivo" not in result.stdout
    assert "OPENAI_API_KEY" in result.stdout and "unset" in result.stdout and "sk-test-terminal" not in result.stdout



def test_a_wrong_hash_is_refused_with_a_key_exported_too(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_FIXTURE_ENV_IN_HASH"] = "1"
    env["OPENAI_API_KEY"] = "sk-test-terminal"
    env["JHT_FIXTURE_CONTAINER_CASE"] = "wrong-config-hash"
    result = _run(wrapper, env, "status")
    assert result.returncode != 0 and "non attestabile" in result.stdout and "OPENAI_API_KEY" in result.stdout



def test_the_caller_variables_the_wrapper_sets_aside_are_those_the_compose_takes():
    import re
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    wrapper = WRAPPER.read_text(encoding="utf-8")
    listed = set(re.search(r'^PODMAN_CALLER_ENV="([^"]+)"', wrapper, re.M).group(1).split())
    taken = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}", compose))
    # HOME is the same for everyone who asks; JHT_IMAGE comes from the channel pin; the three below are read from host.env
    # by the wrapper itself before any compose runs (so they do not follow the caller).
    taken -= {"HOME", "JHT_IMAGE", "JHT_HOST_TYPE", "JHT_LANG", "JHT_USER_TZ"}
    assert listed == taken, (sorted(listed ^ taken))



def test_status_with_no_container_at_all_still_says_not_active(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"                 # the project lists no container
    result = _run(wrapper, env, "status")
    assert result.returncode != 0 and "non attivo" in result.stdout and "non attestabile" not in result.stdout



def test_status_of_an_unattestable_container_without_a_caller_variable_names_none(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY"):
        env.pop(name, None)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "wrong-config-hash"
    result = _run(wrapper, env, "status")
    assert result.returncode != 0 and "non attestabile" in result.stdout
    assert "sono impostate" not in result.stdout and "non attivo" not in result.stdout



def test_status_shows_the_first_line_the_provider_printed_when_it_cannot_list_the_project(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_FIXTURE_PS_FAILS"] = "\n  ERROR:podman_compose:failed to check if podman is installed: 'podman'\nsecond line\n"
    result = _run(wrapper, env, "status")
    assert result.returncode != 0
    assert "non attestabile" in result.stdout and "non attivo" not in result.stdout
    assert "Il provider ha detto: ERROR:podman_compose:failed to check if podman is installed: 'podman'" in result.stdout
    assert "second line" not in result.stdout



def test_status_cuts_a_long_provider_line_and_drops_control_characters(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_FIXTURE_PS_FAILS"] = "x" * 500 + "\x1b[31mred\x07"
    result = _run(wrapper, env, "status")
    said = next(line for line in result.stdout.splitlines() if "Il provider ha detto:" in line)
    assert len(said.split("Il provider ha detto: ", 1)[1]) <= 200
    assert "\x1b" not in result.stdout and "\x07" not in result.stdout



def test_status_of_a_provider_that_says_nothing_gives_its_exit_code(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_FIXTURE_PS_FAILS"] = " "
    result = _run(wrapper, env, "status")
    assert "Il provider ha detto: provider exit code 1, nothing said" in result.stdout



def test_the_reason_file_is_left_behind_by_no_one(tmp_path: Path):
    wrapper, env, _, _ = _runtime(tmp_path)
    tmp = tmp_path / "scratch"
    tmp.mkdir()
    env["TMPDIR"] = str(tmp)
    env["JHT_FIXTURE_PS_FAILS"] = "boom"
    _run(wrapper, env, "status")
    ok_env = dict(env)
    ok_env.pop("JHT_FIXTURE_PS_FAILS")
    _run(wrapper, ok_env, "status")
    assert list(tmp.iterdir()) == []
