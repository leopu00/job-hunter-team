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
#
# La Console però ADESSO la nomina, in due forme:
#   'mode_until'       → istante assoluto ISO 8601 (o null/'' per togliere la
#                        scadenza): la forma che scrive anche `jht coordinator`;
#   'mode_until_hours' → «per quante ore ancora», che il gioco preferisce e che
#                        si converte QUI. Come per la deroga di spesa
#                        (burn_intent), la durata viaggia relativa e diventa un
#                        istante nel container: fra host e container il fuso può
#                        differire, e una scadenza calcolata sull'orologio
#                        sbagliato è diversa da quella che l'utente ha visto.
# La validazione è quella di mode_deadline.py, non una copia: una data che il
# lettore non digerisce sarebbe una modalità senza fine, cioè il difetto di
# partenza. Import tollerante come in mode_banner, ma qui l'assenza del modulo
# NON è silenziosa: su un'immagine che non sa valutare le scadenze, scrivere
# `mode_until` significherebbe promettere una fine che nessuno farà scattare.
try:
    import mode_deadline
except Exception:
    mode_deadline = None

_UNSET = object()
requested = m.get('mode_until', _UNSET)
if requested is _UNSET and m.get('mode_until_hours') is not None:
    try:
        hours = float(m.get('mode_until_hours'))
    except Exception:
        hours = 0.0
    if hours > 0:
        from datetime import datetime, timedelta, timezone
        ends = datetime.now(timezone.utc) + timedelta(hours=hours)
        requested = ends.replace(microsecond=0).isoformat()
    else:
        requested = None      # 0 ore = «senza scadenza», non «scaduta subito»
if isinstance(requested, str) and not requested.strip():
    requested = None
if requested is not None and requested is not _UNSET:
    requested = requested.strip() if isinstance(requested, str) else None
    if requested is None:
        print(json.dumps({'ok': False, 'error': 'mode_until must be an ISO 8601 '
                          'date/time, null to clear it'}))
        raise SystemExit(1)
    if mode_deadline is None:
        print(json.dumps({'ok': False, 'error': 'this container image does not '
                          'evaluate mode deadlines yet (mode_deadline.py '
                          'missing): a deadline written now would never fire'}))
        raise SystemExit(1)
    if mode_deadline.parse_deadline(requested) is None:
        # Concatenazione e non formattazione: TUTTO questo file è un template
        # che il gioco interpola col segno di percentuale (il JSON base64 in
        # cima), quindi un secondo segno qui dentro romperebbe il payload.
        print(json.dumps({'ok': False, 'error': repr(requested) + ' is not an '
                          'ISO 8601 date/time (e.g. 2026-08-10T18:00:00Z)'},
                         ensure_ascii=False))
        raise SystemExit(1)


def carry_deadline(payload):
    if requested is not _UNSET:
        # La Console ha parlato: una scadenza nuova, o nessuna scadenza.
        if requested is not None:
            payload['mode_until'] = requested
        return payload
    until = current.get('mode_until')
    if not (isinstance(until, str) and until.strip()):
        return payload
    until = until.strip()
    # Una scadenza GIÀ PASSATA non si porta dietro: la Console la mostra come
    # «niente scadenza» (la modalità è finita, il campo è spento), e riscriverla
    # nel file darebbe alla modalità appena scelta una fine già avvenuta — nata
    # morta, e di nuovo un file che dice una cosa diversa dall'interfaccia. Se
    # questa immagine non sa valutare le scadenze, si preserva: non poter dire
    # se è passata non autorizza a buttarla.
    if mode_deadline is not None:
        parsed = mode_deadline.parse_deadline(until)
        if parsed is not None and mode_deadline.is_expired(parsed):
            return payload
    payload['mode_until'] = until
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
