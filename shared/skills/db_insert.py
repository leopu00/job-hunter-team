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

from _db import get_db, ensure_schema, resolve_company_id
from profile_gate import check_minimum_viable_profile
import maintenance_log

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


def _normalize_city(location):
    """Estrae e normalizza il primo token della location come 'citta'.

    Address vps1-postmortem anomalia #3: 7 (title, company) duplicate
    perche' Scout dedup falliva quando stessa position arrivava da
    source multipli con location string diversa:
      - LinkedIn: 'Milan, Italy'
      - Ashby:    'Milan, Lombardy, IT'
      - Direct:   'Milano, IT'
    Senza normalizzazione, Level 2/3 dedup non matchano e si crea row
    duplicata. Tokenizziamo sul primo token + normalizzazione minima
    (lowercase + strip diacritici comuni IT/EN).

    Esempi:
      'Milan, Italy'         -> 'milan'
      'Milan, Lombardy, IT'  -> 'milan'
      'Milano, IT'           -> 'milano'   # IT vs EN nome citta diverso
      'New York, NY, USA'    -> 'new york'
      None / ''              -> ''
    """
    if not location:
        return ''
    # Primo token comma-separated (la citta')
    first = location.split(',')[0].strip().lower()
    # Strip diacritics: 'münchen' -> 'munchen', 'köln' -> 'koln', 'genève' -> 'geneve'.
    # NFD decompone i caratteri (ä = a + combining-diaeresis), poi filtriamo
    # le marks combining (categoria 'Mn' di unicodedata).
    import unicodedata
    nfd = unicodedata.normalize('NFD', first)
    return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')


# Synonyms cross-language per le citta' italiane/europee piu' frequenti
# nei JD. Tutto in lowercase. Se nessuna mappatura → ritorna l'input.
_CITY_SYNONYMS = {
    'milano': 'milan',
    'milan': 'milan',
    'roma': 'rome',
    'rome': 'rome',
    'torino': 'turin',
    'turin': 'turin',
    'firenze': 'florence',
    'florence': 'florence',
    'venezia': 'venice',
    'venice': 'venice',
    'napoli': 'naples',
    'naples': 'naples',
    'genova': 'genoa',
    'genoa': 'genoa',
    'monaco di baviera': 'munich',
    'munchen': 'munich',
    'munich': 'munich',
    'koln': 'cologne',
    'cologne': 'cologne',
    'wien': 'vienna',
    'vienna': 'vienna',
    'praha': 'prague',
    'prague': 'prague',
}


def _normalize_city_canonical(location):
    """Normalizza city + applica synonym map cross-language."""
    raw = _normalize_city(location)
    return _CITY_SYNONYMS.get(raw, raw)


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
                (Milano vs Berlino sono offerte distinte).
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

    # Livello 2 — azienda + titolo + city normalizzata (primo token + synonym map)
    # Address vps1-postmortem anomalia #3: 'Milan, Italy' vs 'Milan, Lombardy, IT'
    # vs 'Milano, IT' devono matchare. Carichiamo i candidati per azienda+titolo
    # e applichiamo _normalize_city_canonical in Python (SQL non ha la synonym map).
    city_new = _normalize_city_canonical(location)
    if company and title:
        candidates_l2 = conn.execute(
            "SELECT id, title, company, location FROM positions "
            "WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?)",
            (company, title)
        ).fetchall()
        for cand in candidates_l2:
            if _normalize_city_canonical(cand['location']) == city_new:
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
            if _normalize_city_canonical(cand['location']) != city_new:
                continue
            if _title_similarity(title, cand['title']) > 0.85:
                _log_dedup_skip(3, cand['id'], url, company, title)
                return cand, "azienda+titolo simile+city-norm"

    return None, None


def _rollback_quietly(conn):
    """ROLLBACK che non copre l'errore vero se la transazione è già chiusa."""
    try:
        conn.execute("ROLLBACK")
    except sqlite3.Error:
        pass


def insert_position(args):
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
        # Check duplicati PRIMA dell'inserimento (bug #25 SC-05: 4 livelli)
        existing, match_type = check_duplicate(
            conn, args.url, args.company, args.title, getattr(args, 'location', None),
        )
        if existing:
            _rollback_quietly(conn)
            print(f"⚠️  DUPLICATO ({match_type}): '{args.company} — {args.title}' già presente come #{existing['id']} ({existing['company']} — {existing['title']}). INSERT annullato.")
            conn.close()
            sys.exit(1)

        # Auto-resolve company_id
        company_id = resolve_company_id(conn, args.company)

        cur = conn.execute("""
            INSERT INTO positions (title, company, company_id, location,
                                   remote_type,
                                   salary_declared_min, salary_declared_max, salary_declared_currency,
                                   salary_estimated_min, salary_estimated_max, salary_estimated_currency,
                                   salary_estimated_source,
                                   url, source, jd_text, requirements,
                                   found_by, deadline, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (args.title, args.company, company_id, args.location,
              args.remote_type,
              args.salary_declared_min, args.salary_declared_max, args.salary_declared_currency or 'EUR',
              args.salary_estimated_min, args.salary_estimated_max, args.salary_estimated_currency or 'EUR',
              args.salary_estimated_source,
              args.url, args.source, args.jd_text,
              args.requirements, args.found_by, args.deadline, args.notes))

        # Bug #14: log la transizione iniziale (None → 'new') con by_agent =
        # JHT_AGENT_NAME (es. scout-1). Senza questa entry il funnel parte
        # da "scored" come stato visibile più antico — pessimo per metriche
        # di throughput a livello pipeline.
        position_id = cur.lastrowid
        actor = os.environ.get('JHT_AGENT_NAME') or args.found_by or 'unknown'
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
        print(f"⚠️  DUPLICATO (URL già presente, vincolo UNIQUE): '{args.company} — {args.title}' — {args.url}. INSERT annullato.")
        conn.close()
        sys.exit(1)
    except BaseException:
        _rollback_quietly(conn)
        raise

    cid_info = f" (company_id={company_id})" if company_id else " (company_id=NULL — azienda non in DB)"
    print(f"Posizione inserita con ID: {position_id}{cid_info}")
    conn.close()


def insert_company(args):
    conn = get_db()
    ensure_schema(conn)
    cur = conn.execute("""
        INSERT OR REPLACE INTO companies (name, website, hq_country, sector, size,
                                          glassdoor_rating, red_flags, culture_notes,
                                          analyzed_by, verdict)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (args.name, args.website, args.hq_country, args.sector, args.size,
          args.glassdoor_rating, args.red_flags, args.culture_notes,
          args.analyzed_by, args.verdict))
    conn.commit()
    print(f"Azienda inserita/aggiornata: {args.name} (ID: {cur.lastrowid})")
    conn.close()


def _validate_score_range(value, name, min_val, max_val):
    """Valida che un sub-score sia nel range ammesso."""
    if value is not None and (value < min_val or value > max_val):
        print(f"⚠️  ERRORE: {name}={value} fuori range [{min_val}-{max_val}]")
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
        print(f"⚠️  SCORE RIFIUTATO: {reason}.")
        print("    Il profilo candidato è sostanzialmente assente: non assegnare lo score.")
        print("    Lascia la posizione in 'checked' ed escala al Capitano (RULE-T10 — do not invent).")
        sys.exit(1)

    _validate_score_range(args.total, 'total', 0, 100)
    _validate_score_range(args.stack_match, 'stack_match', 0, 40)
    _validate_score_range(args.remote_fit, 'remote_fit', 0, 25)
    _validate_score_range(args.salary_fit, 'salary_fit', 0, 20)
    _validate_score_range(args.experience_fit, 'experience_fit', 0, 10)
    _validate_score_range(args.strategic_fit, 'strategic_fit', 0, 15)

    conn = get_db()
    ensure_schema(conn)

    # `INSERT OR REPLACE` sovrascrive in silenzio: senza fotografare il
    # punteggio precedente, un re-score che lascia il totale identico è
    # indistinguibile da un re-score mai eseguito. È lo stesso difetto dei
    # campi di manutenzione, sulla tabella `scores`.
    # `getattr`: insert_score è chiamata anche con Namespace costruiti a mano
    # (test, dashboard), che non conoscono i flag di evidenza.
    action = getattr(args, 'action', None)
    previous = _snapshot_score(conn, args.position_id) if action else {}

    cur = conn.execute("""
        INSERT OR REPLACE INTO scores (position_id, total_score, stack_match, remote_fit,
                                        salary_fit, experience_fit, strategic_fit,
                                        breakdown, notes, scored_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            print(f"⚠️  SCORE ANNULLATO: {e}")
            conn.close()
            sys.exit(1)

    conn.commit()
    if action and previous and not diffs:
        # Detto a voce: un re-score che non muove nulla è un'informazione,
        # non un errore — ma va vista, non sepolta in un contatore.
        print(f"Score invariato per posizione {args.position_id}: "
              f"{args.total}/100 (nessun campo cambiato)")
    else:
        print(f"Score inserito per posizione {args.position_id}: {args.total}/100")
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
    print(f"Application inserita per posizione {args.position_id}")
    conn.close()


def insert_highlight(args):
    conn = get_db()
    ensure_schema(conn)
    cur = conn.execute("""
        INSERT INTO position_highlights (position_id, type, text)
        VALUES (?, ?, ?)
    """, (args.position_id, args.type, args.text))
    conn.commit()
    print(f"Highlight ({args.type}) inserito per posizione {args.position_id}: {args.text[:50]}")
    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Inserisci dati in jobs.db')
    sub = parser.add_subparsers(dest='entity', required=True)

    # position
    p = sub.add_parser('position')
    p.add_argument('--title', required=True)
    p.add_argument('--company', required=True)
    p.add_argument('--location', help='Location (Remote, London, Berlin/Remote, etc.)')
    p.add_argument('--remote-type', choices=['full_remote', 'hybrid', 'onsite'])
    p.add_argument('--salary-declared-min', type=int, help='Stipendio dichiarato min')
    p.add_argument('--salary-declared-max', type=int, help='Stipendio dichiarato max')
    p.add_argument('--salary-declared-currency', default='EUR')
    p.add_argument('--salary-estimated-min', type=int, help='Stipendio stimato min')
    p.add_argument('--salary-estimated-max', type=int, help='Stipendio stimato max')
    p.add_argument('--salary-estimated-currency', default='EUR')
    p.add_argument('--salary-estimated-source', help='Fonte stima: glassdoor, levels.fyi, manual')
    p.add_argument('--url', required=True)
    p.add_argument('--source')
    p.add_argument('--jd-text')
    p.add_argument('--requirements')
    p.add_argument('--found-by')
    p.add_argument('--deadline', help='Data scadenza YYYY-MM-DD o "non presente"')
    p.add_argument('--notes')

    # company
    c = sub.add_parser('company')
    c.add_argument('--name', required=True)
    c.add_argument('--website')
    c.add_argument('--hq-country', help='Paese sede principale')
    c.add_argument('--sector')
    c.add_argument('--size')
    c.add_argument('--glassdoor-rating', type=float)
    c.add_argument('--red-flags')
    c.add_argument('--culture-notes')
    c.add_argument('--analyzed-by')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])

    # score
    s = sub.add_parser('score')
    s.add_argument('--position-id', type=int, required=True)
    s.add_argument('--total', type=int, required=True)
    s.add_argument('--stack-match', type=int, help='Componente stack, range 0-40')
    s.add_argument('--remote-fit', type=int, help='Componente remote/location, range 0-25')
    s.add_argument('--salary-fit', type=int, help='Componente stipendio, range 0-20')
    s.add_argument('--experience-fit', type=int, help='Componente seniority, range 0-10')
    s.add_argument('--strategic-fit', type=int, help='Componente strategico, range 0-15')
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
    a.add_argument('--written-at', help='Timestamp creazione CV (YYYY-MM-DD HH:MM o "now")')

    # highlight (pro/con)
    h = sub.add_parser('highlight')
    h.add_argument('--position-id', type=int, required=True)
    h.add_argument('--type', required=True, choices=['pro', 'con'])
    h.add_argument('--text', required=True)

    args = parser.parse_args()

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
