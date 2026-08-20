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

`retire` resta il lifecycle ordinario (scale-down). Un containment di sicurezza
ha invece uno stato distinto e sticky: `record` non lo cancella, quindi neppure
uno spawn manuale puo' riattivare per sbaglio una sessione contenuta. Solo
`release` rimuove esplicitamente quel cancello. Chi contiene usa il wrapper
`jht-agent-contain`, che cattura il pane PRIMA di scrivere lo stato e fermare la
sessione; le subcommand qui sotto sono il contratto a basso livello.

    python3 team_roster.py retire SCOUT-3 --reason "scale-down deliberato"

CLI::

    python3 team_roster.py record scout 3 --src start-agent.sh
    python3 team_roster.py retire SCOUT-3 --reason "scale-down"
    python3 team_roster.py contain SCRITTORE-2 --by capitano --reason "unsafe output" --evidence /path/to/pane.txt
    python3 team_roster.py release SCRITTORE-2 --by operatore --reason "incident resolved"
    python3 team_roster.py is-contained SCRITTORE-2
    python3 team_roster.py contained-live --tsv
    python3 team_roster.py missing            # JSON: attesi ma senza sessione
    python3 team_roster.py next-respawn       # "<role> <instance> <session>" o nulla
    python3 team_roster.py mark-respawn SCOUT-3
    python3 team_roster.py list
"""
from __future__ import annotations

import argparse
import importlib.util
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


def containment_marker(session: str, path: Path | None = None) -> Path:
    """Marker separato dal roster: rende il containment immune a una write
    concorrente di start-agent che avesse letto il roster appena prima della
    decisione."""
    base = (path or roster_path()).parent / "containment"
    return base / f"{session.strip().upper()}.hold.json"


def _load_containment_marker(session: str, path: Path | None = None) -> dict:
    try:
        data = json.loads(containment_marker(session, path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_containment_marker(session: str, event: dict,
                              path: Path | None = None) -> None:
    marker = containment_marker(session, path)
    marker.parent.mkdir(parents=True, exist_ok=True)
    tmp = marker.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(event, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(marker)
    try:
        marker.chmod(0o600)
    except OSError:
        pass


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
    if role == "critico" and instance not in (None, ""):
        return f"CRITICO-S{instance}"
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


def save(state: dict, path: Path | None = None) -> bool:
    p = path or roster_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2))
        tmp.replace(p)
        return True
    except OSError as e:  # fail-open: il roster non deve mai bloccare uno spawn
        print(f"[team_roster] WARN write failed: {e}", file=sys.stderr)
        return False


def record(role: str, instance=None, src: str = "", path: Path | None = None) -> dict:
    """Registra uno spawn riuscito. Idempotente: riporta l'entry ad `active`
    (un `retire` seguito da un nuovo spawn e' una ri-attivazione esplicita)."""
    role = role.strip().lower()
    sess = session_name(role, instance)
    state = load(path)
    entry = state["agents"].get(sess) or {}
    now = _iso(_now())
    contained = (entry.get("status") == "contained" or
                 containment_marker(sess, path).exists())
    entry.update({
        "session": sess,
        "role": role,
        "instance": int(instance) if instance not in (None, "") else None,
        # Un normale spawn riattiva uno scale-down (`retired`) ma NON revoca
        # un containment di sicurezza. In quel caso il watchdog vede la
        # sessione viva, ne salva il pane e la rimette giu'.
        "status": "contained" if contained else "active",
        "last_spawn": now,
        "last_spawn_src": src or entry.get("last_spawn_src", ""),
    })
    entry.setdefault("first_seen", now)
    entry.setdefault("respawns", [])
    if not contained:
        entry.pop("retired_at", None)
        entry.pop("retire_reason", None)
    else:
        entry.setdefault("containment_spawn_attempts", []).append(now)
        entry["containment_spawn_attempts"] = entry["containment_spawn_attempts"][-20:]
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


def contain(session: str, by: str, reason: str, evidence: str,
            path: Path | None = None) -> dict:
    """Applica un containment sticky. La cattura e' responsabilita' del
    chiamante e deve gia' esistere: se il roster non e' persistibile, il
    wrapper NON deve procedere al kill."""
    sess = session.strip().upper()
    state = load(path)
    entry = state["agents"].get(sess)
    if not entry:
        raise ValueError(f"{sess} is not in the expected roster")
    now = _iso(_now())
    event = {
        "action": "contained",
        "at": now,
        "by": by.strip() or "unknown",
        "reason": reason.strip(),
        "evidence": evidence,
    }
    marker_preexisted = containment_marker(sess, path).exists()
    _write_containment_marker(sess, event, path)
    entry.update({
        "status": "contained",
        "contained_at": now,
        "contained_by": event["by"],
        "contain_reason": event["reason"],
        "contain_evidence": evidence,
    })
    entry.setdefault("containment_history", []).append(event)
    entry["containment_history"] = entry["containment_history"][-50:]
    if not save(state, path):
        if not marker_preexisted:
            try:
                containment_marker(sess, path).unlink()
            except OSError:
                pass
        raise OSError("could not persist containment in the roster")
    return entry


def release(session: str, by: str, reason: str,
            path: Path | None = None) -> tuple[dict, str]:
    """Revoca esplicitamente un containment; restituisce anche chi lo aveva
    deciso, cosi' il wrapper puo' notificargli che la sua decisione cambia."""
    sess = session.strip().upper()
    state = load(path)
    entry = state["agents"].get(sess)
    marker_data = _load_containment_marker(sess, path)
    if not entry or (entry.get("status") != "contained" and not marker_data):
        raise ValueError(f"{sess} is not contained")
    original_by = str(entry.get("contained_by") or marker_data.get("by") or "")
    now = _iso(_now())
    event = {
        "action": "released",
        "at": now,
        "by": by.strip() or "unknown",
        "reason": reason.strip(),
    }
    entry["status"] = "active"
    entry["released_at"] = now
    entry["released_by"] = event["by"]
    entry["release_reason"] = event["reason"]
    # Una release e' una nuova decisione esplicita: le sonde di recovery
    # antecedenti non devono auto-ritirarla come "seconda sparizione".
    entry["respawns"] = []
    entry.setdefault("containment_history", []).append(event)
    entry["containment_history"] = entry["containment_history"][-50:]
    if not save(state, path):
        raise OSError("could not persist containment release in the roster")
    try:
        containment_marker(sess, path).unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise OSError("could not remove the sticky containment marker") from exc
    return entry, original_by


def is_contained(session: str, path: Path | None = None) -> bool:
    sess = session.strip().upper()
    if containment_marker(sess, path).exists():
        return True
    entry = load(path).get("agents", {}).get(sess) or {}
    return entry.get("status") == "contained"


def contained_live(path: Path | None = None,
                   live: set | None = None) -> list[dict]:
    state = load(path)
    contained_by_session = {
        sess: dict(entry)
        for sess, entry in sorted(state.get("agents", {}).items())
        if entry.get("status") == "contained"
    }
    marker_dir = containment_marker("placeholder", path).parent
    try:
        markers = list(marker_dir.glob("*.hold.json"))
    except OSError:
        markers = []
    for marker in markers:
        sess = marker.name.removesuffix(".hold.json")
        data = _load_containment_marker(sess, path)
        entry = contained_by_session.get(sess) or dict(
            state.get("agents", {}).get(sess) or {"session": sess})
        entry["status"] = "contained"
        entry["contained_by"] = data.get("by") or entry.get("contained_by") or "unknown"
        entry["contain_evidence"] = data.get("evidence") or entry.get("contain_evidence") or ""
        contained_by_session[sess] = entry
    contained = sorted(contained_by_session.items())
    if not contained:
        return []
    alive = live_sessions() if live is None else live
    return [
        entry for sess, entry in contained if sess in alive
    ]


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

# Il modulo `standby` si carica UNA volta per processo (path-import: il roster
# gira sia nel container sia dai test, e `standby` non è un package).
_STANDBY_MOD = None


def _standby_active(home: Path) -> bool:
    """Standby ATTIVO adesso, secondo l'UNICO predicato del team
    ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS], `standby.py`).

    Il flag ha sempre una condizione di uscita: uno SCADUTO non è più standby
    e non deve bloccare il respawn — se il sentinel-bridge (che rimuove il
    flag) è morto, gatare sul file significa non ricreare più nessun worker,
    cioè lo standby eterno. `home` è esplicito: qui si risolve a ogni
    chiamata, in standby.py è una costante di modulo.

    Fail-CLOSED: modulo non caricabile → il vecchio `.exists()`.
    """
    global _STANDBY_MOD
    if _STANDBY_MOD is None:
        for cand in (Path("/app/shared/skills/standby.py"),
                     Path(__file__).resolve().parent / "standby.py"):
            try:
                if not cand.exists():
                    continue
                spec = importlib.util.spec_from_file_location(
                    "standby_predicate", cand)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                _STANDBY_MOD = mod
                break
            except Exception:      # noqa: BLE001
                continue
    if _STANDBY_MOD is None or not hasattr(_STANDBY_MOD, "is_active"):
        return (home / ".team-standby.flag").exists()
    try:
        return bool(_STANDBY_MOD.is_active(home=home))
    except Exception:      # noqa: BLE001
        return (home / ".team-standby.flag").exists()


def _halted(home: Path) -> str:
    for flag, label in (
        (".team-halted.flag", "halted"),
        (".weekly-halt.flag", "weekly-halt"),
    ):
        if (home / flag).exists():
            return label
    if _standby_active(home):
        return "standby"
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
                e["retire_reason"] = (
                    "respawn already attempted and session disappeared again — "
                    "treating it as an intentional removal"
                )
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
    p = argparse.ArgumentParser(description="Expected JHT team roster")
    sub = p.add_subparsers(dest="cmd")

    pr = sub.add_parser("record", help="record a successful spawn")
    pr.add_argument("role")
    pr.add_argument("instance", nargs="?", default=None)
    pr.add_argument("--src", default="")

    pt = sub.add_parser("retire", help="declare an INTENTIONAL removal")
    pt.add_argument("session")
    pt.add_argument("--reason", default="")

    pc = sub.add_parser("contain", help="persist a sticky safety containment")
    pc.add_argument("session")
    pc.add_argument("--by", required=True)
    pc.add_argument("--reason", required=True)
    pc.add_argument("--evidence", required=True)

    prelease = sub.add_parser("release", help="explicitly revoke a containment")
    prelease.add_argument("session")
    prelease.add_argument("--by", required=True)
    prelease.add_argument("--reason", required=True)

    pic = sub.add_parser("is-contained", help="exit 0 only for a contained session")
    pic.add_argument("session")

    pcl = sub.add_parser("contained-live", help="contained sessions that are alive")
    pcl.add_argument("--tsv", action="store_true")

    pl = sub.add_parser(
        "roles", help="roles with their own tmux session, one per line "
                      "(single source for shell scripts)")
    pl.add_argument("--kind", choices=("all", "worker", "core", "ephemeral"),
                    default="all", help="subset (default: all)")

    sub.add_parser("missing", help="expected entries without a live session (JSON)")
    sub.add_parser("next-respawn", help="return at most one worker to recreate")
    sub.add_parser("list", help="dump the roster (JSON)")

    pm = sub.add_parser("mark-respawn", help="record a respawn attempt")
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
    if args.cmd == "contain":
        try:
            entry = contain(args.session, args.by, args.reason, args.evidence)
        except (ValueError, OSError) as exc:
            print(f"team_roster: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(entry, ensure_ascii=False))
        return 0
    if args.cmd == "release":
        try:
            entry, original_by = release(args.session, args.by, args.reason)
        except (ValueError, OSError) as exc:
            print(f"team_roster: {exc}", file=sys.stderr)
            return 1
        print(json.dumps({"entry": entry, "original_by": original_by}, ensure_ascii=False))
        return 0
    if args.cmd == "is-contained":
        return 0 if is_contained(args.session) else 1
    if args.cmd == "contained-live":
        entries = contained_live()
        if args.tsv:
            for entry in entries:
                print("\t".join((str(entry.get("session") or ""),
                                  str(entry.get("contained_by") or "unknown"),
                                  str(entry.get("contain_evidence") or ""))))
        else:
            print(json.dumps(entries, ensure_ascii=False))
        return 0
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
