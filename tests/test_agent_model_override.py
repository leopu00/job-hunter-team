"""Il modello per ruolo deve arrivare davvero al CLI Codex.

La mappa storica distingueva Opus/Sonnet, ma Codex ignorava la terza colonna:
l'effort corretto nel pane mascherava il fatto che il modello restava quello
implicito del CLI. Questi test eseguono le funzioni vere del launcher.

L'ultimo test nasce da una prova di rottura (2026-08-20). Nella prima stesura
asseriva la riga `CLI_ARGS=...` come STRINGA del sorgente, e quella misura era
invertita: togliendo la risoluzione del modello — cioe' reintroducendo esatto
il difetto che il commit chiude, con `--model` che riceve una stringa vuota —
restava VERDE; riordinando i flag senza cambiare comportamento diventava
ROSSO. Ora il ramo `openai|codex)` viene ESEGUITO e si guarda il comando che
ne esce, cosi' il rosso segue il difetto e non la forma della riga.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest


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


def _codex_branch(source: str) -> str:
    """Il corpo del ramo `openai|codex)` del case sul provider."""
    match = re.search(
        r"^  openai\|codex\)\n(.*?)^    ;;$",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert match, "il ramo openai|codex non e' piu' in start-agent.sh"
    return match.group(1)


@pytest.mark.parametrize(
    ("role", "expected_model"),
    [
        ("capitano", "gpt-5.6-sol"),
        ("scrittore", "gpt-5.6-sol"),
        ("critico", "gpt-5.6-sol"),
        ("mentor", "gpt-5.6-sol"),
        ("scout", "gpt-5.6-terra"),
        ("analista", "gpt-5.6-terra"),
        ("scorer", "gpt-5.6-terra"),
        ("assistente", "gpt-5.6-terra"),
        ("sentinella", "gpt-5.6-terra"),
    ],
)
def test_codex_command_carries_the_model_of_that_role(
    role: str, expected_model: str
) -> None:
    """Il comando che parte per QUEL ruolo nomina QUEL modello.

    Si esegue la catena vera — mappa ruoli, risoluzione alias, costruzione di
    CLI_ARGS — e si legge il comando finale: e' il fatto che sulla VPS si
    misura dal processo.
    """
    source = START_AGENT.read_text(encoding="utf-8")
    script = "\n".join(
        [
            _function(source, "get_agent_info"),
            _function(source, "resolve_codex_model"),
            f'IFS="|" read -r session_prefix effort model_override '
            f'<<< "$(get_agent_info {role})"',
            "AUTH_METHOD=subscription",
            "API_KEY=",
            _codex_branch(source),
            'printf "%s %s\\n" "$CLI_BIN" "$CLI_ARGS"',
        ]
    )
    result = subprocess.run(
        [_bash(), "-c", script], capture_output=True, text=True, check=False
    )

    assert result.returncode == 0, result.stderr
    command = result.stdout.strip()
    assert command.startswith("codex ")
    assert f"--model {expected_model}" in command
    assert "-c model_reasoning_effort=high" in command


def test_an_unmapped_alias_refuses_to_start_instead_of_guessing() -> None:
    """Un alias che la mappa Codex non conosce ferma l'avvio.

    Senza questo, un ruolo nuovo con alias sconosciuto partirebbe con `--model`
    vuoto: consumo sul modello di punta con l'aria di aver funzionato.
    """
    source = START_AGENT.read_text(encoding="utf-8")
    result = _run_model_map('resolve_codex_model haiku && echo "NON DOVEVA"')

    assert result.returncode != 0
    assert "NON DOVEVA" not in result.stdout
    assert "no Codex model mapping" in result.stderr


def test_codex_command_receives_the_resolved_model() -> None:
    """Preserva il contratto nominale del branch Fullstack con una prova reale."""
    test_codex_command_carries_the_model_of_that_role(
        "capitano", "gpt-5.6-sol"
    )
