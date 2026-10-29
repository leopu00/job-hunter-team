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
  python3 first_run.py ask-plan [--agent capitano|assistente]  # chiede il piano all'utente con una card (l'unico modo, da qualunque agente)
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
            # registered only while it runs (a module with a dataclass, agent_questions, cannot be executed
            # otherwise), and what was there before comes back: this loader never replaces a module somebody imported
            before = sys.modules.get(name)
            sys.modules[name] = mod
            try:
                spec.loader.exec_module(mod)
            finally:
                if before is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = before
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


def mentor_check() -> dict:
    """{"mentor_due", "phase"}: whether the Mentor has anything to read yet. Until the first run is over (`steady`:
    there are scored positions on screen) the Mentor has no record to walk, and its first wake at every start would
    be spent on nothing; the agent watchdog turns it on when the run closes. The phase is read ONCE, here: a state
    that cannot be read counts as due (phase "unknown"), so the Mentor is then started as it always was."""
    try:
        phase = status().get("phase")
    except Exception:
        return {"mentor_due": True, "phase": "unknown"}
    return {"mentor_due": phase == PHASE_STEADY, "phase": phase}


def mentor_due() -> bool:
    return mentor_check()["mentor_due"]


def _live_sessions() -> Optional[list[str]]:
    """Names (lower case) of the tmux sessions running, [] when there is no tmux server, None when it cannot
    be asked (no tmux, no answer)."""
    try:
        done = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                              capture_output=True, text=True, timeout=4)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode == 0:
        return [line.strip().lower() for line in done.stdout.splitlines() if line.strip()]
    return [] if "no server running" in done.stderr or "no sessions" in done.stderr else None


def roster_gap(state: dict) -> dict:
    """In a burst, which roles of the roster have a session and which do not: after a restart of the
    containers every session is gone, and the Capitano must start the MISSING ones, not the whole roster over
    again (a worker that is up is not spawned over, whatever it is doing). `roster_alive` and `roster_missing`
    count per role; `roster_check: "unavailable"` when tmux cannot be asked, and then nothing is assumed."""
    roster = state.get("roster")
    if state.get("phase") != PHASE_BURST or not isinstance(roster, dict):
        return {}
    names = _live_sessions()
    if names is None:
        return {"roster_check": "unavailable"}
    # The state file is a file on disk: a role or a count that is not what begin-burst wrote is left out, and the
    # answer is about the roles that are well formed (nothing is guessed about the others).
    wanted = {role: want for role, want in roster.items()
              if isinstance(role, str) and isinstance(want, int) and not isinstance(want, bool) and want >= 0}
    alive = {role: sum(1 for n in names if re.fullmatch(rf"{re.escape(role)}-\d+", n)) for role in wanted}
    return {"roster_alive": alive, "roster_missing": {role: max(0, want - alive[role]) for role, want in wanted.items()}}


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
        return dict(state, note="burst already in progress", **plan_gap(state), **roster_gap(state))

    info = plan_info()
    if not info.get("ok"):
        return {"ok": False, "phase": state["phase"],
                "reason": info.get("reason", "plan not declared"),
                "hint": info.get("hint") or "ask the user with first_run.py ask-plan, then write the plan with plan_registry.py set"}

    with contextlib.suppress(Exception):  # the card is a courtesy to the user: it never stops the burst
        close_plan_question()  # the plan is declared: the card that asked for it has nothing left to ask
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
PLAN_REASK_AFTER_S = 3600  # after an answer that named no plan («I do not know»), the card comes back after this
PLAN_ASKERS = ("capitano", "assistente")  # the agents the person talks to: the card goes to the chat they are in
MAX_PLAN_CARDS = 3  # cards about the plan, in all, for a provider; then nobody asks again
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


def _user_chat(requested: str) -> str:
    """The chat the card goes to: where the person is talking.

    While the first run is open and the person confirmed their profile with the Assistente's card
    (`state/profile-confirm-card.json` exists), they are in the Assistente's chat, whoever asks: the card goes
    there, never to a chat they are not looking at. Otherwise it goes where the caller says."""
    if status().get("phase") != PHASE_STEADY and (STATE_PATH.parent / "profile-confirm-card.json").is_file():
        return "assistente"
    return requested


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


def _plan_question_state(state: dict, provider: Optional[str] = None) -> tuple[str, Optional[dict]]:
    """«none» (never asked, or the question is gone, or it was for another provider), «open» (asked, no answer),
    or «answered» with the answer.

    A card is for the provider it was posted for: when the provider has changed since, its answer (or its silence)
    says nothing about the plans of the new one, so the state is «none» and the new provider is asked afresh."""
    record = state.get("plan_question")
    question_id = record.get("id") if isinstance(record, dict) else None
    if not isinstance(question_id, str):
        return "none", None
    if provider and record.get("provider") not in (None, provider):
        return "none", None
    asked, answer = _plan_question_rows(question_id)
    if answer is not None:
        return "answered", answer
    return ("open" if asked else "none"), None


def _cards_asked(state: dict, provider: str) -> int:
    """How many cards about the plan were posted for this provider (the count starts again with another)."""
    cards = state.get("plan_cards")
    if isinstance(cards, dict) and cards.get("provider") == provider and isinstance(cards.get("count"), int):
        return cards["count"]
    return 0


def _answered_at(answer: Optional[dict]) -> Optional[datetime]:
    moment = _parse((answer or {}).get("ts"))
    if moment is not None and moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def _close_plan_question(info: dict, now: Optional[datetime] = None) -> dict:
    """With the plan declared, close the card that asked for it if it is still open (the caller holds the lock).

    The plan can be written by a path that never meets the card: the Assistente's chat, `jht providers plan`,
    the app's settings, a hand edit. The card then stays in the Agents panel as «1 open question» and in the
    Messages with the Capitano, asking what has been told (TEST 15). It is closed here, as the system's answer
    (origin `sistema`, never the person's), with the plan the configuration says: the option of the card that
    stands for it, or «I do not know» when the card is for another provider and has no such option.

    `{"closed": True, ...}` when it closed one; `{"closed": False, ...}` otherwise, with `"failed": True` when
    something that should have worked did not (a database that cannot be read or written)."""
    record = _read().get("plan_question")
    question_id = record.get("id") if isinstance(record, dict) else None
    if not isinstance(question_id, str):
        return {"closed": False, "reason": "no question about the plan was asked"}
    questions = _load_module("agent_questions", "agent_questions.py")
    registry = _load_module("plan_registry", "plan_registry.py")
    if questions is None or registry is None:
        return {"closed": False, "failed": True, "reason": "the question tool is unavailable"}
    try:
        asked, answer = _plan_question_rows(question_id)
        if not asked or answer is not None:
            return {"closed": False, "reason": "the question about the plan has an answer or is gone"}
        conn = sqlite3.connect(_db_path(), timeout=10)
        try:
            closed = questions.close_as_system(
                conn, question_id, [registry.option_id(str(info.get("plan") or "")), registry.UNKNOWN_OPTION], now=now)
        finally:
            conn.close()
    except (sqlite3.Error, ValueError) as error:  # AnswerRejected is a ValueError
        return {"closed": False, "failed": True, "reason": f"the card was not closed: {error}"}
    if closed.status != "recorded":
        return {"closed": False, "reason": "the question about the plan was answered meanwhile"}
    return {"closed": True, "question_id": question_id, "choice": closed.answer.get("scelte", [])[:1]}


def close_plan_question(now: Optional[datetime] = None) -> dict:
    """Close the card about the plan if the plan is declared and the card is still open. Idempotent."""
    with _plan_question_lock():
        info = plan_info()
        if not info.get("ok"):
            return {"closed": False, "reason": "the plan is not declared"}
        return _close_plan_question(info, now)


def ask_plan(agent: str = "capitano", asked_by: str = "agent", reask_s: float = PLAN_REASK_AFTER_S,
             now: Optional[datetime] = None) -> dict:
    """Ask the user which plan they have: the one way to do it, for any agent. The card goes to the chat where the
    person is (`_user_chat`: `agent`'s own, or the Assistente's while they confirm their profile with it), and
    never before the profile is saved. The reply says which agent has the card and whether it is in the caller's
    chat (`in_your_chat`), so nobody tells the person «in this chat» for a card that is elsewhere.
    Idempotent — no second card while the first has no answer, whoever posted it (the reply says which agent has
    it), and nothing to ask once the plan is declared. After an answer that named no plan («I do not know») the
    card comes back only after `reask_s`, and never more than `MAX_PLAN_CARDS` times for a provider."""
    if agent not in PLAN_ASKERS:
        return {"ok": False, "asked": False, "reason": f"the plan is asked in the chat of {' or '.join(PLAN_ASKERS)}"}
    now = now or datetime.now(timezone.utc)
    with _plan_question_lock():
        info = plan_info()
        if info.get("ok"):
            closed = _close_plan_question(info, now)
            return dict({"ok": True, "asked": False, "reason": "the plan is already declared"},
                        **({"closed_question": closed["question_id"]} if closed.get("closed") else {}))
        if _profile_imported() is None:  # the same rule as the net: the plan is never asked before the profile is saved
            return {"ok": True, "asked": False, "wait_for_profile": True,
                    "reason": "the profile is not saved yet: the plan is asked after it, never before"}
        if not info.get("hint"):
            return {"ok": False, "asked": False, "reason": info.get("reason", "plan_registry is unavailable")}
        registry = _load_module("plan_registry", "plan_registry.py")
        card = registry.question_options() if registry is not None else {}
        if not card:
            return {"ok": False, "asked": False, "reason": "no plans are known for the active provider"}
        state = status()
        try:
            kind, answer = _plan_question_state(state, card["provider"])
        except sqlite3.Error as error:
            return {"ok": False, "asked": False, "reason": f"the database cannot be read: {error}"}
        if kind == "open":
            record = state["plan_question"]
            holder = record.get("agent") or "capitano"
            return {"ok": True, "asked": False, "reason": "a question about the plan is open and has no answer",
                    "question_id": record["id"], "agent": holder, "in_your_chat": holder == agent}
        cards = _cards_asked(state, card["provider"])
        if cards >= MAX_PLAN_CARDS:
            return {"ok": True, "asked": False, "limit": True,
                    "reason": f"the plan was asked {cards} times and the user named none: not asked again"}
        answered = _answered_at(answer) if kind == "answered" else None
        if answered is not None and (now - answered).total_seconds() < reask_s:
            return {"ok": True, "asked": False, "reason": "the user answered without naming a plan: asked again later",
                    "seconds_left": int(reask_s - (now - answered).total_seconds())}
        chat = _user_chat(agent)
        question_id, why = _post_plan_card(chat, card)
        if question_id is None:
            return {"ok": False, "asked": False, "reason": why}
        state = status()  # read again: what was written while the card was being posted stays
        state["plan_question"] = {"id": question_id, "asked_at": _now(), "asked_by": asked_by,
                                  "provider": card["provider"], "agent": chat}
        state["plan_cards"] = {"provider": card["provider"], "count": cards + 1}
        _write(state)
        return {"ok": True, "asked": True, "question_id": question_id, "options": [o["id"] for o in card["options"]],
                "agent": chat, "in_your_chat": chat == agent}


# The first run opens when the Capitano runs `begin-burst`, and the Capitano is told once, by `jht profile import`,
# that the profile is ready. If the plan was not declared yet, that run refused; when the person then picks their plan
# on the card (the Assistente writes it, the card shows «picked up»), nothing told the Capitano again, and the team
# stayed in `awaiting_profile` until the person wrote «start the team» (TEST 18c, 28/10: the plan was saved 10 s after
# the click and the burst opened four minutes later, by hand). The net tells the Capitano again, from the watchdog's
# tick, once the profile is imported and the plan is declared and the first run has not opened.
START_NUDGE_SETTLE_S = 45   # after the plan is written: the one who wrote it is still confirming it
START_NUDGE_EVERY_S = 300   # between two reminders to the Capitano
START_NUDGE_MAX = 3         # for one declared plan; then the Capitano is on its own, and so is the person (they can write)
START_ENTER_TRIES = 3       # Enter pressed by hand on our own reminder left in the composer, each time it is looked at
START_ENTER_WAIT_S = float(os.environ.get("JHT_FIRST_RUN_ENTER_WAIT_S") or 2)
START_ENTER_MAX = 6         # for one declared plan, all together: a composer that never takes it is the person's to look at
START_NUDGE_SEND_S = float(os.environ.get("JHT_FIRST_RUN_SEND_S") or 25)  # the transport may hang: the watchdog's tick (respawns, bridges, mail) does not wait for it for long
START_MESSAGE = (
    "The subscription plan is declared and the candidate profile is complete: the team can start. "
    "Run first_run.py begin-burst and follow your first-run-burst skill."
)
# The reminders are written in a file of their own, never in first-run.json: that file is the Capitano's (begin-burst
# rewrites all of it), and the watchdog that rewrote it from a state read a moment before could put back
# `awaiting_profile` over a burst the Capitano had just opened, with no roster (found by the guardian, 29/10).
NUDGE_PATH = JHT_HOME / "state" / "first-run-nudge.json"


def _read_nudge() -> dict:
    try:
        with NUDGE_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_nudge(record: dict) -> None:
    NUDGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = NUDGE_PATH.with_suffix(f".json.{os.getpid()}.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(record, f)
        f.write("\n")
    tmp.replace(NUDGE_PATH)


def _plan_declared_at() -> Optional[float]:
    registry = _load_module("plan_registry", "plan_registry.py")
    try:
        return Path(registry._config_path()).stat().st_mtime if registry is not None else None
    except (OSError, AttributeError):
        return None


def _capitano_pane() -> Optional[str]:
    """The Capitano's screen as the transport reads it, or None when tmux cannot say."""
    try:
        done = subprocess.run(["tmux", "capture-pane", "-e", "-t", "=CAPITANO:", "-p"],
                              capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout if done.returncode == 0 else None


def _reminder_is_left(message: str) -> bool:
    """True when the Capitano's composer holds EXACTLY our reminder, unsent (spaces apart: a wrapped row loses one)."""
    pane = _capitano_pane()
    composer = _load_module("tmux_send_composer", "tmux_send_composer.py")
    if pane is None or composer is None:
        return False
    try:
        return composer.composer_relation(pane, message)[0] == "ours"
    except Exception:
        return False


def _press_enter_on_the_reminder(message: str, allowed: int) -> tuple[int, bool]:
    """Enter, one at a time and at most `allowed` (and START_ENTER_TRIES), on a composer that holds exactly our reminder,
    looking again after each one. (Enter pressed, whether the composer is free of the reminder.) It never presses on
    anything else: a person typing, a menu, an empty composer. The transport does this by itself when it can tell the
    text is its own; this is the check that does not depend on that (a footer the reader did not know made the text
    «another draft» and left it six minutes with no Enter: TEST 19b)."""
    import time

    pressed = 0
    while pressed < min(allowed, START_ENTER_TRIES) and _reminder_is_left(message):
        try:
            subprocess.run(["tmux", "send-keys", "-t", "=CAPITANO:", "Enter"], capture_output=True, timeout=5, check=False)
        except (OSError, subprocess.SubprocessError):
            break
        pressed += 1
        time.sleep(START_ENTER_WAIT_S)
    return pressed, not _reminder_is_left(message)


def _tell_the_capitano(message: str, timeout: float = START_NUDGE_SEND_S, allowed: int = START_ENTER_MAX) -> tuple[bool, int]:
    """Type `message` into the Capitano's terminal as the person's console (the way `jht profile import` does: the
    envelope of an agent is not ours to wear), then look at the composer: if our text is still there, press Enter on
    it, a few times. (Sent, Enter pressed by hand.) Sent is True when the transport took it, or when the Enter pressed
    here emptied the composer; False when neither did, or the transport did not answer in `timeout` seconds (it is
    then left to finish: `tmux_send_run` does not kill it between its paste and its Enter)."""
    sender = os.environ.get("JHT_TMUX_SENDER") or shutil.which("jht-tmux-send")
    if not sender:
        for candidate in (Path("/app/agents/_skills/tmux-send/jht-tmux-send"),
                          Path(__file__).resolve().parents[2] / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"):
            if candidate.is_file():
                sender = str(candidate)
                break
    if not sender:
        return False, 0
    # a reminder of ours that stayed in the composer is not pasted over: it gets its Enter
    if _reminder_is_left(message):
        pressed, freed = _press_enter_on_the_reminder(message, allowed)
        return freed, pressed
    # this process is a short tick of its own: the environment is what the transport reads
    os.environ["JHT_TMUX_SEND_FROM"] = "user-console"
    os.environ["JHT_TMUX_FOREIGN_WAIT"] = "0"
    runner = _load_module("tmux_send_run", "tmux_send_run.py")
    took = False
    try:
        if runner is not None:
            done = runner.run([sender, "CAPITANO", message], timeout, text=False)
        else:
            done = subprocess.run([sender, "CAPITANO", message], capture_output=True, timeout=timeout, check=False)
        took = done.returncode == 0
    except (OSError, subprocess.SubprocessError):
        took = False
    pressed, freed = _press_enter_on_the_reminder(message, allowed)
    return (took and freed) or (pressed > 0 and freed), pressed


def _start_nudge(state: dict, info: dict, now: datetime, imported: Optional[float] = None) -> dict:
    """The plan is declared and the profile imported: while the first run has not opened, tell the Capitano to open it."""
    if state["phase"] != PHASE_AWAITING:
        return {"action": "none", "reason": "the plan is declared"}
    # the wait counts from the later of the two: a plan declared before the profile was ready is not news at the
    # moment the Capitano is itself told the profile is ready
    declared = max((moment for moment in (_plan_declared_at(), imported) if moment is not None), default=None)
    if declared is not None and now.timestamp() - declared < START_NUDGE_SETTLE_S:
        return {"action": "waiting", "seconds_left": int(START_NUDGE_SETTLE_S - (now.timestamp() - declared))}
    record = _read_nudge()
    plan = info.get("plan")
    count, last = 0, None
    if record.get("plan") == plan:
        count = record.get("count") if isinstance(record.get("count"), int) else 0
        last = _parse(record.get("last_at"))
    if count >= START_NUDGE_MAX:
        return {"action": "none", "reason": f"the Capitano was told {count} times; the person can say it in the chat"}
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        left = START_NUDGE_EVERY_S - (now - last).total_seconds()
        if left > 0:
            # between two reminders: our last one, if it is still unsent in the composer, gets its Enter now and not
            # five minutes later (a limited number of times for the plan: the rest is the person's)
            pressed_so_far = record.get("pressed") if isinstance(record.get("pressed"), int) else 0
            if count >= 1 and pressed_so_far < START_ENTER_MAX and _reminder_is_left(START_MESSAGE):
                pressed, freed = _press_enter_on_the_reminder(START_MESSAGE, START_ENTER_MAX - pressed_so_far)
                _write_nudge({**record, "pressed": pressed_so_far + pressed})
                return {"action": "waiting", "seconds_left": int(left), "pressed": pressed, "freed": freed}
            return {"action": "waiting", "seconds_left": int(left)}
    # the phase is read again, now: the Capitano may have opened the run since `state` was read, and the reminder
    # is for a run that has not opened
    if _read().get("phase", PHASE_AWAITING) != PHASE_AWAITING:
        return {"action": "none", "reason": "the first run opened meanwhile"}
    # written (in the file of the reminders, never in first-run.json) before it is sent: a transport that hangs or a
    # crash must not become a reminder every tick
    pressed_so_far = record.get("pressed") if record.get("plan") == plan and isinstance(record.get("pressed"), int) else 0
    _write_nudge({"plan": plan, "count": count + 1, "last_at": now.isoformat(timespec="seconds"), "pressed": pressed_so_far})
    sent, pressed = _tell_the_capitano(START_MESSAGE, allowed=max(0, START_ENTER_MAX - pressed_so_far))
    if pressed:
        _write_nudge({"plan": plan, "count": count + 1, "last_at": now.isoformat(timespec="seconds"), "pressed": pressed_so_far + pressed})
    return {"action": "start", "plan": plan, "count": count + 1, "sent": sent, "pressed": pressed}


def plan_question_check(after_s: float = PLAN_QUESTION_AFTER_S, reask_s: float = PLAN_REASK_AFTER_S,
                        now: Optional[datetime] = None) -> dict:
    """The net under `ask-plan`: with the profile imported and no plan declared, and nobody asking for `after_s`
    seconds from the import, the system asks.

    Never before the profile is imported, never in `steady`, never while a question about the plan is open, and
    never when the registry cannot be read. After an answer that named no plan it waits `reask_s` (an hour), and
    after `MAX_PLAN_CARDS` cards it stops («stopped»: the watchdog says so in its log). An answer that names a
    plan which is still not written after `after_s` is written here, as the user chose it, for the provider the
    card was posted for. The reverse too: a plan declared by any other path closes the card still open for it
    («closed»)."""
    now = now or datetime.now(timezone.utc)
    # A plan declared by any path closes the card that is still asking for it, before anything else: at any
    # phase of the first run, and whether or not the profile is imported.
    closed = close_plan_question(now)
    if closed.get("closed"):
        return {"action": "closed", "question_id": closed["question_id"], "choice": closed["choice"]}
    if closed.get("failed"):
        return {"action": "failed", "reason": closed["reason"]}
    imported = _profile_imported()
    if imported is None:
        return {"action": "none", "reason": "the profile is not imported yet"}
    state = status()
    if state["phase"] == PHASE_STEADY:
        return {"action": "none", "reason": "the first run is complete"}
    info = plan_info()
    if info.get("ok"):
        return _start_nudge(state, info, now, imported)
    if not info.get("hint"):
        return {"action": "none", "reason": "the plan table cannot be read"}
    registry = _load_module("plan_registry", "plan_registry.py")
    provider = (registry.question_options() or {}).get("provider") if registry is not None else None
    if not provider:
        return {"action": "none", "reason": "no plans are known for the active provider"}
    try:
        kind, answer = _plan_question_state(state, provider)
    except sqlite3.Error:
        return {"action": "none", "reason": "the database cannot be read"}
    if kind == "open":
        return {"action": "none", "reason": "a question about the plan is open"}
    chosen = (answer or {}).get("scelte")
    choice = chosen[0] if isinstance(chosen, list) and len(chosen) == 1 and isinstance(chosen[0], str) else None
    if kind == "answered" and choice and registry.find_plan(provider, choice) is not None:
        left = after_s - (now - (_answered_at(answer) or now)).total_seconds()
        if left > 0:
            return {"action": "waiting", "seconds_left": int(left)}
        plan = registry.set_plan(provider, choice)
        return {"action": "declared", "provider": provider, "plan": plan["id"]}
    cards = _cards_asked(state, provider)
    if cards >= MAX_PLAN_CARDS:
        return {"action": "stopped", "reason": f"the plan was asked {cards} times and the user named none"}
    since = _answered_at(answer) if kind == "answered" else None
    wait = reask_s
    if since is None:
        since, wait = datetime.fromtimestamp(imported, timezone.utc), after_s
    left = wait - (now - since).total_seconds()
    if left > 0:
        return {"action": "waiting", "seconds_left": int(left)}
    asked = ask_plan(agent="capitano", asked_by="net", reask_s=reask_s, now=now)
    return dict(asked, action="asked" if asked.get("asked") else ("none" if asked.get("ok") else "failed"))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="First-run status")
    ap.add_argument("command", nargs="?", default="status",
                    choices=["status", "begin-burst", "check", "complete", "reset",
                             "plan", "ask-plan", "plan-question-check", "mentor-due"])
    ap.add_argument("--reason", default="closed manually")
    ap.add_argument("--agent", choices=PLAN_ASKERS, default="capitano",
                    help="ask-plan: whose chat the card goes to (the agent the person is talking to)")
    ap.add_argument("--after", type=float, default=PLAN_QUESTION_AFTER_S,
                    help="plan-question-check: seconds without a question before the system asks")
    ap.add_argument("--reask", type=float, default=PLAN_REASK_AFTER_S,
                    help="ask-plan, plan-question-check: seconds before the card comes back after an answer that named no plan")
    args = ap.parse_args(argv)

    if args.command == "status":
        state = status()
        out = dict(state, **plan_gap(state), **roster_gap(state))
    elif args.command == "plan":
        out = plan_info()
    elif args.command == "mentor-due":
        answer = mentor_check()
        print(json.dumps(answer))
        return 0 if answer["mentor_due"] else 1
    elif args.command == "begin-burst":
        out = begin_burst()
    elif args.command == "check":
        out = check()
    elif args.command == "complete":
        out = complete(args.reason)
    elif args.command == "ask-plan":
        out = ask_plan(agent=args.agent, reask_s=args.reask)
    elif args.command == "plan-question-check":
        out = plan_question_check(args.after, args.reask)
    else:
        out = reset()

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
