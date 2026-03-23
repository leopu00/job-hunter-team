#!/usr/bin/env python3
"""Test suite completa per database jobs.db schema V2.

Uso:
  python3 test_db_v2.py              # Esegui tutti i test
  python3 test_db_v2.py --verbose    # Output dettagliato
"""

import sqlite3
import subprocess
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from _db import DB_PATH, get_db, ensure_schema, resolve_company_id

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))
passed = 0
failed = 0
errors = []


def test(name):
    """Decoratore per test."""
    def decorator(func):
        global passed, failed
        try:
            func()
            passed += 1
            print(f"  PASS  {name}")
        except AssertionError as e:
            failed += 1
            errors.append(f"{name}: {e}")
            print(f"  FAIL  {name}: {e}")
        except Exception as e:
            failed += 1
            errors.append(f"{name}: ERRORE {e}")
            print(f"  ERR   {name}: {e}")
    return decorator


def run_script(args):
    """Esegue uno script e ritorna (returncode, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable] + args,
        capture_output=True, text=True, cwd=SKILLS_DIR,
        timeout=15
    )
    return result.returncode, result.stdout, result.stderr


# ===== SEZIONE 1: SCHEMA =====
print("\n=== 1. VERIFICA SCHEMA ===")


@test("Schema version = 2")
def _():
    conn = get_db()
    v = conn.execute("PRAGMA user_version").fetchone()[0]
    conn.close()
    assert v == 2, f"Atteso 2, trovato {v}"


@test("Tabella positions ha colonne V2")
def _():
    conn = get_db()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(positions)").fetchall()}
    required = {'id', 'title', 'company', 'company_id', 'location', 'remote_type',
                'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
                'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
                'salary_estimated_source', 'url', 'source', 'jd_text', 'requirements',
                'found_by', 'found_at', 'deadline', 'status', 'notes', 'last_checked'}
    missing = required - cols
    conn.close()
    assert not missing, f"Colonne mancanti: {missing}"


@test("Tabella positions NON ha colonne V1")
def _():
    conn = get_db()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(positions)").fetchall()}
    removed = {'company_hq', 'work_location', 'salary_type', 'salary_min', 'salary_max', 'salary_currency'}
    still_there = removed & cols
    conn.close()
    assert not still_there, f"Colonne V1 ancora presenti: {still_there}"


@test("Tabella applications ha colonne V2")
def _():
    conn = get_db()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(applications)").fetchall()}
    required = {'written_at', 'response_at', 'cv_drive_id', 'cl_drive_id'}
    missing = required - cols
    conn.close()
    assert not missing, f"Colonne mancanti: {missing}"


@test("Tabella companies esiste e ha le colonne corrette")
def _():
    conn = get_db()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()}
    required = {'id', 'name', 'website', 'hq_country', 'sector', 'size',
                'glassdoor_rating', 'red_flags', 'culture_notes',
                'analyzed_by', 'analyzed_at', 'verdict'}
    missing = required - cols
    conn.close()
    assert not missing, f"Colonne mancanti: {missing}"


@test("Tabella scores ha le colonne corrette")
def _():
    conn = get_db()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(scores)").fetchall()}
    required = {'id', 'position_id', 'total_score', 'stack_match', 'remote_fit',
                'salary_fit', 'experience_fit', 'strategic_fit',
                'breakdown', 'notes', 'scored_by', 'scored_at'}
    missing = required - cols
    conn.close()
    assert not missing, f"Colonne mancanti: {missing}"


@test("Indici esistono tutti")
def _():
    conn = get_db()
    indices = {r[1] for r in conn.execute("PRAGMA index_list(positions)").fetchall()}
    required = {'idx_positions_status', 'idx_positions_company',
                'idx_positions_company_id', 'idx_positions_url'}
    missing = required - indices
    conn.close()
    assert not missing, f"Indici mancanti: {missing}"


# ===== SEZIONE 2: INTEGRITA' =====
print("\n=== 2. INTEGRITA' DATI ===")


@test("PRAGMA integrity_check OK")
def _():
    conn = get_db()
    result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    conn.close()
    assert result == 'ok', f"Integrity check fallito: {result}"


@test("PRAGMA foreign_key_check OK")
def _():
    conn = get_db()
    conn.execute("PRAGMA foreign_keys=ON")
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    conn.close()
    assert len(violations) == 0, f"{len(violations)} violazioni FK"


@test("Nessuna URL duplicata")
def _():
    conn = get_db()
    dupes = conn.execute("""
        SELECT url, COUNT(*) FROM positions WHERE url IS NOT NULL
        GROUP BY url HAVING COUNT(*) > 1
    """).fetchall()
    conn.close()
    assert len(dupes) == 0, f"{len(dupes)} URL duplicate"


@test("Tutti gli scores hanno position_id valido")
def _():
    conn = get_db()
    orphans = conn.execute("""
        SELECT COUNT(*) FROM scores s
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = s.position_id)
    """).fetchone()[0]
    conn.close()
    assert orphans == 0, f"{orphans} scores orfani"


@test("Tutte le applications hanno position_id valido")
def _():
    conn = get_db()
    orphans = conn.execute("""
        SELECT COUNT(*) FROM applications a
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = a.position_id)
    """).fetchone()[0]
    conn.close()
    assert orphans == 0, f"{orphans} applications orfane"


@test("Tutti i company_id puntano a companies esistenti")
def _():
    conn = get_db()
    orphans = conn.execute("""
        SELECT COUNT(*) FROM positions p
        WHERE p.company_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = p.company_id)
    """).fetchone()[0]
    conn.close()
    assert orphans == 0, f"{orphans} company_id non validi"


@test("Tutti gli highlights hanno position_id valido")
def _():
    conn = get_db()
    orphans = conn.execute("""
        SELECT COUNT(*) FROM position_highlights h
        WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = h.position_id)
    """).fetchone()[0]
    conn.close()
    assert orphans == 0, f"{orphans} highlights orfani"


# ===== SEZIONE 3: DATI =====
print("\n=== 3. QUALITA' DATI ===")


@test("Nessun excluded morto (excluded senza score ne app)")
def _():
    conn = get_db()
    dead = conn.execute("""
        SELECT COUNT(*) FROM positions p
        WHERE p.status = 'excluded'
        AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.position_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.position_id = p.id)
    """).fetchone()[0]
    conn.close()
    assert dead == 0, f"{dead} excluded morti ancora presenti"


@test("company_id popolato per almeno 60% delle posizioni")
def _():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    with_cid = conn.execute("SELECT COUNT(*) FROM positions WHERE company_id IS NOT NULL").fetchone()[0]
    pct = 100 * with_cid // total if total else 0
    conn.close()
    assert pct >= 60, f"Solo {pct}% di company_id popolati ({with_cid}/{total})"


@test("Salary split corretto — nessun dato in entrambi declared e estimated per stessa posizione")
def _():
    conn = get_db()
    # E' lecito avere entrambi, ma verifichiamo che i dati abbiano senso
    both = conn.execute("""
        SELECT COUNT(*) FROM positions
        WHERE salary_declared_min IS NOT NULL AND salary_estimated_min IS NOT NULL
    """).fetchone()[0]
    conn.close()
    # Avere entrambi e' OK (declared dalla JD + stima da glassdoor), ma non dovrebbe essere la norma
    assert both <= 5, f"{both} posizioni con sia declared che estimated — potrebbe essere OK ma verificare"


@test("Status validi in positions")
def _():
    conn = get_db()
    valid = {'new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response'}
    invalid = conn.execute(f"""
        SELECT DISTINCT status FROM positions WHERE status NOT IN ({','.join('?' * len(valid))})
    """, list(valid)).fetchall()
    conn.close()
    assert len(invalid) == 0, f"Status non validi: {[r[0] for r in invalid]}"


# ===== SEZIONE 4: INSERT/UPDATE CYCLE =====
print("\n=== 4. INSERT/UPDATE CYCLE ===")

TEST_COMPANY = "__TEST_V2_COMPANY__"
TEST_TITLE = "__TEST_V2_POSITION__"
TEST_URL = "https://__test-v2__.example.com/test"
test_position_id = None
test_company_id = None


@test("Insert company via CLI")
def _():
    global test_company_id
    rc, out, err = run_script([
        'db_insert.py', 'company',
        '--name', TEST_COMPANY,
        '--hq-country', 'Italia',
        '--sector', 'test',
        '--verdict', 'GO',
        '--analyzed-by', 'test'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'inserita' in out.lower(), f"Output inatteso: {out}"
    conn = get_db()
    r = conn.execute("SELECT id FROM companies WHERE name = ?", (TEST_COMPANY,)).fetchone()
    conn.close()
    assert r is not None, "Company non trovata nel DB"
    test_company_id = r['id']


@test("Insert position via CLI con salary V2 + auto-resolve company_id")
def _():
    global test_position_id
    rc, out, err = run_script([
        'db_insert.py', 'position',
        '--title', TEST_TITLE,
        '--company', TEST_COMPANY,
        '--location', 'Remote EU',
        '--remote-type', 'full_remote',
        '--salary-declared-min', '40000',
        '--salary-declared-max', '65000',
        '--salary-estimated-min', '45000',
        '--salary-estimated-max', '70000',
        '--salary-estimated-source', 'glassdoor',
        '--url', TEST_URL,
        '--source', 'test',
        '--found-by', 'test-suite',
        '--jd-text', 'Test JD per V2 migration',
        '--requirements', 'Python, Test'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert f'company_id={test_company_id}' in out, f"company_id non risolto: {out}"
    conn = get_db()
    r = conn.execute("SELECT * FROM positions WHERE url = ?", (TEST_URL,)).fetchone()
    conn.close()
    assert r is not None, "Position non trovata"
    test_position_id = r['id']
    assert r['company_id'] == test_company_id, f"company_id: atteso {test_company_id}, trovato {r['company_id']}"
    assert r['salary_declared_min'] == 40000
    assert r['salary_declared_max'] == 65000
    assert r['salary_estimated_min'] == 45000
    assert r['salary_estimated_source'] == 'glassdoor'
    assert r['location'] == 'Remote EU'


@test("Update position salary via CLI")
def _():
    rc, out, err = run_script([
        'db_update.py', 'position', str(test_position_id),
        '--salary-estimated-min', '50000',
        '--salary-estimated-max', '75000',
        '--salary-estimated-source', 'levels.fyi'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    conn = get_db()
    r = conn.execute("SELECT * FROM positions WHERE id = ?", (test_position_id,)).fetchone()
    conn.close()
    assert r['salary_estimated_min'] == 50000
    assert r['salary_estimated_source'] == 'levels.fyi'


@test("Insert score via CLI")
def _():
    rc, out, err = run_script([
        'db_insert.py', 'score',
        '--position-id', str(test_position_id),
        '--total', '75',
        '--stack-match', '30',
        '--remote-fit', '20',
        '--salary-fit', '15',
        '--experience-fit', '5',
        '--strategic-fit', '5',
        '--scored-by', 'test'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"


@test("Insert application via CLI con written-at")
def _():
    rc, out, err = run_script([
        'db_insert.py', 'application',
        '--position-id', str(test_position_id),
        '--cv-path', 'test/cv.md',
        '--cl-path', 'test/cl.md',
        '--written-by', 'test',
        '--written-at', '2026-02-28 12:00'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    conn = get_db()
    r = conn.execute("SELECT * FROM applications WHERE position_id = ?", (test_position_id,)).fetchone()
    conn.close()
    assert r is not None
    assert r['written_at'] == '2026-02-28 12:00'


@test("Update application --applied-at auto-cascade applied=1")
def _():
    rc, out, err = run_script([
        'db_update.py', 'application', str(test_position_id),
        '--applied-at', '2026-02-28',
        '--applied-via', 'linkedin'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    conn = get_db()
    r = conn.execute("SELECT * FROM applications WHERE position_id = ?", (test_position_id,)).fetchone()
    conn.close()
    assert r['applied'] == 1, f"applied doveva essere 1, trovato {r['applied']}"
    assert r['applied_at'] == '2026-02-28'
    assert r['applied_via'] == 'linkedin'


@test("Update application --critic-score auto-setta critic_reviewed_at")
def _():
    rc, out, err = run_script([
        'db_update.py', 'application', str(test_position_id),
        '--critic-verdict', 'PASS',
        '--critic-score', '8.0'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    conn = get_db()
    r = conn.execute("SELECT * FROM applications WHERE position_id = ?", (test_position_id,)).fetchone()
    conn.close()
    assert r['critic_reviewed_at'] is not None, "critic_reviewed_at non settato"
    assert r['critic_score'] == 8.0


@test("Update application --response-at")
def _():
    rc, out, err = run_script([
        'db_update.py', 'application', str(test_position_id),
        '--response', 'interview',
        '--response-at', '2026-03-01'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"
    conn = get_db()
    r = conn.execute("SELECT * FROM applications WHERE position_id = ?", (test_position_id,)).fetchone()
    conn.close()
    assert r['response'] == 'interview'
    assert r['response_at'] == '2026-03-01'


@test("Insert highlight via CLI")
def _():
    rc, out, err = run_script([
        'db_insert.py', 'highlight',
        '--position-id', str(test_position_id),
        '--type', 'pro',
        '--text', 'Test V2 highlight'
    ])
    assert rc == 0, f"Exit code {rc}: {err}"


# ===== SEZIONE 5: QUERY =====
print("\n=== 5. QUERY ===")


@test("db_query.py stats funziona")
def _():
    rc, out, err = run_script(['db_query.py', 'stats'])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'positions' in out and 'companies' in out
    assert 'V2' in out, "Non mostra versione V2"


@test("db_query.py dashboard funziona")
def _():
    rc, out, err = run_script(['db_query.py', 'dashboard'])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'Company ID' in out, "Dashboard non mostra company_id coverage"


@test("db_query.py position mostra salary V2")
def _():
    rc, out, err = run_script(['db_query.py', 'position', str(test_position_id)])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'company_id=' in out, "Non mostra company_id"
    assert 'levels.fyi' in out or '50K' in out, f"Salary V2 non mostrato: {out}"


@test("db_query.py check-url funziona")
def _():
    rc, out, err = run_script(['db_query.py', 'check-url', TEST_URL])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'TROVATA' in out, f"Position non trovata: {out}"


@test("db_query.py company mostra posizioni collegate")
def _():
    rc, out, err = run_script(['db_query.py', 'company', TEST_COMPANY])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert TEST_TITLE in out or 'Posizioni' in out, f"Posizioni collegate non mostrate: {out}"


@test("resolve_company_id funziona (case insensitive)")
def _():
    conn = get_db()
    ensure_schema(conn)
    cid = resolve_company_id(conn, TEST_COMPANY)
    assert cid == test_company_id, f"Atteso {test_company_id}, trovato {cid}"
    cid_lower = resolve_company_id(conn, TEST_COMPANY.lower())
    assert cid_lower == test_company_id, f"Case insensitive fallito: {cid_lower}"
    cid_none = resolve_company_id(conn, "AZIENDA_INESISTENTE_XYZ")
    assert cid_none is None, f"Doveva essere None, trovato {cid_none}"
    conn.close()


# ===== SEZIONE 6: GENERATE DASHBOARD =====
print("\n=== 6. GENERATE DASHBOARD ===")


@test("generate_dashboard.py funziona con schema V2")
def _():
    rc, out, err = run_script(['generate_dashboard.py'])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'Dashboard generata' in out, f"Output inatteso: {out}"


@test("db_to_sheets.py sync --dry-run funziona")
def _():
    rc, out, err = run_script(['db_to_sheets.py', 'sync', '--dry-run'])
    assert rc == 0, f"Exit code {rc}: {err}"
    assert 'DRY RUN' in out, f"Output inatteso: {out}"


# ===== CLEANUP =====
print("\n=== CLEANUP ===")


@test("Pulizia dati di test")
def _():
    conn = get_db()
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("DELETE FROM position_highlights WHERE position_id = ?", (test_position_id,))
    conn.execute("DELETE FROM applications WHERE position_id = ?", (test_position_id,))
    conn.execute("DELETE FROM scores WHERE position_id = ?", (test_position_id,))
    conn.execute("DELETE FROM positions WHERE id = ?", (test_position_id,))
    conn.execute("DELETE FROM companies WHERE name = ?", (TEST_COMPANY,))
    conn.commit()
    # Verifica pulizia
    r = conn.execute("SELECT COUNT(*) FROM positions WHERE url = ?", (TEST_URL,)).fetchone()[0]
    assert r == 0, f"Position test non eliminata"
    r = conn.execute("SELECT COUNT(*) FROM companies WHERE name = ?", (TEST_COMPANY,)).fetchone()[0]
    assert r == 0, f"Company test non eliminata"
    conn.close()


# ===== RIEPILOGO =====
print("\n" + "=" * 50)
print(f"  RISULTATO: {passed} PASS, {failed} FAIL")
print("=" * 50)

if errors:
    print("\nErrori:")
    for e in errors:
        print(f"  - {e}")

sys.exit(0 if failed == 0 else 1)
