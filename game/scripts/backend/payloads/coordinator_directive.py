import base64, json, sys
sys.path.insert(0, '/app/shared/skills')
from _db import get_db, ensure_schema
data = json.loads(base64.b64decode('%s').decode('utf-8'))
conn = get_db(); ensure_schema(conn)
action = str(data.get('action', ''))
if action == 'add':
    body = str(data.get('body', '')).strip()
    kind = str(data.get('kind', 'order'))
    if not body or len(body) > 2000 or kind not in ('order','strategy','formation','note'):
        raise ValueError('direttiva non valida')
    order = conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM team_directives WHERE status='active'").fetchone()[0]
    conn.execute("INSERT INTO team_directives(body,kind,status,sort_order,created_by) VALUES(?,?,'active',?,'user')", (body,kind,order))
elif action == 'archive':
    directive_id = int(data.get('id', 0))
    if directive_id <= 0: raise ValueError('id non valido')
    conn.execute("UPDATE team_directives SET status='archived', archived_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=? AND status='active'", (directive_id,))
else:
    raise ValueError('azione non valida')
conn.commit(); conn.close()
print(json.dumps({'ok': True, 'action': action}, ensure_ascii=False))
