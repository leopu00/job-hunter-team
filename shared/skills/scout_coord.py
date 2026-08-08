#!/usr/bin/env python3
"""
Coordinazione Scout — divisione del lavoro, dentro il database della squadra.

Gli Scout usano queste tabelle per solidificare la divisione di cerchi e fonti
dopo la negoziazione via tmux. Storico incluso per sessioni future.

## Dove vivono i dati ([JHT-DB-SCOUT-COORD], 2026-08-08)

In `jobs.db`, tabelle `scout_coordination` e `scout_claims` — non piu' in un
secondo file sqlite. Il file separato aveva un suo risolutore di percorso, e
quel percorso e' stato la causa dell'issue #132: una cartella che non esisteva,
sqlite che non la crea, e uno Scout che si sceglie un fallback tutto suo.
Un database in meno e' un modo in meno di divergere.

Cosa si guadagna, in concreto: la stessa risoluzione di path che ogni agente
riceve gia' (`JHT_DB`, esportato nel pane dal launcher), le stesse migrazioni,
lo stesso backup, e l'ufficio che puo' finalmente mostrare la distribuzione
leggendo il database che gia' legge. La coordinazione NON viaggia verso il
cloud: `db_to_supabase` sincronizza una lista esplicita di tabelle e queste
non ci sono.

Il vecchio file, se esiste, viene **importato una volta sola** e lasciato
dov'e': si legge, non si cancella. L'import deduplica su scout + `started_at`,
quindi rileggerlo non duplica niente.

Uso:
  python3 scout_coord.py show                          # Distribuzione attuale
  python3 scout_coord.py history                       # Storico distribuzioni
  python3 scout_coord.py assign scout-1 --cerchi "1,2" --fonti "remoteok,pyjobs"
  python3 scout_coord.py assign scout-2 --cerchi "3,4" --fonti "greenhouse,lever"
  python3 scout_coord.py reset                         # Chiudi sessione corrente
  python3 scout_coord.py claim <job_id>  <scout_name>  # Claim posizione (anti-collisione)
  python3 scout_coord.py check-claim <job_id>          # Verifica se gia' claimata
  python3 scout_coord.py bootstrap                     # Verifica il DB (pre-spawn)
  python3 scout_coord.py doctor [--json]               # Quale DB si sta usando davvero
"""

import re
import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import DB_PATH as JOBS_DB_PATH, ensure_schema  # noqa: E402

# Il database della squadra, risolto come per tutte le altre skill. Resta un
# attributo di modulo perche' e' il punto in cui i test puntano altrove.
DB_PATH = Path(JOBS_DB_PATH)
DB_ORIGIN = "jobs_db"

# ── Il vecchio file, solo per importarlo ────────────────────────────────
# `JHT_SCOUT_COORD_DB` non e' piu' una deroga: la deroga sul percorso del
# database e' una sola, `JHT_DB`, e vale per tutta la squadra. Qui la
# variabile sopravvive con l'unico scopo di ritrovare il file legacy di chi
# l'aveva dichiarata prima della consolidazione.
LEGACY_ENV = "JHT_SCOUT_COORD_DB"
LEGACY_FILENAME = "scout_coordination.db"

# Un nome di Scout e' `scout-<n>` (o al piu' un identificativo di sessione):
# tutto il resto e' un errore di invocazione. Serve perche' `assign` prende il
# nome da `sys.argv[2]` e senza validazione un `assign --help` scriveva una
# riga ATTIVA intestata allo scout `--help` — trovata viva su una squadra in
# produzione il 2026-08-08.
SCOUT_NAME_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


class CoordinationDbError(RuntimeError):
    """Il DB di coordinamento non e' utilizzabile. Il messaggio dice cosa fare."""


def resolve_db_path():
    """(path, origine) del database della coordinazione, letti dall'ambiente ORA.

    Funzione pura: nessuna creazione, nessuna scrittura. Da quando la
    coordinazione vive in `jobs.db` l'origine e' sempre la stessa di tutte le
    altre skill — che e' esattamente il punto della consolidazione.
    """
    return Path(os.environ.get("JHT_DB") or JOBS_DB_PATH), DB_ORIGIN


def legacy_db_path():
    """Il vecchio file di coordinazione, se esiste ancora. `None` altrimenti.

    Si guardano gli stessi tre posti del vecchio risolutore, cosi' nessuna
    installazione resta indietro con la sua storia.
    """
    candidates = []
    override = (os.environ.get(LEGACY_ENV) or "").strip()
    if override:
        candidates.append(Path(override).expanduser())
    jht_home = (os.environ.get("JHT_HOME") or "").strip()
    if jht_home:
        candidates.append(Path(jht_home).expanduser() / "data" / LEGACY_FILENAME)
    candidates.append(Path(__file__).parent.parent / "data" / LEGACY_FILENAME)
    for cand in candidates:
        try:
            if cand.is_file():
                return cand
        except OSError:
            continue
    return None


def valid_scout_name(name):
    """`scout-1` si', `--help` no. Vedi SCOUT_NAME_RE."""
    return bool(SCOUT_NAME_RE.match((name or "").strip().lower()))


def _actionable(path, detail):
    """Il messaggio che un agente puo' ESEGUIRE, non solo leggere."""
    return (f"scout coordination unusable in {path}: {detail}. "
            f"That file is the team database (JHT_DB): fix the path or the "
            f"permissions. Do NOT create a database of your own — two Scouts "
            f"on two files are not coordinating, they only believe they are.")


def import_legacy(conn):
    """Porta dentro la storia del vecchio file. Idempotente, e non cancella.

    Deduplica su `(scout, started_at)` invece di scrivere un marcatore: la
    cartella legacy puo' essere proprio quella non scrivibile dell'issue #132,
    e un import che ha bisogno di scrivere accanto al file da leggere
    fallirebbe esattamente nel caso che deve coprire.
    """
    src = legacy_db_path()
    if src is None:
        return {"imported": 0, "claims": 0, "path": None}
    try:
        old = sqlite3.connect(f"file:{src}?mode=ro", uri=True, timeout=5)
        old.row_factory = sqlite3.Row
        rows = [dict(r) for r in old.execute(
            "SELECT scout, cerchi, fonti, note, started_at, superseded_at "
            "FROM coordination").fetchall()]
        claims = [dict(r) for r in old.execute(
            "SELECT job_id, scout, claimed_at FROM claims").fetchall()]
        old.close()
    except sqlite3.Error:
        return {"imported": 0, "claims": 0, "path": str(src), "unreadable": True}

    seen = {(r[0], r[1]) for r in conn.execute(
        "SELECT scout, started_at FROM scout_coordination").fetchall()}
    imported = 0
    quarantined = 0
    now = datetime.now().isoformat()
    for r in rows:
        key = (r["scout"], r["started_at"])
        if key in seen:
            continue
        superseded = r["superseded_at"]
        if superseded is None and not valid_scout_name(r["scout"]):
            # Le righe fantasma esistono davvero (`--help` intestato come
            # Scout, trovato ATTIVO su una squadra in produzione): la storia
            # si importa tutta, ma un partecipante che non esiste non deve
            # comparire nella distribuzione IN VIGORE.
            superseded = now
            quarantined += 1
        conn.execute(
            "INSERT INTO scout_coordination "
            "(scout, cerchi, fonti, note, started_at, superseded_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (r["scout"], r["cerchi"], r["fonti"], r["note"], r["started_at"],
             superseded))
        seen.add(key)
        imported += 1
    claimed = 0
    for c in claims:
        cur = conn.execute(
            "INSERT OR IGNORE INTO scout_claims (job_id, scout, claimed_at) "
            "VALUES (?, ?, ?)", (c["job_id"], c["scout"], c["claimed_at"]))
        claimed += cur.rowcount or 0
    if imported or claimed:
        conn.commit()
    return {"imported": imported, "claims": claimed, "quarantined": quarantined,
            "path": str(src)}


def ensure_ready(path=None, create=True):
    """Il database della squadra e' raggiungibile e SCRIVIBILE. Ritorna un report.

    "Verifica" significa provare a scrivere davvero: una directory che esiste
    e un file che si apre non dicono ancora niente su un bind-mount montato
    read-only o su una ACL di Windows. `BEGIN IMMEDIATE` prende il lock di
    scrittura e fallisce esattamente dove fallirebbe il primo `claim`.

    Solleva `CoordinationDbError` con un messaggio azionabile invece di
    ripiegare in silenzio su un altro percorso.
    """
    target = Path(path) if path is not None else Path(DB_PATH)
    existed = target.exists()
    if create:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise CoordinationDbError(
                _actionable(target, f"cannot create {target.parent} ({e})"))
    elif not target.parent.exists():
        raise CoordinationDbError(
            _actionable(target, f"{target.parent} does not exist"))
    legacy = {"imported": 0, "claims": 0, "path": None}
    try:
        db = _connect(target)
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("ROLLBACK")
            legacy = import_legacy(db)
        finally:
            db.close()
    except (sqlite3.Error, OSError) as e:
        raise CoordinationDbError(_actionable(target, str(e)))
    return {"path": str(target), "origin": DB_ORIGIN, "created": not existed,
            "writable": True, "legacy": legacy}


def _connect(path):
    """Connessione + schema. Non decide nulla sul percorso: quello e' gia' deciso."""
    db = sqlite3.connect(str(path), timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    ensure_schema(db)
    return db


def get_db():
    """Il database della squadra, con lo schema garantito e la storia importata.

    Qualunque guasto esce come `CoordinationDbError`: il chiamante lo riporta
    e si ferma, non si sceglie un altro file.
    """
    path = Path(DB_PATH)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        db = _connect(path)
    except (OSError, sqlite3.Error) as e:
        raise CoordinationDbError(_actionable(path, str(e)))
    try:
        import_legacy(db)
    except sqlite3.Error:
        pass   # la storia vecchia non vale il blocco della coordinazione di oggi
    return db


def cmd_show():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM scout_coordination WHERE superseded_at IS NULL ORDER BY scout"
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
        "SELECT * FROM scout_coordination ORDER BY started_at DESC, scout"
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
    # Il nome arriva da `sys.argv[2]`: senza questo, `assign --help` scriveva
    # una riga ATTIVA intestata allo scout `--help`, e `show` mostrava un
    # partecipante che non esiste alla divisione del territorio.
    if not valid_scout_name(scout):
        raise CoordinationDbError(
            f"{scout!r} is not a Scout name (expected something like "
            f"`scout-1`). Nothing was written: an assignment owned by a "
            f"typo would show up as a participant in the split.")
    db = get_db()
    # Se esiste gia un record attivo per questo scout, aggiornalo
    existing = db.execute(
        "SELECT id FROM scout_coordination WHERE scout=? AND superseded_at IS NULL", (scout,)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE scout_coordination SET cerchi=?, fonti=?, note=?, started_at=CURRENT_TIMESTAMP WHERE id=?",
            (cerchi, fonti, note, existing["id"])
        )
        print(f"Updated: {scout} → search_areas={cerchi}, sources={fonti}")
    else:
        db.execute(
            "INSERT INTO scout_coordination (scout, cerchi, fonti, note) VALUES (?, ?, ?, ?)",
            (scout, cerchi, fonti, note)
        )
        print(f"Assigned: {scout} → search_areas={cerchi}, sources={fonti}")
    db.commit()
    db.close()


def cmd_reset():
    db = get_db()
    now = datetime.now().isoformat()
    updated = db.execute(
        "UPDATE scout_coordination SET superseded_at=? WHERE superseded_at IS NULL", (now,)
    ).rowcount
    # Pulisci anche i claim vecchi (> 24h)
    db.execute("DELETE FROM scout_claims WHERE claimed_at < datetime('now', '-24 hours')")
    db.commit()
    print(f"Session closed: {updated} assignments archived.")
    db.close()


def cmd_claim(job_id, scout):
    db = get_db()
    existing = db.execute("SELECT scout, claimed_at FROM scout_claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"ALREADY_CLAIMED by {existing['scout']} at {existing['claimed_at']}")
        db.close()
        return False
    try:
        db.execute("INSERT INTO scout_claims (job_id, scout) VALUES (?, ?)", (job_id, scout))
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
    existing = db.execute("SELECT scout, claimed_at FROM scout_claims WHERE job_id=?", (job_id,)).fetchone()
    if existing:
        print(f"CLAIMED by {existing['scout']} at {existing['claimed_at']}")
    else:
        print("AVAILABLE")
    db.close()


def cmd_bootstrap():
    """Pre-spawn: il database della squadra esiste e si lascia scrivere.

    Gira PRIMA degli Scout (start-agent.sh) proprio perche' il primo a
    scoprire il problema non deve essere un agente a meta' negoziazione.
    Qui avviene anche l'import una-tantum del vecchio file, se c'e'.
    """
    report = ensure_ready()
    state = "created" if report["created"] else "ready"
    print(f"scout coordination {state} in {report['path']} "
          f"(origin: {report['origin']})")
    legacy = report.get("legacy") or {}
    if legacy.get("imported") or legacy.get("claims"):
        print(f"  imported from the legacy database: "
              f"{legacy['imported']} assignments, {legacy['claims']} claims "
              f"({legacy['path']} — left in place, read-only from now on)")
        if legacy.get("quarantined"):
            print(f"  {legacy['quarantined']} assignment(s) with an invalid "
                  f"Scout name imported as SUPERSEDED: history kept, but they "
                  f"are not participants in the active split")
    elif legacy.get("unreadable"):
        print(f"  legacy database found but unreadable ({legacy['path']}): "
              f"its history stays there, today's coordination works anyway")
    return report


def cmd_doctor(as_json=False):
    """Quale database si sta usando DAVVERO, e se si può scrivere.

    Diagnostica, quindi non crea niente: un doctor che crea la cartella
    mancante risponderebbe "tutto bene" alla domanda sbagliata. Mostra il
    percorso e i conteggi, mai il contenuto: il DB porta nomi di agenti e
    fonti, che non hanno motivo di finire in un log.
    """
    path, origin = resolve_db_path()
    legacy = legacy_db_path()
    report = {"path": str(path), "origin": origin, "exists": path.exists(),
              "writable": False, "assignments": None, "claims": None,
              "error": None, "legacy_db": str(legacy) if legacy else None}
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
                    "SELECT COUNT(*) FROM scout_coordination "
                    "WHERE superseded_at IS NULL").fetchone()[0]
                report["claims"] = db.execute(
                    "SELECT COUNT(*) FROM scout_claims").fetchone()[0]
            finally:
                db.close()
        except sqlite3.Error:
            pass   # DB presente ma non ancora inizializzato: i conteggi restano None
    if as_json:
        import json
        print(json.dumps(report, ensure_ascii=False))
    else:
        print(f"database: {report['path']}")
        print(f"origin:   {origin} (the team database — same JHT_DB as every "
              f"other skill)")
        if report["legacy_db"]:
            print(f"legacy:   {report['legacy_db']} (imported, kept in place)")
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
