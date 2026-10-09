"""Codex must read each role prompt whole.

Codex reads AGENTS.md only up to `project_doc_max_bytes` (32 KiB by default)
and drops the rest without a word. On 08/10, `codex debug prompt-input`
(0.161) showed the Capitano receiving 37-39% of its prompt (83-89 KB
depending on the language), the Analista about 80% and the Sentinella about
85%: every rule past 32 KiB did not exist for the model.

The launcher now passes `-c project_doc_max_bytes` to every Codex session
(agents via start-agent.sh, Dottore and Mantenitore via jht_spawn_repl_cmd),
and every role prompt in every language must stay under that value with a
margin for a global AGENTS.md. The last test runs the real Codex CLI when it
is installed (not in CI) and reads the prompt the model would get.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from test_agent_model_override import _bash, _codex_branch, _function


ROOT = Path(__file__).resolve().parents[1]
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
CODEX_DEFAULT = 32 * 1024
# Room for a global AGENTS.md that Codex adds to the workdir's one.
MARGIN = 16 * 1024
ROLE_PROMPTS = sorted(
    path
    for role in (ROOT / "agents").iterdir()
    if role.is_dir() and not role.name.startswith("_")
    for path in role.glob(f"{role.name}*.md")
)


def _budget() -> int:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; printf %s "$JHT_CODEX_PROJECT_DOC_MAX_BYTES"'],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    return int(result.stdout)


def _flag(command: str) -> int | None:
    match = re.search(r"-c project_doc_max_bytes=(\d+)(\s|$)", command)
    return int(match.group(1)) if match else None


def test_the_budget_is_above_codex_default() -> None:
    assert _budget() > CODEX_DEFAULT


@pytest.mark.parametrize("role", ["capitano", "analista", "sentinella", "scout"])
def test_every_codex_agent_is_started_with_the_budget(role: str) -> None:
    """The real `openai|codex)` branch, run, and the command that comes out."""
    source = START_AGENT.read_text(encoding="utf-8")
    script = "\n".join([
        f'source "{SPAWN_LIB}"',
        _function(source, "get_agent_info"),
        _function(source, "resolve_codex_model"),
        f'IFS="|" read -r session_prefix effort model_override <<< "$(get_agent_info {role})"',
        "AUTH_METHOD=subscription",
        "API_KEY=",
        _codex_branch(source),
        'printf "%s %s\\n" "$CLI_BIN" "$CLI_ARGS"',
    ])
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False)

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("codex ")
    assert _flag(result.stdout) == _budget()


def test_the_doctor_and_maintainer_sessions_get_it_too() -> None:
    result = subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_spawn_repl_cmd codex'],
        capture_output=True, text=True, check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("codex ")
    assert _flag(result.stdout) == _budget()


def test_every_role_prompt_fits_in_the_budget_with_a_margin() -> None:
    # A search that finds nothing must not pass: 12 roles x 7 languages.
    assert len(ROLE_PROMPTS) >= 80, len(ROLE_PROMPTS)
    budget = _budget()
    too_big = [
        f"{path.relative_to(ROOT)}: {path.stat().st_size} B"
        for path in ROLE_PROMPTS
        if path.stat().st_size + MARGIN > budget
    ]
    assert too_big == [], f"over {budget - MARGIN} B: {too_big}"


def _instructions(prompt_json: str) -> str:
    def texts(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            for value in node.values():
                yield from texts(value)
        elif isinstance(node, list):
            for value in node:
                yield from texts(value)

    blocks = [t for t in texts(json.loads(prompt_json)) if "<INSTRUCTIONS>" in t]
    assert blocks, "no AGENTS.md block in the prompt"
    return blocks[0].split("<INSTRUCTIONS>", 1)[1].rsplit("</INSTRUCTIONS>", 1)[0].strip("\n")


@pytest.mark.skipif(shutil.which("codex") is None, reason="codex CLI non installata (non c'e' in CI)")
def test_the_real_codex_cli_reads_the_largest_prompt_whole(tmp_path: Path) -> None:
    largest = max(ROLE_PROMPTS, key=lambda path: path.stat().st_size)
    text = largest.read_text(encoding="utf-8")
    assert len(text.encode()) > CODEX_DEFAULT  # otherwise this proves nothing
    workdir = tmp_path / "role"
    workdir.mkdir()
    (workdir / "AGENTS.md").write_text(text, encoding="utf-8")
    codex_home = tmp_path / "codex-home"
    codex_home.mkdir()
    env = {**os.environ, "CODEX_HOME": str(codex_home)}

    def prompt(*extra: str) -> str:
        result = subprocess.run(
            ["codex", "debug", "prompt-input", *extra, "ciao"],
            cwd=workdir, env=env, capture_output=True, text=True, check=False, timeout=120,
        )
        assert result.returncode == 0, result.stderr
        return _instructions(result.stdout)

    # The control: without the flag Codex cuts at its default.
    assert len(prompt().encode()) == CODEX_DEFAULT
    assert prompt("-c", f"project_doc_max_bytes={_budget()}") == text.strip("\n")
