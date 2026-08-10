"""O-19 — `--effort` dichiarato ma non applicato.

Il launcher passa `--effort high` e il processo lo porta davvero (`ps` lo
mostra), ma i flag `unpin<Modello>LaunchEffort` nel `.claude.json` del
container sganciano l'effort DI LANCIO: gli agenti girano al default del
modello. Nessuno se ne accorge — funzionano lo stesso, e l'unico segnale è
la bolletta dell'utente.

Il test gira la funzione VERA estratta da start-agent.sh, non una sua copia:
il difetto stava nel fatto che l'intenzione non veniva mai verificata, e un
test che riscrivesse la normalizzazione ripeterebbe l'errore in piccolo.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
START_AGENT = ROOT / ".launcher" / "start-agent.sh"


def _run_normalizer(home: Path) -> subprocess.CompletedProcess:
    """Esegue `_ensure_claude_onboarding` così com'è nel launcher."""
    src = START_AGENT.read_text(encoding="utf-8")
    fn = re.search(r"^_ensure_claude_onboarding\(\) \{.*?^\}", src,
                   re.DOTALL | re.MULTILINE)
    assert fn, "la funzione di normalizzazione non è più in start-agent.sh"
    script = f'{fn.group(0)}\n_ensure_claude_onboarding "{home}"\n'
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    return tmp_path


def test_unpinned_launch_effort_is_repinned_and_announced(home: Path) -> None:
    (home / ".claude.json").write_text(json.dumps({
        "hasCompletedOnboarding": True,
        "theme": "dark",
        "unpinOpus47LaunchEffort": True,
        "unpinOpus48LaunchEffort": True,
        "unpinFable5LaunchEffort": True,
    }), encoding="utf-8")

    result = _run_normalizer(home)

    data = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    unpinned = {k: v for k, v in data.items() if k.endswith("LaunchEffort")}
    assert unpinned and not any(unpinned.values()), \
        f"l'effort resta sganciato: {unpinned}"
    # Correggere in silenzio ripeterebbe il difetto in forma più educata:
    # il disallineamento deve lasciare una traccia leggibile.
    assert "effort-unpin" in result.stdout, \
        f"nessun avviso a schermo: {result.stdout!r} {result.stderr!r}"


def test_a_flag_for_a_future_model_is_caught_too(home: Path) -> None:
    """Il riconoscimento è per prefisso, non per elenco.

    I tre nomi noti sono legati a modelli precisi; il prossimo modello porta
    il suo. Un elenco fisso tornerebbe muto proprio quando cambia il modello,
    cioè quando il costo cambia.
    """
    (home / ".claude.json").write_text(
        json.dumps({"unpinSomeFutureModelLaunchEffort": True}), encoding="utf-8")

    _run_normalizer(home)

    data = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    assert data["unpinSomeFutureModelLaunchEffort"] is False


def test_it_is_idempotent_and_leaves_the_rest_alone(home: Path) -> None:
    (home / ".claude.json").write_text(json.dumps({
        "theme": "dark",
        "customThing": {"keep": "me"},
        "unpinOpus47LaunchEffort": False,
    }), encoding="utf-8")

    result = _run_normalizer(home)

    data = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    assert data["customThing"] == {"keep": "me"}
    assert data["theme"] == "dark"
    # Già a posto: nessun avviso, altrimenti a ogni avvio sembrerebbe un guasto.
    assert "effort-unpin" not in result.stdout


def test_the_launcher_normalises_before_launching_every_claude_agent() -> None:
    """La correzione deve girare SEMPRE, non solo quando .claude.json manca.

    Sui box reali il file esiste già — è proprio lì che i flag vivono. Se la
    chiamata finisse dentro il ramo "se manca", il fix non scatterebbe mai
    dove serve.
    """
    src = START_AGENT.read_text(encoding="utf-8")
    guard = src.index('if [ "$CLI_BIN" = "claude" ]')
    call = src.index("_ensure_claude_onboarding", guard)
    missing_check = src.index('if [ ! -s "$_claude_json" ]', guard)
    assert call < missing_check, \
        "la normalizzazione è finita dentro il ramo 'se .claude.json manca'"
