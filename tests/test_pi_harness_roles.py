"""The pi harness for every role: chosen by `harness` in the config, overridden per role by a variable.

The launcher's real code (.launcher/spawn-lib.sh, the provider-to-command chain of start-agent.sh and the
Dottore and Mantenitore spawners), each case on its own. The scout-only cases and the shared helpers are
in test_pi_harness.py.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from test_pi_harness import (
    ROOT, SPAWN_LIB, _after, _argv, _bash, _clean_env, _fake_pi, _harness, _launch, _workdir,
)


ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico",
         "sentinella", "assistente", "mentor", "closer"]


@pytest.mark.parametrize("role", ROLES)
def test_the_config_gives_pi_to_every_role(role: str) -> None:
    result = _harness(role, None, config="pi")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "pi"


@pytest.mark.parametrize("role", ROLES)
def test_the_variable_gives_pi_to_every_role(role: str) -> None:
    result = _harness(role, "pi")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "pi"


def test_codex_in_the_config_is_the_default() -> None:
    result = _harness("scout", None, config="codex")
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_the_variable_brings_one_role_back_to_codex() -> None:
    assert _harness("scout", "codex", config="pi").stdout == ""
    assert _harness("analista", None, config="pi").stdout.strip() == "pi"


def test_the_variable_gives_pi_to_one_role_when_the_config_says_codex() -> None:
    assert _harness("scout", "pi", config="codex").stdout.strip() == "pi"
    assert _harness("analista", None, config="codex").stdout == ""


@pytest.mark.parametrize(("value", "config", "names"), [
    ("opencode", None, "JHT_AGENT_HARNESS_SCOUT='opencode'"),
    (None, "opencode", "harness in the config='opencode'"),
])
def test_an_unknown_harness_stops_the_start_instead_of_falling_back(
        value: str | None, config: str | None, names: str) -> None:
    result = _harness("scout", value, config=config)
    assert result.returncode == 2
    assert "not a known agent harness" in result.stderr
    assert names in result.stderr


def _config_harness(tmp_path: Path, document: object) -> subprocess.CompletedProcess[str]:
    path = tmp_path / "jht.config.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_config_harness "{path}"'],
        capture_output=True, text=True, check=False, env=_clean_env(),
    )


@pytest.mark.parametrize(("document", "printed"), [
    ({"harness": "pi"}, "pi"), ({"harness": "codex"}, "codex"), ({"active_provider": "openai"}, ""),
])
def test_the_launcher_reads_the_harness_key_of_the_config(tmp_path: Path, document: dict, printed: str) -> None:
    result = _config_harness(tmp_path, document)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == printed


@pytest.mark.parametrize("value", ["opencode", "PI", 3, ["pi"], ""])
def test_a_harness_the_launcher_does_not_know_stops_the_start(tmp_path: Path, value: object) -> None:
    result = _config_harness(tmp_path, {"harness": value})
    assert result.returncode == 2
    assert result.stdout == ""
    assert "not a known agent harness" in result.stderr
    assert "jht providers harness codex" in result.stderr


def test_a_missing_config_has_no_harness(tmp_path: Path) -> None:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_config_harness "{tmp_path}/none.json"'],
        capture_output=True, text=True, check=False, env=_clean_env(),
    )
    assert result.returncode == 0 and result.stdout == ""


def _role_table() -> dict[str, tuple[str, str]]:
    """role -> (Codex model id, effort) from the table the launcher and the wizard share."""
    rows = [line.split("|") for line in
            (ROOT / "shared" / "runtime" / "role-models.list").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")]
    models = {r[1]: r[2] for r in rows if r[0] == "model"}
    return {r[1]: (models[r[2]], r[3]) for r in rows if r[0] == "role"}


@pytest.mark.parametrize("role", ROLES)
def test_the_config_starts_every_role_on_pi_with_its_model_and_effort(tmp_path: Path, role: str) -> None:
    """The setup's choice, with no variable at all: the role's own class and effort reach pi."""
    agent_dir = _workdir(tmp_path)
    result = _launch(tmp_path, role=role, harness=None, config_harness="pi", agent_dir=agent_dir)
    assert result.returncode == 0, result.stderr
    env, argv = _argv(result.stdout.strip())

    model, effort = _role_table()[role]
    assert argv[0] == "pi"
    assert _after(argv, "--append-system-prompt") == f"{agent_dir}/AGENTS.md"
    assert _after(argv, "--skill") == f"{agent_dir}/.agents/skills"
    assert _after(argv, "--provider") == "openai"
    assert _after(argv, "--model") == model
    assert _after(argv, "--thinking") == effort
    assert env["PI_CODING_AGENT_DIR"] == str(tmp_path / "home" / ".pi" / "agent")


@pytest.mark.parametrize("role", ROLES)
def test_the_config_decides_nothing_when_it_says_codex(tmp_path: Path, role: str) -> None:
    result = _launch(tmp_path, role=role, harness=None, config_harness="codex")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "codex --yolo --model gpt-5.6-terra"


def test_the_role_models_of_the_config_reach_pi_on_another_role(tmp_path: Path) -> None:
    result = _launch(tmp_path, role="critico", harness=None, config_harness="pi",
                     role_models={"critico": {"model": "luna", "effort": "low"}})
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert _after(argv, "--model") == "gpt-5.6-luna"
    assert _after(argv, "--thinking") == "low"


def test_the_variable_keeps_one_role_on_codex_when_the_config_says_pi(tmp_path: Path) -> None:
    result = _launch(tmp_path, role="mentor", harness="codex", config_harness="pi")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "codex --yolo --model gpt-5.6-terra"


@pytest.mark.parametrize("role", ROLES)
def test_a_claude_subscription_with_pi_in_the_config_is_refused_on_every_role(tmp_path: Path, role: str) -> None:
    result = _launch(tmp_path, role=role, provider="claude", harness=None, config_harness="pi")
    assert result.returncode != 0
    assert result.stdout == ""
    assert "Claude subscription" in result.stderr


# ── Dottore and Mantenitore choose their CLI themselves ──────────────────


def _service_home(tmp_path: Path, document: dict) -> Path:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    (home / "jht.config.json").write_text(json.dumps(document), encoding="utf-8")
    return home


def _active_cli(home: Path, role: str, **env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_active_cli {role}'],
        capture_output=True, text=True, check=False, env=_clean_env(JHT_HOME=str(home), **env),
    )


@pytest.mark.parametrize("role", ["dottore", "mantenitore"])
def test_the_service_agents_follow_the_harness_of_the_config(tmp_path: Path, role: str) -> None:
    pi_home = _service_home(tmp_path, {"active_provider": "openai", "harness": "pi",
                                       "providers": {"openai": {"auth_method": "subscription"}}})
    assert _active_cli(pi_home, role).stdout.strip() == "pi"
    assert _active_cli(pi_home, role, **{f"JHT_AGENT_HARNESS_{role.upper()}": "codex"}).stdout.strip() == "openai"

    default_home = _service_home(tmp_path, {"active_provider": "openai",
                                            "providers": {"openai": {"auth_method": "subscription"}}})
    assert _active_cli(default_home, role).stdout.strip() == "openai"


def test_the_service_agents_refuse_pi_on_a_claude_subscription(tmp_path: Path) -> None:
    home = _service_home(tmp_path, {"active_provider": "claude", "harness": "pi",
                                    "providers": {"claude": {"auth_method": "subscription"}}})
    result = _active_cli(home, "dottore")
    assert result.returncode == 2
    assert result.stdout == ""
    assert "Claude subscription" in result.stderr


def test_the_service_agents_get_the_pi_command_of_the_team(tmp_path: Path) -> None:
    workdir = _workdir(tmp_path)
    pinned = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
                            capture_output=True, text=True, check=True).stdout
    env = _fake_pi(tmp_path, pinned)
    env["JHT_HOME"] = str(tmp_path / "home")
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_repl_cmd pi "{workdir}"'],
        capture_output=True, text=True, check=False, env=env,
    )
    assert result.returncode == 0, result.stderr
    pane_env, argv = _argv(result.stdout.strip())

    assert argv[0] == "pi"
    assert _after(argv, "--append-system-prompt") == f"{workdir}/AGENTS.md"
    assert _after(argv, "--skill") == f"{workdir}/.agents/skills"
    assert _after(argv, "--model") == "gpt-5.6-sol"
    assert _after(argv, "--thinking") == "high"
    assert pane_env["PI_CODING_AGENT_DIR"] == str(tmp_path / "home" / ".pi" / "agent")
    assert (tmp_path / "home" / ".pi" / "agent" / "settings.json").is_file()


def test_the_service_agents_stop_without_their_identity_for_pi(tmp_path: Path) -> None:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_repl_cmd pi "{_workdir(tmp_path, identity=False)}"'],
        capture_output=True, text=True, check=False, env=_clean_env(JHT_HOME=str(tmp_path / "home")),
    )
    assert result.returncode == 2
    assert result.stdout == ""
    assert "AGENTS.md" in result.stderr


@pytest.mark.parametrize("script", ["spawn-doctor.sh", "spawn-maintainer.sh"])
def test_the_service_spawners_ask_for_the_cli_and_mark_a_pi_session(script: str) -> None:
    text = (ROOT / ".launcher" / script).read_text(encoding="utf-8")
    assert 'ACTIVE_CLI="$(jht_spawn_active_cli ' in text
    assert 'jht_spawn_repl_cmd "$ACTIVE_CLI"' in text
    assert 'jht_spawn_mark_harness "$SESSION" "$ACTIVE_CLI"' in text


# ── web search for the roles that have it on Codex ───────────────────────

WEB_SEARCH_ROLES = ["scout", "analista", "mentor"]


def _extension(tmp_path: Path) -> tuple[Path, tuple[str, ...]]:
    ext = tmp_path / "pi-harness" / "web-search.js"
    ext.parent.mkdir()
    ext.write_text("// fixture\n", encoding="utf-8")
    return ext, (f"JHT_PI_WEB_SEARCH_EXT='{ext}'",)


def _extensions(argv: list[str]) -> list[str]:
    return [argv[i + 1] for i, word in enumerate(argv) if word == "-e"]


@pytest.mark.parametrize("role", ROLES)
def test_the_web_search_extension_goes_to_the_roles_codex_gives_search_to(tmp_path: Path, role: str) -> None:
    ext, lines = _extension(tmp_path)
    result = _launch(tmp_path, role=role, harness=None, config_harness="pi", after_lib=lines)
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert _extensions(argv) == ([str(ext)] if role in WEB_SEARCH_ROLES else [])
    # -ne stays: no extension is discovered around the one named
    assert "-ne" in argv


def test_a_missing_extension_is_said_and_the_role_starts_without_search(tmp_path: Path) -> None:
    result = _launch(tmp_path, role="scout", harness=None, config_harness="pi",
                     after_lib=(f"JHT_PI_WEB_SEARCH_EXT='{tmp_path}/none.js'",))
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert _extensions(argv) == []
    assert "scout starts on pi without web search" in result.stderr


def test_the_extension_path_is_not_taken_from_the_environment(tmp_path: Path) -> None:
    """It is code pi loads: the path is fixed in the launcher, an exported variable does not move it."""
    evil = tmp_path / "evil.js"
    evil.write_text("// not ours\n", encoding="utf-8")
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_WEB_SEARCH_EXT"'],
        capture_output=True, text=True, check=True, env=_clean_env(JHT_PI_WEB_SEARCH_EXT=str(evil)),
    )
    assert result.stdout == "/app/shared/runtime/pi-harness/web-search.js"


# ── the pi of the image, not one the agents can leave in their own folder ──


def _image_pi(tmp_path: Path) -> Path:
    fake = tmp_path / "opt" / "jht-pi" / "bin" / "pi"
    fake.parent.mkdir(parents=True)
    fake.write_text("#!/usr/bin/env bash\necho 1.5.0\n", encoding="utf-8")
    fake.chmod(0o755)
    return fake


def test_pi_is_run_by_the_path_of_the_image_when_it_is_there(tmp_path: Path) -> None:
    fake = _image_pi(tmp_path)
    result = _launch(tmp_path, harness=None, config_harness="pi", after_lib=(f"JHT_PI_IMAGE_BIN='{fake}'",))
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert argv[0] == str(fake)


def test_pi_keeps_its_name_when_the_image_has_no_pi_of_its_own(tmp_path: Path) -> None:
    result = _launch(tmp_path, harness=None, config_harness="pi",
                     after_lib=(f"JHT_PI_IMAGE_BIN='{tmp_path}/none/pi'",))
    assert result.returncode == 0, result.stderr
    assert _argv(result.stdout.strip())[1][0] == "pi"


def test_other_clis_are_still_run_by_name(tmp_path: Path) -> None:
    result = _launch(tmp_path, harness=None, config_harness="codex",
                     after_lib=(f"JHT_PI_IMAGE_BIN='{_image_pi(tmp_path)}'",))
    assert _argv(result.stdout.strip())[1][0] == "codex"


def test_a_pi_left_in_the_agents_folder_does_not_replace_the_image_one(tmp_path: Path) -> None:
    """PATH has a folder the agents can write before /usr/local/bin: the pi put there is neither run nor believed."""
    image = _image_pi(tmp_path)
    shadow = tmp_path / "jht-deps" / "bin"
    shadow.mkdir(parents=True)
    (shadow / "pi").write_text("#!/usr/bin/env bash\necho 9.9.9\n", encoding="utf-8")
    (shadow / "pi").chmod(0o755)
    env = _clean_env(PATH=f"{shadow}:{os.environ.get('PATH', '')}", JHT_HOME=str(tmp_path / "home"))
    script = (f'source "{SPAWN_LIB}"; JHT_PI_IMAGE_BIN="{image}"; '
              'jht_pi_version_check && printf "%s\\n" "$(jht_pi_bin)" "$(jht_cli_exec pi)"')
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False, env=env)
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == [str(image), str(image)]
    assert "9.9.9" not in result.stdout


def test_the_version_of_the_image_pi_is_the_one_checked_not_the_shadow(tmp_path: Path) -> None:
    """The shadow pi answers the pinned version, the image one does not: the check follows the image one."""
    image = _image_pi(tmp_path)
    image.write_text("#!/usr/bin/env bash\necho 0.0.1\n", encoding="utf-8")
    shadow = tmp_path / "jht-deps" / "bin"
    shadow.mkdir(parents=True)
    pinned = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
                            capture_output=True, text=True, check=True).stdout
    (shadow / "pi").write_text(f"#!/usr/bin/env bash\necho {pinned}\n", encoding="utf-8")
    (shadow / "pi").chmod(0o755)
    env = _clean_env(PATH=f"{shadow}:{os.environ.get('PATH', '')}")
    result = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; JHT_PI_IMAGE_BIN="{image}"; jht_pi_version_check'],
                            capture_output=True, text=True, check=False, env=env)
    assert result.returncode != 0
    assert "pi 0.0.1 found" in result.stderr
