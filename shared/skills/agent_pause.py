#!/usr/bin/env python3
"""
agent_pause.py — la PAUSA del singolo agente (JHT-T181): sessione accesa, contesto
intatto, nessun lavoro nuovo finché l'utente non riprende.

È la metà «un agente solo» di quello che `standby.py` (modo `pause`) fa per tutta
la squadra. Non è lo STOP: la sessione non si chiude, il marcatore di
contenimento del roster (`team_roster contain`) non si scrive, e il respawn non
c'entra — quello serve a un agente che DEVE restare spento.

Stato: un file per sessione in

    $JHT_HOME/.agent-pauses/<SESSION>.json
    {"session": "SCOUT-1", "since": 1785690713, "until": "2026-11-12T22:00:00+00:00",
     "reason": "paused by the user from the app", "requested_by": "user"}

`until` c'è SEMPRE: la pausa «finché dico io» ha il tetto di 7 giorni (come
quella di squadra). Un marcatore senza `until` valido, o scaduto, NON è una
pausa: chi lo legge riprende a parlare all'agente. La direzione sicura è non
restare muti per sempre; la sveglia (rimozione + [RIPRENDI]) è di
`wake_expired()`, che il sentinel-bridge chiama a ogni tick.

## Chi legge il marcatore (UN solo predicato: `is_paused`)

  • .launcher/stepcap-watchdog.py   — niente nudge né kick-off a quell'agente
  • .launcher/agent-watchdog.sh     — niente refresh a 12 h (cancellerebbe il contesto)
  • shared/skills/throttle_engine.py — nessun avviso di throttle a quell'agente
  • shared/skills/agent_unblock.py  — nessuna spinta a quell'agente
  • shared/skills/standby.py        — la ripresa DI SQUADRA salta chi è in pausa da solo
                                       (l'utente l'ha fermato apposta: non si risveglia
                                       perché riparte la squadra)

Uso:
  python3 agent_pause.py pause SESSION [--reason "…"] [--by user]
  python3 agent_pause.py resume SESSION
  python3 agent_pause.py status [SESSION] [--json]
  python3 agent_pause.py active SESSION        → una parola su stdout: paused|off, exit 0/1
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
DIR_NAME = ".agent-pauses"
LOG = JHT_HOME / "logs" / "agent-pauses.jsonl"
# Lo stesso tetto della pausa di squadra (standby.MANUAL_MAX): nessuna pausa vive per sempre.
MAX_PAUSE = timedelta(days=7)
# The cap holds when the mark is READ, not only when it is written: the marks sit in a folder the agents can write,
# and one with an `until` of the year 2999 would be a pause that never ends. A few minutes of slack for clocks.
READ_SLACK = timedelta(minutes=10)
# Gli stessi nomi di sessione del pannello (agent_control.NAME): una grammatica chiusa, perché
# il nome diventa un nome di file.
NAME = re.compile(r"^[A-Z][A-Z0-9-]{0,39}\Z")   # \Z: a `$` would let a trailing newline through
# Sessioni a cui non si scrive MAI (non sono agenti LLM in chat): in sync con standby.NEVER_MESSAGE.
NEVER_MESSAGE = {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}

PAUSE_TEXT = (
    "[PAUSA] The user has paused YOU{reason}. This is a PAUSE, not a shutdown: your session and "
    "your context stay exactly as they are. Close the step you are in so nothing is left "
    "half-written (do not start a new unit of work, no new orders, no new checks), note in one "
    "line where you got to, then WAIT SILENTLY: do not message other agents and do not poll. "
    "The rest of the team keeps working. Resume ONLY when you receive '[RIPRENDI]', and then "
    "continue from that same point."
)
RESUME_TEXT = (
    "[RIPRENDI] Your pause is over ({why}). Your session and context were never closed: pick up "
    "EXACTLY where you were, with the step you had in hand, and do not start over."
)


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _home(home=None) -> Path:
    return Path(home) if home is not None else JHT_HOME


def marker_dir(home=None) -> Path:
    return _home(home) / DIR_NAME


def marker_path(session: str, home=None) -> Path:
    if not isinstance(session, str) or not NAME.match(session):
        raise ValueError(f"not a session name: {session!r}")
    return marker_dir(home) / f"{session}.json"


def _parse_ts(value) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def read(session: str, home=None, now: Optional[datetime] = None) -> Optional[dict]:
    """Il marcatore, o None se assente/illeggibile/senza un `until` valido o con un `until` OLTRE il tetto dei
    7 giorni da adesso (fail-closed: non è una pausa; `wake_expired` lo toglie)."""
    try:
        data = json.loads(marker_path(session, home).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    until = _parse_ts(data.get("until"))
    if until is None or until > _now(now) + MAX_PAUSE + READ_SLACK:
        return None
    return data


def status(session: str, now: Optional[datetime] = None, home=None) -> dict:
    base = {"session": session, "paused": False, "state": "off", "since": None, "until": None,
            "reason": None, "requested_by": None}
    try:
        exists = marker_path(session, home).exists()
    except ValueError:
        return base
    if not exists:
        return base
    data = read(session, home, now)
    if data is None:
        return dict(base, state="invalid")
    expired = _now(now) >= _parse_ts(data["until"])
    return {"session": session, "paused": not expired, "state": "expired" if expired else "paused",
            "since": data.get("since"), "until": data.get("until"), "reason": data.get("reason"),
            "requested_by": data.get("requested_by")}


def is_paused(session: str, now: Optional[datetime] = None, home=None) -> bool:
    """IL predicato. Mai solleva: un guard non può abbattere un watchdog. Scaduto = non in pausa."""
    try:
        return bool(status(session, now, home)["paused"])
    except Exception:      # noqa: BLE001
        return False


def paused_sessions(now: Optional[datetime] = None, home=None) -> list[str]:
    """Le sessioni in pausa ADESSO (scadute e illeggibili non contano)."""
    out = []
    try:
        names = sorted(p.name.removesuffix(".json") for p in marker_dir(home).glob("*.json"))
    except OSError:
        return out
    for name in names[:500]:
        if NAME.match(name) and is_paused(name, now, home):
            out.append(name)
    return out


def log_event(event: str, **fields) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": int(_now().timestamp()), "event": event}
        row.update(fields)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


def _write(session: str, payload: dict, home=None) -> None:
    path = marker_path(session, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".agent-pause-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _live_sessions() -> list[str]:
    try:
        r = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                           capture_output=True, timeout=5)
        if r.returncode != 0:
            return []
        return [s.strip() for s in r.stdout.decode("utf-8", errors="replace").splitlines() if s.strip()]
    except (subprocess.TimeoutExpired, OSError):
        return []


def _send(session: str, message: str) -> bool:
    try:
        r = subprocess.run(["jht-tmux-send", session, message], capture_output=True, timeout=30)
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def pause(session: str, reason: str = "", by: str = "user", now: Optional[datetime] = None,
          home=None, notify: bool = True) -> dict:
    """Mette UN agente in pausa. L'ordine è marcatore PRIMA, messaggio poi: fra i due un watchdog
    non deve poterlo rimettere in moto. Ritorna {paused, notified, already}."""
    marker_path(session, home)                                # grammatica chiusa, o ValueError
    if session in NEVER_MESSAGE:
        raise ValueError(f"{session} is not an agent in chat")
    if is_paused(session, now, home):
        return {"paused": True, "notified": False, "already": True}
    nowdt = _now(now)
    payload = {"session": session, "since": int(nowdt.timestamp()),
               "until": (nowdt + MAX_PAUSE).isoformat(timespec="seconds"),
               "reason": (reason or "").strip(), "requested_by": by}
    _write(session, payload, home)
    live = session in _live_sessions() if notify else False
    notified = False
    if notify and live:
        sfx = f" ({payload['reason']})" if payload["reason"] else ""
        notified = _send(session, PAUSE_TEXT.format(reason=sfx))
    log_event("pause", session=session, notified=notified, live=live, requested_by=by)
    return {"paused": True, "notified": notified, "already": False, "live": live}


def resume(session: str, why: str = "resumed by the user", home=None, notify: bool = True) -> dict:
    """Toglie la pausa a UN agente, poi gli dice di riprendere. Marcatore PRIMA (altrimenti i watchdog
    lo risilenzierebbero appena sveglio). Ritorna {removed, notified}."""
    path = marker_path(session, home)
    try:
        path.unlink()
        removed = True
    except OSError:
        removed = False
    if not removed:
        return {"removed": False, "notified": False}
    notified = False
    if notify and session in _live_sessions():
        notified = _send(session, RESUME_TEXT.format(why=why or "resumed"))
    log_event("resume", session=session, notified=notified, why=why)
    return {"removed": True, "notified": notified}


def wake_expired(now: Optional[datetime] = None, home=None) -> list[str]:
    """La sveglia del tetto: le pause scadute (o illeggibili) si tolgono e l'agente riceve [RIPRENDI].
    La chiama il sentinel-bridge a ogni tick. Ritorna le sessioni svegliate."""
    woken = []
    try:
        names = sorted(p.name.removesuffix(".json") for p in marker_dir(home).glob("*.json"))
    except OSError:
        return woken
    for name in names[:500]:
        if not NAME.match(name) or is_paused(name, now, home):
            continue
        # a pause that ran out is told to resume; a mark that never was a pause (unreadable, or with an exit
        # past the cap) is only taken away: nobody paused that agent, so nobody has anything to resume
        ran_out = status(name, now, home)["state"] == "expired"
        res = resume(name, why="the pause reached its 7 day limit", home=home, notify=ran_out)
        if res["removed"]:
            woken.append(name)
    return woken


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="agent_pause", description="Pause ONE agent without shutting it down")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_p = sub.add_parser("pause")
    p_p.add_argument("session")
    p_p.add_argument("--reason", default="")
    p_p.add_argument("--by", default="user")
    sub.add_parser("resume").add_argument("session")
    p_s = sub.add_parser("status")
    p_s.add_argument("session", nargs="?")
    p_s.add_argument("--json", action="store_true")
    sub.add_parser("active").add_argument("session")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "pause":
            print(json.dumps(pause(args.session, args.reason, args.by)))
            return 0
        if args.cmd == "resume":
            print(json.dumps(resume(args.session)))
            return 0
        if args.cmd == "active":
            on = is_paused(args.session)
            print("paused" if on else "off")
            return 0 if on else 1
        if args.session:
            out = status(args.session)
        else:
            out = {"paused": paused_sessions()}
        print(json.dumps(out) if args.json else (
            f"{out['session']}: {out['state']}" if args.session else ", ".join(out["paused"]) or "none"))
        return 0
    except ValueError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as _e:      # noqa: BLE001
        print(f"[agent_pause] internal ERROR: {_e}", file=sys.stderr)
        sys.exit(3)
