#!/usr/bin/env python3
"""
Coordinazione Scout — Database di distribuzione lavoro.

Gli scout usano questo DB per solidificare la divisione di cerchi e fonti
dopo la negoziazione via tmux. Storico incluso per sessioni future.

Uso:
  python3 scout_coord.py show                          # Distribuzione attuale
  python3 scout_coord.py history                       # Storico distribuzioni
  python3 scout_coord.py assign scout-1 --cerchi "1,2" --fonti "remoteok,pyjobs"
  python3 scout_coord.py assign scout-2 --cerchi "3,4" --fonti "greenhouse,lever"
  python3 scout_coord.py reset                         # Chiudi sessione corrente
  python3 scout_coord.py claim <job_id>  <scout_name>  # Claim posizione (anti-collisione)
  python3 scout_coord.py check-claim <job_id>          # Verifica se già claimata
  python3 scout_coord.py bootstrap                     # Crea e verifica il DB (pre-spawn)
  python3 scout_coord.py doctor [--json]               # Quale DB si sta usando davvero
"""

import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path

DB_FILENAME = "scout_coordination.db"

# Il DB si dichiara, non si improvvisa (issue #132). Nel run Windows del
# 2026-08-05 il primo Scout non è riuscito ad aprire il percorso previsto —
# `$JHT_HOME/data/` non esisteva e nessuno la creava — e ha proseguito
# scegliendosi un fallback scrivibile: da lì in poi due agenti potevano
# coordinarsi su due database diversi, cioè non coordinarsi affatto,
# credendo di farlo. Un errore rumoroso è meno costoso di uno stato
# divergente silenzioso.
#
# Precedenza, dall'esplicito al derivato:
#   1. $JHT_SCOUT_COORD_DB — la deroga dell'operatore. È l'UNICO fallback
#      ammesso quando il percorso canonico non è scrivibile, ed è unico
#      perché vive nell'ambiente che il launcher passa a TUTTI gli agenti:
#      un fallback scelto da un singolo processo sarebbe un secondo DB.
#   2. $JHT_HOME/data/ — il canonico (bind-mount ~/.jht persistente).
#   3. path relativo al repo — solo esecuzioni ad-hoc fuori dal container,
#      dove JHT_HOME non esiste proprio.
ENV_DB = "JHT_SCOUT_COORD_DB"

# Come si chiamano le tre origini nella diagnostica. Un nome, non un path:
# serve a capire QUALE regola ha deciso, e si legge anche in un log.
ORIGIN_ENV = "env"
ORIGIN_JHT_HOME = "jht_home"
ORIGIN_REPO = "repo"


class CoordinationDbError(RuntimeError):
    """Il DB di coordinamento non è utilizzabile. Il messaggio dice cosa fare."""


def resolve_db_path():
    """(path, origine) del database di coordinamento, letti dall'ambiente ORA.

    Funzione pura sull'ambiente: nessuna creazione, nessuna scrittura. Tutti
    gli agenti che condividono l'ambiente del launcher risolvono lo stesso
    percorso, su Windows come nel container.
    """
    override = (os.environ.get(ENV_DB) or "").strip()
    if override:
        return Path(override).expanduser(), ORIGIN_ENV
    jht_home = (os.environ.get("JHT_HOME") or "").strip()
    if jht_home:
        return Path(jht_home).expanduser() / "data" / DB_FILENAME, ORIGIN_JHT_HOME
    return Path(__file__).parent.parent / "data" / DB_FILENAME, ORIGIN_REPO


# Risolto all'import come `_db.DB_PATH`: resta un attributo di modulo perché
# è il punto in cui i test (e un'esecuzione ad-hoc) puntano altrove.
DB_PATH, DB_ORIGIN = resolve_db_path()


def _actionable(path, origin, detail):
    """Il messaggio che un agente può ESEGUIRE, non solo leggere."""
    if origin == ORIGIN_ENV:
        fix = (f"{ENV_DB} points here: correct it, or make the path writable.")
    else:
        fix = (f"make the directory writable, or declare ONE shared fallback "
               f"for the whole team with {ENV_DB}=<writable path> before "
               f"spawning the agents.")
    return (f"scout coordination database unusable at {path} "
            f"(origin: {origin}): {detail}. {fix} "
            f"Do NOT create a database of your own: two Scouts on two files "
            f"are not coordinating, they only believe they are.")


def ensure_ready(path=None, create=True):
    """Crea (se serve) e VERIFICA il DB di coordinamento. Ritorna un report.

    "Verifica" significa provare a scrivere davvero: una directory che esiste
    e un file che si apre non dicono ancora niente su un bind-mount montato
    read-only o su una ACL di Windows. `BEGIN IMMEDIATE` prende il lock di
    scrittura e fallisce esattamente dove fallirebbe il primo `claim`.

    Solleva `CoordinationDbError` con un messaggio azionabile invece di
    ripiegare in silenzio su un altro percorso.
    """
    target = Path(path) if path is not None else Path(DB_PATH)
    origin = DB_ORIGIN if path is None else "explicit"
    existed = target.exists()
    if create:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise CoordinationDbError(
                _actionable(target, origin, f"cannot create {target.parent} ({e})"))
    elif not target.parent.exists():
        raise CoordinationDbError(
            _actionable(target, origin, f"{target.parent} does not exist"))
    try:
        db = _connect(target)
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("ROLLBACK")
        finally:
            db.close()
    except (sqlite3.Error, OSError) as e:
        raise CoordinationDbError(_actionable(target, origin, str(e)))
    return {"path": str(target), "origin": origin, "created": not existed,
            "writable": True}


def _connect(path):
    """Connessione + schema. Non decide nulla sul percorso: quello è già deciso."""
    db = sqlite3.connect(str(path), timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS coordination (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scout TEXT NOT NULL,
            cerchi TEXT,
            fonti TEXT,
            note TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            superseded_at TIMESTAMP
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            job_id TEXT PRIMARY KEY,
            scout TEXT NOT NULL,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.commit()
    return db


def get_db():
    """Il DB canonico, creando la cartella se manca (era il buco del run Windows).

    Qualunque guasto esce come `CoordinationDbError`: il chiamante lo riporta
    e si ferma, non si sceglie un altro file.
    """
    path = Path(DB_PATH)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        return _connect(path)
    except (OSError, sqlite3.Error) as e:
        raise CoordinationDbError(_actionable(path, DB_ORIGIN, str(e)))


def cmd_show():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM coordination WHERE superseded_at IS NULL ORDER BY scout"
    ).fetchall()
    if not rows:
        print("No active distribution.")
        return
    started = rows[0]["started_at"]
    print(f"=== ACTIVE DISTRIBUTION (since {started}) ===\n")
    for r in rows:
        print(f"  {r['scout']}")
        print(f"    Search areas: {r['cerchi'] or '-'}")
        print(f"    Sources:      {r['fonti'] or '-'}")
        if r["note"]:
            print(f"    Note:   {r['note']}")
        print()
    db.close()


def cmd_history():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM coordination ORDER BY started_at DESC, scout"
    ).fetchall()
    if not rows:
        print("No history.")
        return
    current_session = None
    for r in rows:
        session_key = r["started_at"]
        if session_key != current_session:
            current_session = session_key
            status = "ACTIVE" if r["superseded_at"] is None else f"closed {r['superseded_at']}"
            print(f"\n--- Session {r['started_at']} ({status}) ---")
        active = " *" if r["superseded_at"] is None else ""
        print(f"  {r['scout']}: cerchi={r['cerchi'] or '-'}, fonti={r['fonti'] or '-'}{active}")
    db.close()


def cmd_assign(scout, cerchi=None, fonti=None, note=None):
    db = get_db()
    # Se esiste gia un record attivo per questo scout, aggiornalo
    existing = db.execute(
        "SELECT id FROM coordination WHERE scout=? AND superseded_at IS NULL", (scout,)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE coordination SET cerchi=?, fonti=?, note=?, started_at=CURRENT_TIMESTAMP WHERE id=?",
            (cerchi, fonti, note, existing["id"])
        )
        print(f"Updated: {scout} → search_areas={cerchi}, sources={fonti}")
    else:
        db.execute(
            "INSERT INTO coordination (scout, cerchi, fonti, note) VALUES (?, ?, ?, ?)",
            (scout, cerchi, fonti, note)
        )
        print(f"Assigned: {scout} → search_areas={cerchi}, sources={fonti}")
    db.commit()
    db.close()


def cmd_reset():
    db = get_db()
    now = datetime.now().isoformat()
    updated = db.execute(
        "UPDATE coordination SET superseded_at=? WHERE superseded_at IS NULL", (now,)
    ).rowcount
    # Pulisci anche i claim vecchi (> 24h)
    db.execute("DELETE FROM claims WHERE claimed_at < datetime('now', '-24 hours')")
    db.commit()
    print(f"Session closed: {updated} assignments archived.")
    db.close()


def cmd_claim(job_id, scout):
    db = get_db()
    existing = db.execute("SELECT scout, claimed_at FROM claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"ALREADY_CLAIMED by {existing['scout']} at {existing['claimed_at']}")
        db.close()
        return False
    try:
        db.execute("INSERT INTO claims (job_id, scout) VALUES (?, ?)", (job_id, scout))
        db.commit()
        print(f"CLAIMED by {scout}")
        db.close()
        return True
    except sqlite3.IntegrityError:
        print("ALREADY_CLAIMED (race condition)")
        db.close()
        return False


def cmd_check_claim(job_id):
    db = get_db()
    existing = db.execute("SELECT scout, claimed_at FROM claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"CLAIMED by {existing['scout']} at {existing['claimed_at']}")
    else:
        print("AVAILABLE")
    db.close()


def cmd_bootstrap():
    """Pre-spawn: la cartella e il DB esistono e si lasciano scrivere.

    Gira PRIMA degli Scout (start-agent.sh) proprio perché il primo a
    scoprire il problema non deve essere un agente a metà negoziazione.
    """
    report = ensure_ready()
    state = "created" if report["created"] else "ready"
    print(f"scout coordination db {state}: {report['path']} "
          f"(origin: {report['origin']})")
    return report


def cmd_doctor(as_json=False):
    """Quale database si sta usando DAVVERO, e se si può scrivere.

    Diagnostica, quindi non crea niente: un doctor che crea la cartella
    mancante risponderebbe "tutto bene" alla domanda sbagliata. Mostra il
    percorso e i conteggi, mai il contenuto: il DB porta nomi di agenti e
    fonti, che non hanno motivo di finire in un log.
    """
    path, origin = resolve_db_path()
    report = {"path": str(path), "origin": origin, "exists": path.exists(),
              "writable": False, "assignments": None, "claims": None,
              "error": None, "env_override": bool(os.environ.get(ENV_DB))}
    try:
        ensure_ready(create=False)
        report["writable"] = True
    except CoordinationDbError as e:
        report["error"] = str(e)
    if report["exists"]:
        try:
            db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
            try:
                report["assignments"] = db.execute(
                    "SELECT COUNT(*) FROM coordination "
                    "WHERE superseded_at IS NULL").fetchone()[0]
                report["claims"] = db.execute(
                    "SELECT COUNT(*) FROM claims").fetchone()[0]
            finally:
                db.close()
        except sqlite3.Error:
            pass   # DB presente ma non ancora inizializzato: i conteggi restano None
    if as_json:
        import json
        print(json.dumps(report, ensure_ascii=False))
    else:
        print(f"database: {report['path']}")
        print(f"origin:   {origin}"
              + ("  (declared override)" if report["env_override"] else ""))
        print(f"exists:   {report['exists']}    writable: {report['writable']}")
        print(f"active assignments: {report['assignments']}   "
              f"claims: {report['claims']}")
        if report["error"]:
            print(report["error"], file=sys.stderr)
    return report


def _dispatch(cmd):
    if cmd == "show":
        cmd_show()
    elif cmd == "history":
        cmd_history()
    elif cmd == "assign" and len(sys.argv) >= 3:
        scout = sys.argv[2]
        cerchi = fonti = note = None
        args = sys.argv[3:]
        for i, arg in enumerate(args):
            if arg == "--cerchi" and i + 1 < len(args):
                cerchi = args[i + 1]
            elif arg == "--fonti" and i + 1 < len(args):
                fonti = args[i + 1]
            elif arg == "--note" and i + 1 < len(args):
                note = args[i + 1]
        cmd_assign(scout, cerchi, fonti, note)
    elif cmd == "reset":
        cmd_reset()
    elif cmd == "claim" and len(sys.argv) >= 4:
        cmd_claim(sys.argv[2], sys.argv[3])
    elif cmd == "check-claim" and len(sys.argv) >= 3:
        cmd_check_claim(sys.argv[2])
    else:
        print(__doc__)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    # Exit 3 = DB inutilizzabile, con il messaggio azionabile su stderr. Vale
    # per OGNI comando: un agente che riceve 3 sa di essersi fermato PRIMA di
    # scrivere, e non deve dedurlo da un output vuoto — né rimediare da sé
    # scegliendosi un altro file, che è come è nato il problema.
    _cmd = sys.argv[1]
    try:
        if _cmd == "bootstrap":
            cmd_bootstrap()
        elif _cmd == "doctor":
            _rep = cmd_doctor(as_json="--json" in sys.argv[2:])
            sys.exit(0 if _rep["writable"] else 3)
        else:
            _dispatch(_cmd)
    except CoordinationDbError as e:
        print(str(e), file=sys.stderr)
        sys.exit(3)
