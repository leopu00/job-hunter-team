#!/usr/bin/env python3
"""Server localhost per la dashboard Job Hunter.

Serve la dashboard + API JSON + terminale tmux agenti.

Uso:
  python3 dashboard_server.py              # porta 8080
  python3 dashboard_server.py --port 3000  # porta custom
"""

import http.server
import json
import os
import sys
import argparse
import subprocess
import urllib.parse

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SKILLS_DIR, '..', 'data')
GENERATE_SCRIPT = os.path.join(SKILLS_DIR, 'generate_dashboard.py')

sys.path.insert(0, SKILLS_DIR)
from _db import get_db, ensure_schema

REPO_ROOT = os.path.abspath(os.path.join(SKILLS_DIR, '..', '..'))

# Mappa ruolo -> (emoji report, modello)
ROLE_CONFIG = {
    'scout': ('🕵️‍♂️', 'sonnet'),
    'analista': ('👨‍🔬', 'sonnet'),
    'scorer': ('👨‍💻', 'sonnet'),
    'scrittore': ('👨‍🏫', 'opus'),
    'critico': ('👨‍⚖️', 'opus'),
    'mentor': ('👨🏻‍⚕️', 'sonnet'),
}

def discover_agents():
    """Scopri agenti dalle worktree git esistenti."""
    agents = []
    try:
        result = subprocess.run(
            ['git', 'worktree', 'list', '--porcelain'],
            capture_output=True, text=True, timeout=5,
            cwd=os.path.join(REPO_ROOT, 'alfa')
        )
        for line in result.stdout.split('\n'):
            if line.startswith('worktree '):
                wt_path = line[len('worktree '):]
                dirname = os.path.basename(wt_path)
                # Match pattern: role-N or role
                for role_key, (emoji, model) in ROLE_CONFIG.items():
                    if dirname.startswith(role_key):
                        suffix = dirname[len(role_key):]
                        # scout-1, scout-2, analista-1, scorer, critico, etc.
                        if suffix == '' or (suffix.startswith('-') and suffix[1:].isdigit()):
                            session_name = dirname.upper()
                            role_display = role_key.capitalize()
                            if role_key == 'scrittore':
                                role_display = 'Scrittore'
                            elif role_key == 'critico':
                                role_display = 'Critico'
                            agents.append((session_name, role_display))
                            break
    except Exception:
        # Fallback statico
        agents = [
            ('SCOUT-1', 'Scout'), ('SCOUT-2', 'Scout'), ('SCOUT-3', 'Scout'),
            ('ANALISTA-1', 'Analista'), ('ANALISTA-2', 'Analista'),
            ('SCORER-1', 'Scorer'),
            ('SCRITTORE-1', 'Scrittore'), ('SCRITTORE-2', 'Scrittore'), ('SCRITTORE-3', 'Scrittore'),
            ('CRITICO', 'Critico'),
            ('MENTOR', 'Mentor'),
        ]
    # Aggiungi critici dinamici (sessioni S1/S2/S3) e Mentor (non è una git worktree)
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                           capture_output=True, text=True, timeout=5)
        for s in (r.stdout.strip().split('\n') if r.stdout.strip() else []):
            if 'CRITICO-S' in s and not any(a[0] == s for a in agents):
                agents.append((s, 'Critico'))
            if s == 'MENTOR' and not any(a[0] == 'MENTOR' for a in agents):
                agents.append(('MENTOR', 'Mentor'))
    except Exception:
        pass
    # Assicura che Mentor sia sempre presente (anche se offline)
    if not any(a[0] == 'MENTOR' for a in agents):
        agents.append(('MENTOR', 'Mentor'))
    return agents


def create_agent(role_key, number):
    """Crea un nuovo agente: worktree + branch + CLAUDE.md."""
    if role_key not in ROLE_CONFIG:
        return {'ok': False, 'error': f'Ruolo sconosciuto: {role_key}'}

    agent_name = f"{role_key}-{number}"
    wt_path = os.path.join(REPO_ROOT, agent_name)

    if os.path.exists(wt_path):
        return {'ok': False, 'error': f'Worktree {agent_name} esiste già'}

    emoji, model = ROLE_CONFIG[role_key]

    try:
        # Crea branch e worktree
        subprocess.run(
            ['git', 'worktree', 'add', wt_path, '-b', agent_name],
            capture_output=True, text=True, timeout=15,
            cwd=os.path.join(REPO_ROOT, 'alfa')
        )

        # Trova un CLAUDE.md esistente dello stesso ruolo da copiare
        template_source = None
        for i in range(1, 10):
            candidate = os.path.join(REPO_ROOT, f"{role_key}-{i}", 'CLAUDE.md')
            if os.path.isfile(candidate):
                template_source = candidate
                break
        # Fallback: prova senza numero (es. "critico", "scorer")
        if not template_source:
            candidate = os.path.join(REPO_ROOT, role_key, 'CLAUDE.md')
            if os.path.isfile(candidate):
                template_source = candidate

        if template_source:
            with open(template_source, 'r') as f:
                content = f.read()

            # Adatta il contenuto al nuovo numero
            old_base = os.path.basename(os.path.dirname(template_source))
            # Sostituisci tutte le varianti: scout-1, Scout-1, SCOUT-1
            old_cap = old_base.capitalize().replace('-', '-')  # scout-1 -> Scout-1 (non funziona con -)
            new_cap = agent_name.capitalize().replace('-', '-')
            # Manuale: "Scout-1" -> "Scout-4" (capitalize prima del trattino)
            old_title = old_base.split('-')[0].capitalize() + '-' + old_base.split('-')[1] if '-' in old_base else old_base.capitalize()
            new_title = agent_name.split('-')[0].capitalize() + '-' + agent_name.split('-')[1] if '-' in agent_name else agent_name.capitalize()
            content = content.replace(old_title, new_title)      # Scout-1 -> Scout-4
            content = content.replace(old_base, agent_name)       # scout-1 -> scout-4
            content = content.replace(old_base.upper(), agent_name.upper())  # SCOUT-1 -> SCOUT-4

            dest = os.path.join(wt_path, 'CLAUDE.md')
            with open(dest, 'w') as f:
                f.write(content)

        # Aggiorna start-agent.sh se necessario
        _ensure_start_agent_entry(agent_name, emoji, model)

        return {'ok': True, 'agent': agent_name, 'path': wt_path}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def remove_agent(role_key, number):
    """Rimuove un agente: kill sessione + rimuovi worktree."""
    agent_name = f"{role_key}-{number}"
    emoji = ROLE_CONFIG.get(role_key, ('', ''))[0]
    session_name = f"{emoji} {agent_name.upper()}"
    wt_path = os.path.join(REPO_ROOT, agent_name)

    if not os.path.exists(wt_path):
        return {'ok': False, 'error': f'Worktree {agent_name} non esiste'}

    try:
        # Kill sessione tmux se attiva
        subprocess.run(['tmux', 'kill-session', '-t', session_name],
                       capture_output=True, timeout=5)

        # Rimuovi worktree
        subprocess.run(
            ['git', 'worktree', 'remove', wt_path, '--force'],
            capture_output=True, text=True, timeout=15,
            cwd=os.path.join(REPO_ROOT, 'alfa')
        )

        # Rimuovi branch
        subprocess.run(
            ['git', 'branch', '-D', agent_name],
            capture_output=True, text=True, timeout=5,
            cwd=os.path.join(REPO_ROOT, 'alfa')
        )

        return {'ok': True, 'agent': agent_name, 'removed': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def _ensure_start_agent_entry(agent_name, emoji, model):
    """Aggiunge entry allo start-agent.sh se non esiste."""
    script_path = os.path.join(REPO_ROOT, 'alfa', 'scripts', 'scripts', 'start-agent.sh')
    with open(script_path, 'r') as f:
        content = f.read()

    entry = f'    {agent_name})'
    if entry not in content:
        new_line = f'    {agent_name})     echo "{emoji}|{agent_name}|{model}" ;;'
        # Inserisci prima della riga *) (default case)
        content = content.replace('    *)           echo "" ;;',
                                  f'{new_line}\n    *)           echo "" ;;')
        with open(script_path, 'w') as f:
            f.write(content)


def get_scout_activity():
    """Estrai attività corrente degli scout dal tmux e dal DB di coordinazione."""
    import sqlite3 as sqlite3_mod
    import re as re_mod

    result = {'coordination': [], 'activity': {}}

    # 1. Leggi distribuzione dal DB coordinazione
    coord_db_path = os.path.join(DATA_DIR, 'scout_coordination.db')
    if os.path.exists(coord_db_path):
        try:
            cdb = sqlite3_mod.connect(coord_db_path)
            cdb.row_factory = sqlite3_mod.Row
            rows = cdb.execute(
                "SELECT scout, cerchi, fonti, note, started_at FROM coordination WHERE superseded_at IS NULL ORDER BY scout"
            ).fetchall()
            result['coordination'] = [dict(r) for r in rows]
            # Storico: ultima sessione chiusa
            hist = cdb.execute(
                "SELECT scout, cerchi, fonti, started_at, superseded_at FROM coordination WHERE superseded_at IS NOT NULL ORDER BY superseded_at DESC LIMIT 10"
            ).fetchall()
            result['history'] = [dict(r) for r in hist]
            cdb.close()
        except Exception:
            pass

    # 2. Parse tmux output per ogni scout online
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                           capture_output=True, text=True, timeout=5)
        sessions = [s for s in (r.stdout.strip().split('\n') if r.stdout.strip() else []) if 'SCOUT' in s]
    except Exception:
        sessions = []

    for sess in sessions:
        try:
            r = subprocess.run(['tmux', 'capture-pane', '-t', sess, '-p', '-S', '-30'],
                               capture_output=True, text=True, timeout=3)
            output = r.stdout
            info = _parse_scout_output(output, sess)
            # Nome agente: "SCOUT-1" -> "scout-1"
            agent_key = sess.lower()
            result['activity'][agent_key] = info
        except Exception:
            pass

    # 3. Ultime 30 posizioni inserite (per feed scout)
    try:
        conn = get_db()
        ensure_schema(conn)
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.found_by, p.found_at, p.source, p.location, p.remote_type
            FROM positions p
            ORDER BY p.found_at DESC
            LIMIT 30
        """).fetchall()
        result['recent_positions'] = [dict(r) for r in rows]
        # Conteggio totale trovate oggi
        today = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE date(found_at) = date('now', 'localtime')"
        ).fetchone()[0]
        result['total_found_today'] = today
        # Totale posizioni con status 'new' (pipeline)
        total_new = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE status = 'new'"
        ).fetchone()[0]
        result['total_new'] = total_new

        # Stats per scout nella sessione corrente
        scout_stats = []
        try:
            # Leggi timestamp creazione sessioni tmux
            tmux_r = subprocess.run(
                ['tmux', 'list-sessions', '-F', '#{session_name}|||#{session_created}'],
                capture_output=True, text=True, timeout=5
            )
            import time as time_mod
            now_ts = time_mod.time()
            for line in (tmux_r.stdout.strip().split('\n') if tmux_r.stdout.strip() else []):
                if '|||' not in line or 'SCOUT' not in line:
                    continue
                sname, screated = line.split('|||', 1)
                if not screated.isdigit():
                    continue
                created_ts = int(screated)
                agent_key = sname.split(' ', 1)[-1].lower() if ' ' in sname else sname.lower()
                # Converti timestamp unix a datetime per query SQL
                from datetime import datetime as dt_cls
                created_dt = dt_cls.fromtimestamp(created_ts).strftime('%Y-%m-%d %H:%M:%S')
                # Conta posizioni trovate da questo scout OGGI (tutto il giorno)
                today_str = dt_cls.now().strftime('%Y-%m-%d')
                found_today = conn.execute(
                    "SELECT COUNT(*) FROM positions WHERE found_by = ? AND found_at >= ?",
                    (agent_key, today_str)
                ).fetchone()[0]
                # Ultimo inserimento di questo scout (dal DB, non dal tmux)
                last_row = conn.execute(
                    "SELECT id, title, company, found_at FROM positions WHERE found_by = ? ORDER BY found_at DESC LIMIT 1",
                    (agent_key,)
                ).fetchone()
                last_insert = None
                last_insert_at = None
                if last_row:
                    last_insert = f"#{last_row['id']} {last_row['title']} @ {last_row['company']}"
                    last_insert_at = last_row['found_at']
                elapsed_min = (now_ts - created_ts) / 60
                rate = elapsed_min / found_today if found_today > 0 else None
                scout_stats.append({
                    'scout': agent_key,
                    'session_start': created_dt,
                    'elapsed_min': round(elapsed_min, 1),
                    'positions_found': found_today,
                    'min_per_position': round(rate, 1) if rate else None,
                    'last_insert': last_insert,
                    'last_insert_at': last_insert_at,
                })
        except Exception:
            pass
        result['scout_session_stats'] = scout_stats
        conn.close()
    except Exception:
        result['recent_positions'] = []

    return result


def _parse_scout_output(output, session_name):
    """Analizza l'output tmux di uno scout per capire cosa sta facendo."""
    import re as re_mod
    lines = output.strip().split('\n')
    info = {
        'phase': None,        # 'fase0', 'cerchio1', 'cerchio2', etc.
        'action': None,       # 'searching', 'inserting', 'checking', 'idle', 'stopped'
        'detail': None,       # Dettaglio testuale breve
        'last_insert': None,  # Ultima posizione inserita
        'positions_found': 0, # Conteggio inserimenti in questa sessione
        'current_source': None,  # Fonte corrente (RemoteOK, Greenhouse, etc.)
    }

    # Cerca pattern nell'output (dal basso verso l'alto per avere il più recente)
    for line in reversed(lines):
        line_s = line.strip()
        if not line_s:
            continue

        # Fermato
        if any(w in line_s.lower() for w in ['fermo', 'fermati', 'mi fermo', 'pausa', 'stop']):
            if info['action'] is None:
                info['action'] = 'stopped'
                info['detail'] = 'In pausa'

        # Fase 0
        if 'FASE 0' in line_s or 'email LinkedIn' in line_s or 'imap_reader' in line_s:
            if info['phase'] is None:
                info['phase'] = 'fase0'

        # Cerchi
        m = re_mod.search(r'[Cc]erchio\s*(\d)', line_s)
        if m and info['phase'] is None:
            info['phase'] = f'cerchio{m.group(1)}'

        # Inserimento
        m = re_mod.search(r'ID:\s*(\d+)|#(\d{2,4})\b.*?inserit', line_s, re_mod.IGNORECASE)
        if m:
            pid = m.group(1) or m.group(2)
            info['positions_found'] += 1
            if info['last_insert'] is None:
                info['last_insert'] = f'#{pid}'

        m = re_mod.search(r'Posizione inserita con ID:\s*(\d+)', line_s)
        if m:
            info['positions_found'] += 1
            if info['last_insert'] is None:
                info['last_insert'] = f'#{m.group(1)}'

        # Azione corrente
        if 'Web Search' in line_s and info['action'] is None:
            info['action'] = 'searching'
            # Estrai query
            mq = re_mod.search(r'Web Search\("([^"]{0,60})', line_s)
            if mq:
                info['detail'] = f'WebSearch: {mq.group(1)}...'
            info['current_source'] = 'WebSearch'

        if 'fetch' in line_s.lower() and 'MCP' in line_s and info['action'] is None:
            info['action'] = 'fetching'
            mq = re_mod.search(r'url:\s*"([^"]{0,80})', line_s)
            if mq:
                # Estrai dominio
                dm = re_mod.search(r'https?://([^/]+)', mq.group(1))
                info['detail'] = f'Fetch: {dm.group(1)}' if dm else f'Fetch: {mq.group(1)[:50]}'
                if 'greenhouse' in mq.group(1):
                    info['current_source'] = 'Greenhouse'
                elif 'lever' in mq.group(1):
                    info['current_source'] = 'Lever'
                elif 'remoteok' in mq.group(1):
                    info['current_source'] = 'RemoteOK'

        if 'curl' in line_s and 'linkedin' in line_s and info['action'] is None:
            info['action'] = 'fetching'
            info['detail'] = 'Fetch LinkedIn JD via curl'
            info['current_source'] = 'LinkedIn'

        if 'db_insert' in line_s and info['action'] is None:
            info['action'] = 'inserting'
            info['detail'] = 'Inserimento nel DB'

        if 'check-url' in line_s and info['action'] is None:
            info['action'] = 'checking'
            info['detail'] = 'Check duplicati'

        # Thinking/working indicator
        if ('esc to interrupt' in line_s or 'thinking' in line_s) and info['action'] is None:
            info['action'] = 'thinking'
            info['detail'] = 'Elaborazione...'

    # Default
    if info['action'] is None:
        info['action'] = 'idle'
    if info['phase'] is None:
        info['phase'] = 'sconosciuta'

    return info


def get_analista_activity():
    """Estrai attività corrente degli analisti dal tmux e dati coda/elaborati dal DB."""
    import sqlite3 as sqlite3_mod
    import re as re_mod

    result = {'activity': {}, 'queue': [], 'recent_processed': [],
              'queue_size': 0, 'analyzed_today': 0, 'excluded_today': 0,
              'analista_session_stats': []}

    # 1. Parse tmux per ogni analista online
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                           capture_output=True, text=True, timeout=5)
        sessions = [s for s in (r.stdout.strip().split('\n') if r.stdout.strip() else []) if 'ANALISTA' in s]
    except Exception:
        sessions = []

    for sess in sessions:
        try:
            r = subprocess.run(['tmux', 'capture-pane', '-t', sess, '-p', '-S', '-30'],
                               capture_output=True, text=True, timeout=3)
            output = r.stdout
            info = _parse_analista_output(output, sess)
            agent_key = sess.split(' ', 1)[-1].lower() if ' ' in sess else sess.lower()
            result['activity'][agent_key] = info
        except Exception:
            pass

    # 1b. Arricchisci current_position con titolo e azienda dal DB
    try:
        conn_enrich = get_db()
        ensure_schema(conn_enrich)
        import re as re_mod2
        for agent_key, info in result['activity'].items():
            cp = info.get('current_position', '')
            if cp:
                m = re_mod2.search(r'#(\d+)', cp)
                if m:
                    pid = int(m.group(1))
                    row = conn_enrich.execute(
                        "SELECT title, company FROM positions WHERE id = ?", (pid,)
                    ).fetchone()
                    if row:
                        info['current_title'] = row[0]
                        info['current_company'] = row[1]
        conn_enrich.close()
    except Exception:
        pass

    # 2. Dati DB
    try:
        conn = get_db()
        ensure_schema(conn)

        # Coda: ultime 10 posizioni 'new' (più recenti = prossime da elaborare dagli analisti)
        queue_rows = conn.execute("""
            SELECT id, title, company, location, remote_type, source, found_by, found_at, notes
            FROM positions WHERE status = 'new'
            ORDER BY id DESC LIMIT 10
        """).fetchall()
        result['queue'] = [dict(r) for r in queue_rows]

        # Ultime 10 checked (risultato diretto del lavoro analisti: new → checked)
        processed_rows = conn.execute("""
            SELECT id, title, company, location, remote_type, status, source, found_by, found_at, last_checked, notes
            FROM positions WHERE status = 'checked'
            ORDER BY COALESCE(last_checked, found_at) DESC LIMIT 10
        """).fetchall()
        result['recent_processed'] = [dict(r) for r in processed_rows]

        # Ultime 10 escluse (log trasparenza: perché sono sparite dalla coda)
        excluded_rows = conn.execute("""
            SELECT id, title, company, location, remote_type, status, source, found_by, found_at, last_checked, notes
            FROM positions WHERE status = 'excluded' AND last_checked IS NOT NULL
            ORDER BY last_checked DESC LIMIT 10
        """).fetchall()
        result['recent_excluded'] = [dict(r) for r in excluded_rows]

        # Conteggi
        result['queue_size'] = conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'new'").fetchone()[0]
        result['checked_total'] = conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'checked'").fetchone()[0]

        # Checked/escluse oggi (approssimazione via last_checked)
        result['analyzed_today'] = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE status = 'checked' AND date(last_checked) = date('now', 'localtime')"
        ).fetchone()[0]
        result['excluded_today'] = conn.execute(
            "SELECT COUNT(*) FROM positions WHERE status = 'excluded' AND date(last_checked) = date('now', 'localtime')"
        ).fetchone()[0]

        # Stats per analista
        import time as time_mod
        try:
            tmux_r = subprocess.run(
                ['tmux', 'list-sessions', '-F', '#{session_name}|||#{session_created}'],
                capture_output=True, text=True, timeout=5
            )
            now_ts = time_mod.time()
            for line in (tmux_r.stdout.strip().split('\n') if tmux_r.stdout.strip() else []):
                if '|||' not in line or 'ANALISTA' not in line:
                    continue
                sname, screated = line.split('|||', 1)
                if not screated.isdigit():
                    continue
                created_ts = int(screated)
                agent_key = sname.split(' ', 1)[-1].lower() if ' ' in sname else sname.lower()
                from datetime import datetime as dt_cls
                created_dt = dt_cls.fromtimestamp(created_ts).strftime('%Y-%m-%d %H:%M:%S')
                elapsed_min = (now_ts - created_ts) / 60
                result['analista_session_stats'].append({
                    'analista': agent_key,
                    'session_start': created_dt,
                    'elapsed_min': round(elapsed_min, 1),
                })
        except Exception:
            pass

        # Ratio e categorie esclusione (pie chart) — SOLO OGGI
        excluded_today_rows = conn.execute("""
            SELECT notes FROM positions
            WHERE status = 'excluded' AND date(last_checked) = date('now', 'localtime')
        """).fetchall()
        result['ratio'] = {
            'checked': result.get('analyzed_today', 0),
            'excluded': result.get('excluded_today', 0),
        }
        cats = {}
        for row in excluded_today_rows:
            cat = _categorize_exclusion(row[0] or '')
            cats[cat] = cats.get(cat, 0) + 1
        result['exclusion_categories'] = cats

        conn.close()
    except Exception:
        pass

    return result


def get_scorer_activity():
    """Estrai attività corrente dello scorer dal tmux e dati coda/elaborati dal DB."""
    import re as re_mod

    result = {'activity': {}, 'queue': [], 'recent_scored': [], 'recent_excluded': [],
              'queue_size': 0, 'scored_today': 0, 'excluded_today': 0,
              'scored_total': 0, 'scorer_session_stats': []}

    # 1. Parse tmux per scorer online
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                           capture_output=True, text=True, timeout=5)
        sessions = [s for s in (r.stdout.strip().split('\n') if r.stdout.strip() else []) if 'SCORER' in s]
    except Exception:
        sessions = []

    for sess in sessions:
        try:
            r = subprocess.run(['tmux', 'capture-pane', '-t', sess, '-p', '-S', '-30'],
                               capture_output=True, text=True, timeout=3)
            output = r.stdout
            info = _parse_scorer_output(output)
            agent_key = sess.split(' ', 1)[-1].lower() if ' ' in sess else sess.lower()
            result['activity'][agent_key] = info
        except Exception:
            pass

    # 1b. Arricchisci current_position
    try:
        conn_e = get_db()
        ensure_schema(conn_e)
        for agent_key, info in result['activity'].items():
            cp = info.get('current_position', '')
            if cp:
                m = re_mod.search(r'#(\d+)', cp)
                if m:
                    pid = int(m.group(1))
                    row = conn_e.execute("SELECT title, company FROM positions WHERE id = ?", (pid,)).fetchone()
                    if row:
                        info['current_title'] = row[0]
                        info['current_company'] = row[1]
        conn_e.close()
    except Exception:
        pass

    # 2. Dati DB
    try:
        conn = get_db()
        ensure_schema(conn)

        # Coda: posizioni checked (pronte per scoring), più recenti prima
        queue_rows = conn.execute("""
            SELECT id, title, company, location, remote_type, source, found_by, found_at, last_checked, notes
            FROM positions WHERE status = 'checked'
            ORDER BY last_checked DESC LIMIT 10
        """).fetchall()
        result['queue'] = [dict(r) for r in queue_rows]

        # Ultime 10 scored (solo >= 50, range 40-49 sono riserve nascoste)
        scored_rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status,
                   s.total_score, s.scored_at, s.scored_by
            FROM positions p
            JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'scored' AND s.total_score >= 50
            ORDER BY s.scored_at DESC LIMIT 10
        """).fetchall()
        result['recent_scored'] = [dict(r) for r in scored_rows]

        # Ultime 10 escluse dallo scorer (score < 40)
        excluded_rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status,
                   s.total_score, s.scored_at, s.scored_by, p.notes
            FROM positions p
            JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'excluded' AND s.total_score < 40
            ORDER BY s.scored_at DESC LIMIT 10
        """).fetchall()
        result['recent_excluded'] = [dict(r) for r in excluded_rows]

        # Conteggi
        result['queue_size'] = conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'checked'").fetchone()[0]
        result['scored_total'] = conn.execute("SELECT COUNT(*) FROM positions p JOIN scores s ON s.position_id = p.id WHERE p.status = 'scored' AND s.total_score >= 50").fetchone()[0]
        result['scored_today'] = conn.execute(
            "SELECT COUNT(*) FROM scores WHERE date(scored_at) = date('now', 'localtime')"
        ).fetchone()[0]
        result['excluded_today'] = conn.execute("""
            SELECT COUNT(*) FROM positions p JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'excluded' AND s.total_score < 40
            AND date(s.scored_at) = date('now', 'localtime')
        """).fetchone()[0]

        # Media score della sessione (oggi)
        avg_row = conn.execute(
            "SELECT AVG(total_score) FROM scores WHERE date(scored_at) = date('now', 'localtime')"
        ).fetchone()
        result['avg_score_today'] = round(avg_row[0], 1) if avg_row[0] is not None else None

        # Session stats
        import time as time_mod
        try:
            tmux_r = subprocess.run(
                ['tmux', 'list-sessions', '-F', '#{session_name}|||#{session_created}'],
                capture_output=True, text=True, timeout=5
            )
            now_ts = time_mod.time()
            for line in (tmux_r.stdout.strip().split('\n') if tmux_r.stdout.strip() else []):
                if '|||' not in line or 'SCORER' not in line:
                    continue
                sname, screated = line.split('|||', 1)
                if not screated.isdigit():
                    continue
                created_ts = int(screated)
                from datetime import datetime as dt_cls
                created_dt = dt_cls.fromtimestamp(created_ts).strftime('%Y-%m-%d %H:%M:%S')
                elapsed_min = (now_ts - created_ts) / 60
                scorer_key = sname.split(' ', 1)[-1].lower() if ' ' in sname else sname.lower()
                result['scorer_session_stats'].append({
                    'scorer': scorer_key,
                    'session_start': created_dt,
                    'elapsed_min': round(elapsed_min, 1),
                })
        except Exception:
            pass

        conn.close()
    except Exception:
        pass

    return result


def _parse_scorer_output(output):
    """Analizza l'output tmux dello scorer."""
    import re as re_mod
    lines = output.strip().split('\n')
    info = {
        'action': None,
        'detail': None,
        'current_position': None,
    }

    for line in reversed(lines):
        line_s = line.strip()
        if not line_s:
            continue

        if any(w in line_s.lower() for w in ['fermo', 'fermati', 'mi fermo', 'pausa', 'stop']):
            if info['action'] is None:
                info['action'] = 'stopped'
                info['detail'] = 'In pausa'

        if 'db_update' in line_s and info['action'] is None:
            info['action'] = 'updating'
            info['detail'] = 'Aggiornamento DB'

        if 'db_query' in line_s and info['action'] is None:
            info['action'] = 'querying'
            info['detail'] = 'Query DB'

        if ('esc to interrupt' in line_s or 'thinking' in line_s) and info['action'] is None:
            info['action'] = 'scoring'
            info['detail'] = 'Scoring...'

        if ('curl' in line_s or 'fetch' in line_s.lower()) and info['action'] is None:
            info['action'] = 'verifying'
            info['detail'] = 'Verifica link'

        m = re_mod.search(r'#(\d{2,4})\b', line_s)
        if m and info['current_position'] is None:
            info['current_position'] = f'#{m.group(1)}'

    if info['action'] is None:
        info['action'] = 'idle'

    return info


def _categorize_exclusion(notes):
    """Categorizza il motivo di esclusione dalle notes."""
    n = notes.lower()
    first_line = n.split('\n')[0]
    # Tag esplicito ESCLUSA: [CAT] (formato nuovo obbligatorio)
    import re as _re
    m = _re.search(r'esclus[ao]:\s*\[(\w+)\]', n)
    if m:
        return m.group(1).upper()
    # Parsing legacy
    if any(k in n for k in ['link scaduto', 'link morto', '404', 'redirect', 'lavoro occupato', 'pagina rimossa', 'url morto']):
        return 'LINK_MORTO'
    if any(k in n for k in ['score < 40', 'score <40', 'score basso']):
        return 'SCORE_BASSO'
    if any(k in n for k in ['duplicat', 'già presente', 'stessa posizione']):
        return 'DUPLICATA'
    if any(k in n for k in ['us-only', 'uk-only', 'americas', 'restrizione geografica', 'work authorization uk', 'post-brexit']):
        return 'GEO'
    if any(k in n for k in ['lingua croata', 'tedesco obbligat', 'polacco', 'ungherese', 'français', 'dutch']):
        return 'LINGUA'
    if any(k in n for k in ['senior con 5+', '5+ anni obbligatori', 'seniority troppo']):
        return 'SENIORITY'
    if any(k in n for k in ['senza python', 'no python', 'solo java', 'solo node', 'stack incomp']):
        return 'STACK'
    if any(k in n for k in ['zero sviluppo', 'mismatch', 'ruolo non-dev', 'iam analyst', 'no coding']):
        return 'RUOLO'
    if any(k in n for k in ['scam', 'fantasma', 'red flag']):
        return 'SCAM'
    if any(k in n for k in ['voto critico', 'critic']):
        return 'CRITICO'
    return 'NON_CATEGORIZZATA'


def get_scrittore_activity():
    """Estrai attività corrente degli scrittori+critici dal tmux e dati coda/elaborati dal DB."""
    import re as re_mod

    result = {'activity': {}, 'queue': [], 'recent_completed': [], 'in_progress': [],
              'queue_size': 0, 'writing_today': 0, 'completed_today': 0,
              'avg_critic_score': None, 'scrittore_session_stats': []}

    # 1. Parse tmux per scrittori e critici online
    try:
        r = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                           capture_output=True, text=True, timeout=5)
        sessions = [s for s in (r.stdout.strip().split('\n') if r.stdout.strip() else [])
                    if ('SCRITTORE' in s or 'CRITICO-S' in s)]
    except Exception:
        sessions = []

    for sess in sessions:
        try:
            is_critico = 'CRITICO' in sess
            # Cattura corta per action detection
            capture_lines = '-150' if is_critico else '-50'
            r = subprocess.run(['tmux', 'capture-pane', '-t', sess, '-p', '-S', capture_lines, '-J'],
                               capture_output=True, text=True, timeout=3)
            output = r.stdout
            info = _parse_scrittore_output(output, is_critico=is_critico)
            agent_key = sess.split(' ', 1)[-1].lower() if ' ' in sess else sess.lower()

            # Per scrittori: cattura lunga per trovare score/round se non trovati
            if not is_critico and not info.get('tmux_critic_score'):
                r2 = subprocess.run(['tmux', 'capture-pane', '-t', sess, '-p', '-S', '-500', '-J'],
                                    capture_output=True, text=True, timeout=3)
                long_text = ''.join(line.rstrip() for line in r2.stdout.strip().split('\n'))
                import re as re_mod2
                score_matches = re_mod2.findall(r'(\d+(?:\.\d+)?)\s*/\s*10', long_text)
                if score_matches:
                    try:
                        info['tmux_critic_score'] = float(score_matches[-1])
                    except (ValueError, TypeError):
                        pass
                if not info.get('current_round'):
                    round_matches = re_mod2.findall(r'[Rr]ound\s*(\d)\s*/?\s*3?', long_text)
                    if round_matches:
                        info['current_round'] = int(round_matches[-1])

            result['activity'][agent_key] = info
        except Exception:
            pass

    # 1b. Arricchisci current_position e reviewing_company con dati DB (scrittori+critici)
    try:
        conn_e = get_db()
        ensure_schema(conn_e)
        for agent_key, info in result['activity'].items():
            cp = info.get('current_position', '')
            if cp:
                m = re_mod.search(r'#(\d+)', cp)
                if m:
                    pid = int(m.group(1))
                    row = conn_e.execute("SELECT title, company FROM positions WHERE id = ?", (pid,)).fetchone()
                    if row:
                        info['current_title'] = row[0]
                        info['current_company'] = row[1]
            # Se non ha position ma ha company dal path, cerca nel DB
            if not cp and info.get('reviewing_company'):
                company_like = info['reviewing_company'].lower().replace(' ', '%')
                row = conn_e.execute("""
                    SELECT p.id, p.title, p.company FROM positions p
                    WHERE p.status IN ('writing', 'review', 'scored')
                      AND LOWER(p.company) LIKE ?
                    ORDER BY p.id DESC LIMIT 1
                """, (f'%{company_like}%',)).fetchone()
                if row:
                    info['current_position'] = f'#{row[0]}'
                    info['current_title'] = row[1]
                    info['current_company'] = row[2]
        conn_e.close()
    except Exception:
        pass

    # 1c. Cross-reference scrittore ↔ critico
    for agent_key, info in list(result['activity'].items()):
        if not agent_key.startswith('scrittore-'):
            continue
        num = agent_key.replace('scrittore-', '')
        critico_key = f'critico-s{num}'
        crit_info = result['activity'].get(critico_key, {})
        # Eredita position dal critico
        if not info.get('current_position') and crit_info.get('current_position'):
            info['current_position'] = crit_info['current_position']
            info['current_company'] = crit_info.get('current_company', crit_info.get('reviewing_company'))
            info['current_title'] = crit_info.get('current_title')
        # Se il critico è attivo → scrittore è in attesa
        if crit_info.get('action') and crit_info['action'] not in ('stopped', 'idle', None):
            info['action'] = 'critic_review'
            info['detail'] = 'Attesa critico'
        # Eredita voto dal critico se lo scrittore non ce l'ha
        if not info.get('tmux_critic_score') and crit_info.get('tmux_critic_score'):
            info['tmux_critic_score'] = crit_info['tmux_critic_score']

    # 1d. DB per posizione/voto scrittore — sovrascrive tmux SE trova application attiva
    # Se non c'è application, arricchisci posizione dal tmux con dati DB (titolo, azienda)
    try:
        conn_fb = get_db()
        ensure_schema(conn_fb)
        for agent_key, info in result['activity'].items():
            if not agent_key.startswith('scrittore-'):
                continue
            writer_name = agent_key  # es: scrittore-1
            # Cerca application attiva dal DB
            row = conn_fb.execute("""
                SELECT p.id, p.title, p.company, a.critic_score, a.critic_verdict
                FROM positions p
                JOIN applications a ON a.position_id = p.id
                WHERE a.written_by = ? AND p.status IN ('writing', 'review')
                ORDER BY a.id DESC LIMIT 1
            """, (writer_name,)).fetchone()
            if row:
                info['current_position'] = f'#{row[0]}'
                info['current_title'] = row[1]
                info['current_company'] = row[2]
                info['db_critic_score'] = row[3] if row[3] else info.get('tmux_critic_score')
                info['db_critic_round'] = info.get('current_round')
                info['db_critic_verdict'] = row[4]
            else:
                info['db_critic_score'] = info.get('tmux_critic_score')
                info['db_critic_round'] = info.get('current_round')
                info['db_critic_verdict'] = None
                # Nessuna application — arricchisci posizione tmux con titolo/azienda dal DB
                cp = info.get('current_position', '')
                if cp:
                    m = re_mod.search(r'#(\d+)', cp)
                    if m:
                        pid = int(m.group(1))
                        prow = conn_fb.execute("SELECT title, company FROM positions WHERE id = ?", (pid,)).fetchone()
                        if prow:
                            info['current_title'] = prow[0]
                            info['current_company'] = prow[1]
        conn_fb.close()
    except Exception:
        pass

    # 2. Dati DB
    try:
        conn = get_db()
        ensure_schema(conn)

        # Coda: posizioni scored >= 50 (pronte per scrittura), ordinate per score DESC
        queue_rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.location, p.remote_type,
                   s.total_score, p.notes, p.status
            FROM positions p
            JOIN scores s ON s.position_id = p.id
            WHERE p.status = 'scored' AND s.total_score >= 50
            ORDER BY s.total_score DESC LIMIT 15
        """).fetchall()
        result['queue'] = [dict(r) for r in queue_rows]

        # In progress: raccogli position IDs dalle activity tmux + DB writing recenti
        active_pids = set()
        writer_for_pid = {}
        for agent_key, info in result['activity'].items():
            if not agent_key.startswith('scrittore'):
                continue
            cp = info.get('current_position', '')
            if cp:
                m = re_mod.search(r'#(\d+)', cp)
                if m:
                    pid = int(m.group(1))
                    active_pids.add(pid)
                    writer_for_pid[pid] = agent_key

        # Aggiungi posizioni in writing/review con written_at recente
        db_pids = conn.execute("""
            SELECT p.id FROM positions p
            LEFT JOIN applications a ON a.position_id = p.id
            WHERE p.status IN ('writing', 'review')
              AND (a.written_at = 'now'
                   OR date(a.written_at) = date('now', 'localtime')
                   OR date(a.written_at) = date('now'))
        """).fetchall()
        for r in db_pids:
            active_pids.add(r[0])

        in_progress = []
        if active_pids:
            placeholders = ','.join('?' * len(active_pids))
            progress_rows = conn.execute(f"""
                SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status,
                       s.total_score, p.notes,
                       a.written_by, a.critic_score, a.critic_verdict,
                       a.written_at, a.critic_reviewed_at
                FROM positions p
                LEFT JOIN scores s ON s.position_id = p.id
                LEFT JOIN applications a ON a.position_id = p.id
                WHERE p.id IN ({placeholders})
                ORDER BY s.total_score DESC
            """, list(active_pids)).fetchall()
            in_progress = [dict(r) for r in progress_rows]

        # Arricchisci con stato critico corrente e round (da tmux activity)
        for p in in_progress:
            writer = p.get('written_by') or writer_for_pid.get(p['id'], '')
            if writer:
                num = writer.replace('scrittore-', '')
                critico_key = f'critico-s{num}'
                critico_info = result['activity'].get(critico_key, {})
                p['critic_active'] = critico_info.get('action') not in (None, 'stopped', 'idle')
                p['critic_status'] = critico_info.get('detail', '')
                # Round: max tra DB e tmux (DB può essere 0 se non ancora aggiornato)
                writer_info = result['activity'].get(writer, {})
                tmux_round = writer_info.get('current_round') or 0
                p['critic_round'] = tmux_round or None

        result['in_progress'] = in_progress

        # Ultime 10 completate (ready o con critic_score recente)
        completed_rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status,
                   s.total_score,
                   a.written_by, a.critic_score, a.critic_verdict,
                   a.written_at, a.critic_reviewed_at, a.cv_pdf_path
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            WHERE p.status = 'ready'
               OR (a.critic_score IS NOT NULL AND a.critic_reviewed_at > datetime('now', '-7 days', 'localtime'))
            ORDER BY a.critic_reviewed_at DESC LIMIT 10
        """).fetchall()
        result['recent_completed'] = [dict(r) for r in completed_rows]

        # Conteggi
        result['queue_size'] = conn.execute("SELECT COUNT(*) FROM positions p JOIN scores s ON s.position_id = p.id WHERE p.status = 'scored' AND s.total_score >= 50").fetchone()[0]
        result['writing_today'] = conn.execute("""
            SELECT COUNT(*) FROM applications WHERE date(written_at) = date('now', 'localtime')
        """).fetchone()[0]
        result['completed_today'] = conn.execute("""
            SELECT COUNT(*) FROM applications
            WHERE critic_score IS NOT NULL AND date(critic_reviewed_at) = date('now', 'localtime')
        """).fetchone()[0]

        # Media voto critico della sessione
        avg_row = conn.execute("""
            SELECT AVG(critic_score) FROM applications
            WHERE critic_score IS NOT NULL AND date(critic_reviewed_at) = date('now', 'localtime')
        """).fetchone()
        result['avg_critic_score'] = round(avg_row[0], 1) if avg_row[0] is not None else None

        # Session stats
        import time as time_mod
        try:
            tmux_r = subprocess.run(
                ['tmux', 'list-sessions', '-F', '#{session_name}|||#{session_created}'],
                capture_output=True, text=True, timeout=5
            )
            now_ts = time_mod.time()
            for line in (tmux_r.stdout.strip().split('\n') if tmux_r.stdout.strip() else []):
                if '|||' not in line or 'SCRITTORE' not in line:
                    continue
                sname, screated = line.split('|||', 1)
                if not screated.isdigit():
                    continue
                created_ts = int(screated)
                from datetime import datetime as dt_cls
                created_dt = dt_cls.fromtimestamp(created_ts).strftime('%Y-%m-%d %H:%M:%S')
                elapsed_min = (now_ts - created_ts) / 60
                sk = sname.split(' ', 1)[-1].lower() if ' ' in sname else sname.lower()
                result['scrittore_session_stats'].append({
                    'scrittore': sk,
                    'session_start': created_dt,
                    'elapsed_min': round(elapsed_min, 1),
                })
        except Exception:
            pass

        conn.close()
    except Exception:
        pass

    return result


def _parse_scrittore_output(output, is_critico=False):
    """Analizza l'output tmux di uno scrittore o critico."""
    import re as re_mod
    lines = output.strip().split('\n')
    info = {
        'action': None,
        'detail': None,
        'current_position': None,
        'reviewing_company': None,
        'current_round': None,
        'tmux_critic_score': None,
    }

    # Cerca company e round nel testo unito — rstrip() rimuove padding tmux
    # così le righe wrappate si ricongiungono: "canon " + "ical-data/" → "canonical-data/"
    full_text = ''.join(line.rstrip() for line in lines)
    m_app = re_mod.search(r'/applications/([a-zA-Z0-9_-]+)/', full_text)
    if m_app:
        info['reviewing_company'] = m_app.group(1).replace('_', ' ').replace('-', ' ').title()

    # Cerca "Round N/3" o "Round N" — prendi l'ultimo match (il più recente)
    round_matches = re_mod.findall(r'[Rr]ound\s*(\d)\s*/?\s*3?', full_text)
    if round_matches:
        info['current_round'] = int(round_matches[-1])

    # Cerca voto critico dal tmux — pattern: "5.5/10", "VOTO: 6", "Round 2: 5.5/10"
    # Prendi l'ultimo match (il più recente)
    score_matches = re_mod.findall(r'(\d+(?:\.\d+)?)\s*/\s*10', full_text)
    if score_matches:
        try:
            info['tmux_critic_score'] = float(score_matches[-1])
        except (ValueError, TypeError):
            pass

    for line in reversed(lines):
        line_s = line.strip()
        if not line_s:
            continue

        if any(w in line_s.lower() for w in ['fermo', 'fermati', 'mi fermo', 'pausa', 'stop']):
            if info['action'] is None:
                info['action'] = 'stopped'
                info['detail'] = 'In pausa'

        if 'pandoc' in line_s.lower() and info['action'] is None:
            info['action'] = 'generating_pdf'
            info['detail'] = 'Generazione PDF'

        if not is_critico and ('critico' in line_s.lower() or 'critic' in line_s.lower() or 'capture-pane' in line_s.lower()) and 'kill' not in line_s.lower() and info['action'] is None:
            info['action'] = 'critic_review'
            info['detail'] = 'Attesa critico'

        if not is_critico and 'sleep' in line_s.lower() and info['action'] is None:
            info['action'] = 'critic_review'
            info['detail'] = 'Attesa critico'

        if 'db_update' in line_s and info['action'] is None:
            info['action'] = 'updating'
            info['detail'] = 'Aggiornamento DB'

        if 'db_query' in line_s and info['action'] is None:
            info['action'] = 'querying'
            info['detail'] = 'Query DB'

        if ('esc to interrupt' in line_s or 'thinking' in line_s) and info['action'] is None:
            info['action'] = 'writing'
            if is_critico:
                info['detail'] = 'Review in corso...'
            else:
                info['detail'] = 'Scrittura CV...'

        if ('curl' in line_s or 'fetch' in line_s.lower()) and info['action'] is None:
            info['action'] = 'verifying'
            info['detail'] = 'Verifica link'

        m = re_mod.search(r'#(\d{2,4})\b', line_s)
        if m and info['current_position'] is None:
            info['current_position'] = f'#{m.group(1)}'

        # Estrai company da path applications (sia scrittori che critici)
        if info.get('reviewing_company') is None:
            m2 = re_mod.search(r'/applications/([^/]+)/', line_s)
            if m2:
                info['reviewing_company'] = m2.group(1).replace('_', ' ').replace('-', ' ').title()

    if info['action'] is None:
        info['action'] = 'idle'

    return info


def _parse_analista_output(output, session_name):
    """Analizza l'output tmux di un analista per capire cosa sta facendo."""
    import re as re_mod
    lines = output.strip().split('\n')
    info = {
        'action': None,
        'detail': None,
        'current_position': None,
    }

    for line in reversed(lines):
        line_s = line.strip()
        if not line_s:
            continue

        # Fermato
        if any(w in line_s.lower() for w in ['fermo', 'fermati', 'mi fermo', 'pausa', 'stop']):
            if info['action'] is None:
                info['action'] = 'stopped'
                info['detail'] = 'In pausa'

        # Verifica link
        if ('curl' in line_s or 'linkedin_check' in line_s) and info['action'] is None:
            info['action'] = 'verifying'
            info['detail'] = 'Verifica link'

        # Fetch JD
        if ('fetch' in line_s.lower() and 'MCP' in line_s) and info['action'] is None:
            info['action'] = 'fetching'
            info['detail'] = 'Fetch JD'

        # DB update
        if 'db_update' in line_s and info['action'] is None:
            info['action'] = 'updating'
            info['detail'] = 'Aggiornamento DB'

        # DB query
        if 'db_query' in line_s and info['action'] is None:
            info['action'] = 'querying'
            info['detail'] = 'Query DB'

        # Working/thinking
        if ('esc to interrupt' in line_s or 'thinking' in line_s) and info['action'] is None:
            info['action'] = 'analyzing'
            info['detail'] = 'Analizzando...'

        # Position ID
        m = re_mod.search(r'#(\d{2,4})\b', line_s)
        if m and info['current_position'] is None:
            info['current_position'] = f'#{m.group(1)}'

    if info['action'] is None:
        info['action'] = 'idle'

    return info


def get_api_data():
    """Estrae tutti i dati dal DB come dizionario JSON-serializzabile."""
    conn = get_db()
    ensure_schema(conn)

    # Stats pipeline (scored conta solo >= 50, le riserve 40-49 sono nascoste)
    stats = {}
    for r in conn.execute("SELECT status, COUNT(*) as cnt FROM positions GROUP BY status").fetchall():
        stats[r['status']] = r['cnt']
    # Override: scored mostra solo >= 50
    scored_visible = conn.execute("""
        SELECT COUNT(*) FROM positions p JOIN scores s ON s.position_id = p.id
        WHERE p.status = 'scored' AND s.total_score >= 50
    """).fetchone()[0]
    stats['scored'] = scored_visible

    # Posizioni applied
    applied = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url, p.source,
               p.found_at,
               p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
               p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
               p.salary_estimated_source,
               s.total_score, a.applied_at, a.applied_via, a.response, a.response_at,
               a.critic_verdict, a.critic_score, a.cv_pdf_path, a.cl_pdf_path,
               a.written_at,
               c.hq_country, c.verdict as company_verdict
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE a.applied = 1 OR a.response IS NOT NULL
        ORDER BY a.applied_at DESC
    """).fetchall():
        applied.append(dict(r))

    # Rejected
    rejected = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url,
               s.total_score, a.applied_at, a.applied_via, a.response, a.response_at,
               a.critic_verdict, a.critic_score,
               c.hq_country
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE a.response = 'rejected'
        ORDER BY a.response_at DESC
    """).fetchall():
        rejected.append(dict(r))

    # Accepted
    accepted = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url,
               s.total_score, a.applied_at, a.applied_via, a.response, a.response_at,
               a.critic_verdict, a.critic_score,
               c.hq_country
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE a.response = 'accepted'
        ORDER BY a.response_at DESC
    """).fetchall():
        accepted.append(dict(r))

    # Pipeline positions (top scored >= 50, ready, writing — riserve 40-49 nascoste)
    pipeline = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.status, p.remote_type, p.url,
               s.total_score, a.critic_verdict, a.critic_score, a.status as app_status,
               c.hq_country, c.verdict as company_verdict
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.status NOT IN ('excluded', 'applied', 'response')
          AND NOT (p.status = 'scored' AND COALESCE(s.total_score, 0) < 50)
        ORDER BY COALESCE(s.total_score, -1) DESC
        LIMIT 100
    """).fetchall():
        pipeline.append(dict(r))

    # Team status — scopri agenti dinamicamente dalle worktree
    agents = discover_agents()
    try:
        result = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}|||#{session_created}'],
                                capture_output=True, text=True, timeout=5)
        active = {}
        for line in (result.stdout.strip().split('\n') if result.stdout.strip() else []):
            if '|||' in line:
                sname, screated = line.split('|||', 1)
                active[sname] = int(screated) if screated.isdigit() else None
            else:
                active[line] = None
    except Exception:
        active = {}

    team = []
    for name, role in agents:
        online = name in active
        created_at = active.get(name) if online else None
        if online or 'CRITICO-S' not in name:
            working = False
            if online:
                try:
                    r = subprocess.run(['tmux', 'capture-pane', '-t', name, '-p', '-S', '-5'],
                                       capture_output=True, text=True, timeout=3)
                    output = r.stdout
                    working = 'esc to interrupt' in output or 'thinking' in output or 'Running' in output
                except Exception:
                    pass
            # For writers, try to extract current job from tmux output
            current_job = None
            if online and role == 'Scrittore':
                try:
                    r2 = subprocess.run(['tmux', 'capture-pane', '-t', name, '-p', '-S', '-30'],
                                        capture_output=True, text=True, timeout=3)
                    lines = r2.stdout
                    # Look for position references like "#123" or "position 123"
                    import re
                    ids = re.findall(r'#(\d{2,4})\b', lines)
                    if ids:
                        last_id = ids[-1]
                        row = conn.execute(
                            "SELECT p.id, p.title, p.company FROM positions p WHERE p.id = ?",
                            (int(last_id),)).fetchone()
                        if row:
                            current_job = {'id': row['id'], 'title': row['title'], 'company': row['company']}
                except Exception:
                    pass
            team.append({'session': name, 'role': role, 'online': online, 'working': working, 'current_job': current_job, 'created_at': created_at})

    # Conteggi coerenti con le pagine filtrate
    # Fase attiva: in coda (writing/review senza voto) + valutati (con voto, ultimi 7 giorni)
    active_phase = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.status,
               a.written_by, a.status as app_status, a.critic_verdict, a.critic_score,
               a.cv_pdf_path, a.written_at, a.critic_reviewed_at
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        WHERE p.status IN ('writing', 'review')
           OR (a.critic_score IS NOT NULL AND a.critic_reviewed_at > datetime('now', '-7 days', 'localtime'))
        ORDER BY a.critic_reviewed_at DESC
    """).fetchall():
        active_phase.append(dict(r))

    # Consulenza IT — posizioni simili a Teoresi
    consulting = []
    consulting_ids = [53, 274, 259, 355, 54, 44, 47, 56, 155, 98]
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url, p.source,
               p.found_at, p.status,
               p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
               p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
               p.salary_estimated_source,
               s.total_score, a.applied_at, a.applied_via, a.response, a.response_at,
               a.critic_verdict, a.critic_score, a.cv_pdf_path, a.cl_pdf_path,
               a.written_at, a.status as app_status, a.applied,
               c.hq_country, c.verdict as company_verdict
        FROM positions p
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.id IN ({})
        ORDER BY s.total_score DESC
    """.format(','.join('?' * len(consulting_ids))), consulting_ids).fetchall():
        consulting.append(dict(r))

    # Da inviare — recensite ma non ancora inviate (escluse freelance)
    ready_to_send = []
    freelance_to_send = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url, p.source,
               p.found_at,
               p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
               p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
               p.salary_estimated_source,
               s.total_score, a.critic_verdict, a.critic_score, a.cv_pdf_path, a.cl_pdf_path,
               a.written_at, a.critic_reviewed_at,
               c.hq_country, c.verdict as company_verdict
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE a.critic_score IS NOT NULL AND a.critic_score >= 5
              AND (a.applied = 0 OR a.applied IS NULL)
              AND p.status != 'excluded'
        ORDER BY a.critic_reviewed_at DESC NULLS LAST
    """).fetchall():
        row = dict(r)
        if 'freelance' in (row.get('title') or '').lower():
            freelance_to_send.append(row)
        else:
            ready_to_send.append(row)

    total_cv = conn.execute("""
        SELECT COUNT(*) FROM applications a
        JOIN positions p ON p.id = a.position_id
        WHERE COALESCE(a.response,'') != 'rejected' AND p.status != 'excluded'
    """).fetchone()[0]
    total_inviate = conn.execute("SELECT COUNT(*) FROM applications WHERE applied = 1 OR response IS NOT NULL").fetchone()[0]
    total_risposte = conn.execute("SELECT COUNT(*) FROM applications WHERE response IS NOT NULL").fetchone()[0]

    # Dashboard stats extra
    # Response breakdown
    response_breakdown = {}
    for r in conn.execute("SELECT response, COUNT(*) as cnt FROM applications WHERE response IS NOT NULL GROUP BY response").fetchall():
        response_breakdown[r['response']] = r['cnt']

    # Interviews/meetings
    meetings = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url,
               s.total_score, a.response, a.response_at, a.applied_at,
               c.hq_country
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE a.response IN ('interview_scheduled', 'interview_done', 'call_scheduled', 'acknowledged')
        ORDER BY a.response_at DESC
    """).fetchall():
        meetings.append(dict(r))

    # Top salary positions (declared, non-excluded)
    # Top salary — ordina per valore convertito in EUR
    _eur_rates = {'EUR': 1.0, 'USD': 0.92, 'GBP': 1.17, 'PLN': 0.23, 'CHF': 1.05, 'SEK': 0.088, 'CZK': 0.041, 'HUF': 0.0026, 'RON': 0.20}
    _all_salary = []
    for r in conn.execute("""
        SELECT p.id, p.title, p.company, p.location, p.remote_type, p.url, p.status,
               p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
               s.total_score,
               a.response, a.applied, a.status as app_status
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.salary_declared_max IS NOT NULL AND p.status != 'excluded'
              AND COALESCE(a.response, '') != 'rejected'
    """).fetchall():
        row = dict(r)
        cur = (row.get('salary_declared_currency') or 'EUR').upper()
        rate = _eur_rates.get(cur, 1.0)
        row['_salary_max_eur'] = (row['salary_declared_max'] or 0) * rate
        _all_salary.append(row)
    _all_salary.sort(key=lambda x: x['_salary_max_eur'], reverse=True)
    top_salary = _all_salary[:5]
    for s in top_salary:
        del s['_salary_max_eur']

    # Location distribution (non-excluded) — con normalizzazione varianti
    import re as _re
    _loc_map = {}  # normalized -> count
    for r in conn.execute("""
        SELECT p.location, COUNT(*) as cnt
        FROM positions p WHERE p.status != 'excluded'
        GROUP BY p.location ORDER BY cnt DESC
    """).fetchall():
        loc = r['location'] or 'N/A'
        # Normalizza varianti comuni
        loc_lower = loc.lower().strip()
        if _re.search(r'\brom[ae]\b', loc_lower) and not _re.search(r'\broman', loc_lower):
            # Roma/Rome variants (exclude Romania/Romagna)
            if '/' in loc or ',' in loc and loc_lower.count(',') > 1:
                norm = loc  # multi-city, keep as-is
            elif any(x in loc_lower for x in ['milano', 'milan', 'napoli', 'torino', 'cagliari', 'bari', 'cosenza']):
                norm = loc  # multi-city
            else:
                norm = 'Roma, Italia'
        elif _re.search(r'\bmilan[o]?\b', loc_lower) and 'rom' not in loc_lower:
            norm = 'Milano, Italia'
        elif loc_lower in ('remote', 'remote eu', 'full remote', 'remote europe'):
            norm = 'Remote EU'
        else:
            norm = loc
        _loc_map[norm] = _loc_map.get(norm, 0) + r['cnt']
    location_stats = sorted([{'location': k, 'count': v} for k, v in _loc_map.items()],
                            key=lambda x: x['count'], reverse=True)[:10]

    # Remote type distribution (non-excluded)
    remote_stats = {}
    for r in conn.execute("""
        SELECT p.remote_type, COUNT(*) as cnt
        FROM positions p WHERE p.status != 'excluded'
        GROUP BY p.remote_type ORDER BY cnt DESC
    """).fetchall():
        remote_stats[r['remote_type'] or 'unknown'] = r['cnt']

    # Remote type distribution — solo candidature inviate (applied=1 o con risposta)
    applied_remote_stats = {}
    for r in conn.execute("""
        SELECT p.remote_type, COUNT(*) as cnt
        FROM positions p
        JOIN applications a ON a.position_id = p.id
        WHERE a.applied = 1 OR a.response IS NOT NULL
        GROUP BY p.remote_type ORDER BY cnt DESC
    """).fetchall():
        applied_remote_stats[r['remote_type'] or 'unknown'] = r['cnt']

    conn.close()
    return {
        'stats': stats,
        'applied': applied,
        'rejected': rejected,
        'accepted': accepted,
        'pipeline': pipeline,
        'team': team,
        'total_positions': sum(stats.values()),
        'total_applications': len(applied),
        'total_cv_scritti': total_cv,
        'active_phase': active_phase,
        'total_inviate': total_inviate,
        'total_risposte': total_risposte,
        'consulting': consulting,
        'ready_to_send': ready_to_send,
        'freelance_to_send': freelance_to_send,
        'response_breakdown': response_breakdown,
        'meetings': meetings,
        'top_salary': top_salary,
        'location_stats': location_stats,
        'remote_stats': remote_stats,
        'applied_remote_stats': applied_remote_stats,
    }


def get_positions_by_status(status_filter):
    """Restituisce posizioni filtrate per status o categoria."""
    conn = get_db()
    ensure_schema(conn)

    # Mapping: le metriche della dashboard mappano a query diverse
    if status_filter == 'all':
        where = "p.status != 'excluded'"
    elif status_filter == 'writing':
        # Writing + Review (CV in lavorazione)
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   s.total_score,
                   a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.applied_at, a.written_at,
                   c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status IN ('writing', 'review')
            ORDER BY COALESCE(s.total_score, -1) DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'cv_scritti':
        # CV scritti: escludi rejected, ordina per critic_score DESC
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   s.total_score, a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.applied_at, c.hq_country, c.verdict as company_verdict
            FROM positions p
            JOIN applications a ON a.position_id = p.id
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE COALESCE(a.response, '') != 'rejected'
              AND p.status != 'excluded'
            ORDER BY COALESCE(a.critic_score, -1) DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'inviate':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   s.total_score, a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.response_at, a.applied_at, a.applied_via,
                   c.hq_country, c.verdict as company_verdict
            FROM positions p
            JOIN applications a ON a.position_id = p.id
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE a.applied = 1 OR a.response IS NOT NULL
            ORDER BY a.applied_at DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'risposte':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   s.total_score, a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.response_at, a.applied_at, a.applied_via,
                   c.hq_country, c.verdict as company_verdict
            FROM positions p
            JOIN applications a ON a.position_id = p.id
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE a.response IS NOT NULL
            ORDER BY a.response_at DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'new':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.source, p.found_by, p.found_at, p.requirements,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   p.salary_estimated_source,
                   c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status = 'new'
            ORDER BY p.found_at DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'checked':
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.source, p.found_by, p.found_at, p.last_checked, p.notes,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status = 'checked'
            ORDER BY p.last_checked DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    elif status_filter == 'scored':
        # Solo scored >= 50 (riserve 40-49 nascoste)
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   p.found_at, p.source,
                   s.total_score, s.scored_at, s.scored_by,
                   a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.applied_at, c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status = 'scored' AND s.total_score >= 50
            ORDER BY COALESCE(s.total_score, -1) DESC
        """).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    else:
        where = f"p.status = ?"

    if status_filter in ('all', ):
        rows = conn.execute(f"""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   s.total_score, a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.applied_at, c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE {where}
            ORDER BY COALESCE(s.total_score, -1) DESC
        """).fetchall()
    else:
        rows = conn.execute("""
            SELECT p.id, p.title, p.company, p.status, p.remote_type, p.location, p.url,
                   p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
                   p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
                   p.found_at, p.source,
                   s.total_score, s.scored_at, s.scored_by,
                   a.critic_verdict, a.critic_score, a.status as app_status,
                   a.response, a.applied_at, c.hq_country, c.verdict as company_verdict
            FROM positions p
            LEFT JOIN scores s ON s.position_id = p.id
            LEFT JOIN applications a ON a.position_id = p.id
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status = ?
            ORDER BY COALESCE(s.total_score, -1) DESC
        """, (status_filter,)).fetchall()

    conn.close()
    return [dict(r) for r in rows]


def get_position_detail(pos_id):
    """Restituisce tutti i dettagli di una posizione."""
    conn = get_db()
    ensure_schema(conn)

    pos = conn.execute("""
        SELECT p.*, s.total_score, s.stack_match, s.remote_fit, s.salary_fit,
               s.experience_fit, s.strategic_fit, s.breakdown, s.pros as score_pros, s.cons as score_cons,
               s.notes as score_notes, s.scored_by, s.scored_at,
               a.cv_path, a.cl_path, a.cv_pdf_path, a.cl_pdf_path,
               a.critic_verdict, a.critic_score, a.critic_notes,
               a.status as app_status, a.written_at, a.applied_at, a.applied_via,
               a.response, a.response_at, a.written_by, a.applied,
               c.name as company_name, c.website as company_website,
               c.hq_country, c.sector, c.size as company_size,
               c.glassdoor_rating, c.red_flags, c.culture_notes as company_culture,
               c.verdict as company_verdict
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.id = ?
    """, (pos_id,)).fetchone()

    if not pos:
        conn.close()
        return {'error': 'Posizione non trovata'}

    # Highlights (da position_highlights legacy + scores.pros/cons nuovo)
    highlights = {'pro': [], 'con': []}
    for r in conn.execute("SELECT type, text FROM position_highlights WHERE position_id = ?", (pos_id,)).fetchall():
        highlights[r['type']].append(r['text'])

    conn.close()

    result = dict(pos)
    # Merge: score_pros/cons (comma-separated) prendono priorità sui highlights legacy
    if result.get('score_pros'):
        highlights['pro'] = [p.strip() for p in result['score_pros'].split(',') if p.strip()]
    if result.get('score_cons'):
        highlights['con'] = [c.strip() for c in result['score_cons'].split(',') if c.strip()]
    result['highlights'] = highlights
    return result


def send_tmux_message(session_name, message):
    """Invia un messaggio a una sessione tmux (2 comandi separati: testo + Enter)."""
    try:
        result = subprocess.run(
            ['tmux', 'has-session', '-t', session_name],
            capture_output=True, timeout=3
        )
        if result.returncode != 0:
            return {'ok': False, 'error': f'Sessione {session_name} non trovata'}

        # Comando 1: testo senza Enter
        subprocess.run(
            ['tmux', 'send-keys', '-t', session_name, message],
            capture_output=True, timeout=3
        )
        # Comando 2: Enter separato
        subprocess.run(
            ['tmux', 'send-keys', '-t', session_name, 'Enter'],
            capture_output=True, timeout=3
        )
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def get_tmux_output(session_name, scroll='bottom'):
    """Cattura l'output di una sessione tmux."""
    try:
        # Check if session exists
        result = subprocess.run(
            ['tmux', 'has-session', '-t', session_name],
            capture_output=True, timeout=3
        )
        if result.returncode != 0:
            return {'online': False, 'output': '', 'pane_width': 80}

        # Get pane width
        pw = subprocess.run(
            ['tmux', 'display-message', '-t', session_name, '-p', '#{pane_width}'],
            capture_output=True, text=True, timeout=3
        )
        pane_width = int(pw.stdout.strip()) if pw.returncode == 0 and pw.stdout.strip().isdigit() else 80

        # Capture pane — top = full history, bottom = last 200 lines
        if scroll == 'top':
            cap_args = ['tmux', 'capture-pane', '-t', session_name, '-p', '-S', '-']
        else:
            cap_args = ['tmux', 'capture-pane', '-t', session_name, '-p', '-S', '-200']

        result = subprocess.run(cap_args, capture_output=True, text=True, timeout=5)
        return {'online': True, 'output': result.stdout, 'pane_width': pane_width}
    except Exception as e:
        return {'online': False, 'output': f'Errore: {e}', 'pane_width': 80}


def agent_control(session_name, action):
    """Avvia o ferma un agente tmux."""
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    START_SCRIPT = os.path.join(BASE_DIR, 'alfa', 'scripts', 'scripts', 'start-agent.sh')

    # Map session name to agent name: "SCOUT-1" -> "scout-1"
    agent_name = session_name.lower()

    try:
        if action == 'stop':
            result = subprocess.run(
                ['tmux', 'kill-session', '-t', session_name],
                capture_output=True, text=True, timeout=5
            )
            return {'ok': result.returncode == 0, 'action': 'stop', 'agent': agent_name}
        elif action == 'start':
            result = subprocess.run(
                [START_SCRIPT, agent_name],
                capture_output=True, text=True, timeout=10
            )
            return {'ok': result.returncode == 0, 'action': 'start', 'agent': agent_name, 'output': result.stdout}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.abspath(DATA_DIR), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API: posizioni filtrate per status
        if path.startswith('/api/positions/'):
            status_filter = urllib.parse.unquote(path[len('/api/positions/'):])
            data = get_positions_by_status(status_filter)
            self._json_response(data)
            return

        # API: posizione singola
        if path.startswith('/api/position/'):
            try:
                pos_id = int(path[len('/api/position/'):])
            except ValueError:
                self._json_response({'error': 'ID non valido'})
                return
            data = get_position_detail(pos_id)
            self._json_response(data)
            return

        # API: dati JSON
        if path == '/api/data':
            data = get_api_data()
            self._json_response(data)
            return

        # API: attività analisti
        if path == '/api/analista-activity':
            data = get_analista_activity()
            self._json_response(data)
            return

        # API: attività scout (coordinazione + parsing tmux)
        if path == '/api/scout-activity':
            data = get_scout_activity()
            self._json_response(data)
            return

        # API: attività scrittori+critici
        if path == '/api/scrittore-activity':
            data = get_scrittore_activity()
            self._json_response(data)
            return

        # API: attività scorer
        if path == '/api/scorer-activity':
            data = get_scorer_activity()
            self._json_response(data)
            return

        # API: dati per grafico scout — tutti i timestamp delle posizioni di oggi
        if path == '/api/scout-chart':
            conn = get_db()
            ensure_schema(conn)
            rows = conn.execute("""
                SELECT found_at, found_by FROM positions
                WHERE found_at >= datetime('now', 'localtime', '-24 hours')
                ORDER BY found_at
            """).fetchall()
            conn.close()
            self._json_response([{'t': r['found_at'], 's': r['found_by']} for r in rows])
            return

        # API: agent control (start/stop)
        if path.startswith('/api/agent/') and not path.startswith('/api/agent-'):
            rest = urllib.parse.unquote(path[len('/api/agent/'):])
            parts = rest.rsplit('/', 1)
            if len(parts) == 2:
                session_name, action = parts
                data = agent_control(session_name, action)
                self._json_response(data)
                return

        # API: create agent  /api/agent-create/<role>/<number>
        if path.startswith('/api/agent-create/'):
            rest = path[len('/api/agent-create/'):]
            parts = rest.split('/')
            if len(parts) == 2:
                data = create_agent(parts[0], int(parts[1]))
                self._json_response(data)
                return

        # API: remove agent  /api/agent-remove/<role>/<number>
        if path.startswith('/api/agent-remove/'):
            rest = path[len('/api/agent-remove/'):]
            parts = rest.split('/')
            if len(parts) == 2:
                data = remove_agent(parts[0], int(parts[1]))
                self._json_response(data)
                return

        # API: tmux terminal
        if path.startswith('/api/tmux/'):
            session_name = urllib.parse.unquote(path[len('/api/tmux/'):])
            query = urllib.parse.parse_qs(parsed.query)
            scroll = query.get('scroll', ['bottom'])[0]
            data = get_tmux_output(session_name, scroll=scroll)
            self._json_response(data)
            return

        # API: gap report (generato dal Mentor)
        if path == '/api/gap':
            gap_path = os.path.join(DATA_DIR, 'gap-report.json')
            if os.path.exists(gap_path):
                with open(gap_path, 'r') as f:
                    self._json_response(json.load(f))
            else:
                self._json_response({'generated_at': None, 'gaps': [], 'roadmap': [], 'categories': []})
            return

        # Default: rigenera dashboard per /
        if path == '/' or path == '/dashboard.html':
            subprocess.run(
                [sys.executable, GENERATE_SCRIPT],
                capture_output=True, cwd=SKILLS_DIR
            )
            self.path = '/dashboard.html'

        # Redirect /app to /app.html
        if path == '/app':
            self.send_response(301)
            self.send_header('Location', '/app.html')
            self.end_headers()
            return

        # Serve PDF/file da qualsiasi worktree o shared/data
        # I path nel DB possono essere: "data/applications/..." o "scrittore-X/data/..."
        if path.endswith('.pdf'):
            repo_root = os.path.abspath(os.path.join(DATA_DIR, '..', '..'))
            # Prova: shared/data/ + path (strip /data/ prefix se presente)
            candidates = []
            clean = path.lstrip('/')
            # 1. Path diretto da DATA_DIR (strip "data/" prefix)
            if clean.startswith('data/'):
                candidates.append(os.path.join(DATA_DIR, clean[5:]))
            # 2. Path diretto da DATA_DIR (as-is)
            candidates.append(os.path.join(DATA_DIR, clean))
            # 3. Path dal repo root (per worktree paths tipo scrittore-2/data/...)
            candidates.append(os.path.join(repo_root, clean))
            # 4. Cerca in tutte le worktree
            for wt in ['scrittore-1', 'scrittore-2', 'scrittore-3']:
                if clean.startswith('data/'):
                    candidates.append(os.path.join(repo_root, wt, clean))
                candidates.append(os.path.join(repo_root, wt, 'data', clean.replace('data/', '', 1) if clean.startswith('data/') else clean))

            for fpath in candidates:
                fpath = os.path.realpath(fpath)
                if os.path.isfile(fpath):
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/pdf')
                    self.send_header('Content-Length', str(os.path.getsize(fpath)))
                    self.end_headers()
                    with open(fpath, 'rb') as f:
                        self.wfile.write(f.read())
                    return

        super().do_GET()

    def end_headers(self):
        """Disabilita cache per file statici (dev mode)."""
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API: invia messaggio tmux
        if path.startswith('/api/tmux/'):
            session_name = urllib.parse.unquote(path[len('/api/tmux/'):])
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                payload = json.loads(body)
                message = payload.get('message', '')
            except Exception:
                message = body

            if not message:
                self._json_response({'ok': False, 'error': 'Messaggio vuoto'})
                return

            result = send_tmux_message(session_name, message)
            self._json_response(result)
            return

        self.send_error(404)

    def _json_response(self, data):
        body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        path = str(args[0]) if args else ''
        if '/api/' in path:
            return  # Silenzio per API calls
        if 'dashboard.html' in path:
            sys.stderr.write(f"[dashboard] Rigenerata e servita\n")


def main():
    parser = argparse.ArgumentParser(description='Dashboard server')
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()

    # Prima generazione dashboard classica
    subprocess.run([sys.executable, GENERATE_SCRIPT], cwd=SKILLS_DIR)

    server = http.server.HTTPServer(('0.0.0.0', args.port), DashboardHandler)
    print(f"\n  Job Hunter Dashboard Server")
    print(f"  Dashboard classica: http://localhost:{args.port}")
    print(f"  App interattiva:    http://localhost:{args.port}/app.html")
    print(f"  API dati:           http://localhost:{args.port}/api/data")
    print(f"  Ctrl+C per fermare\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer fermato.")
        server.server_close()


if __name__ == '__main__':
    main()
