import base64, json, os, sys
sys.path.insert(0, '/app/shared/skills')
from _db import DB_PATH
data = json.loads(base64.b64decode('%s').decode('utf-8'))
profile = os.path.join(os.path.dirname(DB_PATH), 'profile')
os.makedirs(profile, exist_ok=True)

def boolean(value, default=False):
    return value if isinstance(value, bool) else default
def integer(value, default, lo, hi):
    try: value = int(value)
    except Exception: value = default
    return max(lo, min(hi, value))
def nullable_score(value):
    if value is None or str(value).strip().lower() in ('', 'null', 'none'):
        return None
    return integer(value, 0, 0, 100)
def atomic(path, value):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write('\n')
    os.replace(tmp, path)

m = data.get('maintenance', {})
maintenance_path = os.path.join(profile, 'capitano-maintenance.json')
if boolean(m.get('enabled')):
    maintenance = {
        'mode': 'maintenance',
        'orders': {
            'stop_search': boolean(m.get('stop_search'), True),
            'discard_expired_rotating': boolean(m.get('discard_expired_rotating'), True),
            'cv_min_score': integer(m.get('cv_min_score'), 90, 0, 100),
            'pre_check_liveness_for_cv': boolean(m.get('pre_check_liveness_for_cv'), True),
        },
    }
    atomic(maintenance_path, maintenance)
else:
    try: os.unlink(maintenance_path)
    except FileNotFoundError: pass

e = data.get('enrichment', {})
policy = {
    'economy': boolean(e.get('economy')),
    'logo': {
        'enabled': boolean(e.get('logo_enabled'), True),
        'min_score': nullable_score(e.get('logo_min_score')),
    },
    'geocode_missing': {
        'enabled': boolean(e.get('geocode_enabled'), True),
        'min_score': nullable_score(e.get('geocode_min_score')),
        'non_remote_only': boolean(e.get('geocode_non_remote_only'), True),
    },
    'recheck_weekly': {
        'enabled': boolean(e.get('recheck_enabled'), True),
        'min_score': integer(e.get('recheck_min_score'), 70, 0, 100),
        'older_than_days': integer(e.get('recheck_older_days'), 7, 1, 365),
    },
}
atomic(os.path.join(profile, 'enrichment-policy.json'), policy)
print(json.dumps({'ok': True, 'maintenance': maintenance if boolean(m.get('enabled')) else None,
                  'enrichment': policy}, ensure_ascii=False))
