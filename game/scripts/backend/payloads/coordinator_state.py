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
mode_until = maintenance_raw.get('mode_until') \
    if isinstance(maintenance_raw, dict) else None
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
    # in nessuno dei due casi si può dire all'utente che la sua data è
    # illeggibile.
    'mode_until_valid': (deadline is not None)
                        if (mode_until and mode_deadline) else None,
    'mode_until_in': (mode_deadline.remaining_text(deadline)
                      if (deadline is not None and mode_deadline) else ''),
    # Lo stesso dato in secondi, perché la Console precompila con questo il
    # campo «fino a quando»: un delta non richiede che host e container
    # concordino sul fuso (la scelta di `remaining_sec` della deroga di spesa).
    # `getattr`: l'helper è più nuovo del modulo, e un'immagine container a
    # metà rolling deploy può avere il secondo senza il primo.
    'mode_until_sec': (getattr(mode_deadline, 'remaining_seconds',
                               lambda *_a, **_k: 0)(deadline)
                       if (deadline is not None and mode_deadline) else 0),
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

# Gli stati della pipeline si contano qui: sono `positions.status`, non code —
# nessun predicato condiviso da rispettare, nessuna policy che li spenga.
queue_counts = {
    'new': count("SELECT COUNT(*) FROM positions WHERE status='new'"),
    'analysis': count("SELECT COUNT(*) FROM positions WHERE status='checked'"),
    'scored': count("SELECT COUNT(*) FROM positions WHERE status='scored'"),
    'expired': count("SELECT COUNT(*) FROM positions WHERE status!='excluded' AND expires_at IS NOT NULL AND expires_at < datetime('now')"),
}

# Le CODE invece si CHIEDONO, non si ricontano ([CONSOLE-COUNTS-INLINE-SQL]).
# Qui c'era una copia dell'SQL di ognuna, e le copie divergono: quella del
# recheck guardava solo `last_checked` e ignorava `last_open_check`, quindi
# contava come da rifare posizioni già verificate — lo stesso errore che
# `LAST_VERIFIED_SQL` aveva corretto nella coda vera. E nessuna copia
# conosceva il gate della policy, quindi in risparmio (o con l'automatismo
# spento) la Console annunciava lavoro che nessuno avrebbe fatto.
#
# `db_query.queue_total` è la risposta della coda stessa: stesso predicato,
# stesso gate. `None` = coda SPENTA, e vale 0 lavori in attesa.
#
# Import tollerante (rolling deploy: il gioco può essere più nuovo
# dell'immagine): se questa immagine non sa rispondere, la chiave NON viene
# mandata affatto e la Console mostra «—». Meglio nessun numero che il numero
# sbagliato — è il motivo per cui questa riga esiste.
try:
    import db_query
except Exception:
    db_query = None
QUEUE_CARDS = (('geocode', 'geocode-missing'), ('logos', 'logo-missing'),
               ('recheck', 'recheck-due'), ('harvest', 'harvest'),
               ('calibration', 'calibration'))
for card, queue in QUEUE_CARDS:
    if db_query is None or not hasattr(db_query, 'queue_total'):
        continue
    try:
        total = db_query.queue_total(conn, queue)
    except Exception:
        continue
    queue_counts[card] = 0 if total is None else int(total)

directives = []
for row in conn.execute("SELECT id,body,kind,status,sort_order,created_at,updated_at "
                        "FROM team_directives WHERE status='active' "
                        "ORDER BY sort_order,created_at"):
    directives.append(dict(row))
conn.close()
print(json.dumps({'ok': True, 'maintenance': maintenance,
                  'enrichment': enrichment, 'queue_counts': queue_counts,
                  'directives': directives}, ensure_ascii=False))
