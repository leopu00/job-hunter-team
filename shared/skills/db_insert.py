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
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, resolve_company_id


def extract_linkedin_job_id(url):
    """Estrae l'ID numerico da URL LinkedIn (es. linkedin.com/jobs/view/4381470286)."""
    if not url:
        return None
    match = re.search(r'linkedin\.com/jobs/view/(\d+)', url)
    return match.group(1) if match else None


def check_duplicate(conn, url, company, title):
    """Controlla duplicati per LinkedIn job ID e company+title. Ritorna posizione esistente o None."""
    # Check 1: LinkedIn job ID (più affidabile)
    linkedin_id = extract_linkedin_job_id(url)
    if linkedin_id:
        existing = conn.execute(
            "SELECT id, title, company FROM positions WHERE url LIKE ? AND status != 'excluded'",
            (f'%{linkedin_id}%',)
        ).fetchone()
        if existing:
            return existing, f"LinkedIn job ID {linkedin_id}"

    # Check 2: company + title esatto (case-insensitive)
    if company and title:
        existing = conn.execute(
            "SELECT id, title, company FROM positions WHERE LOWER(company) = LOWER(?) AND LOWER(title) = LOWER(?) AND status != 'excluded'",
            (company, title)
        ).fetchone()
        if existing:
            return existing, "company+title"

    return None, None


def insert_position(args):
    conn = get_db()
    ensure_schema(conn)

    # Check duplicati PRIMA dell'inserimento
    existing, match_type = check_duplicate(conn, args.url, args.company, args.title)
    if existing:
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
    conn.commit()
    cid_info = f" (company_id={company_id})" if company_id else " (company_id=NULL — azienda non in DB)"
    print(f"Posizione inserita con ID: {cur.lastrowid}{cid_info}")
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
    _validate_score_range(args.total, 'total', 0, 100)
    _validate_score_range(args.stack_match, 'stack_match', 0, 40)
    _validate_score_range(args.remote_fit, 'remote_fit', 0, 25)
    _validate_score_range(args.salary_fit, 'salary_fit', 0, 20)
    _validate_score_range(args.experience_fit, 'experience_fit', 0, 10)
    _validate_score_range(args.strategic_fit, 'strategic_fit', 0, 15)

    conn = get_db()
    ensure_schema(conn)
    cur = conn.execute("""
        INSERT OR REPLACE INTO scores (position_id, total_score, stack_match, remote_fit,
                                        salary_fit, experience_fit, strategic_fit,
                                        breakdown, notes, scored_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (args.position_id, args.total, args.stack_match, args.remote_fit,
          args.salary_fit, args.experience_fit, args.strategic_fit,
          args.breakdown, args.notes, args.scored_by))
    conn.commit()
    print(f"Score inserito per posizione {args.position_id}: {args.total}/100")
    conn.close()


def insert_application(args):
    conn = get_db()
    ensure_schema(conn)
    cur = conn.execute("""
        INSERT OR REPLACE INTO applications (position_id, cv_path, cl_path,
                                              cv_pdf_path, cl_pdf_path,
                                              written_by, written_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (args.position_id, args.cv_path, args.cl_path,
          args.cv_pdf_path, args.cl_pdf_path, args.written_by,
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
    s.add_argument('--stack-match', type=int)
    s.add_argument('--remote-fit', type=int)
    s.add_argument('--salary-fit', type=int)
    s.add_argument('--experience-fit', type=int)
    s.add_argument('--strategic-fit', type=int)
    s.add_argument('--breakdown')
    s.add_argument('--pros')
    s.add_argument('--cons')
    s.add_argument('--notes')
    s.add_argument('--scored-by')

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
