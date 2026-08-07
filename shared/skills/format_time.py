#!/usr/bin/env python3
"""format_time — convert UTC to the user's time zone for visible output.

Bug #15: agents communicate in UTC while the user reads local time. This is
the shared helper for matplotlib subtitles, Telegram, dashboards, and logs.

API:
    fmt_user(dt_utc)              → "HH:MM CEST"
    fmt_user_with_utc(dt_utc)     → "HH:MM CEST (HH:MM UTC)"
    fmt_user_long(dt_utc)         → "Mon 17 May, 03:21 CEST"
    user_timezone()               → tz info per matplotlib axis tick

The user's time zone comes from the host configuration, with the legacy
`candidate_profile.yml::timezone` field as a fallback. The lookup is cached
for the process because the time zone does not change at runtime.

Shell usage (one-shot debugging):
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


# Default UTC: niente assumption geografiche. La timezone va settata
# esplicitamente dal setup wizard (host-setup.sh → host.env::JHT_USER_TZ).
# Fallback su UTC se mai configurata = orari consistenti col container,
# l'utente capisce che deve completare il setup.
DEFAULT_TZ = "UTC"

# Cascade di lookup per la timezone utente (in ordine di precedenza):
#   1. env var JHT_USER_TZ          (esposta dal wrapper jht da host.env)
#   2. ~/.jht/host.env::JHT_USER_TZ  (scritto da host-setup.sh interattivo)
#   3. candidate_profile.yml::timezone  (legacy, ancora supportato)
#   4. fallback hardcoded DEFAULT_TZ = "UTC"
_HOST_ENV_CANDIDATES = [
    Path(os.environ.get("JHT_HOST_ENV_FILE", "")) if os.environ.get("JHT_HOST_ENV_FILE") else None,
    Path(os.environ.get("JHT_HOME", "/jht_home")) / "host.env",
    Path.home() / ".jht" / "host.env",
]
_PROFILE_CANDIDATES = [
    Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile" / "candidate_profile.yml",
    Path(os.environ.get("JHT_HOME", "/jht_home")) / "candidate_profile.yml",
    Path("/jht_home/profile/candidate_profile.yml"),
]


def _read_kv_file(path: Path, key: str) -> str | None:
    """Legge `KEY=value` da un file shell-style. None se file/chiave mancanti."""
    try:
        with path.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith(f"{key}="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return val or None
    except (OSError, UnicodeDecodeError, AttributeError):
        return None
    return None


@lru_cache(maxsize=1)
def _read_profile_timezone() -> str:
    """Cascade lookup (vedi docstring modulo). Default UTC se niente settato."""
    # 1. env var diretta (priorità massima, usata dal wrapper jht)
    env_tz = (os.environ.get("JHT_USER_TZ") or "").strip()
    if env_tz:
        return env_tz

    # 2. host.env in vari path candidati
    for path in _HOST_ENV_CANDIDATES:
        if path is None:
            continue
        val = _read_kv_file(path, "JHT_USER_TZ")
        if val:
            return val

    # 3. candidate_profile.yml (legacy)
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

    # 4. fallback: UTC (niente Europe/Rome hardcoded — l'utente potrebbe
    # essere in qualsiasi continente). Se vede UTC, sa che il setup non
    # è completo.
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


def fmt_reset(value, *, with_utc: bool = False) -> str | None:
    """Reset/deadline → 'YYYY-MM-DD HH:MM TZ' nel fuso utente. MAI ora-nuda.

    Regola ferrea del progetto: un timestamp di reset/scadenza non deve MAI
    essere esposto come solo orario ("03:00") — è ambiguo a cavallo di
    mezzanotte e non distingue uno slittamento di giorno (il caso reale del
    rinnovo ciclo settimanale). Qui la DATA di calendario completa è sempre
    inclusa, ancorata all'epoch — la fonte di verità non ambigua.

    Accetta:
      - epoch UTC (int/float)
      - datetime (naive=UTC oppure aware)
      - None / non interpretabile → ritorna None (il chiamante tiene il fallback)

    Con `with_utc=True` aggiunge '(YYYY-MM-DD HH:MM UTC)' di fianco.
    """
    if value is None:
        return None
    if isinstance(value, bool):  # bool è int: escludilo esplicitamente
        return None
    if isinstance(value, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(value), timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    elif isinstance(value, datetime):
        dt = value
    else:
        return None
    if with_utc:
        return fmt_user_with_utc(dt, "%Y-%m-%d %H:%M")
    return fmt_user(dt, "%Y-%m-%d %H:%M")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--now", action="store_true")
    g.add_argument("--iso", help="ISO timestamp (UTC), e.g. 2026-05-17T01:14:00Z")
    p.add_argument("--with-utc", action="store_true",
                   help="append '(HH:MM UTC)' to the local time")
    args = p.parse_args(argv)

    if args.now:
        dt = datetime.now(timezone.utc)
    else:
        iso = (args.iso or "").replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(iso)
        except ValueError:
            print(f"Could not parse ISO timestamp: {args.iso!r}", file=sys.stderr)
            return 2

    print(fmt_user_with_utc(dt) if args.with_utc else fmt_user(dt))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
