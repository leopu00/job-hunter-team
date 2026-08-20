"""Il modello per ruolo deve arrivare davvero al CLI Codex.

La mappa storica distingueva Opus/Sonnet, ma Codex ignorava la terza colonna:
l'effort corretto nel pane mascherava il fatto che il modello restava quello
implicito del CLI. Questi test eseguono le funzioni vere del launcher.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
START_AGENT = ROOT / ".launcher" / "start-agent.sh"


def _bash() -> str:
    """Prefer Git Bash on Windows; System32/bash.exe is the legacy WSL shim."""
    if os.name == "nt":
        git_bash = (
            Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
            / "Git" / "bin" / "bash.exe"
        )
        if git_bash.is_file():
            return str(git_bash)
    found = shutil.which("bash")
    assert found, "bash is required for launcher contract tests"
    return found


def _function(source: str, name: str) -> str:
    match = re.search(
        rf"^{re.escape(name)}\(\) \{{.*?^\}}",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert match, f"{name} non e' piu' in start-agent.sh"
    return match.group(0)


def _run_model_map(commands: str) -> subprocess.CompletedProcess[str]:
    source = START_AGENT.read_text(encoding="utf-8")
    script = "\n".join(
        [
            _function(source, "resolve_codex_model"),
            commands,
        ]
    )
    return subprocess.run(
        [_bash(), "-c", script],
        capture_output=True,
        text=True,
        check=False,
    )


def test_codex_aliases_match_the_claude_calibration() -> None:
    result = _run_model_map(
        "resolve_codex_model ''\nresolve_codex_model sonnet",
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["gpt-5.6-sol", "gpt-5.6-terra"]


def test_all_roles_keep_their_existing_effort_and_model_class() -> None:
    source = START_AGENT.read_text(encoding="utf-8")
    get_agent_info = _function(source, "get_agent_info")
    roles = [
        "capitano", "scout", "analista", "scorer", "scrittore",
        "critico", "mentor", "assistente", "sentinella",
    ]
    command = "\n".join(f"get_agent_info {role}" for role in roles)
    result = subprocess.run(
        [_bash(), "-c", f"{get_agent_info}\n{command}"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    rows = dict(zip(roles, (line.split("|") for line in result.stdout.splitlines())))
    heavy = {"capitano", "scrittore", "critico", "mentor"}
    for role, (_session, effort, alias) in rows.items():
        assert effort == "high"
        assert alias == ("" if role in heavy else "sonnet")


def test_codex_command_receives_the_resolved_model() -> None:
    source = START_AGENT.read_text(encoding="utf-8")

    assert (
        'CLI_ARGS="--yolo --model $codex_model '
        '-c model_reasoning_effort=$effort"'
    ) in source
