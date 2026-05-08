#!/usr/bin/env python3
"""bridge_mailbox.py — drain della mailbox dei verdetti del pacing-bridge.

Il pacing-bridge appende ogni verdetto a $JHT_HOME/logs/bridge-mailbox.jsonl
indipendentemente dal successo della consegna tmux (jht-tmux-send rc=3
quando il capitano è in turno lungo). Questo tool legge i verdetti non
ancora consumati dal capitano e li stampa, poi avanza il cursor.

Uso (dal capitano, all'inizio di ogni turno):
    python3 /app/shared/skills/bridge_mailbox.py drain

Output: zero o piu' righe `[BRIDGE PACING] ...` da processare. Il cursor
viene avanzato in $JHT_HOME/logs/bridge-mailbox.cursor (offset bytes).

Comandi:
    drain        legge nuovi messaggi e avanza cursor (default)
    peek         legge nuovi messaggi SENZA avanzare cursor
    status       stampa quanti messaggi pending vs totali
    reset        resetta il cursor a 0 (rilegge tutto)
"""
import json
import os
import sys
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
MAILBOX = JHT_HOME / "logs" / "bridge-mailbox.jsonl"
CURSOR = JHT_HOME / "logs" / "bridge-mailbox.cursor"


def read_cursor() -> int:
    try:
        return int(CURSOR.read_text().strip() or "0")
    except (OSError, ValueError):
        return 0


def write_cursor(offset: int) -> None:
    try:
        CURSOR.parent.mkdir(parents=True, exist_ok=True)
        CURSOR.write_text(str(offset))
    except OSError as e:
        print(f"[bridge_mailbox] WARN write cursor: {e}", file=sys.stderr)


def read_new(advance: bool) -> list[dict]:
    """Legge la mailbox da `cursor` in poi e ritorna lista di entry.
    Se advance=True, sposta il cursor a fine file. Se il file e' piu'
    piccolo del cursor (es. truncate manuale), riparte da 0."""
    if not MAILBOX.exists():
        return []
    cursor = read_cursor()
    try:
        size = MAILBOX.stat().st_size
    except OSError:
        return []
    if cursor > size:
        cursor = 0
    entries: list[dict] = []
    with MAILBOX.open("rb") as f:
        f.seek(cursor)
        raw = f.read()
        new_offset = cursor + len(raw)
    for line in raw.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if advance:
        write_cursor(new_offset)
    return entries


def cmd_drain():
    new = read_new(advance=True)
    if not new:
        print("[bridge_mailbox] no pending verdicts")
        return
    # Stampa solo i messaggi (sintassi originale del bridge), uno per riga.
    # Il capitano puo' parsarli con la stessa logica dei tick tmux.
    for e in new:
        print(e.get("msg", ""))


def cmd_peek():
    new = read_new(advance=False)
    if not new:
        print("[bridge_mailbox] no pending verdicts (peek)")
        return
    for e in new:
        delivered = "✓tmux" if e.get("delivered_via_tmux") else "✗tmux"
        print(f"[{e.get('ts','?')}] {e.get('kind','?'):>7s} {delivered} | {e.get('msg','')}")


def cmd_status():
    if not MAILBOX.exists():
        print("mailbox: missing | pending: 0 | total: 0")
        return
    cursor = read_cursor()
    try:
        size = MAILBOX.stat().st_size
    except OSError:
        size = 0
    total_lines = 0
    pending_lines = 0
    with MAILBOX.open("rb") as f:
        for ln in f:
            total_lines += 1
        f.seek(cursor)
        for ln in f:
            pending_lines += 1
    print(f"mailbox: {MAILBOX} | size: {size}b | cursor: {cursor}b | "
          f"total: {total_lines} | pending: {pending_lines}")


def cmd_reset():
    write_cursor(0)
    print("[bridge_mailbox] cursor reset to 0 (next drain rileggerà tutto)")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "drain"
    if cmd == "drain":
        cmd_drain()
    elif cmd == "peek":
        cmd_peek()
    elif cmd == "status":
        cmd_status()
    elif cmd == "reset":
        cmd_reset()
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
