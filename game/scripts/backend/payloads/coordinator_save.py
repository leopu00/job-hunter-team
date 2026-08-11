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
# Cosa dice il file ADESSO. Serve perché la Console lo riscrive da zero: le
# chiavi che NON sta cambiando devono sopravvivere alla riscrittura.
try:
    current = json.load(open(maintenance_path, encoding='utf-8'))
except Exception:
    current = {}
if not isinstance(current, dict):
    current = {}

# `mode_until` — la scadenza di [SAVING-MODE-HAS-NO-DEADLINE] — non appartiene
# a una modalità in particolare: dice fino a quando vale l'ordine, chiunque
# l'abbia dato (`jht coordinator set-mode --until`, o un umano nel JSON).
# Riscrivere il file da zero la CANCELLAVA senza avviso, e la modalità tornava
# a durare per inerzia: il difetto che quella chiave esiste per chiudere.
# Stessa regola di `coordinator_settings.write_mode`: una chiave che non si sta
# nominando resta dov'è.
def carry_deadline(payload):
    until = current.get('mode_until')
    if isinstance(until, str) and until.strip():
        payload['mode_until'] = until.strip()
    return payload

# Modalità di lavoro (enum chiuso 2026-08). Contratto del file:
#   assenza = search → si CANCELLA;
#   care    → mode 'care' + gli `orders` fini della cura;
#   le altre (harvest/calibration/saving) → solo {'mode': ...}: cosa
#   implicano vive nel manuale delle modalità e nell'enforcement a codice
#   (enrichment_policy legge mode=saving da qui), non in flag duplicati.
# Un valore fuori enum degrada via il vecchio toggle (enabled → care/search):
# è anche il ramo di compatibilità per un client che non manda ancora 'mode'.
MODES = ('search', 'harvest', 'care', 'calibration', 'saving')
mode = m.get('mode')
if mode == 'maintenance':
    mode = 'care'
if mode not in MODES:
    mode = 'care' if boolean(m.get('enabled')) else 'search'
if mode == 'search':
    # L'assenza del file È `search`: la scadenza se ne va con lui, perché
    # `search` è già il posto in cui una scadenza fa tornare.
    maintenance = None
    try: os.unlink(maintenance_path)
    except FileNotFoundError: pass
elif mode == 'care':
    maintenance = carry_deadline({
        'mode': 'care',
        'orders': {
            'stop_search': boolean(m.get('stop_search'), True),
            'discard_expired_rotating': boolean(m.get('discard_expired_rotating'), True),
            'cv_min_score': integer(m.get('cv_min_score'), 90, 0, 100),
            'pre_check_liveness_for_cv': boolean(m.get('pre_check_liveness_for_cv'), True),
        },
    })
    atomic(maintenance_path, maintenance)
else:
    maintenance = carry_deadline({'mode': mode})
    atomic(maintenance_path, maintenance)

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
print(json.dumps({'ok': True, 'mode': mode, 'maintenance': maintenance,
                  'enrichment': policy}, ensure_ascii=False))
