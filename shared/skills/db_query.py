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
  python3 db_query.py next-for-geocoding    # posizioni con geocoding richiesto dall'utente
  python3 db_query.py next-for-recheck      # posizioni da ri-verificare liveness (scadute)
  python3 db_query.py next-for-categorize   # posizioni senza role_family (backlog categoria)
  python3 db_query.py next-for-salary-precise # posizioni con salary preciso richiesto dall'utente
  python3 db_query.py next-for-recheck-due   # MODALITÀ CURA: recheck cadenzato (vive, score>=70, non verif. da >14gg, score DESC)
                                            # alias legacy: next-for-recheck-weekly
  python3 db_query.py next-for-geocode-missing # MODALITÀ CURA: geocoding vive senza coordinate ufficio
  python3 db_query.py next-for-logo-missing  # MODALITÀ CURA: aziende (con posizioni vive) senza logo
  python3 db_query.py application 42        # check anti-riscrittura (REGOLA-02)
                                            # exit 1 se critic_verdict NOT NULL → SKIP
  python3 db_query.py check-url 4361788825  # cerca per job ID numerico
  python3 db_query.py check-url "https://..."  # cerca per URL esatto

Ogni comando di lettura (positions, position, companies, company, dashboard,
stats, recent-activity) accetta `--json`: una riga JSON su stdout invece della
tabella. Serve a `jht ... --json` e agli agenti LLM che guidano JHT.

Le code `next-for-*` accettano `--limit N`, `--all` e `--json`. Stampano le
prime N righe (default 20) e dichiarano SEMPRE quante ne esistono in totale:

  python3 db_query.py next-for-categorize             # prime 20 di N
  python3 db_query.py next-for-categorize --limit 100 # ne vuoi di più
  python3 db_query.py next-for-categorize --all       # tutte (= --limit 0)
  python3 db_query.py next-for-categorize --json      # {total, shown, rows: [...]}

Il limite è un DEFAULT, non un tetto: serve a non riversare l'intera coda in un
contesto senza che nessuno l'abbia chiesto. Chi ha bisogno di altro alza il
limite — o si scrive la propria query SQL con il proprio LIMIT, che la skill
`db-query` consente già (`allowed-tools: Bash(python3 *)`).
"""

import argparse
import json
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, active_categories
# Importato, non ricopiato: una seconda regex per lo stesso id divergerebbe dalla
# prima al primo cambio di formato degli URL — e' gia' successo con la copia
# stale di `check_duplicate` dentro tests/test_scoring_logic.py.
from db_insert import extract_linkedin_job_id


# ── Output macchina ─────────────────────────────────────────────────────
#
# Ogni comando di lettura accetta `--json`. Serve a chi non ha occhi: il CLI
# (`jht positions list --json`) e gli agenti LLM che guidano JHT, per i quali
# la tabella incolonnata qui sotto è una fonte di parsing fragile. Il formato
# umano resta il default e non cambia — `--json` è una seconda uscita, non una
# riscrittura della prima.
#
# Contratto: UNA riga JSON su stdout, niente intestazioni né colori, exit code
# invariato. Le liste sono array di oggetti con i nomi di colonna del DB; i
# dettagli sono un oggetto solo. `default=str` copre date e Decimal senza
# rompersi su un tipo nuovo.
def emit_json(payload):
    print(json.dumps(payload, ensure_ascii=False, default=str))


def rows_to_dicts(rows):
    return [dict(r) for r in rows]

# Categorie ATTIVE del registro emergente (lane registro dev2). Usa la funzione
# canonica di _db (active_categories: user_id=None → local_user_id) appena è
# disponibile; fallback single-tenant tollerante finché il cross-merge non la
# porta su questo branch (così il branch resta self-contained e testabile).
try:
    from _db import active_categories as _read_active_categories
except ImportError:  # pragma: no cover - ponte pre-cross-merge
    def _read_active_categories(conn, *a, **k):
        try:
            rows = conn.execute(
                "SELECT name FROM role_family_registry "
                "WHERE status='active' ORDER BY support_count DESC"
            ).fetchall()
        except Exception:
            return []
        return [(r[0] if not hasattr(r, "keys") else r["name"]) for r in rows]


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

    if getattr(args, 'json', False):
        emit_json(rows_to_dicts(rows))
        conn.close()
        return

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


def query_position_detail(position_id, as_json=False):
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

    if as_json:
        # Assente → `null`, non un oggetto vuoto: chi legge deve poter
        # distinguere "non c'è" da "c'è ma è vuota" senza un secondo giro.
        emit_json(dict(r) if r else None)
        conn.close()
        return

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

    if getattr(args, 'missing_glassdoor', False):
        query += " AND glassdoor_rating IS NULL"

    if getattr(args, 'missing_verdict', False):
        query += " AND verdict IS NULL"

    query += " ORDER BY name"
    rows = conn.execute(query, params).fetchall()

    if getattr(args, 'json', False):
        emit_json(rows_to_dicts(rows))
        conn.close()
        return

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


def query_company_detail(name, as_json=False):
    conn = get_db()
    ensure_schema(conn)

    r = conn.execute("SELECT * FROM companies WHERE name LIKE ?", (f"%{name}%",)).fetchone()

    if as_json:
        if not r:
            emit_json(None)
            conn.close()
            return
        payload = dict(r)
        payload['positions'] = rows_to_dicts(conn.execute("""
            SELECT p.id, p.title, p.status, s.total_score
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            WHERE p.company_id = ?
            ORDER BY COALESCE(s.total_score, 0) DESC
        """, (r['id'],)).fetchall())
        emit_json(payload)
        conn.close()
        return

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


def dashboard(as_json=False):
    conn = get_db()
    ensure_schema(conn)

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

    if as_json:
        emit_json({
            'total': total,
            'by_status': {r['status']: r['cnt'] for r in statuses},
            'top_scores': rows_to_dicts(conn.execute("""
                SELECT p.id, p.title, p.company, s.total_score, p.status
                FROM positions p JOIN scores s ON s.position_id = p.id
                ORDER BY s.total_score DESC LIMIT 10
            """).fetchall()),
            'applications': rows_to_dicts(conn.execute("""
                SELECT p.id AS position_id, p.company, p.title, a.status,
                       a.critic_verdict, a.applied_at, a.written_at
                FROM applications a JOIN positions p ON p.id = a.position_id
                ORDER BY a.id DESC
            """).fetchall()),
            'companies_by_verdict': {
                r['verdict']: r['cnt'] for r in conn.execute(
                    "SELECT verdict, COUNT(*) as cnt FROM companies "
                    "WHERE verdict IS NOT NULL GROUP BY verdict"
                ).fetchall()
            },
            'positions_with_company_id': conn.execute(
                "SELECT COUNT(*) FROM positions WHERE company_id IS NOT NULL"
            ).fetchone()[0],
        })
        conn.close()
        return

    print("\n" + "=" * 60)
    print("  JOB HUNTER — DASHBOARD (Schema V2)")
    print("=" * 60)
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


def stats(as_json=False):
    conn = get_db()
    ensure_schema(conn)

    counts = {}
    for table in ['positions', 'companies', 'scores', 'applications']:
        counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if as_json:
        emit_json({**counts, 'schema_version': version})
        conn.close()
        return
    print(f"\npositions: {counts['positions']} | companies: {counts['companies']} | scores: {counts['scores']} | applications: {counts['applications']} | schema: V{version}")
    conn.close()


def recent_activity(minutes=30, limit=40, as_json=False):
    """Event-log OSSERVABILITÀ (lean-comms redesign): chi ha mosso quali posizioni,
    quando. Sostituisce i broadcast 'status' inter-agente — invece di narrare in chat
    'ho scorato #X / coda vuota', si QUERYa qui (pull, non push). Sorgente già
    esistente: position_state_transitions (by_agent, from→to, ts, notes). Tempi in UTC
    (CURRENT_TIMESTAMP). Vedi agents/_manual/communication-rules.md (Tier-1 DB)."""
    conn = get_db()
    ensure_schema(conn)
    rows = conn.execute(
        "SELECT ts, by_agent, position_id, from_state, to_state, notes "
        "FROM position_state_transitions "
        "WHERE ts >= datetime('now', ?) "
        "ORDER BY ts DESC LIMIT ?",
        (f'-{int(minutes)} minutes', int(limit))
    ).fetchall()
    if as_json:
        emit_json(rows_to_dicts(rows))
        conn.close()
        return
    if not rows:
        print(f"\nNessuna attività pipeline negli ultimi {minutes} min (UTC).")
        conn.close()
        return
    by_agent = {}
    for r in rows:
        by_agent[r['by_agent']] = by_agent.get(r['by_agent'], 0) + 1
    print(f"\nAttività pipeline ultimi {minutes} min ({len(rows)} transizioni, UTC):")
    print("  per-agente: " + ", ".join(
        f"{a}={n}" for a, n in sorted(by_agent.items(), key=lambda x: -x[1])))
    for r in rows:
        frm = r['from_state'] or '∅'
        note = f" — {r['notes'][:40]}" if r['notes'] else ""
        print(f"  {str(r['ts'])[11:19]} {str(r['by_agent'])[:14]:<14} "
              f"#{r['position_id']} {frm}→{r['to_state']}{note}")
    conn.close()


# ── Code di lavoro: il limite è un DEFAULT, non un tetto ────────────────
#
# Perché esiste (audit 2026-07-30, docs/internal/roadmap/2026-07-30-db-audit-
# observations.md): nessuna coda aveva un limite, quindi una sola invocazione
# riversava l'intero backlog nel contesto di un agente. Misurato col codice
# vero a 2.000 posizioni: `next-for-geocode-missing` = 1.375 righe / 78 KB /
# ~19.500 token; a 20.000 posizioni 13.741 righe ≈ 195.000 token, cioè più di
# una finestra di contesto in un comando solo.
#
# Il difetto NON è «l'agente vede troppe righe» — gli agenti devono poter
# interrogare il DB come ritengono. È «il comando ne stampa 13.000 senza che
# nessuno l'abbia chiesto». Quindi:
#   · `--limit N` su OGNI coda: chi sa cosa sta facendo sceglie il suo numero;
#   · `--all` / `--limit 0`: nessun limite, quando serve davvero;
#   · e soprattutto la coda dichiara SEMPRE il totale, non solo le righe
#     stampate — «(mostrate 20 di 1375)». Un limite silenzioso che nasconde il
#     backlog sarebbe peggio del problema originale: è lo stesso difetto già
#     noto di `recent-activity`, che elenca chi produce e quindi fa *sparire*
#     chi è fermo.
# La via SQL libera resta aperta e documentata: la skill `db-query` concede
# `Bash(python3 *)`, quindi una query custom con il proprio LIMIT è già lecita.
#
# Perché 20, uguale per tutte le code: una coda di lavoro serve a prendere il
# prossimo item, non a fotografare il backlog — l'Analista lavora UNA posizione
# per turno, lo Scorer una alla volta, e il quadro d'insieme (quante ce ne sono)
# ora arriva dal totale, che si vede sempre. 20 è un turno di lavoro abbondante
# (~1 KB) e resta lo stesso numero su tutte le code, così il contratto è uno
# solo da spiegare nei prompt in 7 lingue invece di undici numeri da ricordare.
DEFAULT_QUEUE_LIMIT = 20


def _sql_limit(limit):
    """Traduce il limite scelto dall'agente in un valore per `LIMIT ?`.

    `None` = non specificato → default della coda. `0` (e `--all`) = nessun
    limite → `-1`, che in SQLite significa "senza tetto". Negativi = come 0.
    """
    if limit is None:
        limit = DEFAULT_QUEUE_LIMIT
    limit = int(limit)
    return limit if limit > 0 else -1


def _emit_queue(conn, role, label, rows, sql_limit, as_json):
    """Uscita comune delle code: righe stampate + TOTALE in coda.

    Il totale NON viene da una seconda query: ogni SELECT porta
    `COUNT(*) OVER () AS _total`, che SQLite calcola sull'intero result set
    PRIMA di applicare il LIMIT. Una passata sola, totale esatto anche quando
    il limite taglia.
    """
    total = rows[0]['_total'] if rows else 0
    shown = len(rows)

    if as_json:
        emit_json({
            'queue': role,
            'label': label,
            # sempre presente: una coda spenta dalla policy dice `false` qui, e
            # chi legge non deve dedurlo dall'assenza di righe (vedi
            # _emit_disabled_queue).
            'enabled': True,
            'total': total,
            'shown': shown,
            'limit': None if sql_limit < 0 else sql_limit,
            'rows': [{k: v for k, v in dict(r).items() if k != '_total'}
                     for r in rows],
        })
        conn.close()
        return

    if not rows:
        print(f"\n{label}: nessuna.")
        conn.close()
        return

    counted = str(total) if shown == total else f"mostrate {shown} di {total}"
    print(f"\n{label} ({counted}):")
    for r in rows:
        extra = ""
        if 'total_score' in r.keys():
            extra = f" [score: {r['total_score']}]"
        print(f"  #{r['id']} {r['company'][:20]:<20} {r['title'][:35]}{extra}")
    if shown < total:
        print(f"  … altre {total - shown} in coda. Il limite è un default, non "
              f"un tetto: --limit N per vederne di più, --all per tutte.")
    conn.close()


def _emit_disabled_queue(conn, role, label, message, as_json):
    """Coda spenta dalla enrichment-policy: è uno stato voluto, non un errore.
    In JSON deve restare distinguibile da una coda vuota (`enabled: false`)."""
    if as_json:
        emit_json({
            'queue': role,
            'label': label,
            'enabled': False,
            'total': 0,
            'shown': 0,
            'limit': None,
            'rows': [],
        })
    else:
        print(message)
    conn.close()


def recheck_due_rows(conn, min_score=None, older_than_days=None, limit=None):
    """Coda del recheck cadenzato della MODALITÀ CURA (ex "recheck-weekly").

    Condivisa tra `next-for-recheck-due` e `recheck_batch.py` (il pre-filtro
    meccanico dell'Analista), così query e gate restano UNICI. Applica la
    enrichment-policy: ritorna None se la coda è disabilitata (stato voluto).
    Altrimenti ritorna (rows, min_score, older_than_days) con le posizioni
    ordinate per SCORE DECRESCENTE (prima le migliori — ordine 2026-07-30),
    a parità di score prima le mai verificate, poi le più stantie.
    """
    from enrichment_policy import is_enabled, recheck_options
    if not is_enabled('recheck_weekly'):
        return None
    opts = recheck_options()
    min_score = opts['min_score'] if min_score is None else min_score
    older_than_days = (opts['older_than_days'] if older_than_days is None
                       else older_than_days)
    rows = conn.execute("""
        SELECT p.id, p.title, p.company, p.url, p.last_checked, p.expires_at,
               s.total_score, COUNT(*) OVER () AS _total
        FROM positions p
        JOIN (SELECT position_id, MAX(total_score) AS total_score
              FROM scores GROUP BY position_id) s ON s.position_id = p.id
        WHERE p.status != 'excluded'
          AND s.total_score >= ?
          AND (p.last_checked IS NULL
               OR p.last_checked < datetime('now', ?))
        ORDER BY s.total_score DESC, (p.last_checked IS NOT NULL),
                 p.last_checked ASC
        LIMIT ?
    """, (min_score, f'-{older_than_days} days', _sql_limit(limit))).fetchall()
    return rows, min_score, older_than_days


def next_for_role(role, min_score=None, older_than_days=None, limit=None,
                  as_json=False):
    conn = get_db()
    ensure_schema(conn)
    lim = _sql_limit(limit)

    if role == 'analista':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.found_at, COUNT(*) OVER () AS _total
            FROM positions p
            WHERE p.status = 'new'
            ORDER BY p.found_at ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni new pronte per analisi"

    elif role == 'scorer':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.found_at, COUNT(*) OVER () AS _total
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'checked' AND s.id IS NULL
            ORDER BY p.found_at ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni checked senza score"

    elif role == 'scrittore':
        # Writer-on-demand (V6, 2026-05-29): filtro `write_requested = 1`.
        # Il CV viene scritto solo per le posizioni che l'utente ha
        # esplicitamente selezionato dal dashboard web o via Telegram
        # (`/cv <id>`). Vedi BACKLOG [JHT-WRITER-ON-DEMAND].
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, s.total_score, COUNT(*) OVER () AS _total
            FROM positions p
            JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            WHERE p.write_requested = 1
              AND s.total_score >= 50
              AND a.id IS NULL
              AND p.status = 'scored'
            ORDER BY p.write_requested_at ASC, s.total_score DESC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni con CV richiesto dall'utente (scored >= 50, no application)"

    elif role == 'critico':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, a.written_by, COUNT(*) OVER () AS _total
            FROM positions p
            JOIN applications a ON a.position_id = p.id
            WHERE a.status = 'review' AND a.critic_verdict IS NULL
            ORDER BY a.id ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Application in review senza verdict"

    elif role == 'geocoding':
        # Geocoding-on-demand (V8, 2026-05-31): filtro `geocode_requested = 1`.
        # L'Analista esegue `office-geocoding` solo per le posizioni che
        # l'utente ha esplicitamente selezionato dal dashboard web (button
        # "Geocodifica") o via Telegram. Replica del pattern Writer-on-demand.
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.loc_city, p.loc_country_code,
                   COUNT(*) OVER () AS _total
            FROM positions p
            WHERE p.geocode_requested = 1
              AND (p.office_geocoded IS NULL OR p.office_geocoded = 0)
            ORDER BY p.geocode_requested_at ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni con geocoding richiesto dall'utente (non ancora geocodate)"

    elif role == 'recheck':
        # RECHECK ON-DEMAND (2026-06-18): NON più autonomo. L'Analista ri-verifica
        # la liveness SOLO se l'utente l'ha richiesto dalla pagina posizione
        # (recheck_requested=1, stesso pattern di write/geocode/salary-precise).
        # NIENTE query "naturale" su last_open_check stale (era la causa del weekly
        # burn) e NIENTE backfill automatico dello storico. "Servito" =
        # last_open_check aggiornato DOPO recheck_requested_at → esce dalla coda
        # senza azzerare il flag (una nuova richiesta sposta avanti il timestamp).
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.expires_at, p.last_open_check,
                   COUNT(*) OVER () AS _total
            FROM positions p
            WHERE p.recheck_requested = 1
              AND (p.last_open_check IS NULL
                   OR p.last_open_check < p.recheck_requested_at)
            ORDER BY p.recheck_requested_at ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni con richeck richiesto dall'utente (liveness on-demand)"

    elif role == 'categorize':
        # Tassonomia EMERGENTE + SELF-HEALING (2026-06-15, GO utente): coda di
        # (ri)categorizzazione. Si ri-accoda chi NON è ancora incanalato dalla
        # tassonomia emergente = role_family NULL (mai categorizzata) OPPURE un
        # valore che NON è una categoria ATTIVA del registro e non è la sentinella
        # 'Other' (= drift legacy / categoria sparita). L'analista lo rivaluta →
        # match a un'attiva o 'Other' + proposta; il pass di promozione fa emergere
        # le categorie dai dati. Loop-guard: 'Other' (residuo già incanalato) e le
        # attive NON si ri-accodano mai. Il fix è nel codice + nel ciclo del team
        # (mai UPDATE esterni sui dati VPS). A registro VUOTO (cold-start) tutto il
        # non-'Other' è drift da rivalutare → bootstrap dell'emergenza (costo
        # accettato una-tantum: lo storico viene riproposto e poi clusterizzato).
        active = _read_active_categories(conn)
        if active:
            ph = ",".join("?" * len(active))
            drift_clause = f"OR (p.role_family NOT IN ({ph}) AND p.role_family <> 'Other')"
            qparams = list(active)
        else:
            drift_clause = "OR (p.role_family <> 'Other')"
            qparams = []
        rows = conn.execute(f"""
            SELECT p.id, p.title, p.company, p.location, p.role_family,
                   COUNT(*) OVER () AS _total
            FROM positions p
            WHERE (p.role_family IS NULL {drift_clause})
              AND p.status IN ('checked','scored','writing','review','ready')
            ORDER BY (p.role_family IS NOT NULL), p.created_at ASC
            LIMIT ?
        """, qparams + [lim]).fetchall()
        label = "Posizioni da (ri)categorizzare (mancante o drift → registro emergente)"

    elif role == 'salary-precise':
        # Parte B (2026-06-14): coda ON-DEMAND USER-DRIVEN. L'utente seleziona dal
        # dashboard/Telegram → salary_precise_requested = 1 (viaggia nel sync). L'analista
        # produce il breakdown preciso (azienda + media web + tasse + NETTO) in
        # salary_precise. Processa SOLO i flaggati non ancora prodotti.
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.salary_precise_requested_at,
                   COUNT(*) OVER () AS _total
            FROM positions p
            WHERE p.salary_precise_requested = 1
              AND (p.salary_precise IS NULL OR TRIM(p.salary_precise) = '')
            ORDER BY p.salary_precise_requested_at ASC
            LIMIT ?
        """, (lim,)).fetchall()
        label = "Posizioni con stima salary precisa richiesta dall'utente"

    elif role == 'recheck-due':
        # MODALITÀ CURA (2026-07-13 come "maintenance", rinominata + ritarata
        # 2026-07-30): recheck-liveness AUTONOMO ma cadenzato, per la modalità
        # cura (capitano-maintenance.json — filename storico). NON è il vecchio
        # recheck-continuo che causò il weekly burn (C-13): due gate lo tengono a bada —
        # (1) solo posizioni VIVE con best-score >= min_score (default 70: le migliori,
        # quelle che vale la pena tenere fresche); (2) cadenza QUINDICINALE per posizione
        # (ricontrolla solo chi non è verificato da > older_than_days giorni, default 14,
        # via last_checked). Una posizione verificata oggi esce dalla coda per due
        # settimane → consumo limitato e prevedibile. Ordine: SCORE DESC (prima le
        # migliori). Il lavoro meccanico lo fa recheck_batch.py; l'Analista decide
        # SOLO sui casi ambigui (l'esclusione non è mai di uno script).
        # Da usare SOLO in modalità cura.
        # Enrichment-policy (risparmio): coda vuota A CODICE se disabilitata —
        # vedi enrichment_policy.py. Coda vuota per policy = stato voluto.
        from enrichment_policy import is_enabled, disabled_reason, recheck_options
        if not is_enabled('recheck_weekly'):
            _emit_disabled_queue(
                conn, role, "Recheck cadenzato modalità cura",
                f"\nRecheck cadenzato modalità cura: "
                f"OFF — {disabled_reason('recheck_weekly')}.", as_json)
            return
        opts = recheck_options()
        min_score = opts['min_score'] if min_score is None else min_score
        older_than_days = (opts['older_than_days'] if older_than_days is None
                           else older_than_days)
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.last_checked, p.expires_at, s.total_score,
                   COUNT(*) OVER () AS _total
            FROM positions p
            JOIN (SELECT position_id, MAX(total_score) AS total_score
                  FROM scores GROUP BY position_id) s ON s.position_id = p.id
            WHERE p.status != 'excluded'
              AND s.total_score >= ?
              AND (p.last_checked IS NULL
                   OR p.last_checked < datetime('now', ?))
            ORDER BY (p.last_checked IS NOT NULL), p.last_checked ASC
            LIMIT ?
        """, (min_score, f'-{older_than_days} days', lim)).fetchall()
        label = (f"Recheck cadenzato modalità cura "
                 f"(vive, score>={min_score}, non verificate da >{older_than_days}gg)")

    elif role == 'geocode-missing':
        # MODALITÀ CURA (2026-07-13): geocoding AUTONOMO delle coordinate ufficio per
        # le posizioni VIVE che ne sono ancora sprovviste. A differenza di 'geocoding'
        # (on-demand, flag geocode_requested dell'utente — che NON passa dalla policy:
        # se l'utente chiede, si fa), qui l'Analista arricchisce in autonomia.
        # Da usare SOLO in modalità cura.
        # Enrichment-policy (risparmio): coda vuota A CODICE se disabilitata.
        from enrichment_policy import is_enabled, disabled_reason, geocode_options
        if not is_enabled('geocode_missing'):
            _emit_disabled_queue(
                conn, role, "Geocoding modalità cura",
                f"\nGeocoding modalità cura: "
                f"OFF — {disabled_reason('geocode_missing')}.", as_json)
            return
        opts = geocode_options()
        score_gate = ""
        remote_gate = ""
        params = []
        if opts['min_score'] is not None:
            score_gate = """
              AND EXISTS (SELECT 1 FROM scores sg
                          WHERE sg.position_id = p.id
                            AND sg.total_score >= ?)"""
            params.append(opts['min_score'])
        if opts['non_remote_only']:
            remote_gate = """
              AND LOWER(COALESCE(p.work_mode, '')) != 'remote'"""
        rows = conn.execute(f"""
            SELECT p.id, p.title, p.company, p.location, p.loc_city, p.loc_country_code,
                   COUNT(*) OVER () AS _total
            FROM positions p
            WHERE p.status != 'excluded'
              AND (p.office_lat IS NULL
                   OR p.office_geocoded IS NULL OR p.office_geocoded = 0)
              {score_gate}
              {remote_gate}
            ORDER BY p.found_at DESC
            LIMIT ?
        """, tuple(params + [lim])).fetchall()
        label = ("Geocoding modalità cura (posizioni vive senza coordinate ufficio"
                 + (f", score >= {opts['min_score']}" if opts['min_score'] is not None else "")
                 + (", non remote" if opts['non_remote_only'] else "") + ")")

    elif role == 'logo-missing':
        # MODALITÀ CURA (mig 056): logo aziendale per la pagina posizione web.
        # Coda per AZIENDE (non posizioni): companies con almeno una posizione
        # viva e logo mai tentato (logo_fetched 0/NULL — pattern office_geocoded:
        # un tentativo fallito marca logo_fetched=1 via `logo_fetch.py
        # --mark-attempted` e l'azienda esce dalla coda, niente retry a ogni
        # sweep). Ordinata per numero di posizioni vive → prima le aziende più
        # visibili sul sito. L'Analista esegue la skill `logo-extraction`.
        # Da usare SOLO in modalità cura.
        # Enrichment-policy (risparmio): coda vuota A CODICE se disabilitata;
        # con `logo.min_score` entrano SOLO le aziende con almeno una posizione
        # viva a best-score >= soglia (il gate non marca logo_fetched → quando
        # lo Scorer supera la soglia l'azienda rientra da sola).
        from enrichment_policy import is_enabled, disabled_reason, logo_min_score
        if not is_enabled('logo'):
            _emit_disabled_queue(
                conn, role, "Logo modalità cura",
                f"\nLogo modalità cura: OFF — {disabled_reason('logo')}.", as_json)
            return
        ms = logo_min_score()
        score_gate = ""
        params: list = []
        if ms is not None:
            score_gate = """
              AND EXISTS (SELECT 1 FROM positions p2
                          JOIN scores s2 ON s2.position_id = p2.id
                          WHERE p2.company_id = c.id
                            AND p2.status != 'excluded'
                            AND s2.total_score >= ?)"""
            params = [ms]
        # `COUNT(*) OVER ()` dopo un GROUP BY conta i GRUPPI (le aziende), che è
        # esattamente il totale di questa coda: le window function si applicano
        # alle righe già aggregate.
        rows = conn.execute(f"""
            SELECT c.id, c.name AS company,
                   COUNT(p.id) || ' posizioni vive · '
                     || COALESCE(c.website, 'NO WEBSITE (cercalo prima)') AS title,
                   COUNT(*) OVER () AS _total
            FROM companies c
            JOIN positions p ON p.company_id = c.id AND p.status != 'excluded'
            WHERE (c.logo_fetched IS NULL OR c.logo_fetched = 0)
              {score_gate}
            GROUP BY c.id
            ORDER BY COUNT(p.id) DESC, c.name ASC
            LIMIT ?
        """, tuple(params + [lim])).fetchall()
        label = ("Logo modalità cura (aziende con posizioni vive senza logo"
                 + (f", best-score >= {ms}" if ms is not None else "") + ")")

    else:
        print(f"Ruolo sconosciuto: {role}")
        conn.close()
        return

    _emit_queue(conn, role, label, rows, lim, as_json)


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
        # Stesso ancoraggio del livello 0 di `db_insert.check_duplicate`, e per
        # lo stesso motivo — qui pero' pesava di piu': il pattern aveva un `%`
        # anche FRA `view/` e l'id, quindi bastava che quelle cifre comparissero
        # in un punto qualsiasi di un URL job-view perche' questo Gate 1 dello
        # Scout dicesse TROVATA e gli facesse saltare un annuncio nuovo.
        # Il LIKE resta un prefiltro (nessun URL da cui `extract_linkedin_job_id`
        # ritorni <id> puo' non contenere `/jobs/view/<id>`), e il verdetto lo
        # da' la riestrazione dell'id dal path del candidato.
        r = None
        for cand in conn.execute(
            "SELECT id, title, company, url, status FROM positions WHERE url LIKE ?",
            (f"%/jobs/view/{url_or_id}%",)
        ):
            if extract_linkedin_job_id(cand['url']) == url_or_id:
                r = cand
                break
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

    # `--json` sui comandi di lettura: stessa query, seconda uscita. Vedi
    # emit_json() in testa al file per il contratto.
    JSON_HELP = 'Output JSON su una riga (per CLI e agenti; il default resta umano)'

    # positions
    p = sub.add_parser('positions')
    p.add_argument('--status')
    p.add_argument('--company')
    p.add_argument('--min-score', type=int)
    p.add_argument('--max-score', type=int)
    p.add_argument('--source')
    p.add_argument('--json', action='store_true', help=JSON_HELP)

    # position detail
    pd = sub.add_parser('position')
    pd.add_argument('id', type=int)
    pd.add_argument('--field', help='Stampa solo il valore di una colonna (bug #26): es. --field status. No header, plain stdout.')
    pd.add_argument('--json', action='store_true', help=JSON_HELP)

    # companies
    c = sub.add_parser('companies')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])
    c.add_argument(
        '--missing-glassdoor', action='store_true',
        help='Filtra companies senza glassdoor_rating (per QA Analista, '
             'address vps1-postmortem #2: 0/179 popolato).'
    )
    c.add_argument(
        '--missing-verdict', action='store_true',
        help='Filtra companies senza verdict (gap analysis Analista).'
    )
    c.add_argument('--json', action='store_true', help=JSON_HELP)

    # company detail
    cd = sub.add_parser('company')
    cd.add_argument('name')
    cd.add_argument('--json', action='store_true', help=JSON_HELP)

    # dashboard + stats
    db_p = sub.add_parser('dashboard')
    db_p.add_argument('--json', action='store_true', help=JSON_HELP)
    st_p = sub.add_parser('stats')
    st_p.add_argument('--json', action='store_true', help=JSON_HELP)
    # recent-activity: event-log osservabilità (lean-comms) — sostituisce i broadcast status
    ra = sub.add_parser('recent-activity')
    ra.add_argument('--minutes', type=int, default=30)
    ra.add_argument('--limit', type=int, default=40)
    ra.add_argument('--json', action='store_true', help=JSON_HELP)

    # next-for-*: ogni coda accetta --limit / --all / --json. Il default (20) è
    # un default e non un tetto — vedi DEFAULT_QUEUE_LIMIT — e il TOTALE in coda
    # viene stampato comunque, così alzare il limite è una scelta informata.
    def queue_parser(name):
        q = sub.add_parser(name)
        q.add_argument('--limit', type=int, default=None,
                       help=f'Quante righe stampare (default {DEFAULT_QUEUE_LIMIT}); '
                            f'0 = tutte. Il totale in coda è sempre dichiarato.')
        q.add_argument('--all', action='store_true',
                       help='Nessun limite: stampa tutta la coda (= --limit 0).')
        q.add_argument('--json', action='store_true', help=JSON_HELP)
        return q

    queue_parser('next-for-analista')
    queue_parser('next-for-scorer')
    queue_parser('next-for-scrittore')
    queue_parser('next-for-critico')
    queue_parser('next-for-geocoding')
    queue_parser('next-for-recheck')
    queue_parser('next-for-categorize')
    queue_parser('next-for-salary-precise')
    # Maintenance-mode queues (2026-07-13): autonome ma cadenzate/gated (vedi next_for_role).
    rw = queue_parser('next-for-recheck-weekly')
    rw.add_argument('--min-score', type=int, default=None,
                    help='Score minimo; omesso = valore della enrichment policy (default 70).')
    rw.add_argument('--older-than-days', type=int, default=None,
                    help='Anzianità minima; omesso = enrichment policy (default 7 giorni).')
    queue_parser('next-for-geocode-missing')
    queue_parser('next-for-logo-missing')

    # active-categories <user_id> (tassonomia emergente): nomi role_family
    # ATTIVI del registro per l'utente. Consumato dal write-guard (db_update)
    # e dal prompt analista (match-best-active-or-Altro). Nessuna lista
    # hardcoded: legge role_family_registry.
    ac = sub.add_parser('active-categories')
    ac.add_argument('user_id', nargs='?', default=None,
                    help='omesso → candidato locale (default VPS single-candidate)')
    ac.add_argument('--json', action='store_true', help='output JSON array')

    # other-pile (2026-06-20): posizioni nel parcheggio 'Other' con la proposta
    # dell'analista. L'analista le LEGGE per individuare a GIUDIZIO i grappoli di
    # offerte simili e promuoverli a famiglia (role_registry.py promote --ids ...).
    op = sub.add_parser('other-pile')
    op.add_argument('--limit', type=int, default=300)

    # category-sizes (2026-06-20): categorie attive con dimensione LIVE → trigger del
    # consulto/split col Capitano quando una famiglia diventa troppo grande.
    cs = sub.add_parser('category-sizes')
    cs.add_argument('user_id', nargs='?', default=None)
    cs.add_argument('--big', type=int, default=25, help='soglia direzionale "grande" (default 25)')

    # application (anti-riscrittura check)
    ap = sub.add_parser('application')
    ap.add_argument('position_id', type=int)

    # check-url
    cu = sub.add_parser('check-url')
    cu.add_argument('url', help='URL o job ID numerico LinkedIn')

    # cv-pdf-paths (bug #26 cv-disk-audit): 1 path per riga, script-friendly
    sub.add_parser('cv-pdf-paths')

    args = parser.parse_args()

    if args.cmd == 'positions':
        query_positions(args)
    elif args.cmd == 'position':
        # --field mode (bug #26): scriptable lookup. Bypassa il print
        # umano e stampa solo il valore della colonna richiesta.
        if getattr(args, 'field', None):
            conn = get_db()
            ensure_schema(conn)
            row = conn.execute(
                "SELECT * FROM positions WHERE id = ?", (args.id,)
            ).fetchone()
            if not row:
                sys.exit(1)
            val = row[args.field] if args.field in row.keys() else None
            print('' if val is None else val)
        else:
            query_position_detail(args.id, as_json=args.json)
    elif args.cmd == 'companies':
        query_companies(args)
    elif args.cmd == 'company':
        query_company_detail(args.name, as_json=args.json)
    elif args.cmd == 'dashboard':
        dashboard(as_json=args.json)
    elif args.cmd == 'stats':
        stats(as_json=args.json)
    elif args.cmd == 'recent-activity':
        recent_activity(args.minutes, args.limit, as_json=args.json)
    elif args.cmd == 'application':
        return query_application(args.position_id)
    elif args.cmd == 'check-url':
        check_url(args.url)
    elif args.cmd == 'cv-pdf-paths':
        # Bug #26 cv-disk-audit: stampa 1 path per riga, niente header.
        # Path NULL e stringhe vuote esclusi a monte (DB-side WHERE).
        conn = get_db()
        ensure_schema(conn)
        for r in conn.execute(
            "SELECT cv_pdf_path FROM applications "
            "WHERE cv_pdf_path IS NOT NULL AND TRIM(cv_pdf_path) != ''"
        ):
            print(r['cv_pdf_path'])
    elif args.cmd == 'active-categories':
        conn = get_db()
        ensure_schema(conn)
        names = active_categories(conn, args.user_id)
        if args.json:
            import json as _json
            print(_json.dumps(names, ensure_ascii=False))
        else:
            for n in names:
                print(n)
        conn.close()
    elif args.cmd == 'other-pile':
        conn = get_db()
        ensure_schema(conn)
        rows = conn.execute(
            "SELECT id, title, company, role_family_proposed FROM positions "
            "WHERE role_family = 'Other' "
            "ORDER BY role_family_proposed, id LIMIT ?",
            (args.limit,),
        ).fetchall()
        print(f"# {len(rows)} posizioni in 'Other' — raggruppa i SIMILI a giudizio, "
              f"poi: role_registry.py promote --name \"<famiglia>\" --ids <id,id,...>")
        for r in rows:
            prop = r['role_family_proposed'] or '—'
            title = (r['title'] or '')[:48]
            comp = (r['company'] or '')[:22]
            print(f"  #{r['id']}\t{prop}\t| {title} @ {comp}")
        conn.close()
    elif args.cmd == 'category-sizes':
        conn = get_db()
        ensure_schema(conn)
        actives = active_categories(conn, args.user_id)
        print(f"# categorie attive (dimensione live) — > {args.big} ⇒ valuta consulto/split col Capitano:")
        for name in actives:
            n = conn.execute(
                "SELECT COUNT(*) FROM positions WHERE role_family = ?", (name,)
            ).fetchone()[0]
            flag = '  ⚠ GRANDE' if n > args.big else ''
            print(f"  {n:>4}  {name}{flag}")
        other = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE role_family = 'Other'"
        ).fetchone()[0]
        print(f"  {other:>4}  Other (parcheggio — 'other-pile' per i grappoli da promuovere)")
        # NON categorizzate (role_family IS NULL): NON è una categoria, è il backlog
        # mai incanalato. Va mostrato qui o il quadro è falso (resta invisibile e ignorato).
        uncat = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE role_family IS NULL"
        ).fetchone()[0]
        flag = '  ⚠ DA CATEGORIZZARE SUBITO (next-for-categorize) — NULL non è una categoria' if uncat else ''
        print(f"  {uncat:>4}  NON categorizzate (role_family IS NULL){flag}")
        conn.close()
    elif args.cmd in ('next-for-recheck-due', 'next-for-recheck-weekly'):
        # `as_json` come TUTTE le altre code: questo ramo nasce dalla rinomina
        # in modalità cura (che ha aggiunto l'alias legacy) e il sistema del
        # limite/uscita JSON è arrivato da un altro ramo — fondendoli, questa
        # riga era l'unica rimasta senza. Il comando rispondeva in prosa anche
        # con `--json`, cioè illeggibile per chi lo chiama da programma.
        next_for_role('recheck-due', min_score=args.min_score,
                      older_than_days=args.older_than_days,
                      limit=args.limit, as_json=args.json)
    elif args.cmd.startswith('next-for-'):
        role = args.cmd.replace('next-for-', '')
        next_for_role(
            role,
            # solo next-for-recheck-weekly porta questi due
            min_score=getattr(args, 'min_score', None),
            older_than_days=getattr(args, 'older_than_days', None),
            # --all è la forma esplicita di "so cosa sto chiedendo": nessun limite
            limit=0 if args.all else args.limit,
            as_json=args.json,
        )


if __name__ == '__main__':
    sys.exit(main() or 0)
