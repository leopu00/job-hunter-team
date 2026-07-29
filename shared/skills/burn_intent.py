#!/usr/bin/env python3
"""
burn_intent.py — il punto unico di verità sull'INTENTO di spesa dell'utente.

Gli automatismi che fermano il team scattano sui NUMERI e basta. Quando
l'utente dice *"il budget non è un vincolo, spremete"*, nessuno di loro ha un
modo di saperlo: l'unico rimedio è smontarli a mano, uno per uno, dall'esterno.
Nella notte del 2026-07-27 sono servite **cinque deroghe successive**, e una è
stata **annullata da un agente** che seguiva correttamente il proprio prompt.
Il comportamento predefinito resta giusto — mancava la deroga, non il freno.

Questo modulo tiene quella deroga in **un** posto:

    $JHT_HOME/.burn-intent.flag

Stessa strada di `.team-halted.flag` (file nella home del team, letto da chi
ne ha bisogno) ma di **segno opposto**: quello dice *"l'utente ha detto di
fermarsi"*, questo dice *"l'utente ha detto di spingere"*. Il contenuto è JSON
perché una deroga alla protezione di spesa **deve scadere da sola**:

    {"granted_at": ..., "expires_at": ..., "hours": 5.0,
     "reason": "...", "granted_by": "user"}

## Chi lo consulta PRIMA di agire (non dopo)

  • `.launcher/sentinel-bridge.py`   — prima di scrivere `daily-halt.flag` e
                                       di mandare ESC a tutte le sessioni;
                                       prima di applicare il gate orario
  • `.launcher/pacing-bridge.py`     — prima di tacere su daily-halt/off-hours
  • `.launcher/heartbeat-bridge.py`  — prima di sopprimere il battito orario
  • `shared/skills/throttle-config.py` — prima di applicare WORKER_FLOOR e la
                                       ladder in LETTURA (era il livello che
                                       riportava a 300s ogni override)
  • il prompt del Capitano (C-23, 7 lingue) — perché una deroga tecnica che
    non arriva agli agenti viene annullata in buona fede

Rimuovere il flag *dopo* non basta: fra la scrittura dell'halt e la sua
rimozione il team è già stato messo in ESC.

## Cosa NON cede mai, nemmeno in deroga (`NEVER_YIELDS`)

  • `weekly-halt`     — oltre quel limite il provider non risponde: non è una
                        scelta economica, è un muro
  • `host_agent_cap`  — tetto derivato dalla RAM. Superarlo manda la macchina
                        in thrash e **riduce** la produzione (misurato: 19
                        sessioni → load 24 su 6 core → SSH irraggiungibile)
  • `SC-09`           — una posizione per iterazione: nasce da un marathon che
                        produsse ~308kT per 3 posizioni con dati sporchi
  • `freeze_team`     — ultima rete prima del lockout del provider

Sono danni che il budget non ripaga, o limiti fisici. La deroga copre solo le
decisioni **economiche**: quanto in fretta spendere soldi che sono dell'utente.

Della stessa famiglia, ma **fuori dalla tupla**: `shared/skills/soft_pause_team.py`
— la pausa gentile della Sentinella quando L1+L2+L3 di lettura dell'usage
falliscono tutti. Non cede e non legge questo modulo: senza numeri non c'è una
decisione economica da derogare, solo cecità. Non è in `NEVER_YIELDS` perché
quei nomi finiscono TESTUALMENTE nell'avviso del gioco e nei prompt in 7
lingue; la classificazione, col motivo per esteso, è nel docstring di quel file.

## Fail-closed

Qualunque errore di lettura, parsing o formato → `is_active() == False`. La
direzione sicura è tenere il freno, non toglierlo: un falso negativo costa una
notte meno produttiva, un falso positivo costa il budget della settimana.

Uso:
  python3 burn_intent.py status [--json]     # stato corrente
  python3 burn_intent.py grant [--hours N] [--reason "..."]
  python3 burn_intent.py revoke [--reason "..."]
  python3 burn_intent.py sweep               # rimuove il flag se scaduto
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
# Stessa posizione e stessa forma di `.team-halted.flag`: chi deve leggerlo lo
# trova dove già cerca l'altro, senza una nuova convenzione da imparare.
INTENT_FLAG = JHT_HOME / ".burn-intent.flag"
# Traccia esplicita di ogni transizione. Con i freni tolti la responsabilità di
# non sprecare passa al coordinatore: va SCRITTO, non lasciato dedurre.
AUDIT_LOG = JHT_HOME / "logs" / "burn-intent.jsonl"

# Una finestra di provider (5h) è la durata naturale della deroga: è l'unità su
# cui il team ragiona e quella su cui l'utente vede il risultato.
DEFAULT_HOURS = 5.0
# Tetto duro. Nessuno dei file creati durante la notte del 2026-07-27 si
# disattivava da sé: restavano accesi finché qualcuno si ricordava di
# cancellarli. Oltre le 12h non è più "una notte", è una configurazione — e una
# configurazione va scritta nel config, non lasciata in un flag di deroga.
MAX_HOURS = 12.0
MIN_HOURS = 0.25

# Documentazione ESEGUIBILE (vedi tests/test_burn_intent.py): i freni che
# restano attivi anche in deroga. Chi aggiunge un consumatore di questo modulo
# controlla prima di essere fuori da questa lista.
NEVER_YIELDS = (
    "weekly-halt",
    "host_agent_cap",
    "SC-09",
    "freeze_team",
)

STATE_OFF = "off"
STATE_ACTIVE = "active"
STATE_EXPIRED = "expired"


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _parse_ts(value) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    # Un timestamp naive viene letto come UTC: il flag lo scriviamo sempre
    # aware, ma un file toccato a mano non deve far esplodere il confronto.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def read() -> Optional[dict]:
    """Payload del flag, o None se assente/illeggibile/malformato (fail-closed)."""
    try:
        raw = INTENT_FLAG.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    # Senza scadenza non è una deroga valida: è esattamente il file
    # dimenticato-acceso che questo modulo esiste per non riprodurre.
    if _parse_ts(data.get("expires_at")) is None:
        return None
    return data


def status(now: Optional[datetime] = None) -> dict:
    """Stato leggibile: {active, state, expires_at, remaining_min, reason, ...}."""
    data = read()
    if data is None:
        return {"active": False, "state": STATE_OFF, "expires_at": None,
                "remaining_min": None, "reason": None, "granted_at": None,
                "granted_by": None, "hours": None}
    expires = _parse_ts(data.get("expires_at"))
    remaining = (expires - _now(now)).total_seconds()
    active = remaining > 0
    return {
        "active": active,
        "state": STATE_ACTIVE if active else STATE_EXPIRED,
        "expires_at": data.get("expires_at"),
        "remaining_min": int(remaining // 60) if active else 0,
        "reason": data.get("reason"),
        "granted_at": data.get("granted_at"),
        "granted_by": data.get("granted_by"),
        "hours": data.get("hours"),
    }


def is_active(now: Optional[datetime] = None) -> bool:
    """True SOLO se la deroga esiste e non è scaduta. Mai solleva."""
    try:
        return bool(status(now)["active"])
    except Exception:      # noqa: BLE001 — un guard non può abbattere un bridge
        return False


def banner(now: Optional[datetime] = None) -> str:
    """Riga unica per log e messaggi agli agenti. Vuota se la deroga non è attiva."""
    st = status(now)
    if not st["active"]:
        return ""
    reason = st.get("reason") or "nessun motivo indicato"
    return (f"BURN-INTENT ATTIVO — deroga utente agli automatismi di spesa, "
            f"scade fra {st['remaining_min']} min ({st['expires_at']}); "
            f"motivo: {reason}. Restano attivi: {', '.join(NEVER_YIELDS)}.")


def _audit(event: str, **fields) -> None:
    """Appende una riga all'audit log. Best-effort: non deve mai far fallire
    la transizione che sta tracciando."""
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": _now().isoformat(timespec="seconds"), "event": event}
        row.update(fields)
        with AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


def _atomic_write(payload: dict) -> None:
    INTENT_FLAG.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".burn-intent-", suffix=".tmp",
                               dir=str(INTENT_FLAG.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, INTENT_FLAG)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def grant(hours: float = DEFAULT_HOURS, reason: str = "",
          granted_by: str = "user", now: Optional[datetime] = None) -> dict:
    """Concede la deroga per `hours` ore. Ritorna il payload scritto.

    `hours` è sempre clampato in [MIN_HOURS, MAX_HOURS]: non esiste una deroga
    permanente, nemmeno chiedendola.
    """
    try:
        h = float(hours)
    except (TypeError, ValueError):
        h = DEFAULT_HOURS
    h = max(MIN_HOURS, min(MAX_HOURS, h))
    start = _now(now)
    payload = {
        "granted_at": start.isoformat(timespec="seconds"),
        "expires_at": (start + timedelta(hours=h)).isoformat(timespec="seconds"),
        "hours": round(h, 2),
        "reason": (reason or "").strip(),
        "granted_by": granted_by,
        # Ricordato NEL file, così chi lo legge a mano fra sei mesi vede subito
        # che la deroga non è mai stata totale.
        "never_yields": list(NEVER_YIELDS),
    }
    _atomic_write(payload)
    _audit("granted", hours=payload["hours"], expires_at=payload["expires_at"],
           reason=payload["reason"], granted_by=granted_by)
    return payload


def revoke(reason: str = "", now: Optional[datetime] = None) -> Optional[dict]:
    """Revoca immediata. Ritorna il payload rimosso, o None se non c'era nulla."""
    data = read()
    try:
        INTENT_FLAG.unlink()
    except OSError:
        return None
    _audit("revoked", reason=(reason or "").strip(),
           was=data.get("expires_at") if data else None)
    return data


def sweep(now: Optional[datetime] = None) -> Optional[dict]:
    """Rimuove il flag SE scaduto. Ritorna il payload rimosso, o None.

    Chiamata dal solo `sentinel-bridge` (che già possiede il ciclo di vita di
    `daily-halt.flag`): la scadenza deve avere UN proprietario, altrimenti tre
    processi corrono a cancellare lo stesso file e a loggare tre volte.
    """
    st = status(now)
    if st["state"] != STATE_EXPIRED:
        return None
    data = read()
    try:
        INTENT_FLAG.unlink()
    except OSError:
        return None
    _audit("expired", expires_at=st.get("expires_at"), reason=st.get("reason"))
    return data


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="burn_intent",
        description="Intento di spesa dell'utente (deroga a termine agli automatismi)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_st = sub.add_parser("status", help="stato corrente della deroga")
    p_st.add_argument("--json", action="store_true", help="output machine-readable")

    p_gr = sub.add_parser("grant", help="concede la deroga per N ore")
    p_gr.add_argument("--hours", type=float, default=DEFAULT_HOURS,
                      help=f"durata in ore (default {DEFAULT_HOURS}, max {MAX_HOURS})")
    p_gr.add_argument("--reason", default="", help="perché (finisce nei log)")
    p_gr.add_argument("--by", default="user", help="chi la concede (default: user)")

    p_rv = sub.add_parser("revoke", help="revoca subito la deroga")
    p_rv.add_argument("--reason", default="", help="perché (finisce nei log)")

    sub.add_parser("sweep", help="rimuove il flag se scaduto")

    args = ap.parse_args(argv)

    if args.cmd == "status":
        st = status()
        if args.json:
            print(json.dumps(st, ensure_ascii=False))
        elif st["active"]:
            print(banner())
        else:
            print("BURN-INTENT off — gli automatismi di spesa sono attivi "
                  "(comportamento predefinito).")
        return 0

    if args.cmd == "grant":
        payload = grant(args.hours, args.reason, args.by)
        print(f"BURN-INTENT concesso per {payload['hours']}h "
              f"(scade {payload['expires_at']}).")
        print(f"NON cedono comunque: {', '.join(NEVER_YIELDS)}.")
        return 0

    if args.cmd == "revoke":
        removed = revoke(args.reason)
        print("BURN-INTENT revocato." if removed else "BURN-INTENT non era attivo.")
        return 0

    if args.cmd == "sweep":
        removed = sweep()
        print("BURN-INTENT scaduto → flag rimosso." if removed
              else "nulla da rimuovere.")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
