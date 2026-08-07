#!/usr/bin/env python3
"""
standby.py — standby a SPESA ZERO: ferma anche i ruoli core, senza perdere la sveglia.

Misurato in produzione il 2026-07-29: con tutti e cinque i worker a
`throttle=3600s` e zero posizioni prodotte, il weekly è salito da 98% a 100% in
un'ora — ~2 punti di quota settimanale all'ora a pipeline completamente ferma —
e il team è rimasto bloccato quattro giorni e mezzo fino al reset del provider.
La spesa residua non viene dai worker ma dai ruoli CORE (coordinatore,
assistente, sentinella, dottore, mentore) e dai tre bridge, che si scambiano
tick ogni 5-15 minuti a prescindere dal lavoro: nessuno di loro passa dal
`config/throttle.json`. Le skill che sembrano coprire il caso (`freeze_team`,
`soft_pause_team`) ESCLUDONO esattamente i ruoli che spendono — esclusione
sensata: la Sentinella è quella che deve accorgersi che la quota è tornata.

Il principio che rende il problema risolvibile: **leggere la quota non costa un
turno di modello** — i bridge la ottengono via HTTP/CLI. Quindi in standby i
bridge continuano a LEGGERE e smettono di PARLARE, e la sveglia sta FUORI dal
loop LLM (nel sentinel-bridge, deterministica).

Questo modulo tiene lo stato in UN posto:

    $JHT_HOME/.team-standby.flag        (JSON, falsariga di .burn-intent.flag)

    {"since": 1785690713, "until": null, "reason": "weekly quota exhausted",
     "wake_on": {"weekly_below": 100}, "requested_by": "user"}

`until` per uno standby a tempo, `wake_on` per uno condizionato (il caso
principale: «riaccenditi quando il weekly scende sotto il 100%»). Almeno uno
dei due DEVE essere valorizzato: **uno standby senza condizione di uscita non
si scrive** — è il flag dimenticato-acceso che `.burn-intent.flag` esiste per
non riprodurre (`config/throttle-floor-exempt.txt` porta lo stesso commento).

## Chi legge il flag (vedi ticket [TEAM-STANDBY-ZERO-SPEND])

  • `.launcher/sentinel-bridge.py`   — campiona SEMPRE (sentinel-data.jsonl
                                       cresce), tace in tmux, valuta la sveglia
                                       a ogni tick (until / wake_on)
  • `.launcher/pacing-bridge.py`     — sospende del tutto l'invio dei tick
  • `.launcher/heartbeat-bridge.py`  — sospende del tutto l'invio
  • `.launcher/agent-watchdog.sh`    — non respawna/refresha AGENTI; i BRIDGE
                                       restano sorvegliati (sono la sveglia)
  • `.launcher/doctor-watchdog.sh`   — niente spawn Dottore/Mantenitore
  • `.launcher/stepcap-watchdog.py`  — niente nudge, niente kick-off

NON riusare `.team-halted.flag`: quello dice «l'utente ha fermato il team» e
disabilita il respawn; lo standby è una sospensione TECNICA che si risveglia da
sola. Semantiche diverse, file diversi. E `halted` VINCE: al risveglio, se
`.team-halted.flag` è presente, il flag di standby viene rimosso ma il
[RIPRENDI] NON parte — lo stop dell'utente non è negoziabile.

## Ordine del risveglio (obbligato)

  1. rimuovere `.team-standby.flag`;
  2. mandare `[RIPRENDI]` a tutti i ruoli, core inclusi;
  3. loggare l'uscita su `logs/standby.jsonl`.

Invertirlo lascia il watchdog a risilenziare gli agenti appena svegliati.
`wake()` incapsula l'ordine in UN posto, così nessun chiamante può sbagliarlo.

## Fail-closed (stessa direzione di burn_intent)

Flag assente, illeggibile o SENZA condizione di uscita → `is_active() == False`:
i bridge riprendono a parlare. La direzione sicura è NON restare muti per
sempre — un team che spende si vede (e si rimette in standby), un team muto
in eterno è l'incidente da quattro giorni e mezzo in forma peggiore. Il
sentinel-bridge rimuove da sé un flag invalido e lo scrive nel log.

## Un solo predicato per tutti ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS])

Chi deve solo TACERE (i bridge) e chi deve RIACCENDERE (watchdog, roster)
devono rispondere alla STESSA domanda: «lo standby è attivo ADESSO?». Gatare
sulla nuda esistenza del file è la risposta sbagliata per i secondi: un flag
SCADUTO (`until` passato) non è più standby, e se chi doveva rimuoverlo è
morto nessuno respawnerebbe più niente — lo standby eterno, cioè il caso che
il flag esiste per rendere impossibile. Il predicato unico è:

  • Python : `standby.is_active(home=…)`  (`home` esplicito per i chiamanti
             che risolvono `JHT_HOME` a ogni chiamata)
  • shell  : `python3 standby.py active [--quiet]` → exit 0 attivo / 1 no,
             e su stdout lo STATO in una parola (`active|expired|invalid|off`)

Lo stato su stdout non è decorazione: è quello che rende il fallback dei
chiamanti bash **fail-closed**. Un exit code 1 è ambiguo (può venire da un
traceback), una parola no: se non arriva `active|expired|invalid|off` il
chiamante ricade sul vecchio `[ -e <flag> ]` invece di concludere «non in
standby» — un errore Python che riaccende il team a spesa zero è peggio del
bug che si sta correggendo. Errore interno del CLI → exit 3, mai 1.

Uso:
  python3 standby.py status [--json]
  python3 standby.py active [--quiet]
  python3 standby.py on  --reason "…" [--until <iso>] [--wake-on-weekly [pct]]
  python3 standby.py off [--reason "…"]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
# Stessa posizione e stessa forma di `.team-halted.flag` / `.burn-intent.flag`:
# chi deve leggerlo lo trova dove già cerca gli altri.
FLAG_NAME = ".team-standby.flag"
STANDBY_FLAG = JHT_HOME / FLAG_NAME
# Un record per transizione (enter|exit|wake_check): risponde a «quanto è stato
# in standby» e «perché non si è svegliato», le due domande che arriveranno.
STANDBY_LOG = JHT_HOME / "logs" / "standby.jsonl"
# Lo stop esplicito dell'utente. Qui viene SOLO letto: uscire dallo standby con
# questo flag presente NON fa ripartire il team.
HALTED_FLAG = JHT_HOME / ".team-halted.flag"
# L'ultimo sample del sensore usage: weekly_usage per i log e per lo status.
SENTINEL_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"

# Sessioni tmux a cui non si scrive MAI, nemmeno al risveglio: non sono agenti
# LLM in chat. Tenuta in sync con soft_pause_team.NEVER_MESSAGE (test dedicato).
#   SENTINELLA-WORKER — TUI usata come SENSORE (parse del pane /usage): un
#     messaggio la farebbe rispondere = un turno di modello per niente.
#   DOCTOR-WATCHDOG   — loop bash in tmux: un testo + Enter verrebbe ESEGUITO
#     dalla shell come comando.
NEVER_MESSAGE = {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}

# Soglia di default per --wake-on-weekly: «riaccenditi appena il weekly scende
# sotto il 100%», cioè al reset del provider — il caso dell'incidente.
DEFAULT_WEEKLY_BELOW = 100.0

STATE_OFF = "off"          # nessun flag
STATE_ACTIVE = "active"    # standby in corso
STATE_EXPIRED = "expired"  # `until` passato: sveglia pendente, ma NON più muti
STATE_INVALID = "invalid"  # flag illeggibile o senza condizione di uscita

RESUME_TEXT = (
    "[STANDBY] [RIPRENDI] Zero-spend standby ended ({why}). Resume normal "
    "work: bridges and pacing automation are active again. Continue from "
    "your queue without waiting for more instructions."
)


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _parse_ts(value) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    # Naive → UTC: il flag lo scriviamo aware, ma un file toccato a mano non
    # deve far esplodere il confronto (stessa scelta di burn_intent).
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _parse_wake_on(value) -> Optional[dict]:
    """Normalizza `wake_on`: oggi solo `weekly_below` (float). None se inutile."""
    if not isinstance(value, dict):
        return None
    wb = value.get("weekly_below")
    if isinstance(wb, bool) or not isinstance(wb, (int, float)):
        return None
    return {"weekly_below": float(wb)}


def flag_path(home=None) -> Path:
    """Path del flag.

    `home=None` → la costante di modulo, risolta all'import (e ripuntabile dai
    test, come la fixture di burn_intent). Un `home` ESPLICITO serve ai
    chiamanti che risolvono `JHT_HOME` a ogni chiamata — stepcap-watchdog e
    team_roster lo fanno di proposito — così il predicato risponde sulla loro
    home invece che su quella congelata all'import di questo modulo.
    """
    if home is None:
        return STANDBY_FLAG
    return Path(home) / FLAG_NAME


def read(home=None) -> Optional[dict]:
    """Payload del flag, o None se assente/illeggibile/SENZA condizione di
    uscita (fail-closed: non è uno standby valido)."""
    try:
        raw = flag_path(home).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    # Senza condizione di uscita non è uno standby: è il file dimenticato-acceso
    # che questo modulo esiste per non riprodurre.
    if _parse_ts(data.get("until")) is None and _parse_wake_on(data.get("wake_on")) is None:
        return None
    return data


def status(now: Optional[datetime] = None, home=None) -> dict:
    """Stato leggibile: {active, state, since, until, wake_on, reason, ...}."""
    base = {"active": False, "state": STATE_OFF, "since": None, "until": None,
            "wake_on": None, "reason": None, "requested_by": None}
    if not flag_path(home).exists():
        return base
    data = read(home)
    if data is None:
        # Il flag c'è ma non vale come standby: lo dice lo stato, così il
        # sentinel-bridge può rimuoverlo e loggarlo invece di ignorarlo muto.
        base["state"] = STATE_INVALID
        return base
    until = _parse_ts(data.get("until"))
    expired = until is not None and _now(now) >= until
    return {
        # `expired` NON è attivo: un lettore non resta muto oltre la scadenza
        # anche se chi doveva rimuovere il flag è morto. La sveglia (rimozione
        # + [RIPRENDI]) resta del sentinel-bridge al primo tick utile.
        "active": not expired,
        "state": STATE_EXPIRED if expired else STATE_ACTIVE,
        "since": data.get("since"),
        "until": data.get("until"),
        "wake_on": _parse_wake_on(data.get("wake_on")),
        "reason": data.get("reason"),
        "requested_by": data.get("requested_by"),
    }


def is_active(now: Optional[datetime] = None, home=None) -> bool:
    """True SOLO se lo standby esiste, è valido e non è scaduto. Mai solleva.

    È IL predicato: lo chiamano sia chi deve tacere (bridge) sia chi deve
    riaccendere (agent-watchdog, doctor-watchdog, stepcap-watchdog,
    team_roster, codex-auth-healer), così le due metà del team non possono
    più dare risposte opposte alla stessa domanda.
    """
    try:
        return bool(status(now, home)["active"])
    except Exception:      # noqa: BLE001 — un guard non può abbattere un bridge
        return False


def should_wake(weekly_usage=None, now: Optional[datetime] = None):
    """(wake, why) — la condizione di uscita è soddisfatta?

    • `until` raggiunto → sveglia a tempo.
    • `wake_on.weekly_below` con weekly_usage NOTO e sotto soglia → sveglia.
      weekly_usage=None (fetch fallito, provider senza weekly) NON sveglia:
      senza il dato la condizione non è verificabile, e il wake_check nel log
      dice perché non ci si è svegliati.
    """
    st = status(now)
    if st["state"] == STATE_EXPIRED:
        return True, "--until deadline reached"
    if st["state"] != STATE_ACTIVE:
        return False, None
    wake_on = st.get("wake_on") or {}
    threshold = wake_on.get("weekly_below")
    if (isinstance(threshold, (int, float))
            and isinstance(weekly_usage, (int, float))
            and float(weekly_usage) < float(threshold)):
        return True, f"weekly {weekly_usage:.0f}% below the {threshold:.0f}% threshold"
    return False, None


def log_event(event: str, **fields) -> None:
    """Appende una riga a logs/standby.jsonl. Best-effort: non deve mai far
    fallire la transizione che sta tracciando (stessa forma di burn_intent)."""
    try:
        STANDBY_LOG.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": int(_now().timestamp()), "event": event}
        row.update(fields)
        row["ts_iso"] = _now().isoformat(timespec="seconds")
        with STANDBY_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


def last_weekly_usage():
    """weekly_usage dall'ultimo sample del sensore, o None. Solo per i log."""
    try:
        raw = SENTINEL_JSONL.read_text(encoding="utf-8").strip().splitlines()
        for line in reversed(raw):
            try:
                s = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            w = s.get("weekly_usage")
            if isinstance(w, (int, float)):
                return w
        return None
    except OSError:
        return None


def _atomic_write(payload: dict) -> None:
    STANDBY_FLAG.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".team-standby-", suffix=".tmp",
                               dir=str(STANDBY_FLAG.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STANDBY_FLAG)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def enter(reason: str = "", until=None, wake_on_weekly=None,
          by: str = "user", now: Optional[datetime] = None) -> dict:
    """Scrive il flag di standby. SOLO il flag: chi vuole anche mettere in
    pausa gli agenti usa `activate()` (l'ordine giusto è flag prima, pausa poi:
    fra i due un tick di bridge non deve poter svegliare nessuno).

    Solleva ValueError senza una condizione di uscita valida: uno standby senza
    condizione di uscita non si scrive.
    """
    nowdt = _now(now)
    until_dt = until if isinstance(until, datetime) else _parse_ts(until)
    if until_dt is not None and until_dt.tzinfo is None:
        until_dt = until_dt.replace(tzinfo=timezone.utc)
    wake_on = None
    if wake_on_weekly is not None:
        try:
            wake_on = {"weekly_below": float(wake_on_weekly)}
        except (TypeError, ValueError):
            wake_on = None
    if until_dt is None and wake_on is None:
        raise ValueError(
            "standby requires an exit condition: use --until <iso> or "
            "--wake-on-weekly [pct]")
    if until_dt is not None and until_dt <= nowdt:
        raise ValueError(f"--until is in the past ({until_dt.isoformat()}): "
                         "standby would already be expired")
    payload = {
        "since": int(nowdt.timestamp()),
        "until": until_dt.isoformat(timespec="seconds") if until_dt else None,
        "wake_on": wake_on,
        "reason": (reason or "").strip(),
        "requested_by": by,
    }
    _atomic_write(payload)
    return payload


def _load_sibling(name: str, filename: str):
    """Import per path di una skill sorella (container prima, repo fallback)."""
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent / filename):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except (OSError, ImportError, AttributeError, SyntaxError):
            continue
    return None


def activate(reason: str = "", until=None, wake_on_weekly=None,
             by: str = "user", now: Optional[datetime] = None) -> dict:
    """Standby completo: (1) flag, (2) soft-pause CORE INCLUSI, (3) log enter.

    Il flag va scritto PRIMA della pausa: appena c'è, i bridge tacciono e i
    watchdog non nudgeano — così un tick che cade fra i due passi non può
    rimettere in moto quello che stiamo fermando. La pausa è la forma SOFT
    (mai freeze_team: gli Esc abortiscono il turno e lasciano scritture a
    metà — qui non c'è urgenza, la quota è già finita).
    """
    payload = enter(reason=reason, until=until, wake_on_weekly=wake_on_weekly,
                    by=by, now=now)
    paused = None
    sp = _load_sibling("soft_pause_team", "soft_pause_team.py")
    if sp is not None and hasattr(sp, "pause_all"):
        try:
            paused, _skipped = sp.pause_all(include_core=True, reason=reason)
        except Exception as e:                                  # noqa: BLE001
            print(f"[standby] WARN soft pause failed: {e}", file=sys.stderr)
    else:
        print("[standby] WARN soft_pause_team could not be loaded: flag written "
              "but agents were NOT notified — pause them manually", file=sys.stderr)
    log_event("enter", reason=payload["reason"],
              weekly_usage=last_weekly_usage(),
              agents_paused=(len(paused) if paused is not None else None),
              until=payload.get("until"), wake_on=payload.get("wake_on"),
              requested_by=by)
    return {"payload": payload, "agents_paused": paused}


def _list_sessions():
    try:
        r = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                           capture_output=True, timeout=5)
        if r.returncode != 0:
            return []
        return [s.strip() for s in
                r.stdout.decode("utf-8", errors="replace").splitlines() if s.strip()]
    except (subprocess.TimeoutExpired, OSError):
        return []


def _send(session: str, message: str) -> bool:
    try:
        r = subprocess.run(["jht-tmux-send", session, message],
                           capture_output=True, timeout=15)
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def wake(why: str = "", weekly_usage=None, now: Optional[datetime] = None) -> dict:
    """Uscita dallo standby, nell'ORDINE obbligato del ticket:

      1. rimuove `.team-standby.flag` (PRIMA di qualunque messaggio: se il
         flag è ancora lì, watchdog e bridge risilenzierebbero gli agenti
         appena svegliati);
      2. manda `[RIPRENDI]` a tutti i ruoli, core inclusi — MA con
         `.team-halted.flag` presente NON manda niente: lo stop dell'utente
         vince, uscire dallo standby non fa ripartire un team fermato;
      3. logga l'uscita su logs/standby.jsonl.

    Idempotente: senza flag ritorna {removed: False} e non manda nulla.
    """
    payload = None
    try:
        payload = json.loads(STANDBY_FLAG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = None
    try:
        STANDBY_FLAG.unlink()
        removed = True
    except OSError:
        removed = False
    if not removed:
        return {"removed": False, "resumed": 0, "halted": False, "why": why}

    halted = HALTED_FLAG.exists()
    resumed = 0
    if not halted:
        msg = RESUME_TEXT.format(why=(why or "manual exit"))
        for s in _list_sessions():
            if s in NEVER_MESSAGE:
                continue
            if _send(s, msg):
                resumed += 1
    since = (payload or {}).get("since") if isinstance(payload, dict) else None
    standby_s = None
    if isinstance(since, (int, float)):
        standby_s = max(0, int(_now(now).timestamp() - since))
    log_event("exit", reason=(why or "manual exit"),
              weekly_usage=(weekly_usage if weekly_usage is not None
                            else last_weekly_usage()),
              agents_resumed=resumed, halted=halted, standby_s=standby_s)
    return {"removed": True, "resumed": resumed, "halted": halted, "why": why}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="standby",
        description="Zero-spend team standby (also pauses core roles; bridges "
                    "retain the wake-up mechanism)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_st = sub.add_parser("status", help="current standby status")
    p_st.add_argument("--json", action="store_true", help="output machine-readable")

    p_ac = sub.add_parser(
        "active",
        help="predicate for shell scripts: exit 0 when standby is ACTIVE, 1 "
             "when it is not (off/expired/invalid), 3 on internal error")
    p_ac.add_argument("-q", "--quiet", action="store_true",
                      help="no stdout; only the exit code matters")

    p_on = sub.add_parser("on", help="enter standby (requires an exit condition)")
    p_on.add_argument("--reason", default="", help="reason (recorded in logs)")
    p_on.add_argument("--until", default=None,
                      help="timed exit: ISO 8601 (for example 2026-08-03T09:00:00Z)")
    p_on.add_argument("--wake-on-weekly", nargs="?", const=DEFAULT_WEEKLY_BELOW,
                      type=float, default=None, metavar="PCT",
                      help=f"conditional exit: wake when weekly usage falls "
                           f"below PCT (default {DEFAULT_WEEKLY_BELOW:.0f})")
    p_on.add_argument("--by", default="user", help="requester (default: user)")

    p_off = sub.add_parser("off", help="leave standby now (remove flag, then [RIPRENDI])")
    p_off.add_argument("--reason", default="", help="reason (recorded in logs)")

    args = ap.parse_args(argv)

    if args.cmd == "active":
        # Una PAROLA su stdout (non solo l'exit code): è quello che permette al
        # chiamante bash di distinguere «non in standby» da «non ho potuto
        # rispondere» e ricadere sul vecchio `[ -e <flag> ]` invece di
        # riaccendere il team per un errore Python.
        st = status()
        if not args.quiet:
            print(st["state"])
        return 0 if st["active"] else 1

    if args.cmd == "status":
        st = status()
        if args.json:
            print(json.dumps(st, ensure_ascii=False))
        elif st["state"] == STATE_ACTIVE:
            cond = []
            if st.get("until"):
                cond.append(f"until {st['until']}")
            wo = st.get("wake_on") or {}
            if wo.get("weekly_below") is not None:
                cond.append(f"wake at weekly < {wo['weekly_below']:.0f}%")
            print(f"STANDBY ACTIVE — {'; '.join(cond)}"
                  f" (reason: {st.get('reason') or 'not provided'}).")
            print("Bridges sample silently; sentinel-bridge handles wake-up.")
        elif st["state"] == STATE_EXPIRED:
            print("STANDBY EXPIRED — wake-up pending: sentinel-bridge will "
                  "perform it on the next tick (remove flag, then [RIPRENDI]).")
        elif st["state"] == STATE_INVALID:
            print("INVALID standby flag (no exit condition): it does not count "
                  "as standby and sentinel-bridge will remove it.")
        else:
            print("STANDBY off — the team is operating normally.")
        return 0

    if args.cmd == "on":
        try:
            res = activate(reason=args.reason, until=args.until,
                           wake_on_weekly=args.wake_on_weekly, by=args.by)
        except ValueError as e:
            print(f"✗ {e}", file=sys.stderr)
            return 2
        payload = res["payload"]
        paused = res["agents_paused"]
        cond = payload.get("until") or (
            f"weekly < {payload['wake_on']['weekly_below']:.0f}%"
            if payload.get("wake_on") else "?")
        print(f"STANDBY active (exit: {cond}).")
        print(f"Paused agents: "
              f"{len(paused) if paused is not None else 'N/A (pause failed)'}."
              f" Bridges continue sampling and will handle wake-up.")
        return 0

    if args.cmd == "off":
        res = wake(why=(args.reason or "jht standby off"))
        if not res["removed"]:
            print("STANDBY was not active.")
        elif res["halted"]:
            print("Standby flag removed. Team was NOT restarted: "
                  ".team-halted.flag is present (the user's stop takes "
                  "precedence). Run `jht team start` when ready.")
        else:
            print(f"STANDBY ended: [RIPRENDI] sent to {res['resumed']} sessions.")
        return 0

    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as _e:      # noqa: BLE001
        # MAI exit 1 per un guasto: 1 significa «non in standby» per i
        # chiamanti shell. 3 = «non lo so», e loro ricadono sul fallback.
        print(f"[standby] internal ERROR: {_e}", file=sys.stderr)
        sys.exit(3)
