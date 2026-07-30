#!/usr/bin/env python3
"""Migra i dati da tracking.md e file markdown → SQLite jobs.db.

Uso:
  python3 db_migrate.py              # migra tutto
  python3 db_migrate.py --dry-run    # mostra cosa farebbe senza scrivere
"""

import os
import re
import sys
import glob
import argparse
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema

BASE = os.path.join(os.path.dirname(__file__), '..', 'data')


def parse_tracking_md():
    """Legge tracking.md e restituisce lista di posizioni."""
    tracking_path = os.path.join(BASE, 'tracking.md')
    if not os.path.exists(tracking_path):
        print("tracking.md non trovato")
        return []

    with open(tracking_path, 'r') as f:
        content = f.read()

    # Rimuovi sezione SCARTATE — formato tabella diverso (3 colonne)
    # Parsa solo le tabelle a 8 colonne (ATTIVE e STANDBY)
    content_clean = re.split(r'## Candidature SCARTATE', content)[0]

    positions = []
    # Match righe tabella: | # | Data | Azienda | Posizione | Paese | Score | Stato | Note |
    pattern = r'\|\s*(\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|'

    for match in re.finditer(pattern, content_clean):
        num, date, company, title, location, score, status, notes = [
            m.strip() for m in match.groups()
        ]

        # Ignora header
        if num == '#' or num == '---':
            continue

        # Mappa stato vecchio → nuovo
        status_map = {
            'trovata': 'new',
            'analizzata': 'checked',
            'preparata': 'ready',
            'inviata': 'applied',
            'risposta': 'response',
            'standby': 'new',
            'scartata': 'new',
        }

        # Determina remote_type
        remote_type = None
        loc_lower = location.lower()
        if 'full remote' in loc_lower or 'remote' in loc_lower:
            remote_type = 'full_remote'
        elif 'hybrid' in loc_lower or 'ibrido' in loc_lower:
            remote_type = 'hybrid'
        elif 'on-site' in loc_lower or 'onsite' in loc_lower:
            remote_type = 'onsite'

        # Estrai salary da notes se presente
        salary_min = salary_max = None
        salary_currency = 'EUR'
        salary_match = re.search(r'(?:EUR|€)\s*(\d+)[-–](\d+)K', notes)
        if salary_match:
            salary_min = int(salary_match.group(1)) * 1000
            salary_max = int(salary_match.group(2)) * 1000
        else:
            salary_match = re.search(r'\$(\d+)K', notes)
            if salary_match:
                salary_max = int(salary_match.group(1)) * 1000
                salary_currency = 'USD'
            else:
                salary_match = re.search(r'GBP\s*(\d+)-(\d+)K', notes)
                if salary_match:
                    salary_min = int(salary_match.group(1)) * 1000
                    salary_max = int(salary_match.group(2)) * 1000
                    salary_currency = 'GBP'

        # Score numerico
        try:
            score_val = int(re.sub(r'[^0-9]', '', score)) if score else None
        except ValueError:
            score_val = None

        positions.append({
            'num': int(num),
            'title': title,
            'company': company,
            'location': location,
            'remote_type': remote_type,
            'salary_min': salary_min,
            'salary_max': salary_max,
            'salary_currency': salary_currency,
            'source': 'migrated',
            'found_at': date if date else None,
            'status': status_map.get(status, 'new'),
            'notes': notes,
            'score': score_val,
            'original_status': status,
        })

    return positions


def parse_companies():
    """Legge file da data/companies/ e restituisce lista aziende."""
    companies_dir = os.path.join(BASE, 'companies')
    if not os.path.isdir(companies_dir):
        return []

    companies = []
    for fpath in sorted(glob.glob(os.path.join(companies_dir, '*.md'))):
        fname = os.path.basename(fpath)
        if fname.startswith('VERIFICA') or fname.startswith('README'):
            continue

        with open(fpath, 'r') as f:
            content = f.read()

        # Skip file che non sono dossier aziendali (sono report di ricerca)
        if fname.startswith('ricerca-') or fname.startswith('VERIFICA'):
            continue

        # Estrai nome dall'header — pulisci prefissi come "Dossier Aziendale:", "DOSSIER AZIENDALE:"
        name_match = re.search(r'#\s*(.+)', content)
        if name_match:
            name = name_match.group(1).strip()
            # Rimuovi prefissi comuni
            for prefix in ['DOSSIER AZIENDALE:', 'Dossier Aziendale:', 'Aziendale:',
                           'Company Analysis', 'Company Dossier', '- Dossier Aziendale',
                           '- Company Analysis', '- Company Dossier']:
                name = name.replace(prefix, '')
            name = name.strip(' -—')
        else:
            name = fname.replace('.md', '').replace('-', ' ').title()

        # Estrai verdict
        verdict = None
        if re.search(r'(?:GO|✅\s*GO)', content, re.IGNORECASE):
            if re.search(r'NO.?GO', content, re.IGNORECASE):
                verdict = 'NO_GO'
            elif re.search(r'CAUTIOUS', content, re.IGNORECASE):
                verdict = 'CAUTIOUS'
            else:
                verdict = 'GO'

        # Estrai settore
        sector_match = re.search(r'(?:Settore|Sector|Industry)[:\s]*([^\n]+)', content, re.IGNORECASE)
        sector = sector_match.group(1).strip() if sector_match else None

        # Estrai website
        web_match = re.search(r'(?:Website|Sito)[:\s]*(https?://[^\s\n]+)', content, re.IGNORECASE)
        website = web_match.group(1).strip() if web_match else None

        # Estrai red flags
        red_flags = None
        rf_match = re.search(r'(?:Red [Ff]lag|⚠️)[s:]?\s*([^\n]+(?:\n[-*]\s+[^\n]+)*)', content)
        if rf_match:
            red_flags = rf_match.group(1).strip()[:500]

        companies.append({
            'name': name[:100],
            'website': website,
            'sector': sector,
            'verdict': verdict,
            'red_flags': red_flags,
            'analyzed_by': 'migrated',
        })

    return companies


def migrate(dry_run=False):
    """Esegue la migrazione completa."""
    conn = get_db()
    ensure_schema(conn)

    # Check se già migrato
    existing = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    if existing > 0:
        print(f"Database contiene già {existing} posizioni. Migrazione saltata.")
        print("Per ri-migrare, cancella jobs.db e riesegui db_init.py + db_migrate.py")
        conn.close()
        return

    # 1. Migra posizioni da tracking.md
    positions = parse_tracking_md()
    print(f"\nPosizioni trovate in tracking.md: {len(positions)}")

    pos_id_map = {}  # num → db_id
    for p in positions:
        if dry_run:
            print(f"  [DRY] INSERT position: {p['company']} — {p['title']} [{p['status']}]")
            continue

        cur = conn.execute("""
            INSERT INTO positions (title, company, location, remote_type, salary_min, salary_max,
                                   salary_currency, source, found_at, status, notes, found_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (p['title'], p['company'], p['location'], p['remote_type'],
              p['salary_min'], p['salary_max'], p['salary_currency'],
              p['source'], p['found_at'], p['status'], p['notes'], 'migrated'))

        db_id = cur.lastrowid
        pos_id_map[p['num']] = db_id

        # Inserisci score se presente
        if p['score'] is not None:
            conn.execute("""
                INSERT INTO scores (position_id, total_score, scored_by)
                VALUES (?, ?, ?)
            """, (db_id, p['score'] * 10, 'migrated'))  # vecchio score 1-10 → 10-100

    # 2. Migra aziende
    companies = parse_companies()
    print(f"Aziende trovate in companies/: {len(companies)}")

    for c in companies:
        if dry_run:
            print(f"  [DRY] INSERT company: {c['name']} [{c['verdict']}]")
            continue

        try:
            conn.execute("""
                INSERT OR IGNORE INTO companies (name, website, sector, verdict, red_flags, analyzed_by)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (c['name'], c['website'], c['sector'], c['verdict'], c['red_flags'], c['analyzed_by']))
        except Exception as e:
            print(f"  ERRORE inserimento {c['name']}: {e}")

    if not dry_run:
        conn.commit()

    # Report
    if not dry_run:
        pos_count = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
        comp_count = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
        score_count = conn.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
        print(f"\nMigrazione completata!")
        print(f"  Posizioni: {pos_count}")
        print(f"  Aziende: {comp_count}")
        print(f"  Score: {score_count}")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Migra dati markdown → SQLite')
    parser.add_argument('--dry-run', action='store_true', help='Mostra cosa farebbe senza scrivere')
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)


if __name__ == '__main__':
    main()
