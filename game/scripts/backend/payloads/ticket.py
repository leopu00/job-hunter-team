import sqlite3, base64, json, sys
text = base64.b64decode('%s').decode('utf-8')
pid = %d
# Il path del database NON si indovina: lo risolve _db, lo stesso modulo
# degli agenti (pattern di coordinator_state.py). Prima qui c'era
# '/jht_home/jobs.db' scritto a mano, e sqlite crea il file che non
# esiste: eseguito in un ambiente senza quel percorso, questo INSERT
# nasceva dentro un database vuoto nuovo di zecca e dichiarava successo
# — il ticket sembrava creato e non esisteva da nessuna parte
# (DB-PATH-FALLS-BACK-INSTEAD-OF-STOPPING). Se JHT_DB e JHT_HOME mancano,
# _db si rifiuta e il suo errore dice QUALE variabile impostare: il JSON
# ok=false qui sotto lo porta intatto fino alla UI del gioco.
sys.path.insert(0, '/app/shared/skills')
try:
    from _db import DB_PATH
except Exception as exc:
    print(json.dumps(dict(ok=False, error=str(exc))))
    raise SystemExit(0)
db = sqlite3.connect(DB_PATH)
try:
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA foreign_keys=ON')
    if db.execute('SELECT id FROM positions WHERE id=?', (pid,)).fetchone() is None:
        print(json.dumps(dict(ok=False, error='posizione inesistente')))
    else:
        cur = db.execute(
            "INSERT INTO position_tickets (position_id, request_text, kind, status) "
            "VALUES (?, ?, 'custom', 'open')", (pid, text))
        db.commit()
        print(json.dumps(dict(ok=True, id=cur.lastrowid)))
finally:
    db.close()
