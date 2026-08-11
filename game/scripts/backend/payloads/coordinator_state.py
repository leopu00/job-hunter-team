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
# Modalità di lavoro (enum chiuso 2026-08): search|harvest|care|calibration|
# saving. File assente = search; 'maintenance' resta valido ( = care, file
# scritti da versioni precedenti / andris). Normalizzato QUI e non importando
# enrichment_policy.current_mode: il gioco può essere più nuovo dell'immagine
# container per qualche minuto (rolling deploy) e l'helper potrebbe non
# esserci ancora. Un valore fuori enum degrada a 'search' SOLO per la UI: la
# Console deve comunque mostrare uno stato selezionabile — il freno di spesa
# (enrichment_policy) lo tratta invece come sospensione, lato container.
WORK_MODES = ('search', 'harvest', 'care', 'calibration', 'saving')
raw_mode = maintenance_raw.get('mode') if isinstance(maintenance_raw, dict) else None
if raw_mode == 'maintenance':
    raw_mode = 'care'
mode_raw = raw_mode if raw_mode in WORK_MODES else 'search'

# Scadenza della modalità ([SAVING-MODE-HAS-NO-DEADLINE]): la chiave opzionale
# `mode_until` dice fino a quando vale l'ordine, e si valuta IN LETTURA —
# nessun demone riscrive il file, quindi ogni lettore deve concluderne la
# stessa cosa nello stesso istante. La meccanica vive in mode_deadline.py e la
# condividono `enrichment_policy.current_mode()` e `mode_banner`: qui si
# IMPORTA, non si reimplementa, altrimenti la Console e il freno di spesa
# raccontano due modalità diverse appena una delle due copie deriva.
# L'import è tollerante come in mode_banner: durante un rolling deploy il gioco
# può essere più nuovo dell'immagine container, e senza il modulo la scadenza
# semplicemente non si applica — resta in vigore la modalità scritta, che è il
# comportamento storico e la direzione sicura per un ordine di spesa.
try:
    import mode_deadline
except Exception:
    mode_deadline = None
mode_until = maintenance_raw.get('mode_until') if isinstance(maintenance_raw, dict) else None
if not isinstance(mode_until, str) or not mode_until.strip():
    mode_until = None
else:
    mode_until = mode_until.strip()
deadline = mode_deadline.parse_deadline(mode_until) \
    if (mode_until and mode_deadline is not None) else None
mode, expired = (mode_deadline.effective_mode(mode_raw, deadline)
                 if mode_deadline is not None else (mode_raw, False))
if expired:
    # Scadono anche gli `orders` di quella modalità: «cura fino a venerdì» è UN
    # ordine con una fine, e lasciare in piedi `stop_search` dopo la scadenza
    # significherebbe tornare a `search` e non cercare comunque.
    orders = {}
maintenance = {
    # `mode` è quella IN VIGORE ADESSO, non quella scritta sul file: ruoli
    # invertiti rispetto a `coordinator_settings.read_state()` (dove `mode` è
    # il grezzo) e di proposito, perché qui il lettore è una UI — anche una
    # build vecchia del gioco, che conosce solo questa chiave, deve mostrare la
    # modalità vera invece di una `saving` finita ore prima. Il grezzo resta
    # accanto, per poter dire all'utente COSA è scaduto.
    'mode': mode,
    'mode_raw': mode_raw,
    'expired': expired,
    'mode_until': mode_until,
    # None = non c'è scadenza, o questa immagine non sa ancora valutarne una:
    # in nessuno dei due casi si può dire all'utente che la sua data è illeggibile.
    'mode_until_valid': (deadline is not None) if (mode_until and mode_deadline) else None,
    'mode_until_in': (mode_deadline.remaining_text(deadline)
                      if (deadline is not None and mode_deadline) else ''),
    # Compat col vecchio toggle binario (client che leggono ancora 'enabled').
    'enabled': mode == 'care',
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

# Dati a supporto del selettore modalità (stessa semantica delle code
# `next-for-harvest` / `next-for-calibration` di db_query.py; soglia 75 =
# HARVEST_MIN_SCORE, la leva misurata del burn weekly). SQL replicato come
# per geo/logo/recheck qui sopra: il payload deve girare anche su un'immagine
# container che non conosce ancora le code nuove.
queue_counts['harvest'] = count(
    "SELECT COUNT(*) FROM positions p "
    "JOIN (SELECT position_id, MAX(total_score) AS total_score "
    "      FROM scores GROUP BY position_id) s ON s.position_id=p.id "
    "LEFT JOIN applications a ON a.position_id=p.id "
    "WHERE a.id IS NULL AND p.status='scored' AND s.total_score>=75 "
    "AND COALESCE(p.is_open,1)!=0 "
    "AND (p.expires_at IS NULL OR p.expires_at>=date('now'))")
calibration_wm = '1970-01-01 00:00:00'
try:
    _wm = json.load(open(os.path.join(profile, 'calibration-watermark.json'),
                         encoding='utf-8'))
    if isinstance(_wm, dict) and isinstance(_wm.get('consumed_through'), str) \
            and _wm['consumed_through'].strip():
        calibration_wm = _wm['consumed_through'].strip()
except Exception:
    pass  # file assente/corrotto = epoch: si RIPRESENTA tutto, mai il contrario
queue_counts['calibration'] = count(
    "SELECT (SELECT COUNT(*) FROM positions "
    "        WHERE user_excluded_at IS NOT NULL AND user_excluded_at > ?) "
    "     + (SELECT COUNT(*) FROM position_tickets WHERE created_at > ?)",
    (calibration_wm, calibration_wm))

directives = []
for row in conn.execute("SELECT id,body,kind,status,sort_order,created_at,updated_at "
                        "FROM team_directives WHERE status='active' "
                        "ORDER BY sort_order,created_at"):
    directives.append(dict(row))
conn.close()
print(json.dumps({'ok': True, 'maintenance': maintenance,
                  'enrichment': enrichment, 'queue_counts': queue_counts,
                  'directives': directives}, ensure_ascii=False))
