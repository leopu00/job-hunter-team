#!/usr/bin/env python3
"""format_time — conversione UTC → fuso utente per output user-facing.

Bug #15: agenti comunicano in UTC, utente legge in CEST. Helper centrale
per evitare retrofit manuale in ~10 callsite (matplotlib subtitle,
telegram, dashboard, log Capitano).

API:
    fmt_user(dt_utc)              → "HH:MM CEST"
    fmt_user_with_utc(dt_utc)     → "HH:MM CEST (HH:MM UTC)"
    fmt_user_long(dt_utc)         → "lun 17 mag, 03:21 CEST"
    user_timezone()               → tz info per matplotlib axis tick

La timezone utente viene letta da `candidate_profile.yml::timezone`
(default `Europe/Rome`). Lookup cachato per il process — i prompt user
non cambiano timezone a runtime.

Uso da shell (one-shot debug):
    python3 /app/shared/skills/format_time.py --now
    python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

try:
    from zoneinfo import ZoneInfo  # stdlib 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


DEFAULT_TZ = "Europe/Rome"

# Locations dove guardare `candidate_profile.yml` in ordine. Manteniamo
# pochi candidati per non rallentare il lookup. Il container monta
# $JHT_HOME (=/jht_home), il profilo vive sotto profile/.
_PROFILE_CANDIDATES = [
    Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile" / "candidate_profile.yml",
    Path(os.environ.get("JHT_HOME", "/jht_home")) / "candidate_profile.yml",
    Path("/jht_home/profile/candidate_profile.yml"),
]


@lru_cache(maxsize=1)
def _read_profile_timezone() -> str:
    """Legge timezone dal profile YAML. Default Europe/Rome se mancante.

    Non importa PyYAML — il YAML del profilo è grep-friendly e ci basta
    matchare `^timezone:` per evitare una dipendenza extra (YAML è già
    nei reqs ma vogliamo che questo helper funzioni anche in container
    minimal di test).
    """
    for path in _PROFILE_CANDIDATES:
        try:
            with path.open("r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("timezone:"):
                        val = line.split(":", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except (OSError, UnicodeDecodeError):
            continue
    return DEFAULT_TZ


def _to_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def user_timezone():
    """Ritorna ZoneInfo per la timezone utente, o None se zoneinfo manca."""
    if ZoneInfo is None:
        return None
    try:
        return ZoneInfo(_read_profile_timezone())
    except Exception:
        try:
            return ZoneInfo(DEFAULT_TZ)
        except Exception:
            return None


def fmt_user(dt_utc: datetime, fmt: str = "%H:%M") -> str:
    """UTC → '<fmt> <TZNAME>' nel fuso utente. Es: '03:21 CEST'.

    Quando zoneinfo non è disponibile (es. Python <3.9 senza backport),
    fallback al naive UTC con suffisso UTC esplicito — meglio di un
    crash a runtime negli script grafici.
    """
    aware = _to_aware_utc(dt_utc)
    tz = user_timezone()
    if tz is None:
        return aware.strftime(fmt) + " UTC"
    local = aware.astimezone(tz)
    name = local.tzname() or DEFAULT_TZ
    return local.strftime(fmt) + f" {name}"


def fmt_user_with_utc(dt_utc: datetime, fmt: str = "%H:%M") -> str:
    """Sia fuso utente che UTC, per chart subtitles dove utile entrambi.

    Es: '03:21 CEST (01:21 UTC)'.
    """
    aware = _to_aware_utc(dt_utc)
    user_part = fmt_user(aware, fmt)
    utc_part = aware.strftime(fmt) + " UTC"
    if user_part == utc_part:
        return utc_part
    return f"{user_part} ({utc_part})"


def fmt_user_long(dt_utc: datetime) -> str:
    """Versione lunga: 'lun 17 mag, 03:21 CEST'. Per messaggi Telegram
    in cui la data importa (es. report giornalieri).

    Lascia il giorno in locale-default Python (en_US per ambienti senza
    locale IT). Il Capitano riformatta in italiano nel prompt se serve.
    """
    return fmt_user(dt_utc, "%a %d %b, %H:%M")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--now", action="store_true")
    g.add_argument("--iso", help="ISO timestamp (UTC), es 2026-05-17T01:14:00Z")
    p.add_argument("--with-utc", action="store_true", help="aggiunge '(HH:MM UTC)' di fianco")
    args = p.parse_args(argv)

    if args.now:
        dt = datetime.now(timezone.utc)
    else:
        iso = (args.iso or "").replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(iso)
        except ValueError:
            print(f"ISO non parsabile: {args.iso!r}", file=sys.stderr)
            return 2

    print(fmt_user_with_utc(dt) if args.with_utc else fmt_user(dt))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
