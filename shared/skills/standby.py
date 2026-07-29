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

Uso:
  python3 standby.py status [--json]
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
STANDBY_FLAG = JHT_HOME / ".team-standby.flag"
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
    "[STANDBY] [RIPRENDI] Standby a spesa zero terminato ({why}). "
    "Riprendi il lavoro normale: bridge e automatismi di pacing sono di nuovo "
    "attivi. Riparti dalla tua coda, senza attendere altri ordini."
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


def read() -> Optional[dict]:
    """Payload del flag, o None se assente/illeggibile/SENZA condizione di
    uscita (fail-closed: non è uno standby valido)."""
    try:
        raw = STANDBY_FLAG.read_text(encoding="utf-8")
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


def status(now: Optional[datetime] = None) -> dict:
    """Stato leggibile: {active, state, since, until, wake_on, reason, ...}."""
    base = {"active": False, "state": STATE_OFF, "since": None, "until": None,
            "wake_on": None, "reason": None, "requested_by": None}
    if not STANDBY_FLAG.exists():
        return base
    data = read()
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


def is_active(now: Optional[datetime] = None) -> bool:
    """True SOLO se lo standby esiste, è valido e non è scaduto. Mai solleva."""
    try:
        return bool(status(now)["active"])
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
        return True, "scadenza --until raggiunta"
    if st["state"] != STATE_ACTIVE:
        return False, None
    wake_on = st.get("wake_on") or {}
    threshold = wake_on.get("weekly_below")
    if (isinstance(threshold, (int, float))
            and isinstance(weekly_usage, (int, float))
            and float(weekly_usage) < float(threshold)):
        return True, f"weekly {weekly_usage:.0f}% sotto la soglia {threshold:.0f}%"
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
            "uno standby senza condizione di uscita non si scrive: "
            "serve --until <iso> oppure --wake-on-weekly [pct]")
    if until_dt is not None and until_dt <= nowdt:
        raise ValueError(f"--until è nel passato ({until_dt.isoformat()}): "
                         "sarebbe uno standby già scaduto")
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
            print(f"[standby] WARN soft-pause fallita: {e}", file=sys.stderr)
    else:
        print("[standby] WARN soft_pause_team non caricabile: flag scritto ma "
              "agenti NON avvisati — mettili in pausa a mano", file=sys.stderr)
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
        msg = RESUME_TEXT.format(why=(why or "uscita manuale"))
        for s in _list_sessions():
            if s in NEVER_MESSAGE:
                continue
            if _send(s, msg):
                resumed += 1
    since = (payload or {}).get("since") if isinstance(payload, dict) else None
    standby_s = None
    if isinstance(since, (int, float)):
        standby_s = max(0, int(_now(now).timestamp() - since))
    log_event("exit", reason=(why or "uscita manuale"),
              weekly_usage=(weekly_usage if weekly_usage is not None
                            else last_weekly_usage()),
              agents_resumed=resumed, halted=halted, standby_s=standby_s)
    return {"removed": True, "resumed": resumed, "halted": halted, "why": why}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="standby",
        description="Standby a spesa zero del team (ferma anche i core; "
                    "la sveglia resta nei bridge)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_st = sub.add_parser("status", help="stato corrente dello standby")
    p_st.add_argument("--json", action="store_true", help="output machine-readable")

    p_on = sub.add_parser("on", help="entra in standby (serve una condizione di uscita)")
    p_on.add_argument("--reason", default="", help="perché (finisce nei log)")
    p_on.add_argument("--until", default=None,
                      help="uscita a tempo: ISO 8601 (es. 2026-08-03T09:00:00Z)")
    p_on.add_argument("--wake-on-weekly", nargs="?", const=DEFAULT_WEEKLY_BELOW,
                      type=float, default=None, metavar="PCT",
                      help=f"uscita condizionata: risvegliati quando il weekly "
                           f"scende sotto PCT (default {DEFAULT_WEEKLY_BELOW:.0f})")
    p_on.add_argument("--by", default="user", help="chi lo chiede (default: user)")

    p_off = sub.add_parser("off", help="esce subito dallo standby (flag via, poi [RIPRENDI])")
    p_off.add_argument("--reason", default="", help="perché (finisce nei log)")

    args = ap.parse_args(argv)

    if args.cmd == "status":
        st = status()
        if args.json:
            print(json.dumps(st, ensure_ascii=False))
        elif st["state"] == STATE_ACTIVE:
            cond = []
            if st.get("until"):
                cond.append(f"fino a {st['until']}")
            wo = st.get("wake_on") or {}
            if wo.get("weekly_below") is not None:
                cond.append(f"sveglia a weekly < {wo['weekly_below']:.0f}%")
            print(f"STANDBY ATTIVO — {'; '.join(cond)}"
                  f" (motivo: {st.get('reason') or 'non indicato'}).")
            print("I bridge campionano e tacciono; la sveglia è del sentinel-bridge.")
        elif st["state"] == STATE_EXPIRED:
            print("STANDBY SCADUTO — sveglia pendente: il sentinel-bridge la "
                  "esegue al prossimo tick (flag via, poi [RIPRENDI]).")
        elif st["state"] == STATE_INVALID:
            print("Flag di standby INVALIDO (senza condizione di uscita): non "
                  "vale come standby, il sentinel-bridge lo rimuoverà.")
        else:
            print("STANDBY off — il team opera normalmente.")
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
        print(f"STANDBY attivo (uscita: {cond}).")
        print(f"Agenti in pausa: "
              f"{len(paused) if paused is not None else 'ND (pausa fallita)'}."
              f" I bridge continuano a campionare e faranno da sveglia.")
        return 0

    if args.cmd == "off":
        res = wake(why=(args.reason or "jht standby off"))
        if not res["removed"]:
            print("STANDBY non era attivo.")
        elif res["halted"]:
            print("Flag di standby rimosso. Team NON riavviato: "
                  ".team-halted.flag presente (lo stop dell'utente vince). "
                  "Riparti con `jht team start` quando vuoi.")
        else:
            print(f"STANDBY terminato: [RIPRENDI] inviato a {res['resumed']} sessioni.")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
