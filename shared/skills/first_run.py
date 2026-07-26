#!/usr/bin/env python3
"""
first_run.py — lo stato "questo utente ci sta guardando per la prima volta".

Un utente nuovo finisce il setup, accende il team e resta a guardare. Se in
dieci minuti vede comparire *una* posizione grezza conclude che l'applicazione
non funziona e la disinstalla — e ha ragione a pensarlo: quello che vede è
indistinguibile da un guasto. Il fatto che fra tre giorni avrà trecento
posizioni non lo sa, e non ha motivo di crederci.

Il team però non è lento per caso: la calibrazione prudente (1 worker →
osserva 30 min → sali di un gradino) è la regola giusta **a regime**, quando
sbagliare costa una finestra di budget. Al primo avvio costa l'utente.

Questo modulo tiene il flag che distingue le due situazioni:

    awaiting_profile → il team è acceso ma non sa ancora chi è il candidato
    burst            → profilo pronto: roster completo subito, pipeline
                       spinta fino alle prime posizioni CON PUNTEGGIO
    steady           → dimostrazione fatta, si passa al pacing normale

Il burst NON è "spendere senza guardare": il `pace_guard` continua a tenere
il consumo sulla curva della finestra. È un modo diverso di spendere lo
stesso budget — tutta la pipeline accesa insieme invece che uno scalino ogni
mezz'ora, perché il risultato che conta per l'utente non è una posizione
trovata, è una posizione **valutata**.

Uso:
  python3 first_run.py status              # JSON dello stato corrente
  python3 first_run.py begin-burst         # profilo pronto → parte il burst
  python3 first_run.py check               # obiettivo raggiunto? (aggiorna)
  python3 first_run.py complete --reason … # forza la fine del burst
  python3 first_run.py reset               # solo per test / wipe playground
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
STATE_PATH = JHT_HOME / "state" / "first-run.json"

PHASE_AWAITING = "awaiting_profile"
PHASE_BURST = "burst"
PHASE_STEADY = "steady"

# Oltre questa durata il burst finisce comunque: è una dimostrazione, non un
# regime. Se in una finestra intera la pipeline non ha prodotto il numero di
# punteggi atteso, il problema non si risolve continuando a spingere.
BURST_MAX_HOURS = 5.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse(ts: str | None) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def _load_module(name: str, filename: str):
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent / filename):
        if not cand.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except (OSError, ImportError, AttributeError, SyntaxError):
            continue
    return None


def _scored_count() -> Optional[int]:
    """Quante posizioni hanno un punteggio. None se il DB non è leggibile.

    È l'unica metrica di successo che conta qui: le posizioni trovate ma non
    valutate, per l'utente, non esistono.
    """
    try:
        import sqlite3
        db = os.environ.get("JHT_DB") or str(JHT_HOME / "jobs.db")
        if not Path(db).exists() or Path(db).stat().st_size == 0:
            return None
        conn = sqlite3.connect(db, timeout=10)
        try:
            row = conn.execute("SELECT COUNT(DISTINCT position_id) FROM scores").fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 — un DB assente non è un errore di stato
        return None


def _read() -> dict:
    try:
        with STATE_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write(state: dict) -> dict:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(STATE_PATH)
    return state


def status() -> dict:
    """Stato corrente, creandolo al primo accesso.

    Un'installazione che ha GIÀ punteggi in archivio non è un primo avvio,
    anche se il file di stato manca (caso tipico: aggiornamento di una
    installazione esistente). In quel caso si nasce direttamente `steady`,
    così l'aggiornamento non regala un burst a chi è già a regime.
    """
    state = _read()
    if not state:
        scored = _scored_count() or 0
        state = {
            "phase": PHASE_STEADY if scored > 0 else PHASE_AWAITING,
            "created_at": _now(),
            "burst_started_at": None,
            "completed_at": None,
            "completed_reason": "installazione già avviata" if scored > 0 else None,
            "scored_at_start": scored,
        }
        _write(state)
    return state


def plan_info() -> dict:
    """Roster e obiettivi derivati dall'abbonamento dichiarato dall'utente."""
    mod = _load_module("plan_registry", "plan_registry.py")
    if mod is None:
        return {"ok": False, "reason": "plan_registry non disponibile"}
    return mod.burst_roster()


def begin_burst() -> dict:
    """Profilo pronto → si apre la fase di burst. Idempotente.

    Rifiuta di partire se l'abbonamento non è dichiarato: senza sapere la
    capacità del piano il roster sarebbe un'ipotesi, e un'ipotesi sbagliata
    verso l'alto brucia la finestra dell'utente al primo giorno.
    """
    state = status()
    if state["phase"] == PHASE_STEADY:
        return dict(state, note="il primo avvio è già stato completato")
    if state["phase"] == PHASE_BURST:
        return dict(state, note="burst già in corso")

    info = plan_info()
    if not info.get("ok"):
        return {"ok": False, "phase": state["phase"],
                "reason": info.get("reason", "piano non dichiarato"),
                "hint": "chiedi all'utente di completare il passo abbonamento nel setup"}

    state.update({
        "phase": PHASE_BURST,
        "burst_started_at": _now(),
        "scored_at_start": _scored_count() or 0,
        "plan": {k: info[k] for k in
                 ("provider", "plan", "plan_label", "tier", "weekly_capped")},
        "roster": info["roster"],
        "scout_cap_first_pass": info["scout_cap_first_pass"],
        "target_scored": info["target_scored"],
        "capped_by_host": info.get("capped_by_host", False),
    })
    _write(state)
    return dict(state, ok=True)


def complete(reason: str) -> dict:
    state = status()
    if state["phase"] == PHASE_STEADY:
        return state
    state.update({
        "phase": PHASE_STEADY,
        "completed_at": _now(),
        "completed_reason": reason,
    })
    return _write(state)


def check() -> dict:
    """Il burst ha finito il suo compito? Aggiorna lo stato di conseguenza.

    Due condizioni di uscita, entrambe legittime:
      - l'obiettivo è raggiunto (l'utente ha visto la pipeline funzionare)
      - la finestra è passata (la dimostrazione ha avuto il suo tempo)
    """
    state = status()
    if state["phase"] != PHASE_BURST:
        return dict(state, action="nessuna")

    scored = _scored_count()
    target = int(state.get("target_scored") or 0)
    baseline = int(state.get("scored_at_start") or 0)
    produced = (scored - baseline) if scored is not None else 0

    if target and produced >= target:
        out = complete(f"obiettivo raggiunto: {produced} posizioni con punteggio")
        return dict(out, action="completato", produced=produced, target=target)

    started = _parse(state.get("burst_started_at"))
    if started is not None:
        elapsed_h = (datetime.now(timezone.utc) - started).total_seconds() / 3600.0
        if elapsed_h >= BURST_MAX_HOURS:
            out = complete(
                f"finestra esaurita: {produced}/{target} posizioni con punteggio")
            return dict(out, action="completato", produced=produced, target=target)

    return dict(state, action="in corso", produced=produced, target=target)


def reset() -> dict:
    try:
        STATE_PATH.unlink()
    except FileNotFoundError:
        pass
    return status()


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Stato del primo avvio")
    ap.add_argument("command", nargs="?", default="status",
                    choices=["status", "begin-burst", "check", "complete", "reset",
                             "plan"])
    ap.add_argument("--reason", default="chiuso manualmente")
    args = ap.parse_args(argv)

    if args.command == "status":
        out = status()
    elif args.command == "plan":
        out = plan_info()
    elif args.command == "begin-burst":
        out = begin_burst()
    elif args.command == "check":
        out = check()
    elif args.command == "complete":
        out = complete(args.reason)
    else:
        out = reset()

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
