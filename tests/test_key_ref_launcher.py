"""The key of a run can live in a file or a variable named by the config: every launch finds it, none types it.

`jht setup --secret-mode file|env` writes `api_key_ref` (a path or a variable name, never the key). The launcher resolves
it at EVERY start from the config, so a restart made by the watchdog (the environment of pid1, which has no
JHT_API_KEY_FILE) gets the same key as `team start`. The launcher's real code (.launcher/spawn-keyfile.sh, the line
of start-agent.sh, the watchdog's own respawn_worker); the checker is a stand-in that records how it was called and
never sees a real key. Keys are invented and built from parts.
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

from test_agent_watchdog_spawn_failure_escalation import PREAMBLE, Harness
from test_agent_model_override import _function
from test_pi_harness import ROOT, SPAWN_LIB, START_AGENT, _bash, _clean_env

KEY = "-".join(["fixture", "not", "a", "real", "key"])
KEY_LINE = re.search(r'^KEY_WRAP="\$\(jht_key_wrap[^\n]*$', START_AGENT.read_text(encoding="utf-8"), re.M).group(0)

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the launcher runs in the Linux container")


def _config(tmp_path: Path, provider: dict | None, *, active: str = "openai") -> Path:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    document = {"active_provider": active, "providers": {active: provider or {}}}
    (home / "jht.config.json").write_text(json.dumps(document), encoding="utf-8")
    return home / "jht.config.json"


def _tree(tmp_path: Path) -> Path:
    """A stand-in for the checker: it records its arguments and whether JHT_API_KEY_FILE and the variable were given."""
    tree = tmp_path / "tree"
    (tree / ".launcher").mkdir(parents=True, exist_ok=True)
    tool = tree / "shared" / "skills" / "api_key_file.py"
    tool.parent.mkdir(parents=True, exist_ok=True)
    tool.write_text(
        "import os, sys\n"
        f"open({str(tmp_path / 'ran')!r}, 'a').write(' '.join(sys.argv[1:]) + ' | file=' + os.environ.get('JHT_API_KEY_FILE', '-') + '\\n')\n"
        f"sys.exit(int(os.environ.get('JHT_TEST_CHECK_EXIT', '0')))\n", encoding="utf-8")
    return tree


def _wrap(tmp_path: Path, cfg: Path | None, provider: str = "openai", **env: str):
    script = (f'source "{SPAWN_LIB}"; JHT_SPAWN_LIB_DIR="{_tree(tmp_path) / ".launcher"}"; '
              f'jht_key_wrap {provider} {shlex.quote(str(cfg)) if cfg else ""}')
    base = {k: v for k, v in _clean_env(**env).items() if k != "JHT_API_KEY_FILE" or "JHT_API_KEY_FILE" in env}
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False, env=base)


def _ran(tmp_path: Path) -> list[str]:
    path = tmp_path / "ran"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


FILE_REF = {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": "/dev/shm/jht-run-key"}}
ENV_REF = {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "env", "id": "MY_RUN_API_KEY"}}


def test_a_file_in_the_config_is_the_source_when_the_environment_names_none(tmp_path: Path) -> None:
    result = _wrap(tmp_path, _config(tmp_path, FILE_REF))
    assert result.returncode == 0, result.stderr
    words = shlex.split(result.stdout)
    assert words[0] == "JHT_API_KEY_FILE=/dev/shm/jht-run-key"
    assert words[1] == "python3" and words[2].endswith("shared/skills/api_key_file.py")
    assert words[3:] == ["exec", "--env", "OPENAI_API_KEY", "--"]
    assert _ran(tmp_path) == ["check | file=/dev/shm/jht-run-key"]   # checked before a pane exists, with the file of the config


def test_the_environment_wins_over_the_config(tmp_path: Path) -> None:
    result = _wrap(tmp_path, _config(tmp_path, FILE_REF), JHT_API_KEY_FILE="/dev/shm/from-the-environment")
    assert shlex.split(result.stdout)[0] == "JHT_API_KEY_FILE=/dev/shm/from-the-environment"


@pytest.mark.parametrize(("provider", "name"), [("openai", "OPENAI_API_KEY"), ("claude", "ANTHROPIC_API_KEY"), ("kimi", "MOONSHOT_API_KEY")])
def test_a_variable_in_the_config_is_named_in_the_pane_and_its_value_never(tmp_path: Path, provider: str, name: str) -> None:
    result = _wrap(tmp_path, _config(tmp_path, ENV_REF, active=provider), provider, MY_RUN_API_KEY=KEY)
    assert result.returncode == 0, result.stderr
    words = shlex.split(result.stdout)
    assert words[0] == "python3" and words[1].endswith("shared/skills/api_key_file.py")
    assert words[2:] == ["exec", "--env", name, "--from-env", "MY_RUN_API_KEY", "--"]
    assert KEY not in result.stdout + result.stderr
    assert _ran(tmp_path) == [f"check --from-env MY_RUN_API_KEY --env {name} | file=-"]


def test_a_refused_variable_stops_the_spawn_with_the_code_of_the_checker(tmp_path: Path) -> None:
    result = _wrap(tmp_path, _config(tmp_path, ENV_REF), JHT_TEST_CHECK_EXIT="78")
    assert result.returncode == 78 and result.stdout == ""


@pytest.mark.parametrize("provider", [
    {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "exec", "command": "secret-tool lookup jht"}},
    {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "vault", "id": "x"}},
    {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "env", "id": "bad name"}},
    {"auth_method": "api_key", "api_key_ref": "a string"},
])
def test_a_reference_the_launcher_cannot_resolve_stops_the_spawn_and_says_why(tmp_path: Path, provider: dict) -> None:
    result = _wrap(tmp_path, _config(tmp_path, provider))
    assert result.returncode == 78
    assert result.stdout == ""
    assert "api_key_ref" in result.stderr
    assert _ran(tmp_path) == []


@pytest.mark.parametrize("path", ["relative/key", "/dev/shm/a b", "/dev/shm/it's", "/dev/shm/../etc/key", "/dev/shm/$HOME"])
def test_a_path_of_the_config_that_cannot_be_typed_safely_is_refused_before_the_checker(tmp_path: Path, path: str) -> None:
    provider = {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "file", "path": path}}
    result = _wrap(tmp_path, _config(tmp_path, provider))
    assert result.returncode == 78 and result.stdout == ""
    assert _ran(tmp_path) == []


@pytest.mark.parametrize("provider", [
    {"auth_method": "subscription", "api_key_ref": {"type": "ref", "source": "file", "path": "/dev/shm/k"}},
    {"auth_method": "api_key", "api_key": KEY},
    {"auth_method": "api_key"},
])
def test_without_a_reference_for_an_api_key_nothing_changes(tmp_path: Path, provider: dict) -> None:
    result = _wrap(tmp_path, _config(tmp_path, provider))
    assert result.returncode == 0 and result.stdout == ""
    assert _ran(tmp_path) == []


def test_no_config_and_no_environment_is_the_old_behaviour(tmp_path: Path) -> None:
    assert (_wrap(tmp_path, None).returncode, _wrap(tmp_path, tmp_path / "missing.json").stdout) == (0, "")


def test_the_key_of_the_config_is_not_typed_when_the_config_has_a_reference(tmp_path: Path) -> None:
    cfg = _config(tmp_path, {**FILE_REF, "api_key": KEY})
    script = f'{_function(START_AGENT.read_text(encoding="utf-8"), "extract_provider_info")}\nextract_provider_info "{cfg}"'
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False,
                            env={k: v for k, v in _clean_env().items() if k != "JHT_API_KEY_FILE"})
    assert result.stdout.strip() == "openai|api_key|"
    assert KEY not in result.stdout


def test_the_pi_check_counts_a_reference_as_a_key(tmp_path: Path) -> None:
    for provider, expected in ((FILE_REF, 0), (ENV_REF, 0), ({"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "env", "id": ""}}, 1),
                               ({"auth_method": "subscription", "api_key_ref": FILE_REF["api_key_ref"]}, 1)):
        cfg = _config(tmp_path, provider)
        done = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; jht_pi_config_key_present "{cfg}"'],
                              capture_output=True, text=True, check=False, env=_clean_env())
        assert done.returncode == expected, (provider, done.stderr)


# ── the restart made by the watchdog ─────────────────────────────────────────

def _stub_start_agent(wd: Harness, tmp_path: Path, wrap_out: Path) -> None:
    """start-agent.sh as far as the key goes: the REAL line of the launcher, on the real lib, with the stand-in checker."""
    tree = _tree(tmp_path)
    wd.start.write_text(
        "#!/usr/bin/env bash\n"
        f'. "{SPAWN_LIB}"\nJHT_SPAWN_LIB_DIR="{tree / ".launcher"}"\n'
        'JHT_CONFIG_FILE="$JHT_HOME/jht.config.json"\nPROVIDER=openai\n'
        f"{KEY_LINE}\n"
        f'printf "%s\\n" "$KEY_WRAP" > "{wrap_out}"\n'
        'echo alive > "$T_STATE"\n', encoding="utf-8")
    wd.start.chmod(0o755)


def test_a_restart_by_the_watchdog_gets_the_key_the_first_launch_had(tmp_path: Path, monkeypatch) -> None:
    """The watchdog's environment is pid1's, with no JHT_API_KEY_FILE: the file named by the config is still found."""
    monkeypatch.delenv("JHT_API_KEY_FILE", raising=False)
    wd = Harness(tmp_path)
    cfg = wd.home / "jht.config.json"
    cfg.write_text(json.dumps({"active_provider": "openai", "providers": {"openai": FILE_REF}}), encoding="utf-8")
    wrap_out = tmp_path / "wrap.txt"
    _stub_start_agent(wd, tmp_path, wrap_out)

    result = wd.run("respawn_worker scout 1 SCOUT-S1")
    assert result.returncode == 0, result.stderr
    words = shlex.split(wrap_out.read_text(encoding="utf-8"))
    assert words[0] == "JHT_API_KEY_FILE=/dev/shm/jht-run-key" and words[3:] == ["exec", "--env", "OPENAI_API_KEY", "--"]
    assert _ran(tmp_path) == ["check | file=/dev/shm/jht-run-key"]


def test_a_restart_by_the_watchdog_gets_a_variable_of_the_container(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("JHT_API_KEY_FILE", raising=False)
    monkeypatch.setenv("MY_RUN_API_KEY", KEY)   # the container's own environment, which pid1 and its children share
    wd = Harness(tmp_path)
    (wd.home / "jht.config.json").write_text(json.dumps({"active_provider": "openai", "providers": {"openai": ENV_REF}}), encoding="utf-8")
    wrap_out = tmp_path / "wrap.txt"
    _stub_start_agent(wd, tmp_path, wrap_out)

    result = wd.run("respawn_worker scout 1 SCOUT-S1")
    assert result.returncode == 0, result.stderr
    words = shlex.split(wrap_out.read_text(encoding="utf-8"))
    assert words[2:] == ["exec", "--env", "OPENAI_API_KEY", "--from-env", "MY_RUN_API_KEY", "--"]
    assert KEY not in wrap_out.read_text(encoding="utf-8")


def test_a_key_that_only_the_launching_shell_had_is_not_found_by_a_restart(tmp_path: Path, monkeypatch) -> None:
    """What the config closes: with no reference, the restart (no JHT_API_KEY_FILE in pid1) types nothing."""
    monkeypatch.delenv("JHT_API_KEY_FILE", raising=False)
    wd = Harness(tmp_path)
    (wd.home / "jht.config.json").write_text(json.dumps({"active_provider": "openai", "providers": {"openai": {"auth_method": "api_key"}}}), encoding="utf-8")
    wrap_out = tmp_path / "wrap.txt"
    _stub_start_agent(wd, tmp_path, wrap_out)
    assert wd.run("respawn_worker scout 1 SCOUT-S1").returncode == 0
    assert wrap_out.read_text(encoding="utf-8").strip() == ""


def test_a_refused_key_makes_the_restart_fail_instead_of_starting_without_it(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("JHT_API_KEY_FILE", raising=False)
    monkeypatch.setenv("JHT_TEST_CHECK_EXIT", "78")
    wd = Harness(tmp_path)
    (wd.home / "jht.config.json").write_text(json.dumps({"active_provider": "openai", "providers": {"openai": FILE_REF}}), encoding="utf-8")
    _stub_start_agent(wd, tmp_path, tmp_path / "wrap.txt")
    result = wd.run("respawn_worker scout 1 SCOUT-S1")
    assert result.returncode != 0
    assert not (tmp_path / "wrap.txt").exists()


# ── which variables a config may name (the real checker: the stand-in above would not refuse anything) ─────

def _real_wrap(tmp_path: Path, variable: str, provider: str = "openai", **env: str):
    cfg = _config(tmp_path, {"auth_method": "api_key", "api_key_ref": {"type": "ref", "source": "env", "id": variable}}, active=provider)
    script = f'source "{SPAWN_LIB}"; jht_key_wrap {provider} {shlex.quote(str(cfg))}'
    base = {k: v for k, v in _clean_env(**env).items() if k != "JHT_API_KEY_FILE"}
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False, env=base)


@pytest.mark.parametrize("variable", ["MY_RUN_API_KEY", "OPENAI_API_KEY", "run_api_key"])
def test_a_key_variable_is_accepted_by_the_real_checker(tmp_path: Path, variable: str) -> None:
    result = _real_wrap(tmp_path, variable, **{variable: KEY})
    assert result.returncode == 0, result.stderr
    assert shlex.split(result.stdout)[2:] == ["exec", "--env", "OPENAI_API_KEY", "--from-env", variable, "--"]


@pytest.mark.parametrize("variable", [
    "PATH", "HOME", "FLEETD_TOKEN", "JHT_SECRET_KEY", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_KEY", "NEXT_PUBLIC_KEY",
    "LD_PRELOAD_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY", "AWS_SECRET_ACCESS_KEY", "SSH_PRIVATE_KEY", "MY_RUN_KEY",
])
def test_a_variable_that_is_not_a_key_for_this_provider_is_refused_and_its_value_never_used(tmp_path: Path, variable: str) -> None:
    # PATH and HOME keep their own value: giving them a key would only break the shell of the test
    result = _real_wrap(tmp_path, variable, **({} if variable in ("PATH", "HOME") else {variable: KEY}))
    assert result.returncode == 78, result.stdout
    assert result.stdout == "" and KEY not in result.stderr
