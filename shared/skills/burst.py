#!/usr/bin/env python3
"""
burst.py — «lavora a tutta fino alle HH:MM»: una fascia a termine che il team chiude da solo.

Prima servivano due comandi da CLI (`jht burn on --hours N` e `jht wh set-custom all HH:MM-HH:MM`,
perché alle 08:00 il team si fermava comunque) e gli orari di prima da rimettere a mano. Qui è un
gesto solo, e il ripristino non dipende dall'app: lo fa il team, nel container, al tick del
sentinel-bridge (`sweep`), anche con l'app chiusa. Se il container è spento alla scadenza, lo fa al
primo tick dopo l'avvio: lo stato sta su disco.

Cosa fa `start --until HH:MM`:

  1. salva gli orari di prima (`team.working_hours` di jht.config.json, o «24/7») in
     `$JHT_HOME/.burst.json`, con gli orari che ha scritto e la scadenza;
  2. allarga gli orari, senza mai restringerli: le fasce che il team ha restano tutte e si aggiunge la
     fascia da adesso fino all'ora scelta (unione). Solo un giorno senza fascia propria la vuole di
     almeno 4 ore, come la regola dei `jht wh`; se il team era già 24/7 non scrive niente;
  3. concede il burn (`burn_intent.grant`) fino a quell'ora: stesso file, stesso tetto di 12 ore. Il burn dice
     anche «a tutta»: la pausa del throttle di ogni agente non supera BURST_PAUSE_SEC (`pace_cap_sec`).

Cosa fa `sweep` (a ogni tick del sentinel): se la fascia è finita (scaduta, o il burn è stato
revocato prima) rimette gli orari di prima e toglie lo stato. Se nel frattempo gli orari sono stati
cambiati da qualcun altro (la pagina Orari, il sito) NON li sovrascrive: tiene quelli, scarta il
salvato. Se la config non si legge o non si scrive, lo stato resta e si riprova al tick dopo.

L'ora è nel fuso degli orari del team (`team.working_hours.timezone`), poi in quello scelto nel
setup, poi in quello del sistema: la prossima ricorrenza di HH:MM, fra 15 minuti e 12 ore da ora.

Una seconda `start` durante una fascia sposta la scadenza ma tiene gli orari ORIGINALI da
ripristinare (non quelli allargati dalla prima).

Uso (una riga JSON in uscita, uscita 0 fatto / 1 rifiutato):
  python3 burst.py start --until HH:MM
  python3 burst.py stop            # «Ferma adesso»: ripristina subito e revoca il burn
  python3 burst.py status
  python3 burst.py sweep
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import tempfile
import time as _time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import burn_intent  # noqa: E402
from plain_file import read_plain  # noqa: E402  (the one reader of files the agents can write)

JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
CONFIG_FILE = JHT_HOME / "jht.config.json"
STATE_FILE = JHT_HOME / ".burst.json"
AUDIT_LOG = JHT_HOME / "logs" / "burst.jsonl"

MIN_MINUTES = 15
MAX_HOURS = burn_intent.MAX_HOURS
MIN_WINDOW_HOURS = 4
# «A tutta»: the pause of the throttle after each unit of work is at most this. 60 s is the lowest step of the
# ladder (throttle-config), the pause that stays a checkpoint between two units: without a cap the workers kept
# the 300 s the Captain or the floor gave them and a burst made a position every five or six minutes.
BURST_PAUSE_SEC = 60
DAY_MINUTES = 24 * 60
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
READ_MAX_BYTES = 1024 * 1024
REPLACE_RETRIES = 6


class Refused(Exception):
    """A closed code, never free text: it ends up on the app's screen through the box's answer."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _zone(name):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name) if isinstance(name, str) and name.strip() else None
    except Exception:                       # noqa: BLE001 — no such zone
        return None


def _parse_ts(value) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _audit(event: str, **fields) -> None:
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": _now().isoformat(timespec="seconds"), "event": event}
        row.update(fields)
        with AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


# ── hours: the same shape the schema and `jht team-settings` accept ──────────────────────────────

def _window_hours(start: str, end: str) -> float:
    sh, sm = (int(x) for x in start.split(":"))
    eh, em = (int(x) for x in end.split(":"))
    s, e = sh * 60 + sm, eh * 60 + em
    return (e - s if e > s else 24 * 60 - s + e) / 60


def valid_hours(value) -> bool:
    """working_hours as cli/src/lib/team-settings.js validWorkingHours has it, or None (24/7)."""
    if value is None:
        return True
    if not isinstance(value, dict) or not set(value) <= {"timezone", "windows"}:
        return False
    if _zone(value.get("timezone")) is None:
        return False
    windows = value.get("windows")
    if not isinstance(windows, list) or len(windows) > len(WEEKDAYS):
        return False
    seen: set[str] = set()
    for w in windows:
        if not isinstance(w, dict) or not set(w) <= {"days", "start", "end"}:
            return False
        days = w.get("days")
        if not isinstance(days, list) or not days:
            return False
        for d in days:
            if d not in WEEKDAYS or d in seen:
                return False
            seen.add(d)
        start, end = w.get("start"), w.get("end")
        if not (isinstance(start, str) and isinstance(end, str) and HHMM.match(start) and HHMM.match(end)):
            return False
        if start == end or _window_hours(start, end) < MIN_WINDOW_HOURS:
            return False
    return True


def _is_24_7(hours) -> bool:
    return not hours or not isinstance(hours, dict) or not hours.get("windows")


# ── files ────────────────────────────────────────────────────────────────────────────────────────

def _read_json(path: Path):
    """The parsed file, None when it is not there; Refused when it is there and cannot be read."""
    try:
        raw = read_plain(path, max_size=READ_MAX_BYTES)
    except FileNotFoundError:
        return None
    except Exception:                       # noqa: BLE001 — a pipe, a link, too big, unreadable
        raise Refused("config_unreadable")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise Refused("config_unreadable")


def _write_json(path: Path, value) -> None:
    """Atomic and private, like cli/src/lib/secure-config-io.js writePrivateJson.

    A folder that refuses the rename (a Windows sharing violation through DrvFS/9p) is retried; if it
    keeps refusing and the file is there, it is rewritten in place."""
    body = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        delay = 0.025
        for attempt in range(REPLACE_RETRIES + 1):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == REPLACE_RETRIES:
                    break
                _time.sleep(delay)
                delay *= 2
        if not path.exists():
            raise PermissionError(str(path))
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.unlink(tmp)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _config() -> dict:
    cfg = _read_json(CONFIG_FILE)
    if cfg is None:
        raise Refused("config_missing")
    if not isinstance(cfg, dict):
        raise Refused("config_unreadable")
    return cfg


def _hours_of(cfg: dict):
    team = cfg.get("team")
    return team.get("working_hours") if isinstance(team, dict) else None


def _with_hours(cfg: dict, hours) -> dict:
    out = json.loads(json.dumps(cfg))
    if not isinstance(out.get("team"), dict):
        out["team"] = {}
    if hours is None:
        out["team"].pop("working_hours", None)
    else:
        out["team"]["working_hours"] = hours
    return out


def _read_state() -> Optional[dict]:
    """The saved burst, or None. A file that is not one is no burst (and is never trusted to write hours)."""
    try:
        data = _read_json(STATE_FILE)
    except Refused:
        return None
    if not isinstance(data, dict) or _parse_ts(data.get("until")) is None:
        return None
    if not valid_hours(data.get("previous_hours")) or not valid_hours(data.get("written_hours")):
        return None
    return data


def _drop_state() -> None:
    try:
        STATE_FILE.unlink()
    except OSError:
        pass


# ── the clock ────────────────────────────────────────────────────────────────────────────────────

def _team_zone(hours):
    z = _zone(hours.get("timezone")) if isinstance(hours, dict) else None
    return z or burn_intent._user_zone() or burn_intent._system_zone()


def next_occurrence(hhmm: str, zone, now: datetime) -> datetime:
    """The next time the wall clock of `zone` reads HH:MM, strictly after `now` (aware, in `zone`)."""
    if not isinstance(hhmm, str) or not HHMM.match(hhmm):
        raise Refused("until_invalid")
    h, m = (int(x) for x in hhmm.split(":"))
    local = now.astimezone(zone)
    candidate = local.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate <= local:
        candidate = (local + timedelta(days=1)).replace(hour=h, minute=m, second=0, microsecond=0)
    return candidate


def _minutes(hhmm: str) -> int:
    h, m = (int(x) for x in hhmm.split(":"))
    return h * 60 + m


def _clock(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def widened(previous, now_local: datetime, until_local: datetime, span_hours: float):
    """The hours of a burst: the hours the team has, plus the stretch from now to `until_local`; None when 24/7.

    The burst only ever ADDS: every window of the team stays, and the day the stretch starts on gets the one
    window that holds both its own window (if it has one) and the stretch. Only a day with no window of its own
    needs the four hours the hours rule wants, so the stretch is lengthened backwards to them. The schema allows
    one window per day and a window shorter than a day:
      - when the stretch does not touch that day's window, the window also covers the time between them, which
        is either already past or still before `until_local`;
      - when that makes it a day or more, it is split in two: this day up to midnight and the next day from
        midnight (with the next day's own window kept in it), so the end is exactly the one asked for;
      - when even that cannot hold both (windows of almost a day), the day gets the stretch alone, four hours
        at least: the stretch is what the person asked for, and the hours of before come back at its end.
    """
    if _is_24_7(previous):
        return None
    per_day: dict[str, tuple[int, int]] = {}
    for w in previous["windows"]:
        for d in w["days"]:
            per_day[d] = (_minutes(w["start"]), _minutes(w["end"]))
    long_enough = timedelta(hours=min(23, max(MIN_WINDOW_HOURS, math.ceil(span_hours))))

    def place(begin: datetime):
        # The end is counted on the wall clock, minute against minute: with the seconds of `begin` in it
        # (17:31:45 to 00:30:00) the count falls a minute short and the window ends at 00:29.
        start = begin.hour * 60 + begin.minute
        wall = lambda t: t.replace(tzinfo=None, second=0, microsecond=0)    # noqa: E731
        return WEEKDAYS[begin.weekday()], start, start + int((wall(until_local) - wall(begin)).total_seconds() // 60)

    day, start, end = place(now_local if WEEKDAYS[now_local.weekday()] in per_day else until_local - long_enough)
    if day in per_day:
        s0, e0 = per_day[day]
        if e0 <= s0:
            e0 += DAY_MINUTES
        start, end = min(start, s0), max(end, e0)
    if end - start < DAY_MINUTES:
        per_day[day] = (start, end % DAY_MINUTES)
    else:
        nxt = WEEKDAYS[(WEEKDAYS.index(day) + 1) % len(WEEKDAYS)]
        second_end = end - DAY_MINUTES
        if nxt in per_day:
            s1, e1 = per_day[nxt]
            second_end = max(second_end, e1 if e1 > s1 else e1 + DAY_MINUTES)
        first = min(start, DAY_MINUTES - MIN_WINDOW_HOURS * 60)
        if MIN_WINDOW_HOURS * 60 <= second_end < DAY_MINUTES and first > 0:    # 00:00-00:00 is not a window
            per_day[day] = (first, 0)
            per_day[nxt] = (0, second_end)
        else:
            day, start, end = place(until_local - long_enough)
            per_day[day] = (start, end % DAY_MINUTES)
    groups: dict[tuple[int, int], list[str]] = {}
    for d in WEEKDAYS:
        if d in per_day:
            groups.setdefault(per_day[d], []).append(d)
    return {
        "timezone": previous["timezone"],
        "windows": [{"days": days, "start": _clock(sh), "end": _clock(eh)} for (sh, eh), days in groups.items()],
    }


# ── the operations ───────────────────────────────────────────────────────────────────────────────

def _view(state: Optional[dict], now: Optional[datetime] = None) -> dict:
    """What the app shows: active only while the burst is running AND the burn behind it is."""
    if state is None:
        return {"active": False}
    until = _parse_ts(state["until"])
    active = until > _now(now) and burn_intent.is_active(now)
    if not active:
        return {"active": False}
    zone = _team_zone(state.get("written_hours") or state.get("previous_hours"))
    return {
        "active": True,
        "until": until.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "untilLocal": until.astimezone(zone).strftime("%H:%M"),
    }


def status(now: Optional[datetime] = None) -> dict:
    return {"ok": True, "burst": _view(_read_state(), now)}


def start(until: str, now: Optional[datetime] = None) -> dict:
    moment = _now(now)
    cfg = _config()
    current = _hours_of(cfg)
    if not valid_hours(current):
        raise Refused("config_invalid")
    state = _read_state()
    # A second start keeps the ORIGINAL hours to put back, unless somebody changed them meanwhile.
    if state is not None and current == state.get("written_hours"):
        previous = state.get("previous_hours")
    else:
        previous = current
    zone = _team_zone(previous)
    end_local = next_occurrence(until, zone, moment)
    minutes = (end_local - moment).total_seconds() / 60
    if minutes < MIN_MINUTES:
        raise Refused("until_too_soon")
    if minutes / 60 > MAX_HOURS:
        raise Refused("until_too_far")
    written = widened(previous, moment.astimezone(zone), end_local, minutes / 60)
    record = {
        "started_at": moment.isoformat(timespec="seconds"),
        "until": end_local.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "previous_hours": previous,
        "written_hours": written,
    }
    # State first: a crash between the steps must leave something that `sweep` can put back.
    try:
        _write_json(STATE_FILE, record)
    except OSError:
        raise Refused("write_failed")
    try:
        if written is not None:
            _write_json(CONFIG_FILE, _with_hours(cfg, written))
        burn_intent.grant(minutes / 60, reason=f"burst until {until}", granted_by="user", now=moment,
                          pace_cap_sec=BURST_PAUSE_SEC)
    except Exception:                       # noqa: BLE001 — nothing half done
        try:
            _write_json(CONFIG_FILE, cfg)
        except Exception:                   # noqa: BLE001
            pass
        _drop_state()
        raise Refused("write_failed")
    _audit("started", until=record["until"], widened=written is not None)
    return {"ok": True, "burst": _view(record, moment)}


def _restore(state: dict) -> str:
    """Put the hours back. 'restored' | 'kept' (somebody changed them) | 'unchanged' (24/7 burst).

    Raises Refused when the config cannot be read or written: the state stays, the next tick retries."""
    written, previous = state.get("written_hours"), state.get("previous_hours")
    if written is None:
        return "unchanged"
    cfg = _config()
    if _hours_of(cfg) != written:
        return "kept"
    try:
        _write_json(CONFIG_FILE, _with_hours(cfg, previous))
    except OSError:
        raise Refused("write_failed")
    return "restored"


def _finish(state: dict, event: str) -> str:
    outcome = _restore(state)
    _drop_state()
    _audit(event, outcome=outcome)
    return outcome


def stop(now: Optional[datetime] = None) -> dict:
    """«Ferma adesso»: hours back and burn revoked at once. Nothing to stop is not an error."""
    state = _read_state()
    if state is None:
        return {"ok": True, "burst": {"active": False}}
    _finish(state, "stopped")
    burn_intent.revoke(reason="burst stopped", now=now)
    return {"ok": True, "burst": {"active": False}}


def sweep(now: Optional[datetime] = None) -> Optional[str]:
    """The sentinel's tick: close a burst that is over. Returns the outcome, or None when nothing was due."""
    state = _read_state()
    if state is None:
        return None
    if _parse_ts(state["until"]) > _now(now) and burn_intent.is_active(now):
        return None
    try:
        return _finish(state, "ended")
    except Refused as e:
        _audit("restore_failed", code=e.code)
        return None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="burst", description="Work flat out until HH:MM, then back to the usual hours")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_start = sub.add_parser("start")
    p_start.add_argument("--until", required=True, help="HH:MM, the next time the team's clock reads it")
    sub.add_parser("stop")
    sub.add_parser("status")
    sub.add_parser("sweep")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "start":
            out = start(args.until)
        elif args.cmd == "stop":
            out = stop()
        elif args.cmd == "status":
            out = status()
        else:
            out = {"ok": True, "outcome": sweep()}
    except Refused as e:
        print(json.dumps({"ok": False, "code": e.code}))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
