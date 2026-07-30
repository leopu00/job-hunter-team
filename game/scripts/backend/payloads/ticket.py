import sqlite3, base64, json
text = base64.b64decode('%s').decode('utf-8')
pid = %d
db = sqlite3.connect('/jht_home/jobs.db')
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
