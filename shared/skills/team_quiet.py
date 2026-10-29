#!/usr/bin/env python3
"""
team_quiet.py — i fatti con cui l'app spiega perche' il team non scrive. SOLA LETTURA.

Quando gli agenti tacciono da un po', chi scrive in chat non sa se l'app e' rotta o se il team non puo'
lavorare. Tre cose lo spiegano e stanno nella scatola, non nell'app:

  budget        la finestra di consumo del provider, dall'ultimo campione del sentinel
                (`logs/sentinel-data.jsonl`): quanto e' piena e a che ora si riapre;
  containment   un agente tenuto fermo da un contenimento di sicurezza (un marker
                `logs/containment/<SESSIONE>.hold.json`);
  providerReady il provider attivo ha un accesso su disco (il file delle credenziali esiste e non e' vuoto).

Esce SOLO numeri e booleani, mai un percorso, un nome di agente, un'email o un testo libero. Un fatto che
non si legge manca dalla risposta: non diventa mai «tutto a posto» ne' «guasto».

Uso (una riga JSON in uscita, uscita 0):
  python3 team_quiet.py status
    {"ok": true, "quiet": {"budget": {"usagePct": 97.5, "resetAtUnix": 1790000000}, "containment": false, "providerReady": true}}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Quanto del fondo del file dei campioni si guarda: l'ultimo campione sta in fondo, e il file cresce.
TAIL_BYTES = 64 * 1024
USAGE_MAX = 1000.0

# Dove il provider tiene l'accesso, dentro la home del team.
AUTH_FILES = {
    "claude": [".claude/.credentials.json"],
    "anthropic": [".claude/.credentials.json"],
    "openai": [".codex/auth.json", ".codex/credentials.json"],
    "codex": [".codex/auth.json", ".codex/credentials.json"],
    "kimi": [".kimi/credentials/kimi-code.json", ".config/kimi-cli/credentials.json"],
    "moonshot": [".kimi/credentials/kimi-code.json", ".config/kimi-cli/credentials.json"],
}


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if number == number and abs(number) != float("inf") else None


def budget(home: Path) -> dict | None:
    """L'ultimo campione della finestra del provider, o None se non c'e' o non si legge."""
    path = home / "logs" / "sentinel-data.jsonl"
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    lines = [line.strip() for line in tail.splitlines() if line.strip()]
    # la prima riga puo' essere tagliata a meta': si prova dall'ultima all'indietro, la prima buona vale
    for line in reversed(lines):
        try:
            sample = json.loads(line)
        except ValueError:
            continue
        if not isinstance(sample, dict):
            continue
        usage = _number(sample.get("usage"))
        if usage is None or not 0.0 <= usage <= USAGE_MAX:
            continue
        reset = _number(sample.get("reset_at_unix"))
        return {
            "usagePct": round(usage, 1),
            "resetAtUnix": int(reset) if reset is not None and reset > 0 else None,
        }
    return None


def containment(home: Path) -> bool | None:
    """True se almeno un agente e' tenuto da un contenimento. None se la cartella non si legge."""
    folder = home / "logs" / "containment"
    try:
        return any(entry.name.endswith(".hold.json") for entry in folder.iterdir())
    except FileNotFoundError:
        return False
    except OSError:
        return None


def provider_ready(home: Path) -> bool | None:
    """Il provider attivo ha un accesso su disco. None se non si sa quale provider sia, o non lo conosciamo."""
    try:
        config = json.loads((home / "jht.config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    active = config.get("active_provider") if isinstance(config, dict) else None
    files = AUTH_FILES.get(str(active or "").strip().lower())
    if not files:
        return None
    for name in files:
        try:
            if (home / name).is_file() and (home / name).stat().st_size > 0:
                return True
        except OSError:
            continue
    return False


def status(home: Path | None = None) -> dict:
    home = home or jht_home()
    quiet: dict = {}
    window = budget(home)
    if window is not None:
        quiet["budget"] = window
    held = containment(home)
    if held is not None:
        quiet["containment"] = held
    ready = provider_ready(home)
    if ready is not None:
        quiet["providerReady"] = ready
    return {"ok": True, "quiet": quiet}


def main(argv: list[str]) -> int:
    if argv != ["status"]:
        print(json.dumps({"ok": False, "code": "request_invalid"}))
        return 2
    print(json.dumps(status(), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
