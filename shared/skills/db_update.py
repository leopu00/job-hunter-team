#!/usr/bin/env python3
"""Aggiorna dati nel database jobs.db (schema V2).

Uso:
  python3 db_update.py position 42 --status checked
  python3 db_update.py position 42 --status scored --notes "Ottimo match"
  python3 db_update.py company "Adaptify" --verdict GO --red-flags "piccola"
  python3 db_update.py application 42 --critic-verdict PASS --critic-score 8.5 --reviewed-by critico
  python3 db_update.py application 42 --status applied --applied-at "2026-02-19" --applied-via "dynamite"

Salary V2:
  python3 db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000
  python3 db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

Tracking temporale:
  python3 db_update.py application 42 --written-at "2026-02-20 14:30"
  python3 db_update.py application 42 --response "rejected" --response-at "2026-02-25"
"""

import argparse
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, resolve_company_id


def update_position(args):
    conn = get_db()
    ensure_schema(conn)

    # Bug #14: cattura lo stato corrente PRIMA dell'UPDATE per registrare
    # la transizione. Se status non cambia (es. solo notes aggiornate),
    # nessuna entry viene scritta nel transition log.
    previous_status = None
    if args.status:
        row = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (args.id,)
        ).fetchone()
        if row is not None:
            previous_status = row[0] if not hasattr(row, "keys") else row["status"]

    updates = []
    params = []
    changed = []  # campi leggibili per output

    if args.status:
        updates.append("status = ?")
        params.append(args.status)
        changed.append(f"status={args.status}")
    if args.notes:
        updates.append("notes = ?")
        params.append(args.notes)
        changed.append(f"notes={args.notes[:40]}...")
    if args.jd_text:
        updates.append("jd_text = ?")
        params.append(args.jd_text)
        changed.append("jd_text")
    if args.requirements:
        updates.append("requirements = ?")
        params.append(args.requirements)
        changed.append("requirements")
    if args.location:
        updates.append("location = ?")
        params.append(args.location)
        changed.append(f"location={args.location}")
    if args.remote_type:
        updates.append("remote_type = ?")
        params.append(args.remote_type)
        changed.append(f"remote_type={args.remote_type}")
    if args.url:
        updates.append("url = ?")
        params.append(args.url)
        changed.append("url")
    if args.deadline:
        updates.append("deadline = ?")
        params.append(args.deadline)
        changed.append(f"deadline={args.deadline}")
    if args.title:
        updates.append("title = ?")
        params.append(args.title)
        changed.append(f"title={args.title}")
    if args.company:
        updates.append("company = ?")
        params.append(args.company)
        changed.append(f"company={args.company}")
        # Auto-resolve company_id quando si aggiorna il nome azienda
        cid = resolve_company_id(conn, args.company)
        if cid:
            updates.append("company_id = ?")
            params.append(cid)
            changed.append(f"company_id={cid}")
    if args.salary_declared_min is not None:
        updates.append("salary_declared_min = ?")
        params.append(args.salary_declared_min)
        changed.append(f"salary_declared_min={args.salary_declared_min}")
    if args.salary_declared_max is not None:
        updates.append("salary_declared_max = ?")
        params.append(args.salary_declared_max)
        changed.append(f"salary_declared_max={args.salary_declared_max}")
    if args.salary_declared_currency:
        updates.append("salary_declared_currency = ?")
        params.append(args.salary_declared_currency)
        changed.append(f"salary_declared_currency={args.salary_declared_currency}")
    if args.salary_estimated_min is not None:
        updates.append("salary_estimated_min = ?")
        params.append(args.salary_estimated_min)
        changed.append(f"salary_estimated_min={args.salary_estimated_min}")
    if args.salary_estimated_max is not None:
        updates.append("salary_estimated_max = ?")
        params.append(args.salary_estimated_max)
        changed.append(f"salary_estimated_max={args.salary_estimated_max}")
    if args.salary_estimated_currency:
        updates.append("salary_estimated_currency = ?")
        params.append(args.salary_estimated_currency)
        changed.append(f"salary_estimated_currency={args.salary_estimated_currency}")
    if args.salary_estimated_source:
        updates.append("salary_estimated_source = ?")
        params.append(args.salary_estimated_source)
        changed.append(f"salary_estimated_source={args.salary_estimated_source}")
    if args.source:
        updates.append("source = ?")
        params.append(args.source)
        changed.append(f"source={args.source}")
    if args.last_checked:
        if args.last_checked == 'now':
            updates.append("last_checked = datetime('now', 'localtime')")
        else:
            updates.append("last_checked = ?")
            params.append(args.last_checked)
        changed.append(f"last_checked={args.last_checked}")

    # Role family + location strutturata (popolata dall'analista).
    # Convenzione: stringa vuota "" => SET NULL (per "ripulire" un campo).
    _loc_fields = (
        ('role_family',       'role_family'),
        ('loc_city',          'loc_city'),
        ('loc_region',        'loc_region'),
        ('loc_country',       'loc_country'),
        ('loc_country_code',  'loc_country_code'),
        ('loc_continent',     'loc_continent'),
        ('work_mode',         'work_mode'),
        ('work_country',      'work_country'),
        ('work_country_code', 'work_country_code'),
        ('location_notes',    'location_notes'),
    )
    for arg_name, col in _loc_fields:
        v = getattr(args, arg_name, None)
        if v is not None:
            if v == "":
                updates.append(f"{col} = NULL")
                changed.append(f"{col}=NULL")
            else:
                updates.append(f"{col} = ?")
                params.append(v)
                changed.append(f"{col}={v[:40]}" if len(v) > 40 else f"{col}={v}")
    if args.is_multi_location is not None:
        updates.append("is_multi_location = ?")
        params.append(1 if args.is_multi_location == 'true' else 0)
        changed.append(f"is_multi_location={args.is_multi_location}")

    # Office geocoding (skill office-geocoding)
    if args.office_lat is not None:
        updates.append("office_lat = ?")
        params.append(args.office_lat)
        changed.append(f"office_lat={args.office_lat}")
    if args.office_lon is not None:
        updates.append("office_lon = ?")
        params.append(args.office_lon)
        changed.append(f"office_lon={args.office_lon}")
    if args.office_address is not None:
        if args.office_address == "":
            updates.append("office_address = NULL")
            changed.append("office_address=NULL")
        else:
            updates.append("office_address = ?")
            params.append(args.office_address)
            changed.append(f"office_address={args.office_address[:40]}")
    if args.office_geocoded is not None:
        updates.append("office_geocoded = ?")
        params.append(1 if args.office_geocoded == 'true' else 0)
        changed.append(f"office_geocoded={args.office_geocoded}")
    if args.office_verified is not None:
        updates.append("office_verified = ?")
        params.append(1 if args.office_verified == 'true' else 0)
        changed.append(f"office_verified={args.office_verified}")

    if not updates:
        print("Nessun campo da aggiornare.")
        return

    # Auto-popola `last_actor` con il nome dell'istanza dell'agente
    # (esportato da start-agent.sh come JHT_AGENT_NAME, es.
    # "scrittore-1", "critico-s2"). Senza l'env var ricade su un
    # placeholder così la UI può comunque distinguere chi ha agito.
    actor = os.environ.get('JHT_AGENT_NAME') or os.environ.get('JHT_AGENT_DIR', '').split('/')[-1] or 'unknown'
    updates.append("last_actor = ?")
    params.append(actor)

    params.append(args.id)
    cursor = conn.execute(f"UPDATE positions SET {', '.join(updates)} WHERE id = ?", params)
    if cursor.rowcount == 0:
        print(f"⚠️  ERRORE: nessuna posizione trovata con id={args.id}!")
        conn.close()
        sys.exit(1)

    # Bug #14: log transition se status è cambiato. La INSERT è
    # idempotente per (position_id, ts) — due UPDATE consecutivi con lo
    # stesso status producono una sola entry perché previous_status sarà
    # uguale a args.status al secondo turno. notes opzionale: passiamo le
    # notes della UPDATE se rilevanti (es. 'GEO mismatch' nel caso
    # excluded), altrimenti None.
    if args.status and previous_status != args.status:
        transition_notes = args.notes if args.notes else None
        conn.execute(
            "INSERT INTO position_state_transitions "
            "(position_id, from_state, to_state, by_agent, notes) "
            "VALUES (?, ?, ?, ?, ?)",
            (args.id, previous_status, args.status, actor, transition_notes),
        )

    conn.commit()
    print(f"Posizione {args.id} aggiornata: {', '.join(changed)}")
    conn.close()


def update_company(args):
    conn = get_db()
    ensure_schema(conn)

    updates = []
    params = []

    if args.verdict:
        updates.append("verdict = ?")
        params.append(args.verdict)
    if args.red_flags:
        updates.append("red_flags = ?")
        params.append(args.red_flags)
    if args.culture_notes:
        updates.append("culture_notes = ?")
        params.append(args.culture_notes)
    if args.sector:
        updates.append("sector = ?")
        params.append(args.sector)
    if args.size:
        updates.append("size = ?")
        params.append(args.size)
    if args.glassdoor_rating:
        updates.append("glassdoor_rating = ?")
        params.append(args.glassdoor_rating)
    if args.analyzed_by:
        updates.append("analyzed_by = ?")
        params.append(args.analyzed_by)
    if args.hq_country:
        updates.append("hq_country = ?")
        params.append(args.hq_country)

    if not updates:
        print("Nessun campo da aggiornare.")
        return

    params.append(args.name)
    conn.execute(f"UPDATE companies SET {', '.join(updates)} WHERE name = ?", params)
    conn.commit()
    print(f"Azienda '{args.name}' aggiornata: {', '.join(updates)}")
    conn.close()


def update_application(args):
    conn = get_db()
    ensure_schema(conn)

    updates = []
    params = []

    if args.status:
        updates.append("status = ?")
        params.append(args.status)
    if args.critic_verdict:
        updates.append("critic_verdict = ?")
        params.append(args.critic_verdict)
    if args.critic_score is not None:
        updates.append("critic_score = ?")
        params.append(args.critic_score)
        updates.append("critic_reviewed_at = datetime('now', 'localtime')")
    if args.critic_notes:
        updates.append("critic_notes = ?")
        params.append(args.critic_notes)
    if args.critic_round is not None:
        updates.append("critic_round = ?")
        params.append(args.critic_round)
    if args.reviewed_by:
        updates.append("reviewed_by = ?")
        params.append(args.reviewed_by)
    if args.written_at:
        if args.written_at == 'now':
            updates.append("written_at = datetime('now', 'localtime')")
        else:
            updates.append("written_at = ?")
            params.append(args.written_at)
    if args.applied_at:
        if args.applied_at == 'now':
            updates.append("applied_at = datetime('now', 'localtime')")
        else:
            updates.append("applied_at = ?")
            params.append(args.applied_at)
        # Auto-cascade: se si setta applied_at, segna anche applied=1
        updates.append("applied = 1")
    if args.applied_via:
        updates.append("applied_via = ?")
        params.append(args.applied_via)
    if args.response:
        updates.append("response = ?")
        params.append(args.response)
    if args.response_at:
        if args.response_at == 'now':
            updates.append("response_at = datetime('now', 'localtime')")
        else:
            updates.append("response_at = ?")
            params.append(args.response_at)
    if args.cv_path:
        updates.append("cv_path = ?")
        params.append(args.cv_path)
    if args.cl_path:
        updates.append("cl_path = ?")
        params.append(args.cl_path)
    if args.cv_pdf_path:
        updates.append("cv_pdf_path = ?")
        params.append(args.cv_pdf_path)
    if args.cl_pdf_path:
        updates.append("cl_pdf_path = ?")
        params.append(args.cl_pdf_path)
    if args.applied is not None:
        updates.append("applied = ?")
        params.append(1 if args.applied.lower() in ('true', '1', 'yes') else 0)
    if args.interview_round is not None:
        updates.append("interview_round = ?")
        params.append(args.interview_round)

    if not updates:
        print("Nessun campo da aggiornare.")
        return

    params.append(args.position_id)
    cursor = conn.execute(f"UPDATE applications SET {', '.join(updates)} WHERE position_id = ?", params)
    if cursor.rowcount == 0:
        # UPSERT: nessuna application esistente → INSERT iniziale.
        # Senza questo path, lo Scrittore deve fare INSERT a mano via
        # python3 -c "import sqlite3 ..." e finiva per passare la stringa
        # 'now' invece di datetime('now') — bug dei record con
        # written_at='now' letterale (vedi audit 2026-05-02).
        # Verifica che la position esista (FK guard).
        if not conn.execute("SELECT 1 FROM positions WHERE id = ?", (args.position_id,)).fetchone():
            print(f"⚠️  position_id={args.position_id} non esiste in positions. Abort INSERT.")
            conn.close()
            return
        # Default: written_at=now se non specificato; written_by se passato
        # via --reviewed-by NON va qui, va nel campo reviewed_by.
        # Costruiamo INSERT solo coi campi noti dall'UPDATE + position_id.
        ins_cols = ['position_id']
        ins_vals = [args.position_id]
        ins_placeholders = ['?']
        # Riusa la stessa coerenza UPDATE→INSERT campo-per-campo.
        for clause, val in _zip_set_clauses(updates, params[:-1]):
            col = clause.split('=', 1)[0].strip()
            rhs = clause.split('=', 1)[1].strip()
            ins_cols.append(col)
            if rhs == '?':
                ins_placeholders.append('?')
                ins_vals.append(val)
            else:
                # es. datetime('now', 'localtime') — espressione SQL inline
                ins_placeholders.append(rhs)
        # written_at di default a now se non gia' settato
        if 'written_at' not in ins_cols:
            ins_cols.append('written_at')
            ins_placeholders.append("datetime('now', 'localtime')")
        # written_by da $JHT_AGENT_ID se settato (start-agent.sh lo esporta)
        if 'written_by' not in ins_cols and os.environ.get('JHT_AGENT_ID'):
            ins_cols.append('written_by')
            ins_placeholders.append('?')
            ins_vals.append(os.environ['JHT_AGENT_ID'])
        sql = f"INSERT INTO applications ({', '.join(ins_cols)}) VALUES ({', '.join(ins_placeholders)})"
        conn.execute(sql, ins_vals)
        conn.commit()
        print(f"Application per posizione {args.position_id} CREATA (INSERT iniziale).")
        conn.close()
        return
    conn.commit()
    print(f"Application per posizione {args.position_id} aggiornata ({cursor.rowcount} riga)")
    conn.close()


def _zip_set_clauses(set_clauses, params):
    """Itera coppie (clause, param) dove clause = 'col = ?' o 'col = expr'.

    Le clausole con RHS='?' consumano un param dalla lista; quelle con
    espressione SQL inline (es. datetime(...)) non consumano nulla.
    """
    pi = 0
    for c in set_clauses:
        rhs = c.split('=', 1)[1].strip()
        if rhs == '?':
            yield c, params[pi]
            pi += 1
        else:
            yield c, None


def main():
    parser = argparse.ArgumentParser(description='Aggiorna dati in jobs.db')
    sub = parser.add_subparsers(dest='entity', required=True)

    # position
    p = sub.add_parser('position')
    p.add_argument('id', type=int)
    p.add_argument('--status', choices=['new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response'])
    p.add_argument('--notes')
    p.add_argument('--jd-text')
    p.add_argument('--requirements')
    p.add_argument('--location')
    p.add_argument('--remote-type', choices=['full_remote', 'hybrid', 'onsite'])
    p.add_argument('--url')
    p.add_argument('--deadline', help='Data scadenza YYYY-MM-DD o "non presente"')
    p.add_argument('--title')
    p.add_argument('--company')
    p.add_argument('--salary-declared-min', type=int)
    p.add_argument('--salary-declared-max', type=int)
    p.add_argument('--salary-declared-currency')
    p.add_argument('--salary-estimated-min', type=int)
    p.add_argument('--salary-estimated-max', type=int)
    p.add_argument('--salary-estimated-currency')
    p.add_argument('--salary-estimated-source', help='Fonte stima: glassdoor, levels.fyi, manual')
    p.add_argument('--source')
    p.add_argument('--last-checked', help='Data/ora ultima verifica link (YYYY-MM-DD HH:MM o "now")')
    # Role family (categoria semantica del ruolo)
    p.add_argument('--role-family', help='Categoria semantica popolata dall\'analista (es. "Technical Writing", "CAD / CNC"). Vedi docs/internal/2026-05-23-location-playbook.md')
    # Location strutturata (popolata dall'analista). Vedi playbook 2026-05-23.
    p.add_argument('--loc-city', help='Città di ufficio (es. "Dublin"). NULL se solo paese/continente.')
    p.add_argument('--loc-region', help='Regione/stato (es. "Friuli-Venezia Giulia"). Opzionale.')
    p.add_argument('--loc-country', help='Paese di ufficio (es. "Italy"). NULL se solo continente.')
    p.add_argument('--loc-country-code', help='ISO-3166 alpha-2 (es. "IT").')
    p.add_argument('--loc-continent', choices=['Europe', 'Asia', 'Americas', 'Africa', 'Oceania'])
    p.add_argument('--work-mode', choices=['onsite', 'hybrid', 'remote'], help='Modalità di lavoro. Rimpiazza is_remote/remote_type.')
    p.add_argument('--work-country', help='Paese contrattuale (entity che firma). Determina stipendio/CCNL.')
    p.add_argument('--work-country-code', help='ISO-2 del paese contrattuale.')
    p.add_argument('--is-multi-location', choices=['true', 'false'], help='true se JD elenca più città/paesi (pin singolo su centroide).')
    p.add_argument('--location-notes', help='Note libere analista (es. "EU multi-country: NL+DE+GB")')
    # Office geocoding precise (skill office-geocoding)
    p.add_argument('--office-lat', type=float, help='Latitudine WGS84 ufficio (es. 41.8933203)')
    p.add_argument('--office-lon', type=float, help='Longitudine WGS84 ufficio (es. 12.4829321)')
    p.add_argument('--office-address', help='Indirizzo completo ufficio (display_name del geocoder)')
    p.add_argument('--office-geocoded', choices=['true', 'false'], help='true se è stato fatto geocoding (anche se fallito)')
    p.add_argument('--office-verified', choices=['true', 'false'], help='true se SEI SICURO sia l\'ufficio giusto; false se city-level/multi-ambiguo')

    # company
    c = sub.add_parser('company')
    c.add_argument('name')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])
    c.add_argument('--red-flags')
    c.add_argument('--culture-notes')
    c.add_argument('--hq-country', help='Paese sede principale')
    c.add_argument('--sector')
    c.add_argument('--size')
    c.add_argument('--glassdoor-rating', type=float)
    c.add_argument('--analyzed-by')

    # application
    a = sub.add_parser('application')
    a.add_argument('position_id', type=int)
    a.add_argument('--status', choices=['draft', 'review', 'ready', 'approved', 'applied', 'response'])
    a.add_argument('--critic-verdict', choices=['PASS', 'NEEDS_WORK', 'REJECT'])
    a.add_argument('--critic-score', type=float)
    a.add_argument('--critic-notes')
    a.add_argument('--critic-round', type=int, help='Numero round critico (1 o 2)')
    a.add_argument('--reviewed-by')
    a.add_argument('--written-at', help='Quando il CV è stato creato (YYYY-MM-DD HH:MM o "now")')
    a.add_argument('--applied-at', help='Quando la candidatura è stata inviata')
    a.add_argument('--applied-via')
    a.add_argument('--response', help='Risposta ricevuta')
    a.add_argument('--response-at', help='Quando è arrivata la risposta (YYYY-MM-DD HH:MM o "now")')
    a.add_argument('--cv-path')
    a.add_argument('--cl-path')
    a.add_argument('--cv-pdf-path')
    a.add_argument('--cl-pdf-path')
    a.add_argument('--applied', help='true/false — se l\'utente ha inviato la candidatura')
    a.add_argument('--interview-round', type=int, help='Fase colloquio (1, 2, 3...)')

    args = parser.parse_args()

    if args.entity == 'position':
        update_position(args)
    elif args.entity == 'company':
        update_company(args)
    elif args.entity == 'application':
        update_application(args)


if __name__ == '__main__':
    main()
