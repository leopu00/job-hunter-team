#!/usr/bin/env python3
"""captain_diary — diario giornaliero del Capitano per il passaggio del testimone.

Il Capitano viene riavviato (context-refresh, restart, nuova finestra): senza
memoria del giorno prima rischia di rifare gli stessi errori di pacing (es. 3
Scout in colpo → picco di 15 min infrenabile → 5h di pausa per ripagare il
debito). Questo diario PERSISTE quelle lezioni e le passa al Capitano successivo.

Un file per giorno: `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md` (append-only).

Uso:
  captain_diary.py add "3 Scout insieme alle 20:05 → picco infrenabile, 5h coast.
                        Lezione: max 1 Scout, poi 30 min di osservazione."
  captain_diary.py handoff      # note di IERI (+ oggi finora) — al risveglio
  captain_diary.py today        # solo oggi
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
DIARY_DIR = JHT_HOME / "logs"


def _user_tz():
    """TZ utente via format_time (così la data del diario è quella del giorno
    lavorativo dell'utente, non UTC). Fallback UTC."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from format_time import user_timezone  # type: ignore
        return user_timezone() or timezone.utc
    except Exception:
        return timezone.utc


def _now_local():
    return datetime.now(timezone.utc).astimezone(_user_tz())


def _file_for(day_str: str) -> Path:
    return DIARY_DIR / f"captain-diary-{day_str}.md"


def add(note: str) -> int:
    if not note.strip():
        print("captain_diary: empty note", file=sys.stderr)
        return 2
    now = _now_local()
    day = now.strftime("%Y-%m-%d")
    path = _file_for(day)
    try:
        DIARY_DIR.mkdir(parents=True, exist_ok=True)
        new_file = not path.exists()
        with path.open("a", encoding="utf-8") as f:
            if new_file:
                f.write(f"# 🧭 Captain diary — {now.strftime('%A %d %B %Y')}\n\n")
            # nota su una riga (newline interni → spazi), con orario locale
            flat = " ".join(note.split())
            f.write(f"- **{now.strftime('%H:%M')}** — {flat}\n")
    except OSError as e:
        print(f"captain_diary: write failed: {e}", file=sys.stderr)
        return 1
    print(f"saved to {path.name}")
    return 0


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, FileNotFoundError):
        return ""


def _latest_prior(day_str: str) -> Path | None:
    """Il file-diario più recente PRIMA di day_str (ieri, o l'ultimo giorno
    lavorato — i weekend/giorni off non hanno file)."""
    try:
        cands = sorted(DIARY_DIR.glob("captain-diary-*.md"))
    except OSError:
        return None
    prior = [p for p in cands if p.stem.replace("captain-diary-", "") < day_str]
    return prior[-1] if prior else None


def handoff() -> int:
    now = _now_local()
    today = now.strftime("%Y-%m-%d")
    prior = _latest_prior(today)
    if prior is None:
        print("📭 No previous-day diary — you are the first Captain, or the "
              "previous days were off. Start recording notes with `captain_diary.py add`.")
    else:
        print("📓 PREVIOUS CAPTAIN HANDOFF — notes from the previous Captain "
              f"({prior.stem.replace('captain-diary-', '')}):\n")
        print(_read(prior))
        print("\n— Read and inherit these lessons. Do NOT repeat the same mistakes. —")
    today_txt = _read(_file_for(today))
    if today_txt:
        print("\n🗒️  Already recorded TODAY:\n")
        print(today_txt)
    return 0


def today() -> int:
    txt = _read(_file_for(_now_local().strftime("%Y-%m-%d")))
    print(txt if txt else "🗒️  No notes today yet.")
    return 0


def main(argv) -> int:
    cmd = (argv[0] if argv else "handoff").lower()
    if cmd == "add":
        return add(" ".join(argv[1:]))
    if cmd == "handoff":
        return handoff()
    if cmd == "today":
        return today()
    print(f"captain_diary: unknown command '{cmd}'. Use: add | handoff | today",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
