import json, os, sqlite3, sys
sys.path.insert(0, '/app/shared/skills')
from _db import DB_PATH, ensure_schema
from enrichment_policy import load_policy, logo_min_score

profile = os.path.join(os.path.dirname(DB_PATH), 'profile')
maintenance_path = os.path.join(profile, 'capitano-maintenance.json')
maintenance_raw = {}
try:
    maintenance_raw = json.load(open(maintenance_path, encoding='utf-8'))
except Exception:
    pass
orders = maintenance_raw.get('orders', {}) if isinstance(maintenance_raw, dict) else {}
if not isinstance(orders, dict):
    orders = {}
maintenance = {
    # Modalità CURA (ex 'maintenance'): valore canonico 'care' dal 2026-07-30,
    # 'maintenance' resta valido (file scritti da versioni precedenti / andris).
    # Recuperato fondendo il refactoring che ha spostato questo Python fuori
    # dal .gd: il file esterno nasceva dalla versione PRECEDENTE alla rinomina,
    # e prenderlo tale e quale avrebbe spento la modalità cura nel gioco.
    'enabled': maintenance_raw.get('mode') in ('care', 'maintenance'),
    'stop_search': bool(orders.get('stop_search', True)),
    'discard_expired_rotating': bool(orders.get('discard_expired_rotating', True)),
    'cv_min_score': int(orders.get('cv_min_score', 90)),
    'pre_check_liveness_for_cv': bool(orders.get('pre_check_liveness_for_cv', True)),
}

policy = load_policy()
# Compatibilità rolling-deploy: il gioco può essere più nuovo dell'immagine
# container per qualche minuto. Le opzioni fini si leggono dal JSON già
# normalizzato anche quando gli helper nuovi non sono ancora nell'immagine.
geo_section = policy.get('geocode_missing', {})
geo = {
    'min_score': geo_section.get('min_score'),
    'non_remote_only': bool(geo_section.get('non_remote_only', True)),
}
recheck_section = policy.get('recheck_weekly', {})
recheck = {
    'min_score': int(recheck_section.get('min_score', 70)),
    'older_than_days': int(recheck_section.get('older_than_days', 7)),
}
enrichment = {
    'economy': bool(policy.get('economy', False)),
    'logo_enabled': bool(policy.get('logo', {}).get('enabled', True)),
    'logo_min_score': logo_min_score(policy),
    'geocode_enabled': bool(policy.get('geocode_missing', {}).get('enabled', True)),
    'geocode_min_score': geo.get('min_score'),
    'geocode_non_remote_only': bool(geo.get('non_remote_only', True)),
    'recheck_enabled': bool(policy.get('recheck_weekly', {}).get('enabled', True)),
    'recheck_min_score': int(recheck.get('min_score', 70)),
    'recheck_older_days': int(recheck.get('older_than_days', 7)),
}

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
ensure_schema(conn)
def count(sql, params=()):
    try:
        return int(conn.execute(sql, params).fetchone()[0])
    except Exception:
        return 0

queue_counts = {
    'new': count("SELECT COUNT(*) FROM positions WHERE status='new'"),
    'analysis': count("SELECT COUNT(*) FROM positions WHERE status='checked'"),
    'scored': count("SELECT COUNT(*) FROM positions WHERE status='scored'"),
    'expired': count("SELECT COUNT(*) FROM positions WHERE status!='excluded' AND expires_at IS NOT NULL AND expires_at < datetime('now')"),
}
geo_sql = ("SELECT COUNT(*) FROM positions p "
           "WHERE p.status!='excluded' "
           "AND (p.office_lat IS NULL OR p.office_geocoded IS NULL OR p.office_geocoded=0)")
geo_params = []
if geo.get('min_score') is not None:
    geo_sql += " AND EXISTS (SELECT 1 FROM scores s WHERE s.position_id=p.id AND s.total_score>=?)"
    geo_params.append(int(geo['min_score']))
if geo.get('non_remote_only', True):
    geo_sql += " AND LOWER(COALESCE(p.work_mode,''))!='remote'"
queue_counts['geocode'] = count(geo_sql, tuple(geo_params))

logo_score = logo_min_score(policy)
logo_sql = ("SELECT COUNT(*) FROM companies c "
            "WHERE (c.logo_fetched IS NULL OR c.logo_fetched=0) "
            "AND EXISTS (SELECT 1 FROM positions p WHERE p.company_id=c.id AND p.status!='excluded')")
logo_params = []
if logo_score is not None:
    logo_sql += " AND EXISTS (SELECT 1 FROM positions p JOIN scores s ON s.position_id=p.id WHERE p.company_id=c.id AND p.status!='excluded' AND s.total_score>=?)"
    logo_params.append(int(logo_score))
queue_counts['logos'] = count(logo_sql, tuple(logo_params))
queue_counts['recheck'] = count("SELECT COUNT(DISTINCT p.id) FROM positions p "
   "JOIN scores s ON s.position_id=p.id "
   "WHERE p.status!='excluded' AND s.total_score>=? "
   "AND (p.last_checked IS NULL OR p.last_checked < datetime('now', ?))",
   (int(recheck['min_score']), '-' + str(int(recheck['older_than_days'])) + ' days'))

directives = []
for row in conn.execute("SELECT id,body,kind,status,sort_order,created_at,updated_at "
                        "FROM team_directives WHERE status='active' "
                        "ORDER BY sort_order,created_at"):
    directives.append(dict(row))
conn.close()
print(json.dumps({'ok': True, 'maintenance': maintenance,
                  'enrichment': enrichment, 'queue_counts': queue_counts,
                  'directives': directives}, ensure_ascii=False))
