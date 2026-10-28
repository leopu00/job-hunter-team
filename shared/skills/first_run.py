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

Il burst NON è "spendere senza guardare": il `pace_guard` continua a misurare
il consumo contro la curva della finestra e a consigliare al Capitano il
throttle che ci rimetterebbe sopra (applicarlo è compito suo). È un modo
diverso di spendere lo stesso budget — tutta la pipeline accesa insieme invece
che uno scalino ogni mezz'ora, perché il risultato che conta per l'utente non
è una posizione trovata, è una posizione **valutata**.

Uso:
  python3 first_run.py status              # JSON dello stato corrente
  python3 first_run.py begin-burst         # profilo pronto → parte il burst
  python3 first_run.py check               # obiettivo raggiunto? (aggiorna)
  python3 first_run.py complete --reason … # forza la fine del burst
  python3 first_run.py reset               # solo per test / wipe playground
  python3 first_run.py ask-plan            # chiede il piano all'utente con una card (l'unico modo)
  python3 first_run.py plan-question-check # la rete del watchdog: la card, se nessuno l'ha postata
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import subprocess
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
            "completed_reason": "existing installation already initialized" if scored > 0 else None,
            "scored_at_start": scored,
        }
        _write(state)
    return state


def plan_info() -> dict:
    """Roster e obiettivi derivati dall'abbonamento dichiarato dall'utente."""
    mod = _load_module("plan_registry", "plan_registry.py")
    if mod is None:
        return {"ok": False, "reason": "plan_registry is unavailable"}
    return mod.burst_roster()


def plan_gap(state: dict) -> dict:
    """A burst that runs with no subscription plan declared (the configuration was reset, the provider
    changed, or the file was edited after the burst began): `plan_missing`, why, and how to declare it.

    The burst only ever opens with a declared plan, and begin_burst answers «already in progress» for a
    burst that runs, so without this nobody is told the plan is gone. Empty when the plan is declared, when
    there is no burst, or when the registry cannot be read (an unreadable table is not a missing plan)."""
    if state.get("phase") != PHASE_BURST:
        return {}
    info = plan_info()
    if info.get("ok") or not info.get("hint"):
        return {}
    return {"plan_missing": True, "reason": info.get("reason", "plan not declared"), "hint": info["hint"]}


def begin_burst() -> dict:
    """Profilo pronto → si apre la fase di burst. Idempotente.

    Rifiuta di partire se l'abbonamento non è dichiarato: senza sapere la
    capacità del piano il roster sarebbe un'ipotesi, e un'ipotesi sbagliata
    verso l'alto brucia la finestra dell'utente al primo giorno.
    """
    state = status()
    if state["phase"] == PHASE_STEADY:
        return dict(state, note="first run has already been completed")
    if state["phase"] == PHASE_BURST:
        return dict(state, note="burst already in progress", **plan_gap(state))

    info = plan_info()
    if not info.get("ok"):
        return {"ok": False, "phase": state["phase"],
                "reason": info.get("reason", "plan not declared"),
                "hint": info.get("hint") or "declare the subscription plan with plan_registry.py list/set"}

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
        out = complete(f"goal reached: {produced} scored positions")
        return dict(out, action="completato", produced=produced, target=target)

    started = _parse(state.get("burst_started_at"))
    if started is not None:
        elapsed_h = (datetime.now(timezone.utc) - started).total_seconds() / 3600.0
        if elapsed_h >= BURST_MAX_HOURS:
            out = complete(
                f"window exhausted: {produced}/{target} scored positions")
            return dict(out, action="completato", produced=produced, target=target)

    return dict(state, action="in corso", produced=produced, target=target)


def reset() -> dict:
    try:
        STATE_PATH.unlink()
    except FileNotFoundError:
        pass
    return status()


# ── The question about the plan ──────────────────────────────────────────────
#
# The plan is asked ONE way: a card (`jht-notify-user` with options), posted by `ask-plan`. A question written
# as plain text in the Capitano's pane reaches nobody — the user watches the app, which shows cards and chat
# messages, not the pane (TEST 13) — so nothing that asks the plan is left to the agent's choice of words or
# tool. `plan-question-check` is the net under it: the watchdog runs it every tick.

PLAN_QUESTION_AFTER_S = 300  # a profile imported, a plan missing, no open question for this long: the system asks
ANSWER_PREFIX = "ans:"  # agent_questions.ANSWER_PREFIX: a test holds them equal
_NOTIFY_ID = re.compile(r"\bid=(aq:[a-z0-9][a-z0-9_-]{0,39}:[0-9]+-[a-z0-9]{1,16})\b")


def _profile_imported() -> Optional[float]:
    """When the candidate profile became usable (the modification time of its file), None while it is not.

    «Usable» is the product's own gate for the profile (`profile_gate`: a YAML with a target role, a name that
    is not the template's, and one more signal), the same line the Assistente draws before it announces the
    profile ready. A missing, empty or half-written file is a profile not imported yet; so is a gate that cannot
    run (no YAML reader): the net stays quiet rather than ask early."""
    gate = _load_module("profile_gate", "profile_gate.py")
    if gate is None:
        return None
    path = JHT_HOME / "profile" / "candidate_profile.yml"
    try:
        usable, _ = gate.check_minimum_viable_profile(str(path))
        return path.stat().st_mtime if usable else None
    except (OSError, ValueError, AttributeError):
        return None


def _db_path() -> str:
    return os.environ.get("JHT_DB") or str(JHT_HOME / "jobs.db")


def _plan_question_rows(question_id: str) -> tuple[bool, Optional[dict]]:
    """(the question is still in the database, its answer or None). A database that cannot be read raises."""
    conn = sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=10)
    try:
        asked = conn.execute("SELECT 1 FROM pending_user_messages WHERE source_id = ?", (question_id,)).fetchone()
        row = conn.execute(
            "SELECT source_payload FROM pending_user_messages WHERE source_id = ?", (ANSWER_PREFIX + question_id,)
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return bool(asked), None
    try:
        answer = json.loads(row[0] or "")
    except ValueError:
        answer = {}
    return bool(asked), answer if isinstance(answer, dict) else {}


@contextlib.contextmanager
def _plan_question_lock():
    """One asker at a time: the Capitano and the watchdog can both decide to ask in the same second."""
    try:
        import fcntl
    except ImportError:  # no flock here: the card is idempotent by its own record
        yield
        return
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STATE_PATH.with_suffix(".lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _notify_command() -> list[str]:
    found = shutil.which("jht-notify-user")
    if found:
        return [found]
    return [sys.executable, str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user")]


def _post_plan_card(agent: str, card: dict) -> tuple[Optional[str], str]:
    """Post the card; (the question's id, "") or (None, why not)."""
    command = _notify_command() + ["--agent", agent, "--oggetto", card["subject"]]
    for option in card["options"]:
        command += ["--option", f"{option['id']}={option['label']}"]
    command.append(card["text"])
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=90, env=dict(os.environ), check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, f"the card was not posted: {error}"
    found = _NOTIFY_ID.search(done.stdout or "")
    if done.returncode != 0 or not found:
        return None, "the card was not posted: " + ((done.stderr or done.stdout or "").strip()[:300] or f"exit {done.returncode}")
    return found.group(1), ""


def _plan_question_state(state: dict) -> tuple[str, Optional[dict]]:
    """«none» (never asked, or the question is gone), «open» (asked, no answer), or «answered» with the answer."""
    record = state.get("plan_question")
    question_id = record.get("id") if isinstance(record, dict) else None
    if not isinstance(question_id, str):
        return "none", None
    asked, answer = _plan_question_rows(question_id)
    if answer is not None:
        return "answered", answer
    return ("open" if asked else "none"), None


def ask_plan(agent: str = "capitano", asked_by: str = "agent") -> dict:
    """Ask the user which plan they have: the one way to do it. Idempotent — no second card while the first has
    no answer, and nothing to ask once the plan is declared."""
    with _plan_question_lock():
        info = plan_info()
        if info.get("ok"):
            return {"ok": True, "asked": False, "reason": "the plan is already declared"}
        if not info.get("hint"):
            return {"ok": False, "asked": False, "reason": info.get("reason", "plan_registry is unavailable")}
        registry = _load_module("plan_registry", "plan_registry.py")
        card = registry.question_options() if registry is not None else {}
        if not card:
            return {"ok": False, "asked": False, "reason": "no plans are known for the active provider"}
        state = status()
        try:
            kind, _ = _plan_question_state(state)
        except sqlite3.Error as error:
            return {"ok": False, "asked": False, "reason": f"the database cannot be read: {error}"}
        if kind == "open":
            return {"ok": True, "asked": False, "reason": "a question about the plan is open and has no answer",
                    "question_id": state["plan_question"]["id"]}
        question_id, why = _post_plan_card(agent, card)
        if question_id is None:
            return {"ok": False, "asked": False, "reason": why}
        state["plan_question"] = {"id": question_id, "asked_at": _now(), "asked_by": asked_by}
        _write(state)
        return {"ok": True, "asked": True, "question_id": question_id, "options": [o["id"] for o in card["options"]]}


def plan_question_check(after_s: float = PLAN_QUESTION_AFTER_S, now: Optional[datetime] = None) -> dict:
    """The net under `ask-plan`: with the profile imported and no plan declared, and nobody asking for `after_s`
    seconds (counted from the import, or from the answer that did not name a plan), the system asks.

    Never before the profile is imported, never in `steady`, never while a question about the plan is open, and
    never when the registry cannot be read. An answer that names a plan which is still not written after
    `after_s` is written here, as the user chose it."""
    now = now or datetime.now(timezone.utc)
    imported = _profile_imported()
    if imported is None:
        return {"action": "none", "reason": "the profile is not imported yet"}
    state = status()
    if state["phase"] == PHASE_STEADY:
        return {"action": "none", "reason": "the first run is complete"}
    info = plan_info()
    if info.get("ok"):
        return {"action": "none", "reason": "the plan is declared"}
    if not info.get("hint"):
        return {"action": "none", "reason": "the plan table cannot be read"}
    try:
        kind, answer = _plan_question_state(state)
    except sqlite3.Error:
        return {"action": "none", "reason": "the database cannot be read"}
    if kind == "open":
        return {"action": "none", "reason": "a question about the plan is open"}
    since = datetime.fromtimestamp(imported, timezone.utc)
    choice = None
    if kind == "answered":
        since = _parse((answer or {}).get("ts")) or since
        chosen = (answer or {}).get("scelte")
        choice = chosen[0] if isinstance(chosen, list) and len(chosen) == 1 and isinstance(chosen[0], str) else None
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    waited = (now - since).total_seconds()
    if waited < after_s:
        return {"action": "waiting", "seconds_left": int(after_s - waited)}
    registry = _load_module("plan_registry", "plan_registry.py")
    provider = (registry.question_options() or {}).get("provider") if registry is not None else None
    if choice and provider and registry.find_plan(provider, choice) is not None:
        plan = registry.set_plan(provider, choice)
        return {"action": "declared", "provider": provider, "plan": plan["id"]}
    asked = ask_plan(agent="capitano", asked_by="net")
    return dict(asked, action="asked" if asked.get("asked") else ("none" if asked.get("ok") else "failed"))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="First-run status")
    ap.add_argument("command", nargs="?", default="status",
                    choices=["status", "begin-burst", "check", "complete", "reset",
                             "plan", "ask-plan", "plan-question-check"])
    ap.add_argument("--reason", default="closed manually")
    ap.add_argument("--after", type=float, default=PLAN_QUESTION_AFTER_S,
                    help="plan-question-check: seconds without a question before the system asks")
    args = ap.parse_args(argv)

    if args.command == "status":
        state = status()
        out = dict(state, **plan_gap(state))
    elif args.command == "plan":
        out = plan_info()
    elif args.command == "begin-burst":
        out = begin_burst()
    elif args.command == "check":
        out = check()
    elif args.command == "complete":
        out = complete(args.reason)
    elif args.command == "ask-plan":
        out = ask_plan()
    elif args.command == "plan-question-check":
        out = plan_question_check(args.after)
    else:
        out = reset()

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
