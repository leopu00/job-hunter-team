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

import json
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


# ── team.role_models: modello ed effort per ruolo dal config ────────────────
#
# Il default non cambia: senza la chiave il comando e' quello di sempre (i
# test sopra). Con la chiave, il ruolo parte sulla classe chiesta — luna
# compresa, che nella mappa ruoli non ha un alias — e un valore sbagliato
# ferma l'avvio invece di cadere sul modello di punta.


def _between(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


def _override_block(source: str) -> str:
    return _between(source, "# Override per ruolo dal config", "# Nessun default implicito")


def _claude_branch(source: str) -> str:
    match = re.search(
        r"^  anthropic\|claude\)\n(.*?)^    ;;$",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert match, "il ramo anthropic|claude non e' piu' in start-agent.sh"
    return match.group(1)


def _write_config(tmp_path: Path, role_models: object | None) -> Path:
    cfg: dict[str, object] = {"active_provider": "openai", "providers": {"openai": {}}}
    if role_models is not None:
        cfg["team"] = {"role_models": role_models}
    path = tmp_path / "jht.config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    return path


def _spawn_command(
    tmp_path: Path,
    role: str,
    role_models: object | None,
    provider: str = "openai",
    mode: str = "",
    spawn_src: str = "",
) -> subprocess.CompletedProcess[str]:
    """La catena vera fino al comando: mappa, override del config, ramo del provider.

    `spawn_src` e' JHT_SPAWN_SRC, la variabile con cui chi ricrea la sessione
    (watchdog, pannello, app desktop) dice da dove arriva.
    """
    source = START_AGENT.read_text(encoding="utf-8")
    branch = _codex_branch(source) if provider == "openai" else _claude_branch(source)
    script = "\n".join(
        [
            _function(source, "get_agent_info"),
            _function(source, "resolve_codex_model"),
            _function(source, "jht_role_model_override"),
            f"ROLE={role}",
            f"MODE={mode}",
            f"PROVIDER={provider}",
            f"JHT_CONFIG_FILE='{_write_config(tmp_path, role_models)}'",
            f'IFS="|" read -r session_prefix effort model_override '
            f'<<< "$(get_agent_info {role})"',
            'if [ "$MODE" = "fast" ]; then effort="low"; fi',
            _override_block(source),
            "AUTH_METHOD=subscription",
            "API_KEY=",
            branch,
            'printf "CMD %s %s\\n" "$CLI_BIN" "$CLI_ARGS"',
        ]
    )
    env = {**os.environ, "JHT_SPAWN_SRC": spawn_src} if spawn_src else None
    return subprocess.run(
        [_bash(), "-c", script], capture_output=True, text=True, check=False, env=env
    )


def _command(result: subprocess.CompletedProcess[str]) -> str:
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.startswith("CMD ")]
    assert len(lines) == 1, result.stdout
    return lines[0][4:]


def test_the_codex_classes_include_luna() -> None:
    result = _run_model_map(
        "resolve_codex_model sol\nresolve_codex_model terra\nresolve_codex_model luna",
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]


@pytest.mark.parametrize("role_models", [None, {}, {"scorer": {"model": "luna"}}, {"scout": None}])
def test_without_an_entry_for_the_role_the_command_is_unchanged(
    tmp_path: Path, role_models: object
) -> None:
    command = _command(_spawn_command(tmp_path, "scout", role_models))

    assert "--model gpt-5.6-terra" in command
    assert "-c model_reasoning_effort=high" in command


@pytest.mark.parametrize(
    ("role", "entry", "model", "effort"),
    [
        ("scout", {"model": "luna", "effort": "medium"}, "gpt-5.6-luna", "medium"),
        ("scout", {"model": "luna"}, "gpt-5.6-luna", "high"),
        ("capitano", {"model": "terra", "effort": "low"}, "gpt-5.6-terra", "low"),
        ("scorer", {"effort": "medium"}, "gpt-5.6-terra", "medium"),
        ("analista", {"model": "sol"}, "gpt-5.6-sol", "high"),
    ],
)
def test_the_config_moves_that_role_to_the_class_and_effort_it_asks(
    tmp_path: Path, role: str, entry: dict[str, str], model: str, effort: str
) -> None:
    command = _command(_spawn_command(tmp_path, role, {role: entry}))

    assert command.startswith("codex ")
    assert f"--model {model}" in command
    assert f"-c model_reasoning_effort={effort}" in command


def test_fast_mode_keeps_its_low_effort_over_the_config(tmp_path: Path) -> None:
    command = _command(
        _spawn_command(tmp_path, "scout", {"scout": {"model": "luna", "effort": "high"}}, mode="fast")
    )

    assert "--model gpt-5.6-luna" in command
    assert "-c model_reasoning_effort=low" in command


def test_on_claude_the_class_is_declared_not_applied_and_the_effort_applies(
    tmp_path: Path,
) -> None:
    result = _spawn_command(
        tmp_path, "scout", {"scout": {"model": "luna", "effort": "medium"}}, provider="claude"
    )
    command = _command(result)

    assert command.startswith("claude ")
    assert "--model sonnet" in command
    assert "--effort medium" in command
    assert "applies to Codex and pi only" in result.stdout


@pytest.mark.parametrize(
    ("entry", "message"),
    [
        ({"model": "gpt-5.6-luna"}, "is not one of sol, terra, luna"),
        ({"model": "haiku"}, "is not one of sol, terra, luna"),
        ({"effort": "max"}, "is not one of low, medium, high"),
        ({"model": "luna", "efort": "low"}, "unknown keys ['efort']"),
        ("luna", "must be an object"),
    ],
)
def test_a_wrong_value_refuses_to_start_instead_of_falling_back(
    tmp_path: Path, entry: object, message: str
) -> None:
    result = _spawn_command(tmp_path, "scout", {"scout": entry})

    assert result.returncode != 0
    assert "CMD " not in result.stdout
    assert message in result.stderr


def test_the_launcher_and_the_config_schema_allow_the_same_values() -> None:
    """Due elenchi in due lingue: se divergono, l'app salva un valore che il launcher rifiuta."""
    launcher = _function(START_AGENT.read_text(encoding="utf-8"), "jht_role_model_override")
    schema = (ROOT / "shared" / "config" / "schema.ts").read_text(encoding="utf-8")
    block = _between(schema, "export const RoleModelSchema", "export const TeamSettingsSchema")

    for key in ("model", "effort"):
        in_launcher = re.search(rf'"{key}": \(([^)]*)\)', launcher)
        in_schema = re.search(rf"{key}: z\.enum\(\[([^\]]*)\]\)", block)
        assert in_launcher and in_schema, key
        assert re.findall(r'"(\w+)"', in_launcher.group(1)) == re.findall(
            r'"(\w+)"', in_schema.group(1)
        ), key


# ── JHT-T135: la scelta del ruolo resiste a ogni ricreazione della sessione ──
#
# Il modello scelto con `/model` dentro una sessione vive solo in quella
# sessione. Quello scritto in team.role_models vive nel config, e il launcher
# lo rilegge a OGNI avvio: il watchdog che ricrea una sessione morta, il
# pannello e l'app che la riaccendono, il refresh del Dottore (che ricrea le
# sessioni passando da start-agent.sh) ripartono tutti dalla stessa riga.

SPAWN_SOURCES = ["", "agent-watchdog", "desktop-panel", "desktop-existing-team", "doctor-refresh"]


@pytest.mark.parametrize("spawn_src", SPAWN_SOURCES)
def test_a_role_with_a_chosen_model_restarts_on_the_same_model(
    tmp_path: Path, spawn_src: str
) -> None:
    chosen = {"scout": {"model": "luna", "effort": "low"}}
    first = _command(_spawn_command(tmp_path, "scout", chosen))
    again = _command(_spawn_command(tmp_path, "scout", chosen, spawn_src=spawn_src))

    assert "--model gpt-5.6-luna" in first
    assert "-c model_reasoning_effort=low" in first
    assert again == first
    # gli altri ruoli non seguono la scelta dello scout
    other = _command(_spawn_command(tmp_path, "analista", chosen, spawn_src=spawn_src))
    assert "--model gpt-5.6-terra" in other and "model_reasoning_effort=high" in other


def test_the_next_spawn_reads_the_config_as_it_is_then(tmp_path: Path) -> None:
    """Niente copia fra un avvio e l'altro: cambiare la scelta vale dal prossimo."""
    before = _command(_spawn_command(tmp_path, "scout", {"scout": {"model": "luna"}}))
    after = _command(
        _spawn_command(tmp_path, "scout", {"scout": {"model": "sol", "effort": "medium"}},
                       spawn_src="agent-watchdog")
    )
    cleared = _command(_spawn_command(tmp_path, "scout", {}, spawn_src="agent-watchdog"))

    assert "--model gpt-5.6-luna" in before
    assert "--model gpt-5.6-sol" in after and "model_reasoning_effort=medium" in after
    # {} rimette il ruolo sul suo predefinito: la mappa ruoli, terra e high
    assert "--model gpt-5.6-terra" in cleared and "model_reasoning_effort=high" in cleared
