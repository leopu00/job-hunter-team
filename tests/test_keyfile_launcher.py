"""The launcher's line for JHT_API_KEY_FILE: the key of a run never reaches the command typed into the pane.

shared/skills/api_key_file.py (its own tests: test_api_key_file.py) reads and checks the file. What these tests hold
is what start-agent.sh does with it, on the launcher's real code: the key of the config is not used, the file is
checked BEFORE a pane exists (a refusal stops the spawn with its code), the wrapper sits after the environment
assignments and before the binary, the path is typed in quotes and only with allowed characters, and with no variable
nothing changes.
"""

from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path

import pytest

from test_pi_harness import ROOT, SPAWN_LIB, START_AGENT, _argv, _bash, _clean_env, _function, _launch

# Invented, and built from parts so that no scanner reads it as a key: it is never a real one.
KEY = "-".join(["fixture", "not", "a", "real", "key"])


def _tool_tree(tmp_path: Path, exit_code: int = 0) -> tuple[Path, str]:
    """A stand-in tree for the checker: it records that it ran and exits as asked (it never sees a real key)."""
    tree = tmp_path / "tree"
    (tree / ".launcher").mkdir(parents=True, exist_ok=True)
    tool = tree / "shared" / "skills" / "api_key_file.py"
    tool.parent.mkdir(parents=True, exist_ok=True)
    tool.write_text(f"import sys\nopen({str(tmp_path / 'ran')!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
                    f"sys.exit({exit_code})\n", encoding="utf-8")
    return tool, f"JHT_SPAWN_LIB_DIR='{tree / '.launcher'}'"


def _env(path: str) -> str:
    return f"export JHT_API_KEY_FILE='{path}'"


def _wrap(provider: str, *, path: str = "/dev/shm/jht-key", exit_code: int = 0, tmp_path: Path):
    _tool, lib = _tool_tree(tmp_path, exit_code)
    script = f'source "{SPAWN_LIB}"; {lib}; jht_key_wrap {provider}'
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False,
                          env=_clean_env(JHT_API_KEY_FILE=path))


def test_without_the_variable_nothing_is_typed_and_nothing_is_checked(tmp_path: Path) -> None:
    _tool, lib = _tool_tree(tmp_path)
    result = subprocess.run([_bash(), "-c", f'source "{SPAWN_LIB}"; {lib}; unset JHT_API_KEY_FILE; jht_key_wrap openai'],
                            capture_output=True, text=True, check=False, env=_clean_env())
    assert result.returncode == 0 and result.stdout == ""
    assert not (tmp_path / "ran").exists()


@pytest.mark.parametrize(("provider", "name"), [
    ("openai", "OPENAI_API_KEY"), ("codex", "OPENAI_API_KEY"),
    ("claude", "ANTHROPIC_API_KEY"), ("anthropic", "ANTHROPIC_API_KEY"),
    ("kimi", "MOONSHOT_API_KEY"), ("moonshot", "MOONSHOT_API_KEY"),
])
def test_the_wrapper_names_the_variable_of_the_provider(tmp_path: Path, provider: str, name: str) -> None:
    result = _wrap(provider, tmp_path=tmp_path)
    assert result.returncode == 0, result.stderr
    words = shlex.split(result.stdout)
    assert words[0] == "JHT_API_KEY_FILE=/dev/shm/jht-key"
    assert words[1] == "python3" and words[2].endswith("shared/skills/api_key_file.py")
    assert words[3:] == ["exec", "--env", name, "--"]
    assert (tmp_path / "ran").read_text(encoding="utf-8") == "check\n"


def test_a_refused_file_stops_the_spawn_with_the_code_of_the_checker(tmp_path: Path) -> None:
    result = _wrap("openai", exit_code=78, tmp_path=tmp_path)
    assert result.returncode == 78
    assert result.stdout == ""


@pytest.mark.parametrize("path", ["relative/key", "/dev/shm/a b", "/dev/shm/it's", "/dev/shm/../etc/key", "/dev/shm/k;rm", "/dev/shm/$HOME"])
def test_a_path_that_cannot_be_typed_safely_is_refused_before_the_checker(tmp_path: Path, path: str) -> None:
    result = _wrap("openai", path=path, tmp_path=tmp_path)
    assert result.returncode == 78
    assert result.stdout == ""
    assert "absolute path" in result.stderr
    assert not (tmp_path / "ran").exists()


def test_a_provider_without_a_key_variable_is_refused_but_the_local_scorer_needs_none(tmp_path: Path) -> None:
    assert _wrap("mystery", tmp_path=tmp_path).returncode == 78
    local = _wrap("local-scorer", tmp_path=tmp_path)
    assert local.returncode == 0 and local.stdout == ""


def _provider_info(config: dict, tmp_path: Path, key_file: str | None) -> str:
    source = START_AGENT.read_text(encoding="utf-8")
    path = tmp_path / "jht.config.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    env = _clean_env()
    env.pop("JHT_API_KEY_FILE", None)
    if key_file:
        env["JHT_API_KEY_FILE"] = key_file
    return subprocess.run([_bash(), "-c", f'{_function(source, "extract_provider_info")}\nextract_provider_info "{path}"'],
                          capture_output=True, text=True, check=True, env=env).stdout.strip()


CONFIG = {"active_provider": "openai",
          "providers": {"openai": {"name": "openai", "auth_method": "api_key", "api_key": KEY}}}


def test_the_key_of_the_config_is_not_read_when_a_key_file_is_given(tmp_path: Path) -> None:
    assert _provider_info(CONFIG, tmp_path, None) == f"openai|api_key|{KEY}"
    given = _provider_info(CONFIG, tmp_path, "/dev/shm/jht-key")
    assert given == "openai|api_key|"
    assert KEY not in given


def test_the_command_typed_into_the_pane_holds_the_path_and_never_the_key(tmp_path: Path) -> None:
    """The whole chain on pi: config key ignored, wrapper after the environment and before the binary."""
    _tool, lib = _tool_tree(tmp_path)
    result = _launch(tmp_path, harness=None, config_harness="pi",
                     after_lib=(lib, _env("/dev/shm/jht-key"), "API_KEY=''"))
    assert result.returncode == 0, result.stderr
    assert KEY not in result.stdout
    words = shlex.split(result.stdout.strip())
    exec_at = words.index("exec")
    assert words[exec_at + 1:exec_at + 4] == ["--env", "OPENAI_API_KEY", "--"]
    assert words[exec_at + 4] == "pi"
    assert words.index("PI_CODING_AGENT_DIR=" + [w for w in words if w.startswith("PI_CODING_AGENT_DIR=")][0].split("=", 1)[1]) < words.index("python3")


def test_start_agent_wraps_the_command_and_stops_on_a_refusal() -> None:
    source = START_AGENT.read_text(encoding="utf-8")
    assert 'KEY_WRAP="$(jht_key_wrap "$PROVIDER")" || exit $?' in source
    wrap = source.index('KEY_WRAP="$(jht_key_wrap')
    full = source.index('FULL_CMD="${CLI_ENV_PREFIX}${KEY_WRAP}$(jht_cli_exec')
    pane = source.index('send-keys -t "$SESSION" "$FULL_CMD" C-m')
    session = source.index('tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"')
    assert wrap < full < session < pane, "the file is checked before a pane exists"
    assert "API_KEY" not in source[full:full + 200].replace("KEY_WRAP", "")
