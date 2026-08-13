"""jht-send: gli a capo che l'agente scrive come escape devono arrivare veri.

Gli agenti invocano `jht-send "riga1\\nriga2"`. Dentro i doppi apici la shell
non tocca la sequenza, quindi lo strumento riceve backslash+n e — prima di
questo fix — li ri-serializzava in JSON come "\\\\n": la chat mostrava "\\n"
in mezzo alla frase invece di andare a capo.
"""
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "agents/_tools/jht-send"


def _send(tmp_path: Path, *args: str) -> dict:
    env = os.environ.copy()
    env["JHT_AGENT_DIR"] = str(tmp_path)
    result = subprocess.run(
        [str(TOOL), *args],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads((tmp_path / "chat.jsonl").read_text().strip().split("\n")[-1])


def test_literal_newlines_become_real_ones(tmp_path: Path) -> None:
    entry = _send(tmp_path, "Ciao Leone!\\n\\nChe ruolo cerchi?")
    assert entry["text"] == "Ciao Leone!\n\nChe ruolo cerchi?"
    assert "\\n" not in entry["text"]


def test_tabs_are_decoded_too(tmp_path: Path) -> None:
    entry = _send(tmp_path, "colonna1\\tcolonna2")
    assert entry["text"] == "colonna1\tcolonna2"


def test_escaped_backslash_stays_literal(tmp_path: Path) -> None:
    """Chi vuole davvero mostrare "\\n" raddoppia il backslash."""
    entry = _send(tmp_path, "la sequenza \\\\n va a capo")
    assert entry["text"] == "la sequenza \\n va a capo"


def test_raw_keeps_the_text_untouched(tmp_path: Path) -> None:
    entry = _send(tmp_path, "--raw", "niente\\ndecodifica")
    assert entry["text"] == "niente\\ndecodifica"


def test_real_newlines_survive_the_round_trip(tmp_path: Path) -> None:
    """Un a capo vero nell'argomento resta un a capo, e la riga JSON resta una."""
    entry = _send(tmp_path, "prima\nseconda")
    assert entry["text"] == "prima\nseconda"
    assert len((tmp_path / "chat.jsonl").read_text().strip().split("\n")) == 1


def test_tmux_sender_queues_busy_without_wait_drop() -> None:
    src = (ROOT / "agents/_skills/tmux-send/jht-tmux-send").read_text()
    assert 'queued/delivery unverified' in src
    assert 'exit 6' in src
    assert 'while [ "$waited" -lt "$busy_budget" ]' not in src
    assert 'busy_typed=1' in src
