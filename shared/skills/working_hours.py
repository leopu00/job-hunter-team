#!/usr/bin/env python3
"""
working_hours.py — helper "siamo dentro o fuori la finestra di lavoro?".

Decisione 2026-05-13 (docs/internal/bot-telegram.md § 9): l'utente puo'
configurare working hours del team. Fuori finestra il pacing-bridge non
emette tick al Capitano e jht-notify-user non fa push Telegram (la riga
resta in pending_user_messages e l'utente la trova in dashboard al
ritorno).

Config in $JHT_HOME/jht.config.json:

    {
      "team": {
        "working_hours": {
          "timezone": "Europe/Rome",
          "windows": [
            {"days": ["mon","tue","wed","thu","fri"],
             "start": "09:00", "end": "19:00"}
          ]
        }
      }
    }

`windows` vuoto/assente → team 24/7 (default). Wrap-around mezzanotte
supportato: se start > end la finestra si estende al giorno seguente
(es. start 22:00 end 06:00 = lun 22:00 → mar 06:00).

Uso come libreria:
    from shared.skills.working_hours import is_within_working_hours
    if is_within_working_hours():
        ...

Uso come CLI (gate da script bash):
    python3 -m shared.skills.working_hours && echo "lavoro" || echo "pausa"
    # exit 0 = dentro finestra, exit 1 = fuori, exit 2 = config error
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Iterable

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — python <3.9 non supportato
    ZoneInfo = None  # type: ignore


_WEEKDAY_INDEX = {
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}


def _config_path() -> Path:
    jht_home = os.environ.get("JHT_HOME") or str(Path.home() / ".jht")
    return Path(jht_home) / "jht.config.json"


def _load_config(path: Path | None = None) -> dict:
    p = path or _config_path()
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return {}
    except Exception:
        # Config corrotto: default 24/7 piuttosto che bloccare il team.
        return {}


def _parse_hhmm(s: str) -> time:
    h, m = s.split(":", 1)
    return time(int(h), int(m))


def _window_contains(now: datetime, days: Iterable[str], start: time, end: time) -> bool:
    """True se `now` (gia' in tz locale) cade nella finestra start..end.

    Wrap-around (start > end) gestito guardando anche il giorno precedente:
    una finestra mon 22:00 → 06:00 e' attiva sia lun sera che mar
    mattina presto.
    """
    day_idx = {_WEEKDAY_INDEX[d] for d in days if d in _WEEKDAY_INDEX}
    if not day_idx:
        return False
    t = now.time()
    weekday = now.weekday()
    if start <= end:
        return weekday in day_idx and start <= t < end
    # Wrap-around: la finestra "appartiene" al giorno di start.
    if weekday in day_idx and t >= start:
        return True
    # Coda della finestra del giorno precedente.
    prev = (weekday - 1) % 7
    if prev in day_idx and t < end:
        return True
    return False


def is_within_working_hours(now: datetime | None = None, config: dict | None = None) -> bool:
    """Ritorna True se il team puo' lavorare adesso.

    Default conservativo: in caso di config assente o malformato → True
    (team 24/7). Fuori finestra solo se la config dice esplicitamente cosi'.
    """
    cfg = config if config is not None else _load_config()
    wh = (cfg.get("team") or {}).get("working_hours") if isinstance(cfg, dict) else None
    if not wh or not isinstance(wh, dict):
        return True
    windows = wh.get("windows") or []
    if not isinstance(windows, list) or not windows:
        return True  # 24/7 esplicito

    tz_name = (wh.get("timezone") or "UTC").strip() or "UTC"
    try:
        tz = ZoneInfo(tz_name) if ZoneInfo else None
    except Exception:
        tz = None  # tz invalida → fallback locale (meglio overrun che blocco totale)
    local_now = (now or datetime.now()).astimezone(tz) if tz else (now or datetime.now())

    for w in windows:
        if not isinstance(w, dict):
            continue
        try:
            start = _parse_hhmm(str(w["start"]))
            end = _parse_hhmm(str(w["end"]))
            days = w.get("days") or []
        except Exception:
            continue
        if _window_contains(local_now, days, start, end):
            return True
    return False


def describe_status(now: datetime | None = None) -> str:
    """Stringa diagnostica utile per i log di pacing-bridge / notify-user."""
    cfg = _load_config()
    wh = (cfg.get("team") or {}).get("working_hours") if isinstance(cfg, dict) else None
    if not wh or not wh.get("windows"):
        return "working_hours=24/7"
    inside = is_within_working_hours(now, cfg)
    return f"working_hours=configured tz={wh.get('timezone','UTC')} inside={inside}"


if __name__ == "__main__":
    # CLI gate: exit 0 = dentro, 1 = fuori. Stampa motivo su stderr.
    try:
        ok = is_within_working_hours()
    except Exception as e:
        print(f"working_hours: error: {e}", file=sys.stderr)
        sys.exit(2)
    print(describe_status(), file=sys.stderr)
    sys.exit(0 if ok else 1)
