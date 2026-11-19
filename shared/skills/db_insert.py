#!/usr/bin/env python3
"""Inserisce dati nel database jobs.db (schema V2).

Uso:
  python3 db_insert.py position --title "X" --company "Y" --url "Z" --source linkedin --found-by scout-1
  python3 db_insert.py company --name "X" --verdict GO --analyzed-by analista-1
  python3 db_insert.py score --position-id 42 --total 85 --scored-by scorer
  python3 db_insert.py application --position-id 42 --cv-path "..." --written-by scrittore-1
  python3 db_insert.py highlight --position-id 42 --type pro --text "Stack identico"

Salary (V2 — dichiarato vs stimato):
  python3 db_insert.py position --title "X" --company "Y" --url "Z" --salary-declared-min 40000 --salary-declared-max 55000
  python3 db_insert.py position --title "X" --company "Y" --url "Z" --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor
"""

import argparse
import re
import sqlite3
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, resolve_company_id, link_positions_to_company
from profile_gate import check_minimum_viable_profile
from score_ranges import COMPONENT_LIMITS, SCORE_COMPONENT_LABELS, TOTAL_LIMIT
from external_content import (
    EXTERNAL_BLOCK_FIELDS,
    EXTERNAL_INLINE_FIELDS,
    normalize_external_inline_fields,
)
import maintenance_log
from company_about import clean_about
import profile_exclusions
import first_run
import event_wake

# I flag di `db_insert.py position` che NON vengono dalla pagina: li sceglie
# un agente nostro (o argparse, con `choices`/`type=int`). Gli altri sono
# elencati in `external_content.EXTERNAL_*`, e insieme devono coprire TUTTI i
# flag del comando: `tests/test_external_content_fencing.py` lo verifica, così
# un campo nuovo non può entrare senza che qualcuno abbia deciso da dove viene.
POSITION_INTERNAL_FIELDS = (
    "remote_type",
    "salary_declared_min",
    "salary_declared_max",
    "salary_declared_currency",
    "salary_estimated_min",
    "salary_estimated_max",
    "salary_estimated_currency",
    "salary_estimated_source",
    "found_by",
    "notes",
)

# Campi di uno score che, cambiando, dicono che la rivalutazione è avvenuta.
# `scored_by` e i timestamp restano fuori: cambiano anche quando il giudizio
# è identico, e includerli farebbe passare per `updated` ogni ricopiatura.
SCORE_TRACKED_FIELDS = (
    "total_score", "stack_match", "remote_fit", "salary_fit",
    "experience_fit", "strategic_fit", "breakdown", "notes",
)


def _snapshot_score(conn, position_id):
    """Score corrente della posizione. `{}` se non è mai stata valutata."""
    row = conn.execute(
        f"SELECT {', '.join(SCORE_TRACKED_FIELDS)} FROM scores "
        "WHERE position_id = ?", (position_id,)
    ).fetchone()
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return {f: row[f] for f in SCORE_TRACKED_FIELDS}
    return dict(zip(SCORE_TRACKED_FIELDS, row))


def extract_linkedin_job_id(url):
    """Estrae l'ID numerico da URL LinkedIn (es. linkedin.com/jobs/view/4381470286).

    L'id sta nel PATH. Un `currentJobId=` nella query string non e' l'id di
    questo annuncio: e' l'annuncio che l'utente stava guardando quando ha
    aperto il link, e la regex non lo guarda apposta.
    """
    if not url:
        return None
    match = re.search(r'linkedin\.com/jobs/view/(\d+)', url)
    return match.group(1) if match else None


def _title_similarity(a, b):
    """Ratio Levenshtein via difflib (stdlib). 1.0 = identico, 0.0 = nessun overlap."""
    try:
        from difflib import SequenceMatcher
    except ImportError:
        return 0.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


from city_names import (
    normalize_city as _normalize_city,
    canonical_city as _normalize_city_canonical,
    same_place as _same_place,
    share_a_place as _share_a_place,
    CITY_SYNONYMS as _CITY_SYNONYMS,
)


def _log_dedup_skip(level, existing_id, skipped_url, company, title):
    """Append-only JSONL audit dei skip dedup (bug #25).

    Mai bloccare l'INSERT su errore di logging: se /jht_home/logs/ non
    esiste o non è scrivibile, prosegui silenzioso. La policy dedup è
    nell'exit code di check_duplicate, non in questa append.
    """
    try:
        import json
        from datetime import datetime, timezone
        log_dir = os.path.join(os.environ.get('JHT_HOME', '/jht_home'), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "scout": os.environ.get('JHT_AGENT_NAME', 'unknown'),
            "level": level,
            "existing_id": existing_id,
            "skipped_url": skipped_url or "",
            "company": company or "",
            "title": title or "",
        }
        with open(os.path.join(log_dir, 'scout-dedup.log'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + "\n")
    except (OSError, ValueError):
        pass


SKIP_LOG_READ_BYTES = 256 * 1024   # tetto alla lettura di scout-dedup.log: la coda, mai il file intero


def _urls_refused_before(url):
    """[(existing_id, "YYYY-MM-DD HH:MM:SS"), ...] dei rifiuti di questo URL per nome (livelli 2 e 3) nella coda di scout-dedup.log, dal piu'
    recente. Il log e' un'audit, non una fonte: mancante, illeggibile, righe rotte o file enorme = lista vuota o parziale, mai un errore."""
    import json
    found = []
    try:
        path = os.path.join(os.environ.get('JHT_HOME', '/jht_home'), 'logs', 'scout-dedup.log')
        with open(path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - SKIP_LOG_READ_BYTES))
            tail = f.read(SKIP_LOG_READ_BYTES)
        lines = tail.decode('utf-8', errors='replace').splitlines()
        if size > SKIP_LOG_READ_BYTES:
            lines = lines[1:]   # la prima riga della coda e' tagliata a meta'
        for line in reversed(lines):
            try:
                entry = json.loads(line)
                if entry.get('skipped_url') == url and entry.get('level') in (2, 3):
                    found.append((int(entry['existing_id']), str(entry['ts']).replace('T', ' ')[:19]))
            except (ValueError, TypeError, KeyError, AttributeError):
                continue
    except (OSError, ValueError):
        return []
    return found


def check_duplicate(conn, url, company, title, location=None):
    """Dedup gerarchica a 4 livelli, 0-3 (bug #25 / SC-05).

    Ritorna (existing_row, match_type) — sys.exit gestito dal caller.
    Manteniamo `LinkedIn job ID` come Livello 0 (era già attivo prima
    del fix): è la regola più affidabile quando l'URL è LinkedIn-shaped,
    perché lo stesso annuncio circola con URL diversi. Il match è ancorato
    al segmento `/jobs/view/<id>` e riconfermato sull'id estratto dal path
    del candidato: dedup sì, sottostringa no.

    Livello 1 — URL esatto.
    Livello 2 — Azienda + titolo identici + location uguale (o entrambe NULL/'').
                Stesso ruolo dalla stessa azienda nella stessa città =
                riskinning su altro provider. NON skip se city differisce
                (Milano vs Berlino sono offerte distinte). Un luogo vuoto in
                una delle due righe conta come lo stesso luogo; la provincia
                fra parentesi («Gioia del Colle (BA)») non fa un luogo diverso.
    Livello 3 — Azienda + titolo SIMILE (ratio difflib > 0.85) + location uguale.
                Cattura "Junior Software Engineer" vs "Software Engineer, Junior".

    Match include positions con status='excluded': re-inserirne una è
    spreco di token Scout (la verifica + dedup ripartirebbero da zero).
    """
    # Livello 0 (storico) — LinkedIn job ID
    #
    # Il LIKE e' un PREFILTRO, non il verdetto. Un `LIKE '%<id>%'` non sa dove
    # l'id finisce: cercando 4381470286 pescava la riga il cui id e'
    # 43814702861, e una posizione NUOVA veniva scartata come doppione — con
    # il log a dire che era un doppione. Latente finche' gli id LinkedIn hanno
    # 10 cifre, sistematico all'undicesima, immediato se un URL salvato porta
    # un altro `currentJobId=` in query string (l'id lo leggiamo dal path, il
    # LIKE scandiva tutta la stringa).
    #
    # Ancoriamo su due lati: il prefiltro chiede il segmento `/jobs/view/<id>`
    # (nessun URL da cui `extract_linkedin_job_id` ritorni <id> puo' non
    # contenerlo, quindi non perdiamo candidati), e ogni candidato viene poi
    # CONFERMATO riestraendo l'id dal suo path con la stessa funzione. Il
    # match vale solo se i due id sono lo stesso id — che e' la definizione
    # del livello 0. `fetchall` e non `fetchone`: il duplicato vero puo'
    # arrivare dopo un candidato che il prefiltro ha preso di striscio.
    linkedin_id = extract_linkedin_job_id(url)
    if linkedin_id:
        # `linkedin_id` e' \d+ e il prefisso e' letterale: nessun carattere
        # speciale di LIKE (% _) puo' finire nel pattern.
        candidates_l0 = conn.execute(
            "SELECT id, title, company, url FROM positions WHERE url LIKE ?",
            (f'%/jobs/view/{linkedin_id}%',)
        ).fetchall()
        for cand in candidates_l0:
            if extract_linkedin_job_id(cand['url']) == linkedin_id:
                _log_dedup_skip(0, cand['id'], url, company, title)
                return cand, f"LinkedIn job ID {linkedin_id}"

    # Livello 1 — URL esatto
    if url:
        existing = conn.execute(
            "SELECT id, title, company FROM positions WHERE url = ?",
            (url,)
        ).fetchone()
        if existing:
            _log_dedup_skip(1, existing['id'], url, company, title)
            return existing, "URL esatto"

    # Un URL gia' rifiutato come doppione per NOME (livelli 2 e 3) resta rifiutato: ripresentato con altri nomi (un'altra grafia
    # dell'azienda, un titolo allungato) e' lo stesso annuncio. Misurato 19/11 (banco magazziniere): l'URL rifiutato al livello 2 alle
    # 17:10:38 e' entrato alle 17:11:04 con un'azienda e un titolo diversi. Non i rifiuti per TESTO (livello 4): il testo di un'agenzia
    # e' in gran parte lo stesso modulo (un OSS rifiutato come l'infermiere dello stesso hospice, stesso banco) e rinominarlo e' la
    # via d'uscita di un falso positivo. Lo legge dal log degli skip; un log mancante, illeggibile o troppo grande non cambia niente
    # (mai bloccare un INSERT per un log rotto).
    if url:
        for existing_id, refused_at in _urls_refused_before(url):
            try:
                cand = conn.execute("SELECT id, title, company, location, created_at FROM positions WHERE id = ?",
                                    (existing_id,)).fetchone()
            except sqlite3.Error:
                cand = None
            # la riga deve esistere ed essere piu' vecchia del rifiuto: un log di un db precedente (stessi numeri di id) non conta
            if cand and str(cand['created_at'] or '')[:19] <= refused_at:
                _log_dedup_skip(1, cand['id'], url, company, title)
                return cand, "URL gia' rifiutato come doppione"

    # Livello 2 — azienda + titolo + city normalizzata (primo token + synonym map)
    # Address vps1-postmortem anomalia #3: 'Milan, Italy' vs 'Milan, Lombardy, IT'
    # vs 'Milano, IT' devono matchare. Carichiamo i candidati per azienda+titolo
    # e confrontiamo i luoghi in Python con _same_place (SQL non ha la synonym map):
    # «Gioia del Colle (BA)», «Gioia del Colle, Bari» e «Gioia del Colle» sono lo
    # stesso luogo, e un luogo vuoto non e' un luogo diverso.
    if company and title:
        candidates_l2 = conn.execute(
            "SELECT id, title, company, location FROM positions "
            "WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)",
            (company, title)
        ).fetchall()
        for cand in candidates_l2:
            if _same_place(cand['location'], location):
                _log_dedup_skip(2, cand['id'], url, company, title)
                return cand, "azienda+titolo+city-norm"

    # Livello 3 — azienda + titolo simile (>0.85) + city normalizzata
    if company and title:
        candidates_l3 = conn.execute(
            "SELECT id, title, company, location FROM positions "
            "WHERE LOWER(company) = LOWER(?)",
            (company,)
        ).fetchall()
        for cand in candidates_l3:
            if not _same_place(cand['location'], location):
                continue
            if _title_similarity(title, cand['title']) > 0.85:
                _log_dedup_skip(3, cand['id'], url, company, title)
                return cand, "azienda+titolo simile+city-norm"

    return None, None


# Non e' un'offerta di lavoro (build11, banco cuoco 17/11): un franchising, un'attivita' in vendita, un lead. Lo Scout lo ha inserito
# scrivendo lui stesso nelle note «non un contratto dipendente» / «lead marketplace, non posizione di lavoro»: l'INSERT lo rifiuta
# quando il titolo e' di quel tipo o le note lo dicono. Solo frasi precise: «Responsabile franchising» e' un lavoro.
NOT_A_JOB_EXIT = 6
_NOT_A_JOB_TITLE = re.compile(
    r"opportunit[aà]\s+(?:di\s+)?(?:franchising|business|investimento|affiliazione)|franchis(?:e|ing)\s+opportunity|business\s+opportunity|"
    r"\b(?:cedesi|vendesi)\b|apri\s+(?:il\s+)?tuo\s+(?:negozio|locale|punto vendita)|diventa\s+(?:un\s+)?(?:imprenditore|affiliato|franchisee)",
    re.I)
_NOT_A_JOB_NOTES = re.compile(
    r"non\s+(?:[eè]\s+)?(?:un[ao']?\s+)?(?:posizione|offerta|annuncio)\s+di\s+lavoro|non\s+[eè]\s+un\s+lavoro|"
    r"not\s+a\s+job(?:\s+(?:offer|position|ad))?|no\s+es\s+(?:un\s+)?(?:trabajo|empleo|oferta\s+de\s+trabajo)|"
    r"n'est\s+pas\s+(?:un\s+)?(?:emploi|poste|offre\s+d'emploi)|keine\s+stelle|kein\s+stellenangebot|lead\s+marketplace", re.I)


def not_a_job(title, notes):
    """The phrase that says an ad is not a job, from its title or from the Scout's own notes, or None."""
    for text, pattern in ((title, _NOT_A_JOB_TITLE), (notes, _NOT_A_JOB_NOTES)):
        found = pattern.search(str(text or ""))
        if found:
            return found.group(0)
    return None


# Livello 4 — lo STESSO annuncio ripubblicato da un'altra fonte. Un aggregatore (talent.com) rilancia l'annuncio di un'agenzia con
# un'altra azienda («Randstad Healthcare» per «Randstad Professional Italia»), un altro titolo («infermiere» per «Infermiere per
# centro di riabilitazione Torino») e un altro URL: azienda+titolo non lo riconosce, il TESTO si'. Misurato 17/11 (banco build9,
# un'infermiera a Torino): lo stesso annuncio Randstad inserito due volte, da randstad.it e da talent.com.
JD_SHINGLE_WORDS = 6        # parole per impronta
JD_MIN_WORDS = 40           # sotto questa lunghezza un testo e' un modulo, non un annuncio: non si confronta
JD_WINDOW_WORDS = 500       # si confronta l'inizio: l'aggregatore a volte aggiunge o toglie la coda
JD_OVERLAP = 0.7            # quota delle impronte del testo piu' corto che il piu' lungo ha uguali


def _jd_shingles(text):
    """L'insieme delle impronte di sei parole consecutive dell'inizio del testo, o None se il testo e' troppo corto."""
    import unicodedata
    folded = "".join(c for c in unicodedata.normalize("NFKD", str(text or "").casefold()) if not unicodedata.combining(c))
    words = re.findall(r"[^\W_]+", folded, re.UNICODE)[:JD_WINDOW_WORDS]
    if len(words) < JD_MIN_WORDS:
        return None
    return {tuple(words[i:i + JD_SHINGLE_WORDS]) for i in range(len(words) - JD_SHINGLE_WORDS + 1)}


JD_OVERLAP_SAME_TITLE = 0.6  # con lo stesso titolo basta meno testo in comune: lo Scout a volte salva un riassunto, non il testo intero


def _title_words(title):
    """Il titolo come parole: senza maiuscole, accenti, parentesi («(m/f/nb)») e punteggiatura."""
    from city_names import _folded_words
    return tuple(_folded_words(re.sub(r"\([^)]*\)", " ", str(title or ""))))


def check_duplicate_text(conn, jd_text, location=None, title=None):
    """Livello 4: stesso TESTO dell'annuncio (impronte di sei parole, almeno il 70% in comune) e stessa citta'.

    Lo stesso testo in citta' diverse e' un'offerta diversa (il modulo di una filiale), per questo la citta' conta come per i
    livelli 2 e 3, ma qui e' lo stesso luogo anche quando un nome dell'uno sta intero nell'altro («Torino» in «Rivalta di Torino»,
    «Rimini» in «Coriano (Rimini)»): le fonti scrivono il luogo come vogliono, il testo e' lo stesso. Con lo stesso titolo il testo in
    comune puo' essere il 60%. Ritorna (riga, tipo di match) o (None, None); senza testo, o troppo corto, non decide niente."""
    mine = _jd_shingles(jd_text)
    if not mine:
        return None, None
    mine_title = _title_words(title)
    rows = conn.execute(
        "SELECT id, title, company, location, SUBSTR(jd_text, 1, 6000) AS jd FROM positions "
        "WHERE jd_text IS NOT NULL AND LENGTH(jd_text) >= 200").fetchall()
    for cand in rows:
        if not (_same_place(cand['location'], location) or _share_a_place(cand['location'], location)):
            continue
        theirs = _jd_shingles(cand['jd'])
        if not theirs:
            continue
        need = JD_OVERLAP_SAME_TITLE if (mine_title and mine_title == _title_words(cand['title'])) else JD_OVERLAP
        if len(mine & theirs) >= need * min(len(mine), len(theirs)):
            return cand, "testo dell'annuncio+city-norm"
    return None, None


def _rollback_quietly(conn):
    """ROLLBACK che non copre l'errore vero se la transazione è già chiusa."""
    try:
        conn.execute("ROLLBACK")
    except sqlite3.Error:
        pass


def _estimated_currency(args):
    """The currency of the rough estimate: only with an amount. A currency with nothing to measure is not a fact (it read as «EUR»
    on every position, estimated or not): without amounts it is NULL, the one way to say «absent»."""
    if args.salary_estimated_min is None and args.salary_estimated_max is None:
        return None
    return args.salary_estimated_currency or 'EUR'


def insert_position(args):
    # Prima di tutto il resto, compreso il dedup: titolo, azienda, location,
    # URL, fonte e scadenza arrivano dalla pagina scrapata, e da qui in avanti
    # devono essere una riga sola. Un a capo dentro un titolo non è un dettaglio
    # di formattazione — è il pezzo che permette a un annuncio di ridisegnare
    # l'intestazione che l'agente legge come testo nostro.
    normalize_external_inline_fields(args)

    conn = get_db()
    ensure_schema(conn)

    # Dedup e INSERT sono UNA transazione, non due momenti scollegati.
    #
    # Il check-then-insert nudo lascia una finestra fra il SELECT e l'INSERT:
    # due Scout sulla stessa fonte guardano entrambi un DB in cui la posizione
    # non c'è ancora, e la scrivono tutti e due. Oggi non capita perché C-21
    # divide i territori, ma è esattamente la configurazione che
    # [SOURCE-YIELD-MEMORY] vuole valutare (due Scout insieme su LinkedIn):
    # il vincolo va messo prima che quella configurazione arrivi.
    #
    # `BEGIN IMMEDIATE` prende il lock di scrittura SUBITO, non al primo
    # INSERT: il secondo processo si mette in coda (busy timeout 10s, vedi
    # get_db) e quando entra il suo SELECT vede già la riga dell'altro, quindi
    # riporta un duplicato invece di crearne uno. `isolation_level = None`
    # toglie di mezzo la gestione implicita di sqlite3 e ci lascia il
    # controllo esplicito di BEGIN/COMMIT/ROLLBACK.
    conn.isolation_level = None
    conn.execute("BEGIN IMMEDIATE")
    try:
        # Il tetto del primo passaggio (first_run.sourcing_cap): durante il burst del primo avvio uno Scout non
        # inserisce oltre `scout_cap_first_pass`. Il conto si legge QUI, dentro la transazione, cosi' due Scout
        # non si prendono insieme l'ultimo posto; lo scrive il codice, non dipende da un messaggio del Capitano.
        actor = os.environ.get('JHT_AGENT_NAME') or args.found_by or 'unknown'
        # Either name is enough to hold the cap: a Scout that declares another --found-by is still the Scout that
        # the environment says it is (and the other way round). It is a control of cost, not a boundary.
        if first_run.is_scout(actor) or first_run.is_scout(args.found_by):
            cap = first_run.sourcing_cap(conn)
            if cap and cap["reached"]:
                _rollback_quietly(conn)
                conn.close()
                print(f"FIRST_PASS_CAP_REACHED: {cap['found']}/{cap['cap']} positions found in the first pass. "
                      "INSERT refused. STOP sourcing: do not look for more positions and do not insert this one. "
                      "Tell the Capitano in one line that your share is done, then throttle at the maximum "
                      "(jht-throttle) and wait: the Analista and the Scorer have the positions to work on.")
                sys.exit(3)
        # L'area del profilo: uno Scout non inserisce un annuncio onsite o ibrido in un altro paese per chi vive altrove, vuole
        # remoto o ibrido e non ha detto di volersi trasferire (scout_area.py: solo il PROVATO, ogni dubbio e' «ok»). Misurato
        # 11/11: 19 posizioni su 30 scartate dall'Analista per questo, ognuna con la sua ricerca, il suo INSERT e la sua analisi.
        if first_run.is_scout(actor) or first_run.is_scout(args.found_by):
            import scout_area
            area = scout_area.check_position(getattr(args, 'location', None), getattr(args, 'remote_type', None))
            if area["verdict"] == "outside":
                _rollback_quietly(conn)
                conn.close()
                print(f"AREA_MISMATCH: {area['reason']}. INSERT refused: do not insert this position and do not look for more of "
                      "the same kind (the same portal and country). Take the next candidate. If the ad is in fact "
                      "remote, or its place is the profile's, correct --remote-type or --location and insert it again.")
                sys.exit(4)
        # Il mestiere del profilo (SC-04, quinto rifiuto meccanico): titolo e requisiti senza nessuna parola della famiglia del
        # mestiere che lo Scout ha dichiarato = fuori mestiere. Misurato 16/11: 22 posizioni su 32 di un altro mestiere per un
        # muratore, ognuna con il suo INSERT, la sua analisi, il suo punteggio. Ogni dubbio e' «ok» (scout_role.py).
        role_nudge = None
        if first_run.is_scout(actor) or first_run.is_scout(args.found_by):
            import scout_role
            role = scout_role.check_position(args.title, getattr(args, 'requirements', None))
            if role["verdict"] == "mismatch":
                _rollback_quietly(conn)
                conn.close()
                print(f"ROLE_MISMATCH: {role['reason']} (profile's role: {'; '.join(role['roles'])}). INSERT refused: do not insert "
                      "this position and take the next candidate; do not keep searching the same list for it. If its title names "
                      "your trade in other words, declare that word (scout_role.py declare --term ...) and insert it again.")
                sys.exit(5)
            if role["verdict"] == "terms_missing":
                # not a refusal: a position is never refused for a step the Scout has not done yet (a doubt is «ok»). The Scout is
                # told after the INSERT, in the line it reads, and `scout_coverage.py next` asks for the declaration first.
                role_nudge = (f"ROLE_FAMILY_NOT_DECLARED: the profile has a role ({'; '.join(role['roles'])}) and the family of the trade "
                              f"is not declared, so nothing off-trade is stopped. Declare it ONCE: {scout_role.declare_hint(role['roles'])}")
        # Non e' un lavoro: franchising, attivita' in vendita, lead (lo dice il titolo o le note dello Scout stesso).
        if first_run.is_scout(actor) or first_run.is_scout(args.found_by):
            phrase = not_a_job(args.title, getattr(args, 'notes', None))
            if phrase:
                _rollback_quietly(conn)
                conn.close()
                print(f"NOT_A_JOB: «{phrase}»: this is not a job offer (a franchise, a business for sale, a lead, a paid course). INSERT "
                      "refused: do not insert it, log it with reason `other` and take the next candidate. If it IS a job and the words "
                      "are only in your notes, take them out of --notes and insert it again.")
                sys.exit(NOT_A_JOB_EXIT)
        # Check duplicati PRIMA dell'inserimento (bug #25 SC-05: 4 livelli)
        existing, match_type = check_duplicate(
            conn, args.url, args.company, args.title, getattr(args, 'location', None),
        )
        if not existing:
            existing, match_type = check_duplicate_text(conn, getattr(args, 'jd_text', None), getattr(args, 'location', None),
                                                        args.title)
            if existing:
                _log_dedup_skip(4, existing['id'], args.url, args.company, args.title)
        if existing:
            _rollback_quietly(conn)
            print(f"⚠️  DUPLICATE ({match_type}): '{args.company} — {args.title}' already exists as #{existing['id']} ({existing['company']} — {existing['title']}). INSERT aborted.")
            conn.close()
            sys.exit(1)

        # Auto-resolve company_id
        company_id = resolve_company_id(conn, args.company)

        # Il paese della posizione, dal solo testo dello Scout: quello che il luogo nomina, un luogo scritto all'italiana
        # («Bra (CN), Piemonte») o il paese del portale (talent-com-it, randstad.it). Prima restava vuoto fino all'Analista
        # (banco build9: 26 posizioni nuove su 28 senza paese). Senza prove resta vuoto, mai indovinato dalla citta' (i nomi
        # di citta' non implicano un paese, city_names.py).
        import scout_area
        country_code = scout_area.derive_country(getattr(args, 'location', None), args.source, args.url)
        country_name = scout_area.country_name(country_code) if country_code else None

        cur = conn.execute("""
            INSERT INTO positions (title, company, company_id, location, loc_country, loc_country_code,
                                   remote_type,
                                   salary_declared_min, salary_declared_max, salary_declared_currency,
                                   salary_estimated_min, salary_estimated_max, salary_estimated_currency,
                                   salary_estimated_source,
                                   url, source, jd_text, requirements,
                                   found_by, deadline, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (args.title, args.company, company_id, args.location, country_name, country_code.upper() if country_code else None,
              args.remote_type,
              args.salary_declared_min, args.salary_declared_max, args.salary_declared_currency or 'EUR',
              args.salary_estimated_min, args.salary_estimated_max, _estimated_currency(args),
              args.salary_estimated_source,
              args.url, args.source, args.jd_text,
              args.requirements, args.found_by, args.deadline, args.notes))

        # Bug #14: log la transizione iniziale (None → 'new') con by_agent =
        # JHT_AGENT_NAME (es. scout-1). Senza questa entry il funnel parte
        # da "scored" come stato visibile più antico — pessimo per metriche
        # di throughput a livello pipeline.
        position_id = cur.lastrowid
        conn.execute(
            "INSERT INTO position_state_transitions "
            "(position_id, from_state, to_state, by_agent, notes) "
            "VALUES (?, NULL, 'new', ?, ?)",
            (position_id, actor, 'initial INSERT'),
        )
        conn.execute("COMMIT")
    except SystemExit:
        raise
    except sqlite3.IntegrityError as exc:
        _rollback_quietly(conn)
        # L'indice unico su `positions.url` è l'ultima parola sulla race, non
        # la prima: con BEGIN IMMEDIATE non dovrebbe mai scattare da questo
        # percorso. Se scatta, qualcuno ha scritto lo stesso URL fuori dal
        # wrapper — trattiamolo come il duplicato che è, non come un crash.
        # Gli altri IntegrityError (i CHECK di lunghezza su title/company/
        # location, mig 015) devono invece restare visibili: sono bug di
        # parsing dello Scout e vanno letti nel suo turno.
        if 'UNIQUE' not in str(exc).upper():
            conn.close()
            raise
        print(f"⚠️  DUPLICATE (URL already exists, UNIQUE constraint): '{args.company} — {args.title}' — {args.url}. INSERT aborted.")
        conn.close()
        sys.exit(1)
    except BaseException:
        _rollback_quietly(conn)
        raise

    cid_info = f" (company_id={company_id})" if company_id else " (company_id=NULL — company not found in DB)"
    print(f"Position inserted with ID: {position_id}{cid_info}")
    if role_nudge:
        print(role_nudge)
    conn.close()
    # JHT-T297: an Analista sitting idle at its prompt is woken by the event, not left to find the queue.
    event_wake.notify("new")


def insert_company(args):
    # Upsert sul nome, mai delete+insert (B1-T1, 28/09). Era INSERT OR REPLACE: una
    # riga cancellata e riscritta. Con le foreign key accese, se una posizione puntava
    # già all'azienda (positions.company_id: la seconda posizione di un'azienda nota)
    # la cancellazione veniva rifiutata e l'ANALISTA non salvava l'azienda; quando
    # passava, cambiava l'id e azzerava i campi non passati (il logo già scaricato).
    # Ora la riga resta con il suo id, e si aggiornano solo i campi passati.
    conn = get_db()
    ensure_schema(conn)
    conn.execute("""
        INSERT INTO companies (name, website, hq_country, sector, size,
                               glassdoor_rating, red_flags, culture_notes,
                               analyzed_by, verdict, about)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            website          = COALESCE(excluded.website, companies.website),
            hq_country       = COALESCE(excluded.hq_country, companies.hq_country),
            sector           = COALESCE(excluded.sector, companies.sector),
            size             = COALESCE(excluded.size, companies.size),
            glassdoor_rating = COALESCE(excluded.glassdoor_rating, companies.glassdoor_rating),
            red_flags        = COALESCE(excluded.red_flags, companies.red_flags),
            culture_notes    = COALESCE(excluded.culture_notes, companies.culture_notes),
            analyzed_by      = COALESCE(excluded.analyzed_by, companies.analyzed_by),
            verdict          = COALESCE(excluded.verdict, companies.verdict),
            about            = COALESCE(excluded.about, companies.about),
            analyzed_at      = CURRENT_TIMESTAMP
    """, (args.name, args.website, args.hq_country, args.sector, args.size,
          args.glassdoor_rating, args.red_flags, args.culture_notes,
          args.analyzed_by, args.verdict, clean_about(args.about)))
    # lastrowid non dice niente dopo un aggiornamento: l'id si legge.
    company_id = conn.execute("SELECT id FROM companies WHERE name = ?", (args.name,)).fetchone()[0]
    # le posizioni inserite prima dell'azienda (dallo SCOUT) si collegano adesso
    linked = link_positions_to_company(conn, company_id, args.name)
    conn.commit()
    print(f"Company inserted/updated: {args.name} (ID: {company_id})")
    conn.close()
    if linked:
        # T325 B: the logo step of those positions may have run before the company existed; it runs again for it
        try:
            import position_enrich
            position_enrich.spawn_company(company_id)
        except Exception:  # noqa: BLE001 - the write is done; this step must never fail it
            pass


def _validate_score_range(value, name, min_val, max_val):
    """Valida che un sub-score sia nel range ammesso."""
    if value is not None and (value < min_val or value > max_val):
        print(f"⚠️  ERROR: {name}={value} is outside range [{min_val}-{max_val}]")
        sys.exit(1)


def insert_score(args):
    # Gate anti-scoring con profilo assente (incident 2026-07: score 45
    # persistito per utente con profilo mai compilato). Precondizione
    # DETERMINISTICA, non delegata all'agente: se il profilo non raggiunge il
    # "minimum viable profile" (target_role + un secondo segnale — vedi
    # profile_gate.py) lo score non ha senso e non viene scritto. NON è un
    # check di completezza: i profili parziali passano e restano una
    # valutazione qualitativa dello Scorer (RULE-01 punto 0).
    viable, reason = check_minimum_viable_profile()
    if not viable:
        print(f"⚠️  SCORE REJECTED: {reason}.")
        print("    The candidate profile is substantially empty: do not assign a score.")
        print("    Leave the position in 'checked' and escalate to the Captain (RULE-T10 — do not invent).")
        sys.exit(1)

    # I tetti stanno in score_ranges.py, non qui: erano scritti a mano in questo
    # file, nei prompt dello Scorer, nella pagina web e nel pannello del gioco,
    # e hanno divergiuto senza che nessun test lo vedesse.
    _validate_score_range(args.total, 'total', 0, TOTAL_LIMIT)
    for column, maximum in COMPONENT_LIMITS.items():
        _validate_score_range(getattr(args, column), column, 0, maximum)

    conn = get_db()
    ensure_schema(conn)

    # Le esclusioni di profilo che l'utente ha accettato (JHT-T24): la penalita' la calcola il
    # CODICE dalle colonne della posizione, non lo Scorer. Va sul totale; le componenti restano
    # quelle misurate. I motivi stanno in cima al breakdown (frasi fisse e codici, mai testo).
    penalty, excluded_by = profile_exclusions.penalty_for(conn, args.position_id)
    if penalty:
        raw_total = args.total
        args.total = max(0, args.total - penalty)
        line = profile_exclusions.breakdown_line(penalty, excluded_by)
        args.breakdown = f"{line}\n{args.breakdown}" if args.breakdown else line

    # Un re-score è un aggiornamento della stessa valutazione. `REPLACE`
    # cancellerebbe la riga sul conflitto di position_id e ne creerebbe una
    # nuova: con AUTOINCREMENT cambierebbe scores.id, l'identità della riga
    # verso il cloud. Con recursive_triggers attivo, quella DELETE attiverebbe
    # anche scores_tombstone per una valutazione ancora viva. L'UPSERT conserva
    # l'id e non esegue alcuna DELETE.
    # `getattr`: insert_score è chiamata anche con Namespace costruiti a mano
    # (test, dashboard), che non conoscono i flag di evidenza.
    action = getattr(args, 'action', None)
    previous = _snapshot_score(conn, args.position_id) if action else {}

    cur = conn.execute("""
        INSERT INTO scores (position_id, total_score, stack_match, remote_fit,
                            salary_fit, experience_fit, strategic_fit,
                            breakdown, notes, scored_by, scored_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                strftime('%Y-%m-%d %H:%M:%f', 'now'))
        ON CONFLICT(position_id) DO UPDATE SET
            total_score = excluded.total_score,
            stack_match = excluded.stack_match,
            remote_fit = excluded.remote_fit,
            salary_fit = excluded.salary_fit,
            experience_fit = excluded.experience_fit,
            strategic_fit = excluded.strategic_fit,
            breakdown = excluded.breakdown,
            notes = excluded.notes,
            scored_by = excluded.scored_by,
            scored_at = excluded.scored_at
    """, (args.position_id, args.total, args.stack_match, args.remote_fit,
          args.salary_fit, args.experience_fit, args.strategic_fit,
          args.breakdown, args.notes, args.scored_by))

    if action:
        current = _snapshot_score(conn, args.position_id)
        diffs = [(f, previous.get(f), current.get(f))
                 for f in SCORE_TRACKED_FIELDS
                 if str(previous.get(f)) != str(current.get(f))]
        evidence = maintenance_log.evidence_from_args(args)
        try:
            maintenance_log.record_diffs(
                conn, "position", args.position_id, action, diffs,
                outcome=getattr(args, 'outcome', None), evidence=evidence,
                duration_ms=getattr(args, 'duration_ms', None))
        except maintenance_log.MaintenanceError as e:
            conn.rollback()
            print(f"⚠️  SCORE WRITE ABORTED: {e}")
            conn.close()
            sys.exit(1)

    conn.commit()
    if action and previous and not diffs:
        # Detto a voce: un re-score che non muove nulla è un'informazione,
        # non un errore — ma va vista, non sepolta in un contatore.
        print(f"Score unchanged for position {args.position_id}: "
              f"{args.total}/100 (no fields changed)")
    else:
        print(f"Score inserted for position {args.position_id}: {args.total}/100")
    if penalty:
        print(f"Profile exclusion: -{penalty} ({', '.join(excluded_by)}), {raw_total} -> {args.total}")
    conn.close()


def insert_application(args):
    conn = get_db()
    ensure_schema(conn)
    written_by = (
        args.written_by
        or os.environ.get('JHT_AGENT_NAME')
        or os.environ.get('JHT_AGENT_ID', '')
    ).strip() or None
    cur = conn.execute("""
        INSERT OR REPLACE INTO applications (position_id, cv_path, cl_path,
                                              cv_pdf_path, cl_pdf_path,
                                              written_by, written_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (args.position_id, args.cv_path, args.cl_path,
          args.cv_pdf_path, args.cl_pdf_path, written_by,
          args.written_at))
    conn.commit()
    print(f"Application inserted for position {args.position_id}")
    conn.close()


def insert_highlight(args):
    conn = get_db()
    ensure_schema(conn)
    cur = conn.execute("""
        INSERT INTO position_highlights (position_id, type, text)
        VALUES (?, ?, ?)
    """, (args.position_id, args.type, args.text))
    conn.commit()
    print(f"Highlight ({args.type}) inserted for position {args.position_id}: {args.text[:50]}")
    conn.close()


def build_parser():
    """Il parser, separato da `main` perché non serve solo a `main`.

    `tests/test_external_content_fencing.py` lo interroga per verificare che
    ogni flag di `position` sia classificato: da fuori o nostro. Senza un
    parser raggiungibile, quel controllo diventerebbe una lista scritta a
    mano nel test — cioè la copia che si disallinea al primo campo nuovo.
    """
    parser = argparse.ArgumentParser(description='Insert data into jobs.db')
    sub = parser.add_subparsers(dest='entity', required=True)

    # position
    p = sub.add_parser('position')
    p.add_argument('--title', required=True)
    p.add_argument('--company', required=True)
    p.add_argument('--location', help='Location (Remote, London, Berlin/Remote, etc.)')
    p.add_argument('--remote-type', choices=['full_remote', 'hybrid', 'onsite'])
    p.add_argument('--salary-declared-min', type=int, help='Declared minimum salary')
    p.add_argument('--salary-declared-max', type=int, help='Declared maximum salary')
    p.add_argument('--salary-declared-currency', default='EUR')
    p.add_argument('--salary-estimated-min', type=int, help='Estimated minimum salary')
    p.add_argument('--salary-estimated-max', type=int, help='Estimated maximum salary')
    p.add_argument('--salary-estimated-currency', default=None,
                   help='Currency of the estimate (EUR when amounts are given without one; ignored without amounts)')
    p.add_argument('--salary-estimated-source', help='Estimate source: glassdoor, levels.fyi, manual')
    p.add_argument('--url', required=True)
    p.add_argument('--source')
    p.add_argument('--jd-text')
    p.add_argument('--requirements')
    p.add_argument('--found-by')
    p.add_argument('--deadline', help='Deadline date YYYY-MM-DD or "not present"')
    p.add_argument('--notes')

    # company
    c = sub.add_parser('company')
    c.add_argument('--name', required=True)
    c.add_argument('--website')
    c.add_argument('--hq-country', help='Headquarters country')
    c.add_argument('--sector')
    c.add_argument('--size')
    c.add_argument('--glassdoor-rating', type=float)
    c.add_argument('--red-flags')
    c.add_argument('--culture-notes')
    c.add_argument('--about', help="Two sentences on who the company is and what it does (the company, not the role), user's language, plain text")
    c.add_argument('--analyzed-by')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])

    # score
    s = sub.add_parser('score')
    s.add_argument('--position-id', type=int, required=True)
    s.add_argument('--total', type=int, required=True, help=f'Total, range 0-{TOTAL_LIMIT}')
    # Il testo di --help dice il tetto che il codice applica davvero: prima erano
    # due stringhe diverse da tenere allineate a mano.
    for column, maximum in COMPONENT_LIMITS.items():
        s.add_argument(
            '--' + column.replace('_', '-'),
            type=int,
            help=f'{SCORE_COMPONENT_LABELS[column]} component, range 0-{maximum}',
        )
    s.add_argument('--breakdown')
    s.add_argument('--pros')
    s.add_argument('--cons')
    s.add_argument('--notes')
    s.add_argument('--scored-by')
    # Re-score tracciabile: --action rescore registra il diff col punteggio
    # precedente, così un re-score che non muove nulla si vede.
    maintenance_log.add_cli_args(s)

    # application
    a = sub.add_parser('application')
    a.add_argument('--position-id', type=int, required=True)
    a.add_argument('--cv-path')
    a.add_argument('--cl-path')
    a.add_argument('--cv-pdf-path')
    a.add_argument('--cl-pdf-path')
    a.add_argument('--written-by')
    a.add_argument('--written-at', help='CV creation timestamp (YYYY-MM-DD HH:MM or "now")')

    # highlight (pro/con)
    h = sub.add_parser('highlight')
    h.add_argument('--position-id', type=int, required=True)
    h.add_argument('--type', required=True, choices=['pro', 'con'])
    h.add_argument('--text', required=True)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    # What the caller's ROLE may insert (db_role_policy.py): a Scout that runs `score` is refused here, with the reason.
    import db_role_policy
    db_role_policy.guard_insert(args)

    if args.entity == 'position':
        insert_position(args)
    elif args.entity == 'company':
        insert_company(args)
    elif args.entity == 'score':
        insert_score(args)
    elif args.entity == 'application':
        insert_application(args)
    elif args.entity == 'highlight':
        insert_highlight(args)


if __name__ == '__main__':
    main()
