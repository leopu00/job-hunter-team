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
    assert "jht providers harness pi" in result.stderr


def test_a_missing_config_has_no_harness(tmp_path: Path) -> None:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_config_harness "{tmp_path}/none.json"'],
        capture_output=True, text=True, check=False, env=_clean_env(),
    )
    assert result.returncode == 0 and result.stdout == ""


def _role_table() -> dict[str, tuple[str, str]]:
    """role -> (Codex model id, effort) from the tables the launcher and the wizard share."""
    rows = [line.split("|") for line in
            (ROOT / "shared" / "runtime" / "role-models.list").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")]
    models = {r[1]: r[2] for r in rows if r[0] == "model"}
    # OpenAI gives its light roles (scout, analista, sentinella) the class of provider-models.list, as GLM does
    light = {r[2]: r[3] for r in (line.split("|") for line in
             (ROOT / "shared" / "runtime" / "provider-models.list").read_text(encoding="utf-8").splitlines())
             if r[0] == "rolemodel" and r[1] == "openai"}
    return {r[1]: (models[light.get(r[1], r[2])], r[3]) for r in rows if r[0] == "role"}


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


def _service_config(tmp_path: Path, provider: str = "openai", auth: str = "subscription", **extra) -> None:
    """The configuration of the service agents' home: they follow its active provider, never a default."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    entry = {"auth_method": auth, **extra.pop("provider_fields", {})}
    document = {"active_provider": provider, "harness": "pi", "providers": {provider: entry}, **extra}
    (home / "jht.config.json").write_text(json.dumps(document), encoding="utf-8")


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
    login = tmp_path / "home" / ".pi" / "agent" / "auth.json"   # the pi login: without it the start is refused
    login.parent.mkdir(parents=True)
    login.write_text('{"openai": {"type": "oauth", "access": "x"}}', encoding="utf-8")   # a login for the provider of the config
    _service_config(tmp_path)
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


def _service_pi_command(tmp_path: Path, role: str, *after_lib: str) -> subprocess.CompletedProcess[str]:
    workdir = _workdir(tmp_path)
    pinned = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
                            capture_output=True, text=True, check=True).stdout
    env = _fake_pi(tmp_path, pinned)
    env["JHT_HOME"] = str(tmp_path / "home")
    login = tmp_path / "home" / ".pi" / "agent" / "auth.json"
    login.parent.mkdir(parents=True, exist_ok=True)
    login.write_text('{"openai": {"type": "oauth", "access": "x"}}', encoding="utf-8")
    if not (tmp_path / "home" / "jht.config.json").exists():
        _service_config(tmp_path)
    lines = "".join(f"{line}; " for line in after_lib)
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; {lines}jht_spawn_repl_cmd pi "{workdir}" {role}'],
        capture_output=True, text=True, check=False, env=env,
    )


@pytest.mark.parametrize("role", ["dottore", "mantenitore"])
def test_the_service_agents_on_pi_start_with_the_spending_gate_and_the_environment_it_reads(
    tmp_path: Path, role: str
) -> None:
    """Dottore and Mantenitore went to pi without `-e spend-gate.js`: working, they spent outside the budget's brake.
    The gate also needs JHT_HOME (where the brake's flag is) and JHT_AGENT_NAME in the pane: a session made by the
    spawner does not export them, and with no JHT_HOME the gate sees no flag and holds nothing."""
    gate, lines = _gate(tmp_path)
    result = _service_pi_command(tmp_path, role, *lines)
    assert result.returncode == 0, result.stderr
    env, argv = _argv(result.stdout.strip())
    assert _extensions(argv) == [str(gate)]
    assert "-ne" in argv
    assert env["JHT_HOME"] == str(tmp_path / "home")
    assert env["JHT_AGENT_NAME"] == role


def test_a_service_agent_without_a_role_is_not_given_a_gate_it_cannot_name(tmp_path: Path) -> None:
    result = _service_pi_command(tmp_path, "")
    assert result.returncode == 0, result.stderr
    env, argv = _argv(result.stdout.strip())
    assert _extensions(argv) == [] and "JHT_AGENT_NAME" not in env


def test_a_missing_gate_is_said_and_the_service_agent_starts_without_it(tmp_path: Path) -> None:
    result = _service_pi_command(tmp_path, "dottore", f"JHT_PI_SPEND_GATE_EXT='{tmp_path}/none.js'")
    assert result.returncode == 0, result.stderr
    assert "dottore starts on pi without the spending gate" in result.stderr


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


# ── glm runs only on pi: the service agents know it (JHT-P0) ─────────────


def test_the_service_agents_start_glm_on_pi_and_refuse_it_on_another_harness(tmp_path: Path) -> None:
    document = {"active_provider": "glm", "providers": {"glm": {"auth_method": "api_key", "api_key": "synthetic"}}}
    on_pi = _service_home(tmp_path, {**document, "harness": "pi"})
    assert _active_cli(on_pi, "dottore").stdout.strip() == "pi"
    (tmp_path / "other").mkdir()
    other = _service_home(tmp_path / "other", {**document, "harness": "codex"})
    result = _active_cli(other, "mantenitore")
    assert result.returncode == 2
    assert result.stdout == ""
    assert "runs only on the pi harness" in result.stderr


# ── the spending gate: every role on pi but the Assistente ─────────────────────────────────────────────────────

def _gate(tmp_path: Path) -> tuple[Path, tuple[str, ...]]:
    gate = tmp_path / "gate" / "spend-gate.js"
    gate.parent.mkdir()
    gate.write_text("// fixture\n", encoding="utf-8")
    return gate, (f"JHT_PI_SPEND_GATE_EXT='{gate}'",)


@pytest.mark.parametrize("role", ROLES)
def test_the_spending_gate_goes_to_every_role_but_the_assistente(tmp_path: Path, role: str) -> None:
    gate, lines = _gate(tmp_path)
    ext, search = _extension(tmp_path)
    result = _launch(tmp_path, role=role, harness=None, config_harness="pi", after_lib=lines + search)
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    expected = ([] if role == "assistente" else [str(gate)]) + ([str(ext)] if role in WEB_SEARCH_ROLES else [])
    assert _extensions(argv) == expected


def test_a_missing_gate_is_said_and_the_role_starts_without_it(tmp_path: Path) -> None:
    result = _launch(tmp_path, role="capitano", harness=None, config_harness="pi",
                     after_lib=(f"JHT_PI_SPEND_GATE_EXT='{tmp_path}/none.js'",))
    assert result.returncode == 0, result.stderr
    assert "capitano starts on pi without the spending gate" in result.stderr


def test_the_gate_path_is_not_taken_from_the_environment(tmp_path: Path) -> None:
    evil = tmp_path / "evil.js"
    evil.write_text("// not ours\n", encoding="utf-8")
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_SPEND_GATE_EXT"'],
        capture_output=True, text=True, check=True, env=_clean_env(JHT_PI_SPEND_GATE_EXT=str(evil)),
    )
    assert result.stdout == "/app/shared/runtime/pi-harness/spend-gate.js"


# ── Dottore and Mantenitore on pi get the skills pi reads (giro Windows build6: they never started) ──────────


@pytest.mark.parametrize("role", ["dottore", "mantenitore"])
def test_the_service_agents_on_pi_get_their_skills_where_pi_reads_them(tmp_path: Path, role: str) -> None:
    """Claude with the pi harness: the spawners gave the copy the PROVIDER (claude, .claude/skills only), pi wants
    .agents/skills, and every start stopped on «pi needs … .agents/skills». They give it the CLI now, as start-agent.sh."""
    for cli, present, absent in (("pi", ".agents/skills", ".claude/skills"), ("claude", ".claude/skills", ".agents/skills")):
        workdir = tmp_path / cli / role
        workdir.mkdir(parents=True)
        result = subprocess.run(
            [_bash(), "-c", f'source "{SPAWN_LIB}"; JHT_APP_ROOT="{ROOT}" jht_spawn_copy_skills {role} "{workdir}" test {cli}'],
            capture_output=True, text=True, check=False, env=_clean_env(JHT_HOME=str(tmp_path / "home")),
        )
        assert result.returncode == 0, result.stderr
        assert (workdir / present).is_dir() and any((workdir / present).iterdir()), (cli, present)
        assert not (workdir / absent).exists(), (cli, absent)


@pytest.mark.parametrize("script", ["spawn-doctor.sh", "spawn-maintainer.sh"])
def test_the_service_spawners_copy_the_skills_for_the_cli_and_check_before_the_session(script: str) -> None:
    text = (ROOT / ".launcher" / script).read_text(encoding="utf-8")
    copy = text[text.index("jht_spawn_copy_skills "):]
    copy = copy[:copy.index("\n\n")]
    assert copy.rstrip().endswith('"$ACTIVE_CLI"'), copy
    workdir = "DOTTORE_DIR" if script == "spawn-doctor.sh" else "MANT_DIR"
    role = "dottore" if script == "spawn-doctor.sh" else "mantenitore"
    check = f'jht_spawn_repl_cmd "$ACTIVE_CLI" "${workdir}" {role} >/dev/null || exit 1'
    # a check that fails leaves no empty session that `jht team status` counts as running
    assert text.index(check) < text.index('jht_spawn_new_session "$SESSION"')
    # a REPL that does not come up after the session was made takes its session away too
    wait = text[text.index('jht_spawn_wait_repl "$SESSION"'):]
    assert 'tmux kill-session -t "=$SESSION"' in wait[:wait.index("\n\n")]


SPAWN_FAILED = ROOT / "shared" / "skills" / "spawn_failed.py"


def _spawn_failed(tmp_path: Path, *calls: tuple[str, ...]) -> dict:
    target = tmp_path / "logs" / "spawn-failed.json"
    for args in calls:
        done = subprocess.run(["python3", "-I", str(SPAWN_FAILED), str(target), *args], capture_output=True, text=True,
                              check=False, env=_clean_env())
        assert done.returncode == 0, done.stderr
    return json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}


def test_the_watchdog_writes_a_role_that_cannot_start_and_takes_it_out_when_it_starts(tmp_path: Path) -> None:
    error = ("[spawn-doctor] killing\n[spawn-lib] ERROR: pi needs /jht_home/agents/dottore/AGENTS.md and "
             "/jht_home/agents/dottore/.agents/skills before it starts; one is missing.\n\x1b[31mtail")
    data = _spawn_failed(tmp_path, ("dottore", "1", error), ("mantenitore", "1", "Error: x"))
    assert set(data) == {"dottore", "mantenitore"}
    assert data["dottore"]["rc"] == 1 and data["dottore"]["why"].startswith("[spawn-lib] ERROR: pi needs")
    assert "\x1b" not in json.dumps(data) and data["dottore"]["at"]
    data = _spawn_failed(tmp_path, ("dottore", "ok"))
    assert set(data) == {"mantenitore"}


@pytest.mark.parametrize("args", [(), ("capitano", "1", "x"), ("dottore", "maybe")])
def test_the_writer_refuses_what_it_does_not_know(tmp_path: Path, args: tuple[str, ...]) -> None:
    done = subprocess.run(["python3", "-I", str(SPAWN_FAILED), str(tmp_path / "f.json"), *args], capture_output=True,
                          text=True, check=False, env=_clean_env())
    assert done.returncode == 2 and not (tmp_path / "f.json").exists()


def test_the_watchdog_writes_through_its_bounded_helper() -> None:
    text = (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    body = text[text.index("spawn_failed() {"):]
    body = body[:body.index("\n}\n")]
    assert 'jht_doctor_bounded "$HELPER_TIMEOUT_SEC"' in body and 'python3 "$SPAWN_FAILED_PY"' in body


@pytest.mark.parametrize("branch", ['spawn_failed mantenitore "$mrc" "$mout"', "spawn_failed mantenitore ok",
                                    'spawn_failed dottore "$rc" "$out"', "spawn_failed dottore ok"])
def test_the_watchdog_says_every_failed_and_every_good_start(branch: str) -> None:
    assert branch in (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")


# ── Dottore and Mantenitore on pi run with the provider and the model of the ACTIVE configuration ──────────
# Measured on Windows (build 9, Claude with a key): both were started on `--provider openai` with the Codex model and sat on
# «No API key found for openai», in an empty session, while every other agent ran on Claude.

# provider -> (name pi knows it by, model of the class luna, key variable): the class the service agents have when nothing is pinned
SERVICE_PROVIDERS = {
    "openai": ("openai", "gpt-5.6-luna", "OPENAI_API_KEY"),
    "claude": ("anthropic", "claude-haiku-5-5", "ANTHROPIC_API_KEY"),
    "glm": ("zai", "glm-5.3-flash", None),
    "kimi": ("moonshotai", "kimi-k3.1-pro", "MOONSHOT_API_KEY"),
}


@pytest.mark.parametrize("role", ["dottore", "mantenitore"])
@pytest.mark.parametrize("provider", sorted(SERVICE_PROVIDERS))
def test_the_service_agents_on_pi_run_on_the_provider_and_the_light_model_of_the_active_config(tmp_path: Path, role: str, provider: str) -> None:
    """The cost of the service roles against the search (build 11, Mac: 0.55 $ of 1.97 $ for Dottore and Mantenitore on Sonnet, one of
    their rounds having done nothing): their class is luna (Haiku on Claude) unless the config pins another."""
    pi_name, luna_model, key_var = SERVICE_PROVIDERS[provider]
    _service_config(tmp_path, provider, "api_key", provider_fields={"api_key": "test-key-0123"})
    result = _service_pi_command(tmp_path, role)
    assert result.returncode == 0, result.stderr
    env, argv = _argv(result.stdout.strip())
    assert _after(argv, "--provider") == pi_name
    assert _after(argv, "--model") == luna_model
    if key_var:
        assert env[key_var] == "test-key-0123"   # the key of the active provider, as start-agent.sh gives it to every agent
    assert "openai" not in result.stdout.replace("gpt", "") or provider == "openai"


@pytest.mark.parametrize("role", ["dottore", "mantenitore"])
@pytest.mark.parametrize("provider", ["glm", "kimi", "claude", "openai"])
@pytest.mark.parametrize("pin, expected", [("luna", {"openai": "gpt-5.6-luna", "claude": "claude-haiku-5-5", "glm": "glm-5.3-flash", "kimi": "kimi-k3.1-pro"}),
                                           ("terra", {"openai": "gpt-5.6-terra", "claude": "claude-sonnet-5-5", "glm": "glm-5.3", "kimi": "kimi-k3.1-pro"})])
def test_a_pin_of_the_config_for_a_service_agent_gives_its_model_on_every_provider(tmp_path: Path, role: str, provider: str, pin: str, expected: dict) -> None:
    _service_config(tmp_path, provider, "api_key", provider_fields={"api_key": "test-key-0123"},
                    team={"role_models": {role: {"model": pin}}})
    result = _service_pi_command(tmp_path, role)
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert _after(argv, "--model") == expected[provider]


def test_a_model_given_for_a_retry_stays_and_the_provider_is_still_the_active_one(tmp_path: Path) -> None:
    _service_config(tmp_path, "claude", "api_key", provider_fields={"api_key": "test-key-0123"})
    workdir = _workdir(tmp_path)
    pinned = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_PI_VERSION"'],
                            capture_output=True, text=True, check=True).stdout
    env = _fake_pi(tmp_path, pinned)
    env["JHT_HOME"] = str(tmp_path / "home")
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_pi_repl_cmd "{workdir}" claude-haiku-5-5 dottore'],
        capture_output=True, text=True, check=False, env=env,
    )
    assert result.returncode == 0, result.stderr
    _env, argv = _argv(result.stdout.strip())
    assert _after(argv, "--provider") == "anthropic" and _after(argv, "--model") == "claude-haiku-5-5"


def test_a_service_agent_without_an_active_provider_is_not_started_on_a_default(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / "jht.config.json").write_text("{}", encoding="utf-8")
    result = _service_pi_command(tmp_path, "dottore")
    assert result.returncode == 2
    assert result.stdout == ""
    assert "active_provider" in result.stderr


# ── the CLIs of the providers (no pi): the service agents on the light model too ─────────────────────────────────

def _cli_command(tmp_path: Path, provider: str, role: str, pin: str | None = None, **env: str) -> subprocess.CompletedProcess[str]:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    team = {"role_models": {role: {"model": pin}}} if pin else {}
    (home / "jht.config.json").write_text(json.dumps({"active_provider": provider, "team": team}), encoding="utf-8")
    return subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_repl_cmd {provider} "" {role}'],
                          capture_output=True, text=True, check=False, env=_clean_env(JHT_HOME=str(home), **env))


@pytest.mark.parametrize("role, alias", [("dottore", "haiku"), ("mantenitore", "haiku"), ("scout", "sonnet"), ("", "sonnet")])
def test_the_claude_cli_gives_the_service_agents_haiku_and_keeps_sonnet_for_the_rest(tmp_path: Path, role: str, alias: str) -> None:
    result = _cli_command(tmp_path, "claude", role)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith(f"--model {alias}"), result.stdout


@pytest.mark.parametrize("pin, alias", [("terra", "sonnet"), ("sol", "opus"), ("luna", "haiku")])
def test_a_pin_of_the_config_beats_the_service_class_on_the_claude_cli(tmp_path: Path, pin: str, alias: str) -> None:
    result = _cli_command(tmp_path, "claude", "dottore", pin)
    assert result.stdout.strip().endswith(f"--model {alias}"), result.stdout


def test_the_retry_model_beats_the_service_class_on_the_claude_cli(tmp_path: Path) -> None:
    result = _cli_command(tmp_path, "claude", "dottore", JHT_SPAWN_MODEL_OVERRIDE="sonnet")
    assert result.stdout.strip().endswith("--model sonnet"), result.stdout


@pytest.mark.parametrize("role, model", [("dottore", "gpt-5.6-luna"), ("mantenitore", "gpt-5.6-luna")])
def test_codex_gives_the_service_agents_the_light_model_instead_of_its_default(tmp_path: Path, role: str, model: str) -> None:
    result = _cli_command(tmp_path, "openai", role)
    assert result.returncode == 0, result.stderr
    assert f"--model {model}" in result.stdout or f"-m {model}" in result.stdout, result.stdout


def test_codex_without_a_role_keeps_its_default_model(tmp_path: Path) -> None:
    result = _cli_command(tmp_path, "openai", "")
    assert "gpt-5.6-luna" not in result.stdout, result.stdout
