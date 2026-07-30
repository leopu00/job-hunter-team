#!/usr/bin/env python3
"""team_roster.py — stato condiviso del roster ATTESO (chi dovrebbe essere vivo).

Origine: incidente 2026-07-28/29. Quattro worker (ANALISTA-1, SCORER-3, SCORER-5,
SCOUT-5) sono morti — processi terminati — senza una riga di log, senza respawn e
senza segnalazione. `agent-watchdog.sh` guardava solo i quattro ruoli core
(`AGENTS=(assistente capitano mentor sentinella)`), il Capitano aveva dichiarato
di non sorvegliarli, e il Dottore — che se ne sarebbe accorto — era fermo.

Il watchdog non puo' dedurre il roster atteso dalle sessioni vive: e' esattamente
la cosa che sta cercando di verificare. Serve uno stato condiviso, ed e' questo
file. Contratto:

    scrittura  ← `start-agent.sh` a ogni spawn RIUSCITO (`record`), cioe' l'unico
                 percorso per cui un agente esiste (le skill vietano il
                 `tmux new-session` a mano) → copertura totale, nessuna
                 cooperazione richiesta a chi spawna;
    lettura    ← `agent-watchdog.sh` a ogni tick (`next-respawn`).

## Il rischio vero: combattere col coordinatore

Se il Capitano ha ridotto il roster di proposito, respawnare annulla la sua
decisione — un watchdog che combatte col coordinatore e' peggio di nessun
watchdog. Il roster registra gli SPAWN, non le INTENZIONI: nessuno oggi dichiara
"questo worker l'ho tolto apposta" (il teardown deliberato passa da un
`tmux kill-session` crudo, vedi le skill `sentinel-orders` / `pipeline-triage`).

Quindi la distinzione morto-vs-tolto NON e' dichiarata: e' inferita, con tre
guardie che ne limitano il costo quando l'inferenza sbaglia.

1. **Cancello di attivita'** — si respawna solo un worker che stava LAVORANDO
   quando e' sparito (messaggi o artefatti nella finestra
   `JHT_ROSTER_ACTIVITY_WINDOW_MIN`, default 90 min). E' il principio che il
   coordinatore ricreato aveva gia' individuato da solo: *non chiedere se il
   processo e' vivo, chiedere se il database avanza*. Un worker che il Capitano
   ha tolto era per definizione inattivo (si scala giu' cio' che non serve) →
   non viene respawnato. Un worker crashato stava producendo → viene respawnato.
2. **Sonda a colpo singolo** — un respawn per sessione per
   `JHT_ROSTER_RESPAWN_COOLDOWN_H` (default 6h). Se la stessa sessione sparisce
   di nuovo entro il cooldown, la lettura "e' morta" era sbagliata: l'entry passa
   a `retired` da sola e il watchdog non la tocca piu'. Il conflitto col
   coordinatore dura al massimo un kick-off, poi si spegne — non puo' loopare.
3. **Tetto globale** — al massimo `JHT_ROSTER_RESPAWN_CAP` respawn (default 3)
   nella finestra `JHT_ROSTER_RESPAWN_WINDOW_SEC` (default 1h). Copre il caso
   drastico in cui la Sentinella killa TUTTI i Sonnet per fermare la spesa
   (`sentinel-orders`): il watchdog non puo' ricostruire il team che qualcuno ha
   appena smontato.

Limite dichiarato, da non nascondere: finche' il teardown deliberato non viene
DICHIARATO (`retire`), la distinzione resta un'inferenza. Il costo massimo
dell'errore e' bounded (tre kick-off in un'ora, uno per sessione), ma non e'
zero. Chi smonta un worker di proposito dovrebbe chiamare::

    python3 team_roster.py retire SCOUT-3 --reason "scale-down deliberato"

CLI::

    python3 team_roster.py record scout 3 --src start-agent.sh
    python3 team_roster.py retire SCOUT-3 --reason "scale-down"
    python3 team_roster.py missing            # JSON: attesi ma senza sessione
    python3 team_roster.py next-respawn       # "<role> <instance> <session>" o nulla
    python3 team_roster.py mark-respawn SCOUT-3
    python3 team_roster.py list
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ruoli worker numerati: quelli che PRODUCONO e che nessuna rete deterministica
# sorvegliava. Il Critico e' escluso di proposito: lo spawna e lo killa lo
# Scrittore dentro `critic-loop` (effimero, per singola review) — respawnarlo
# significherebbe combattere con lo Scrittore invece che col Capitano.
WORKER_ROLES = ("scout", "analista", "scorer", "scrittore")

# Ruoli core: gia' coperti da `AGENTS=(...)` in agent-watchdog.sh. Vengono
# registrati comunque (il roster e' l'inventario completo, serve anche al TTL),
# ma `next-respawn` non li propone: li ricrea `ensure_agent`.
CORE_ROLES = ("assistente", "capitano", "mentor", "sentinella")

# Ruoli EFFIMERI: hanno una sessione tmux propria ma il loro ciclo di vita e'
# di un altro agente (il Critico lo spawna e lo killa lo Scrittore dentro
# `critic-loop`). NON vanno respawnati — per questo restano fuori da
# WORKER_ROLES — ma esistono, consumano e possono ROMPERSI: chi li CURA senza
# ricrearli (il codex-auth-healer) deve poterli riconoscere.
EPHEMERAL_ROLES = ("critico",)

# Tutti i ruoli con una sessione tmux propria. Fonte UNICA per chi deve
# riconoscere una sessione senza tenersi una lista scritta a mano (le liste a
# mano sono il bug [HEALER-BLIND-TO-GATES-AND-ROLES]: la mappa del healer non
# conteneva ne' scrittore ne' critico, cioe' i due ruoli che producono il
# deliverable finale, e nessuno se n'era accorto).
# ESCLUSI di proposito: dottore/mantenitore (one-shot, li rimpiazza il loro
# scheduler) e i pane di appoggio come SENTINELLA-WORKER (non agenti LLM).
ALL_ROLES = WORKER_ROLES + CORE_ROLES + EPHEMERAL_ROLES

# Tabella/colonna-autore/colonna-timestamp per la "produzione" di ogni ruolo.
# Stesse colonne di doctor_analytics.py (fonte unica in jobs.db).
PRODUCTION = {
    "scout": ("positions", "found_by", "found_at"),
    "analista": ("positions", "analyzed_by", "last_checked"),
    "scorer": ("scores", "scored_by", "scored_at"),
    "scrittore": ("applications", "written_by", "written_at"),
}

_SESSION_RE = re.compile(r"^([A-Z]+)(?:-(\d+))?$")


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


def roster_path() -> Path:
    return jht_home() / "logs" / "team-roster.json"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_iso(s):
    if not s:
        return None
    try:
        t = str(s).replace("Z", "+00:00")
        dt = datetime.fromisoformat(t)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def session_name(role: str, instance=None) -> str:
    role = role.strip().lower()
    if role in WORKER_ROLES and instance is not None:
        return f"{role.upper()}-{instance}"
    return role.upper()


# ── stato ────────────────────────────────────────────────────────────────────

def load(path: Path | None = None) -> dict:
    p = path or roster_path()
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return {"version": 1, "agents": {}}
    if not isinstance(data, dict) or not isinstance(data.get("agents"), dict):
        return {"version": 1, "agents": {}}
    return data


def save(state: dict, path: Path | None = None) -> None:
    p = path or roster_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2))
        tmp.replace(p)
    except OSError as e:  # fail-open: il roster non deve mai bloccare uno spawn
        print(f"[team_roster] WARN scrittura fallita: {e}", file=sys.stderr)


def record(role: str, instance=None, src: str = "", path: Path | None = None) -> dict:
    """Registra uno spawn riuscito. Idempotente: riporta l'entry ad `active`
    (un `retire` seguito da un nuovo spawn e' una ri-attivazione esplicita)."""
    role = role.strip().lower()
    sess = session_name(role, instance)
    state = load(path)
    entry = state["agents"].get(sess) or {}
    now = _iso(_now())
    entry.update({
        "session": sess,
        "role": role,
        "instance": int(instance) if instance not in (None, "") else None,
        "status": "active",
        "last_spawn": now,
        "last_spawn_src": src or entry.get("last_spawn_src", ""),
    })
    entry.setdefault("first_seen", now)
    entry.setdefault("respawns", [])
    entry.pop("retired_at", None)
    entry.pop("retire_reason", None)
    state["agents"][sess] = entry
    save(state, path)
    return entry


def retire(session: str, reason: str = "", path: Path | None = None) -> bool:
    """Marca un'entry come tolta DI PROPOSITO: il watchdog non la respawna piu'."""
    sess = session.strip().upper()
    state = load(path)
    entry = state["agents"].get(sess)
    if not entry:
        return False
    entry["status"] = "retired"
    entry["retired_at"] = _iso(_now())
    entry["retire_reason"] = reason
    save(state, path)
    return True


# ── osservazione ─────────────────────────────────────────────────────────────

def live_sessions() -> set:
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    return {ln.strip() for ln in out.splitlines() if ln.strip()}


def last_activity(session: str, home: Path | None = None) -> datetime | None:
    """Ultimo segno di vita del worker: un messaggio (inviato O ricevuto) oppure
    un artefatto scritto nel DB. E' il segnale che distingue "stava lavorando e
    e' morto" da "era gia' fermo ed e' stato tolto".

    NB: `messages.jsonl` registra il TENTATIVO di invio, non la consegna
    (jht-tmux-send logga prima di digitare) — quindi uno Scorer bloccato in
    retry-loop verso un Capitano muto risulta attivo, ed e' corretto: era vivo e
    stava lavorando fino all'ultimo istante.
    """
    h = home or jht_home()
    name = session.strip().lower()
    best = None

    msgs = h / "logs" / "messages.jsonl"
    try:
        with open(msgs) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if (d.get("from") or "").lower() != name and (d.get("to") or "").lower() != name:
                    continue
                ts = _parse_iso(d.get("ts"))
                if ts and (best is None or ts > best):
                    best = ts
    except OSError:
        pass

    role = _SESSION_RE.match(session.strip().upper())
    role = role.group(1).lower() if role else ""
    spec = PRODUCTION.get(role)
    db = h / "jobs.db"
    if spec and db.exists():
        table, by_col, ts_col = spec
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            try:
                cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                if by_col in cols and ts_col in cols:
                    row = conn.execute(
                        f"SELECT MAX({ts_col}) FROM {table} WHERE {by_col} LIKE ?",
                        (name + "%",),
                    ).fetchone()
                    ts = _parse_iso(row[0] if row else None)
                    if ts and (best is None or ts > best):
                        best = ts
            finally:
                conn.close()
        except sqlite3.Error:
            pass
    return best


def missing(path: Path | None = None, live: set | None = None) -> list:
    """Entry attese (`status=active`) senza sessione tmux viva."""
    state = load(path)
    alive = live_sessions() if live is None else live
    out = []
    for sess, entry in sorted(state["agents"].items()):
        if entry.get("status") != "active":
            continue
        if sess in alive:
            continue
        out.append(entry)
    return out


# ── decisione di respawn ─────────────────────────────────────────────────────

def _halted(home: Path) -> str:
    for flag, label in (
        (".team-halted.flag", "halted"),
        (".weekly-halt.flag", "weekly-halt"),
        (".team-standby.flag", "standby"),
    ):
        if (home / flag).exists():
            return label
    return ""


def _within_working_hours() -> bool:
    """Fail-open: qualunque errore → True (`working_hours` assente o null =
    nessuna restrizione oraria, non "sempre fuori orario")."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
        from shared.skills.working_hours import is_within_working_hours
        return bool(is_within_working_hours())
    except Exception:
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from working_hours import is_within_working_hours  # type: ignore
            return bool(is_within_working_hours())
        except Exception:
            return True


def decide_respawn(state: dict, alive: set, now: datetime, activity: dict,
                   in_window: bool, halted: str,
                   activity_window_min: int = 90,
                   cooldown_h: int = 6,
                   cap: int = 3,
                   cap_window_sec: int = 3600):
    """Funzione PURA (testabile senza tmux): quale worker respawnare, se uno.

    Ritorna `(entry|None, reason, mutations)` dove `mutations` e' la lista di
    sessioni da auto-ritirare (sonda gia' spesa e sparite di nuovo).
    """
    retire_now = []
    if halted:
        return None, f"halt:{halted}", retire_now
    if not in_window:
        # Fuori finestra un worker assente e' NORMALE: non va ricreato. (Il TTL
        # della Parte B, al contrario, non si sospende mai — vive altrove.)
        return None, "outside-working-hours", retire_now

    # Tetto globale sui respawn recenti: se qualcuno ha appena smontato il team
    # (hard-freeze della Sentinella), non lo ricostruiamo un pezzo per tick.
    recent = 0
    for entry in state.get("agents", {}).values():
        for ts in entry.get("respawns", []) or []:
            dt = _parse_iso(ts)
            if dt and (now - dt).total_seconds() <= cap_window_sec:
                recent += 1
    if recent >= cap:
        return None, f"respawn-cap:{recent}/{cap}", retire_now

    candidates = []
    for sess, entry in state.get("agents", {}).items():
        if entry.get("status") != "active":
            continue
        if (entry.get("role") or "") not in WORKER_ROLES:
            continue          # i core li ricrea ensure_agent
        if sess in alive:
            continue

        last_resp = None
        for ts in entry.get("respawns", []) or []:
            dt = _parse_iso(ts)
            if dt and (last_resp is None or dt > last_resp):
                last_resp = dt
        if last_resp is not None and (now - last_resp) <= timedelta(hours=cooldown_h):
            # Sonda gia' spesa: l'abbiamo ricreata e e' sparita di nuovo. La
            # lettura "morta" era sbagliata → si ritira da sola, niente loop.
            retire_now.append(sess)
            continue

        act = activity.get(sess)
        if act is None:
            continue          # nessuna traccia di lavoro → non e' un crash da coprire
        if (now - act) > timedelta(minutes=activity_window_min):
            continue          # era gia' ferma da un pezzo → tolta, non morta
        candidates.append((act, entry))

    if not candidates:
        return None, "no-candidate", retire_now
    # Piu' recente prima: il crash appena avvenuto ha la precedenza.
    candidates.sort(key=lambda c: c[0], reverse=True)
    return candidates[0][1], "respawn", retire_now


def next_respawn(path: Path | None = None):
    home = jht_home()
    state = load(path)
    alive = live_sessions()
    now = _now()
    activity = {}
    for sess, entry in state.get("agents", {}).items():
        if entry.get("status") == "active" and (entry.get("role") or "") in WORKER_ROLES and sess not in alive:
            activity[sess] = last_activity(sess, home)
    entry, reason, retire_now = decide_respawn(
        state, alive, now, activity,
        in_window=_within_working_hours(),
        halted=_halted(home),
        activity_window_min=_env_int("JHT_ROSTER_ACTIVITY_WINDOW_MIN", 90),
        cooldown_h=_env_int("JHT_ROSTER_RESPAWN_COOLDOWN_H", 6),
        cap=_env_int("JHT_ROSTER_RESPAWN_CAP", 3),
        cap_window_sec=_env_int("JHT_ROSTER_RESPAWN_WINDOW_SEC", 3600),
    )
    if retire_now:
        for sess in retire_now:
            e = state["agents"].get(sess)
            if e:
                e["status"] = "retired"
                e["retired_at"] = _iso(now)
                e["retire_reason"] = "respawn gia' tentato e sessione sparita di nuovo — la tratto come rimozione voluta"
        save(state, path)
    return entry, reason


def mark_respawn(session: str, path: Path | None = None) -> bool:
    sess = session.strip().upper()
    state = load(path)
    entry = state["agents"].get(sess)
    if not entry:
        return False
    entry.setdefault("respawns", []).append(_iso(_now()))
    entry["respawns"] = entry["respawns"][-10:]
    save(state, path)
    return True


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Roster atteso del team JHT")
    sub = p.add_subparsers(dest="cmd")

    pr = sub.add_parser("record", help="registra uno spawn riuscito")
    pr.add_argument("role")
    pr.add_argument("instance", nargs="?", default=None)
    pr.add_argument("--src", default="")

    pt = sub.add_parser("retire", help="dichiara una rimozione VOLUTA")
    pt.add_argument("session")
    pt.add_argument("--reason", default="")

    pl = sub.add_parser(
        "roles", help="ruoli con una sessione tmux propria, uno per riga "
                      "(fonte unica per gli script shell)")
    pl.add_argument("--kind", choices=("all", "worker", "core", "ephemeral"),
                    default="all", help="sottoinsieme (default: all)")

    sub.add_parser("missing", help="attesi ma senza sessione viva (JSON)")
    sub.add_parser("next-respawn", help="al massimo un worker da ricreare")
    sub.add_parser("list", help="dump del roster (JSON)")

    pm = sub.add_parser("mark-respawn", help="segna un tentativo di respawn")
    pm.add_argument("session")

    args = p.parse_args(argv)

    if args.cmd == "record":
        inst = args.instance
        if inst in ("", "None"):
            inst = None
        entry = record(args.role, inst, src=args.src)
        print(json.dumps(entry, ensure_ascii=False))
        return 0
    if args.cmd == "retire":
        ok = retire(args.session, args.reason)
        print("retired" if ok else "not-in-roster")
        return 0 if ok else 1
    if args.cmd == "roles":
        groups = {"all": ALL_ROLES, "worker": WORKER_ROLES,
                  "core": CORE_ROLES, "ephemeral": EPHEMERAL_ROLES}
        for role in groups[args.kind]:
            print(role)
        return 0
    if args.cmd == "missing":
        print(json.dumps(missing(), ensure_ascii=False))
        return 0
    if args.cmd == "next-respawn":
        entry, reason = next_respawn()
        if entry is None:
            print(f"# {reason}", file=sys.stderr)
            return 1
        print(f"{entry['role']} {entry.get('instance') or ''} {entry['session']}".strip())
        return 0
    if args.cmd == "mark-respawn":
        return 0 if mark_respawn(args.session) else 1
    if args.cmd == "list":
        print(json.dumps(load(), ensure_ascii=False, indent=2))
        return 0

    p.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
