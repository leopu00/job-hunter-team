#!/usr/bin/env python3
"""Query il database jobs.db (schema V2).

Uso:
  python3 db_query.py positions [--status new] [--min-score 70] [--company "X"]
  python3 db_query.py position 42
  python3 db_query.py companies [--verdict GO]
  python3 db_query.py company "Adaptify"
  python3 db_query.py dashboard
  python3 db_query.py stats
  python3 db_query.py next-for-analista     # posizioni new pronte per analisi
  python3 db_query.py next-for-scorer       # posizioni checked senza score
  python3 db_query.py next-for-scrittore    # posizioni scored >= 50 senza application
  python3 db_query.py next-for-critico      # application in review senza verdict
  python3 db_query.py application 42        # check anti-riscrittura (REGOLA-02)
                                            # exit 1 se critic_verdict NOT NULL → SKIP
  python3 db_query.py check-url 4361788825  # cerca per job ID numerico
  python3 db_query.py check-url "https://..."  # cerca per URL esatto
"""

import argparse
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema


def format_salary_v2(row):
    """Formatta stipendio dichiarato e/o stimato."""
    parts = []
    if row['salary_declared_min'] or row['salary_declared_max']:
        lo = f"{row['salary_declared_min']//1000}K" if row['salary_declared_min'] else '?'
        hi = f"{row['salary_declared_max']//1000}K" if row['salary_declared_max'] else '?'
        cur = row['salary_declared_currency'] or 'EUR'
        parts.append(f"{lo}-{hi} {cur}")
    if row['salary_estimated_min'] or row['salary_estimated_max']:
        lo = f"{row['salary_estimated_min']//1000}K" if row['salary_estimated_min'] else '?'
        hi = f"{row['salary_estimated_max']//1000}K" if row['salary_estimated_max'] else '?'
        cur = row['salary_estimated_currency'] or 'EUR'
        src = row['salary_estimated_source'] or '?'
        parts.append(f"~{lo}-{hi} {cur} ({src})")
    return ' | '.join(parts) if parts else 'N/D'


def query_positions(args):
    conn = get_db()
    ensure_schema(conn)

    query = """
        SELECT p.*, s.total_score, a.status as app_status, a.critic_verdict,
               c.hq_country as c_hq_country, c.verdict as company_verdict
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE 1=1
    """
    params = []

    if args.status:
        query += " AND p.status = ?"
        params.append(args.status)
    if args.company:
        query += " AND p.company LIKE ?"
        params.append(f"%{args.company}%")
    if args.min_score:
        query += " AND s.total_score >= ?"
        params.append(args.min_score)
    if args.max_score:
        query += " AND s.total_score <= ?"
        params.append(args.max_score)
    if args.source:
        query += " AND p.source = ?"
        params.append(args.source)

    query += " ORDER BY COALESCE(s.total_score, 0) DESC, p.found_at DESC"

    rows = conn.execute(query, params).fetchall()
    if not rows:
        print("Nessuna posizione trovata.")
        return

    print(f"\n{'ID':>4} {'Score':>5} {'Stato':>10} {'Azienda':<20} {'Titolo':<35} {'Remote':<12} {'Fonte':<10}")
    print("-" * 100)
    for r in rows:
        score = str(r['total_score']) if r['total_score'] else '-'
        remote = r['remote_type'] or '-'
        source = r['source'] or '-'
        status = r['status'] or '-'
        print(f"{r['id']:>4} {score:>5} {status:>10} {r['company'][:20]:<20} {r['title'][:35]:<35} {remote:<12} {source:<10}")

    print(f"\nTotale: {len(rows)} posizioni")
    conn.close()


def query_position_detail(position_id):
    conn = get_db()
    ensure_schema(conn)

    r = conn.execute("""
        SELECT p.*, s.total_score, s.stack_match, s.remote_fit, s.salary_fit,
               s.experience_fit, s.strategic_fit, s.breakdown as score_breakdown, s.notes as score_notes,
               a.cv_path, a.cl_path, a.cv_pdf_path, a.cl_pdf_path,
               a.critic_verdict, a.critic_score, a.critic_notes,
               a.status as app_status, a.written_at, a.applied_at, a.applied_via,
               a.response, a.response_at,
               c.hq_country as c_hq_country, c.verdict as company_verdict, c.sector as c_sector
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.id = ?
    """, (position_id,)).fetchone()

    if not r:
        print(f"Posizione {position_id} non trovata.")
        return

    print(f"\n{'='*60}")
    print(f"  POSIZIONE #{r['id']}: {r['title']}")
    print(f"  Azienda: {r['company']} (company_id={r['company_id'] or 'NULL'})")
    print(f"{'='*60}")
    print(f"  Location: {r['location'] or 'N/D'}")
    print(f"  HQ Azienda: {r['c_hq_country'] or 'N/D'}")
    print(f"  Remote: {r['remote_type'] or 'N/D'}")
    print(f"  Stipendio: {format_salary_v2(r)}")
    print(f"  URL: {r['url'] or 'N/D'}")
    print(f"  Fonte: {r['source'] or 'N/D'}")
    print(f"  Stato: {r['status']}")
    print(f"  Trovata da: {r['found_by'] or 'N/D'}")
    print(f"  Data: {r['found_at'] or 'N/D'}")

    if r['total_score']:
        print(f"\n  --- SCORE: {r['total_score']}/100 ---")
        print(f"  Stack: {r['stack_match'] or '-'}/40 | Remote: {r['remote_fit'] or '-'}/25 | Stipendio: {r['salary_fit'] or '-'}/20")
        print(f"  Esperienza: {r['experience_fit'] or '-'} | Strategico: {r['strategic_fit'] or '-'}/15")
        if r['score_breakdown']:
            print(f"  Breakdown: {r['score_breakdown']}")

    if r['app_status']:
        print(f"\n  --- APPLICATION ---")
        print(f"  Stato: {r['app_status']}")
        if r['written_at']:
            print(f"  Scritta: {r['written_at']}")
        print(f"  Critico: {r['critic_verdict'] or 'in attesa'} (score: {r['critic_score'] or '-'})")
        if r['applied_at']:
            print(f"  Inviata: {r['applied_at']} via {r['applied_via']}")
        if r['response']:
            print(f"  Risposta: {r['response']} ({r['response_at'] or 'N/D'})")

    if r['notes']:
        print(f"\n  Note: {r['notes']}")

    conn.close()


def query_companies(args):
    conn = get_db()
    ensure_schema(conn)

    query = "SELECT * FROM companies WHERE 1=1"
    params = []

    if args.verdict:
        query += " AND verdict = ?"
        params.append(args.verdict)

    query += " ORDER BY name"
    rows = conn.execute(query, params).fetchall()

    if not rows:
        print("Nessuna azienda trovata.")
        return

    print(f"\n{'ID':>4} {'Verdict':>8} {'Azienda':<25} {'Settore':<15} {'Size':<10} {'Glassdoor':>9}")
    print("-" * 75)
    for r in rows:
        verdict = r['verdict'] or '-'
        sector = (r['sector'] or '-')[:15]
        size = (r['size'] or '-')[:10]
        rating = f"{r['glassdoor_rating']:.1f}" if r['glassdoor_rating'] else '-'
        print(f"{r['id']:>4} {verdict:>8} {r['name'][:25]:<25} {sector:<15} {size:<10} {rating:>9}")

    print(f"\nTotale: {len(rows)} aziende")
    conn.close()


def query_company_detail(name):
    conn = get_db()
    ensure_schema(conn)

    r = conn.execute("SELECT * FROM companies WHERE name LIKE ?", (f"%{name}%",)).fetchone()
    if not r:
        print(f"Azienda '{name}' non trovata.")
        return

    print(f"\n  {r['name']} — {r['verdict'] or 'NON VALUTATA'}")
    print(f"  Website: {r['website'] or 'N/D'}")
    print(f"  HQ: {r['hq_country'] or 'N/D'}")
    print(f"  Settore: {r['sector'] or 'N/D'}")
    print(f"  Size: {r['size'] or 'N/D'}")
    print(f"  Glassdoor: {r['glassdoor_rating'] or 'N/D'}")
    if r['red_flags']:
        print(f"  Red flags: {r['red_flags']}")
    if r['culture_notes']:
        print(f"  Cultura: {r['culture_notes']}")

    # Posizioni collegate
    positions = conn.execute("""
        SELECT p.id, p.title, p.status, s.total_score
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        WHERE p.company_id = ?
        ORDER BY COALESCE(s.total_score, 0) DESC
    """, (r['id'],)).fetchall()
    if positions:
        print(f"\n  Posizioni ({len(positions)}):")
        for p in positions:
            score = f" [score: {p['total_score']}]" if p['total_score'] else ""
            print(f"    #{p['id']} {p['title'][:40]} [{p['status']}]{score}")

    conn.close()


def dashboard():
    conn = get_db()
    ensure_schema(conn)

    print("\n" + "=" * 60)
    print("  JOB HUNTER — DASHBOARD (Schema V2)")
    print("=" * 60)

    # Conteggi per stato
    statuses = conn.execute("""
        SELECT status, COUNT(*) as cnt FROM positions GROUP BY status ORDER BY
        CASE status
            WHEN 'new' THEN 1 WHEN 'checked' THEN 2 WHEN 'scored' THEN 3
            WHEN 'writing' THEN 4 WHEN 'review' THEN 5 WHEN 'ready' THEN 6
            WHEN 'applied' THEN 7 WHEN 'response' THEN 8 ELSE 9
        END
    """).fetchall()

    total = sum(r['cnt'] for r in statuses)
    print(f"\n  Posizioni totali: {total}")
    for r in statuses:
        print(f"    {r['status']:>10}: {r['cnt']}")

    # Top score
    top = conn.execute("""
        SELECT p.title, p.company, s.total_score, p.status
        FROM positions p JOIN scores s ON s.position_id = p.id
        ORDER BY s.total_score DESC LIMIT 10
    """).fetchall()

    if top:
        print(f"\n  TOP 10 per score:")
        for r in top:
            print(f"    {r['total_score']:>3}/100  {r['company'][:20]:<20} {r['title'][:30]:<30} [{r['status']}]")

    # Candidature attive
    apps = conn.execute("""
        SELECT p.company, p.title, a.status, a.critic_verdict, a.applied_at, a.written_at
        FROM applications a JOIN positions p ON p.id = a.position_id
        ORDER BY a.id DESC
    """).fetchall()

    if apps:
        print(f"\n  Candidature ({len(apps)}):")
        for r in apps:
            verdict = f" [{r['critic_verdict']}]" if r['critic_verdict'] else ""
            applied = f" | Inviata {r['applied_at']}" if r['applied_at'] else ""
            print(f"    {r['company'][:20]:<20} {r['title'][:25]:<25} {r['status']}{verdict}{applied}")

    # Aziende per verdict
    verdicts = conn.execute("""
        SELECT verdict, COUNT(*) as cnt FROM companies WHERE verdict IS NOT NULL GROUP BY verdict
    """).fetchall()

    if verdicts:
        print(f"\n  Aziende analizzate:")
        for r in verdicts:
            print(f"    {r['verdict']:>8}: {r['cnt']}")

    # Company ID coverage
    with_cid = conn.execute("SELECT COUNT(*) FROM positions WHERE company_id IS NOT NULL").fetchone()[0]
    print(f"\n  Company ID: {with_cid}/{total} posizioni collegate ({100*with_cid//total if total else 0}%)")

    conn.close()


def stats():
    conn = get_db()
    ensure_schema(conn)

    counts = {}
    for table in ['positions', 'companies', 'scores', 'applications']:
        counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    version = conn.execute("PRAGMA user_version").fetchone()[0]
    print(f"\npositions: {counts['positions']} | companies: {counts['companies']} | scores: {counts['scores']} | applications: {counts['applications']} | schema: V{version}")
    conn.close()


def next_for_role(role):
    conn = get_db()
    ensure_schema(conn)

    if role == 'analista':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.found_at
            FROM positions p
            WHERE p.status = 'new'
            ORDER BY p.found_at ASC
        """).fetchall()
        label = "Posizioni new pronte per analisi"

    elif role == 'scorer':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.found_at
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'checked' AND s.id IS NULL
            ORDER BY p.found_at ASC
        """).fetchall()
        label = "Posizioni checked senza score"

    elif role == 'scrittore':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, s.total_score
            FROM positions p
            JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            WHERE s.total_score >= 50 AND a.id IS NULL AND p.status = 'scored'
            ORDER BY s.total_score DESC
        """).fetchall()
        label = "Posizioni scored >= 50 senza application"

    elif role == 'critico':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, a.written_by
            FROM positions p
            JOIN applications a ON a.position_id = p.id
            WHERE a.status = 'review' AND a.critic_verdict IS NULL
            ORDER BY a.id ASC
        """).fetchall()
        label = "Application in review senza verdict"

    else:
        print(f"Ruolo sconosciuto: {role}")
        return

    if not rows:
        print(f"\n{label}: nessuna.")
        return

    print(f"\n{label} ({len(rows)}):")
    for r in rows:
        extra = ""
        if 'total_score' in r.keys():
            extra = f" [score: {r['total_score']}]"
        print(f"  #{r['id']} {r['company'][:20]:<20} {r['title'][:35]}{extra}")

    conn.close()


def query_application(position_id):
    """Check anti-riscrittura (REGOLA-02 Scrittore).

    Output stato application + critic info per la position. Exit code:
      0 — nessuna application, oppure application senza critic_verdict (procedi)
      1 — critic_verdict valorizzato (SKIP ASSOLUTO, voto del Critico è finale)
    """
    conn = get_db()
    ensure_schema(conn)

    r = conn.execute("""
        SELECT a.status, a.critic_verdict, a.critic_score, a.critic_notes,
               a.written_by, a.reviewed_by, a.written_at, a.critic_reviewed_at,
               a.cv_path, a.cv_pdf_path, a.cl_path, a.cl_pdf_path,
               a.applied, a.applied_at, a.applied_via,
               p.title, p.company
        FROM applications a
        JOIN positions p ON p.id = a.position_id
        WHERE a.position_id = ?
    """, (position_id,)).fetchone()

    if not r:
        print(f"Nessuna application per posizione {position_id}. PROCEDI.")
        conn.close()
        return 0

    print(f"\n  APPLICATION posizione #{position_id}: {r['company']} — {r['title']}")
    print(f"  Status:        {r['status']}")
    print(f"  Scritta da:    {r['written_by'] or 'N/D'} ({r['written_at'] or 'N/D'})")
    print(f"  Critic verdict:{r['critic_verdict'] or 'IN ATTESA'}")
    if r['critic_verdict']:
        print(f"  Critic score:  {r['critic_score']}")
        print(f"  Reviewed by:   {r['reviewed_by'] or 'N/D'} ({r['critic_reviewed_at'] or 'N/D'})")
        if r['critic_notes']:
            print(f"  Critic notes:  {r['critic_notes']}")
    if r['cv_pdf_path']:
        print(f"  CV PDF:        {r['cv_pdf_path']}")
    if r['applied']:
        print(f"  Inviata:       {r['applied_at']} via {r['applied_via'] or 'N/D'}")

    conn.close()

    if r['critic_verdict']:
        print(f"\n  ⛔ SKIP — il voto del Critico è FINALE (REGOLA-02).")
        return 1
    return 0


def check_url(url_or_id):
    """Cerca una posizione per URL o job ID LinkedIn."""
    conn = get_db()
    ensure_schema(conn)

    if url_or_id.isdigit():
        r = conn.execute(
            "SELECT id, title, company, url, status FROM positions WHERE url LIKE ?",
            (f"%/jobs/view/%{url_or_id}%",)
        ).fetchone()
    else:
        r = conn.execute(
            "SELECT id, title, company, url, status FROM positions WHERE url = ?",
            (url_or_id,)
        ).fetchone()

    if r:
        print(f"TROVATA: #{r['id']} {r['company']} — {r['title']} [{r['status']}]")
    else:
        print("NON TROVATA")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Query jobs.db')
    sub = parser.add_subparsers(dest='cmd', required=True)

    # positions
    p = sub.add_parser('positions')
    p.add_argument('--status')
    p.add_argument('--company')
    p.add_argument('--min-score', type=int)
    p.add_argument('--max-score', type=int)
    p.add_argument('--source')

    # position detail
    pd = sub.add_parser('position')
    pd.add_argument('id', type=int)

    # companies
    c = sub.add_parser('companies')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])

    # company detail
    cd = sub.add_parser('company')
    cd.add_argument('name')

    # dashboard + stats
    sub.add_parser('dashboard')
    sub.add_parser('stats')

    # next-for-*
    sub.add_parser('next-for-analista')
    sub.add_parser('next-for-scorer')
    sub.add_parser('next-for-scrittore')
    sub.add_parser('next-for-critico')

    # application (anti-riscrittura check)
    ap = sub.add_parser('application')
    ap.add_argument('position_id', type=int)

    # check-url
    cu = sub.add_parser('check-url')
    cu.add_argument('url', help='URL o job ID numerico LinkedIn')

    args = parser.parse_args()

    if args.cmd == 'positions':
        query_positions(args)
    elif args.cmd == 'position':
        query_position_detail(args.id)
    elif args.cmd == 'companies':
        query_companies(args)
    elif args.cmd == 'company':
        query_company_detail(args.name)
    elif args.cmd == 'dashboard':
        dashboard()
    elif args.cmd == 'stats':
        stats()
    elif args.cmd == 'application':
        return query_application(args.position_id)
    elif args.cmd == 'check-url':
        check_url(args.url)
    elif args.cmd.startswith('next-for-'):
        role = args.cmd.replace('next-for-', '')
        next_for_role(role)


if __name__ == '__main__':
    sys.exit(main() or 0)
