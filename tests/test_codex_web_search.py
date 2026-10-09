"""Codex sessions of the roles that search the web get `--search`.

Claude Code has WebSearch built in; Codex has a native `web_search` tool only
when the session starts with `--search`. Without it the Scout lost the fourth
tier of its sources (circles-and-sources), the Analista the web fallback of
geocoding, location and logo enrichment, the Mentor its web check. The flag
exists in the pinned Codex 0.147.0 (codex-rs/tui/src/cli.rs at rust-v0.147.0)
and in the 0.161 measured on 08/10.

The list of roles lives in spawn-lib.sh and must match the roles whose
skills or prompt name WebSearch: a new skill that searches the web, or a role
that stops doing it, turns this red instead of drifting.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from test_agent_model_override import _bash, _codex_branch, _function


ROOT = Path(__file__).resolve().parents[1]
AGENTS = ROOT / "agents"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico",
         "mentor", "assistente", "sentinella"]
WEB_SEARCH = re.compile(r"\bWebSearch\b")


def _roles_that_search_the_web() -> set[str]:
    shared = {p.parent.name for p in (AGENTS / "_skills").glob("*/SKILL.md")
              if WEB_SEARCH.search(p.read_text(encoding="utf-8"))}
    roles = set()
    for role in AGENTS.iterdir():
        if not role.is_dir() or role.name.startswith("_"):
            continue
        listed = set()
        manifest = role / "skills.list"
        if manifest.exists():
            for line in manifest.read_text(encoding="utf-8").splitlines():
                name = line.split("#", 1)[0].strip()
                if name:
                    listed.add(name)
        private = [p for p in (role / "_skills").glob("*/SKILL.md")
                   if WEB_SEARCH.search(p.read_text(encoding="utf-8"))]
        prompt = role / f"{role.name}.md"
        in_prompt = prompt.exists() and WEB_SEARCH.search(prompt.read_text(encoding="utf-8"))
        if listed & shared or private or in_prompt:
            roles.add(role.name)
    return roles


def _configured_roles() -> set[str]:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_CODEX_WEB_SEARCH_ROLES"'],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    return set(result.stdout.split())


def _codex_command(role: str) -> str:
    source = START_AGENT.read_text(encoding="utf-8")
    script = "\n".join([
        f'source "{SPAWN_LIB}"',
        _function(source, "get_agent_info"),
        _function(source, "resolve_codex_model"),
        f"ROLE={role}",
        f'IFS="|" read -r session_prefix effort model_override <<< "$(get_agent_info {role})"',
        "AUTH_METHOD=subscription",
        "API_KEY=",
        _codex_branch(source),
        'printf "%s %s\\n" "$CLI_BIN" "$CLI_ARGS"',
    ])
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stderr == "", result.stderr
    return result.stdout.strip()


def test_the_list_matches_the_roles_that_name_websearch() -> None:
    expected = _roles_that_search_the_web()
    # A search that finds nothing must not pass.
    assert {"scout", "analista", "mentor"} <= expected
    assert _configured_roles() == expected


@pytest.mark.parametrize("role", ROLES)
def test_only_those_roles_start_codex_with_search(role: str) -> None:
    command = _codex_command(role)

    assert command.startswith("codex ")
    assert ("--search" in command.split()) == (role in _configured_roles())


@pytest.mark.skipif(shutil.which("codex") is None, reason="codex CLI non installata (non c'e' in CI)")
def test_the_installed_codex_accepts_the_flags_together(tmp_path: Path) -> None:
    home = tmp_path / "codex-home"
    home.mkdir()
    args = _codex_command("scout").split()[1:]

    def run(*flags: str) -> int:
        return subprocess.run(
            ["codex", *flags, "debug", "prompt-input", "ciao"],
            cwd=tmp_path, env={**os.environ, "CODEX_HOME": str(home)},
            capture_output=True, text=True, check=False, timeout=120,
        ).returncode

    # --model is a session choice the debug command does not need.
    flags = [a for i, a in enumerate(args) if a != "--model" and (i == 0 or args[i - 1] != "--model")]
    assert run(*flags) == 0
    assert run("--surch") != 0  # the control: a flag the CLI does not know is refused
