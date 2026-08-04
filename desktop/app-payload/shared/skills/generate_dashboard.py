#!/usr/bin/env python3
"""Genera dashboard HTML dal database SQLite.

Uso:
  python3 generate_dashboard.py              # genera alfa/data/dashboard.html
  python3 generate_dashboard.py --open       # genera e apre nel browser
  python3 generate_dashboard.py --version    # salva anche una copia versionata
"""

import os
import sys
import shutil
import argparse
import subprocess
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from _db import get_db, ensure_schema

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'dashboard.html')
VERSIONS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'dashboard-versions')


def get_team_status():
    """Controlla lo stato degli agenti tmux."""
    import subprocess
    agents = [
        ('SCOUT-1', 'Scout'),
        ('SCOUT-2', 'Scout'),
        ('ANALISTA-1', 'Analista'),
        ('ANALISTA-2', 'Analista'),
        ('SCORER-1', 'Scorer'),
        ('SCORER-2', 'Scorer'),
        ('SCRITTORE-1', 'Scrittore'),
        ('SCRITTORE-2', 'Scrittore'),
        ('SCRITTORE-3', 'Scrittore'),
        ('CRITICO', 'Critico'),
        ('CRITICO-S1', 'Critico'),
        ('CRITICO-S2', 'Critico'),
        ('CRITICO-S3', 'Critico'),
    ]
    try:
        result = subprocess.run(['tmux', 'list-sessions', '-F', '#{session_name}'],
                                capture_output=True, text=True, timeout=5)
        active = set(result.stdout.strip().split('\n')) if result.stdout.strip() else set()
    except Exception:
        active = set()

    team = []
    for session_name, role in agents:
        online = session_name in active
        team.append({'session': session_name, 'role': role, 'online': online})
    return team


def get_stats(conn):
    rows = conn.execute("""
        SELECT status, COUNT(*) as cnt FROM positions
        GROUP BY status ORDER BY cnt DESC
    """).fetchall()
    return {r['status']: r['cnt'] for r in rows}


def get_all_positions(conn):
    return conn.execute("""
        SELECT p.id, p.title, p.company, p.company_id,
               p.location, p.remote_type,
               p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
               p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
               p.salary_estimated_source,
               p.url, p.source, p.status, p.notes, p.found_by, p.found_at, p.deadline,
               s.total_score, s.stack_match, s.remote_fit, s.salary_fit,
               s.experience_fit, s.strategic_fit, s.breakdown as score_breakdown,
               s.notes as score_notes,
               a.cv_pdf_path, a.cl_pdf_path, a.status as app_status,
               a.critic_verdict, a.critic_score, a.applied_at, a.applied_via,
               a.response,
               c.verdict as company_verdict, c.glassdoor_rating, c.sector,
               c.hq_country as c_hq_country
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.status != 'excluded'
        ORDER BY
            CASE WHEN a.response = 'rejected' THEN 1 ELSE 0 END,
            COALESCE(s.total_score, -1) DESC, p.found_at DESC
    """).fetchall()


def get_highlights(conn):
    rows = conn.execute("SELECT position_id, type, text FROM position_highlights ORDER BY id").fetchall()
    highlights = {}
    for r in rows:
        pid = r['position_id']
        if pid not in highlights:
            highlights[pid] = {'pro': [], 'con': []}
        highlights[pid][r['type']].append(r['text'])
    return highlights


def get_company_stats(conn):
    rows = conn.execute("""
        SELECT verdict, COUNT(*) as cnt FROM companies
        WHERE verdict IS NOT NULL GROUP BY verdict
    """).fetchall()
    return {r['verdict']: r['cnt'] for r in rows}


def esc(text):
    if not text:
        return ''
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def tier_info(score):
    if score is None:
        return 'non-scored', '&#11044;', 'Non valutata'
    if score >= 70:
        return 'seria', '&#11044;', 'SERIA'
    if score >= 40:
        return 'practice', '&#11044;', 'PRACTICE'
    return 'riferimento', '&#11044;', 'RIFERIMENTO'


def status_badge(status):
    colors = {
        'new': '#58a6ff', 'checked': '#bc8cff', 'excluded': '#f85149',
        'scored': '#d29922', 'writing': '#d18616', 'review': '#39d2c0',
        'ready': '#3fb950', 'applied': '#3fb950', 'response': '#58a6ff',
    }
    color = colors.get(status, '#8b949e')
    extra_class = ' badge-applied' if status == 'applied' else ''
    return f'<span class="badge{extra_class}" style="background:{color}20;color:{color};border:1px solid {color}40">{"&#10004; " if status == "applied" else ""}{esc(status)}</span>'


def verdict_badge(verdict):
    if not verdict:
        return ''
    colors = {'GO': '#3fb950', 'CAUTIOUS': '#d29922', 'NO_GO': '#f85149',
              'PASS': '#3fb950', 'NEEDS_WORK': '#d29922', 'REJECT': '#f85149'}
    color = colors.get(verdict, '#8b949e')
    return f'<span class="badge" style="background:{color}20;color:{color};border:1px solid {color}40">{esc(verdict)}</span>'


def source_label(source, url):
    """Nome leggibile della fonte con icona."""
    if not url:
        return ''
    labels = {
        'linkedin': 'LinkedIn',
        'indeed': 'Indeed',
        'glassdoor': 'Glassdoor',
        'dynamite': 'Dynamite Jobs',
        'wttj': 'WTTJ',
        'remoteok': 'RemoteOK',
        'weworkremotely': 'WeWorkRemotely',
        'wellfound': 'Wellfound',
        'otta': 'Otta',
        'berlinstartupjobs': 'Berlin Startup Jobs',
        'migrated': 'Importata',
        'jobspy': 'JobSpy',
    }
    # Try to detect from URL if source is missing
    if not source or source == 'migrated':
        url_lower = url.lower()
        if 'linkedin.com' in url_lower:
            source = 'linkedin'
        elif 'greenhouse.io' in url_lower:
            source = 'greenhouse'
        elif 'lever.co' in url_lower:
            source = 'lever'
        elif 'ashbyhq.com' in url_lower:
            source = 'ashby'
        elif 'workable.com' in url_lower:
            source = 'workable'
        elif 'smartrecruiters.com' in url_lower:
            source = 'smartrecruiters'
        elif 'weworkremotely.com' in url_lower:
            source = 'weworkremotely'
        elif 'berlinstartupjobs.com' in url_lower:
            source = 'berlinstartupjobs'
        elif 'notion.site' in url_lower:
            source = 'notion'
        else:
            # Use domain name
            from urllib.parse import urlparse
            try:
                domain = urlparse(url).netloc.replace('www.', '')
                source = domain.split('.')[0]
            except Exception:
                source = 'web'

    label = labels.get(source, source.capitalize() if source else 'Link')
    return f'<a href="{esc(url)}" target="_blank" class="source-link">{esc(label)} &#8599;</a>'


def pdf_link(path, label):
    if not path:
        return f'<span class="text-dim">{label}: -</span>'
    if path.startswith('data/'):
        rel = path[5:]
    else:
        rel = path
    return f'<a href="{esc(rel)}" target="_blank" class="pdf-link">{label} &#128196;</a>'


def country_flag(country):
    """Emoji bandiera per il paese."""
    flags = {
        'Italia': '&#127470;&#127481;', 'Italy': '&#127470;&#127481;',
        'UK': '&#127468;&#127463;', 'Regno Unito': '&#127468;&#127463;',
        'USA': '&#127482;&#127480;',
        'Germania': '&#127465;&#127466;', 'Germany': '&#127465;&#127466;',
        'Olanda': '&#127475;&#127473;', 'Netherlands': '&#127475;&#127473;',
        'Francia': '&#127467;&#127479;', 'France': '&#127467;&#127479;',
        'Spagna': '&#127466;&#127480;', 'Spain': '&#127466;&#127480;',
        'Austria': '&#127462;&#127481;',
        'Svizzera': '&#127464;&#127469;', 'Switzerland': '&#127464;&#127469;',
        'Svezia': '&#127480;&#127466;',
        'Irlanda': '&#127470;&#127466;', 'Ireland': '&#127470;&#127466;',
        'Estonia': '&#127466;&#127466;',
        'Polonia': '&#127477;&#127473;', 'Poland': '&#127477;&#127473;',
        'Portogallo': '&#127477;&#127481;',
        'Belgio': '&#127463;&#127466;',
        'Danimarca': '&#127465;&#127472;',
        'Finlandia': '&#127467;&#127470;',
        'Norvegia': '&#127475;&#127476;',
        'Lussemburgo': '&#127473;&#127482;',
        'Grecia': '&#127468;&#127479;',
        'Islanda': '&#127470;&#127480;',
        'Australia': '&#127462;&#127482;',
        'Canada': '&#127464;&#127462;',
        'India': '&#127470;&#127475;',
        'Israele': '&#127470;&#127473;',
        'Singapore': '&#127480;&#127468;',
        'Cipro': '&#127464;&#127486;', 'Cyprus': '&#127464;&#127486;',
        'Romania': '&#127479;&#127476;',
        'Bulgaria': '&#127463;&#127468;',
        'Globale': '&#127760;',
    }
    if not country:
        return ''
    return flags.get(country, '')


def render_position_card(pos, highlights):
    score = pos['total_score']
    tier_class, tier_dot, tier_label = tier_info(score)
    is_rejected = pos['response'] == 'rejected' if pos['response'] else False

    # HQ azienda (pin) — da companies via FK
    hq = pos['c_hq_country'] or ''
    hq_display = f'<span class="tag hq">{country_flag(hq)} {esc(hq)}</span>' if hq else ''

    # Location (V2 — campo unificato)
    work_loc = pos['location'] or ''
    if not work_loc and pos['remote_type']:
        icons = {'full_remote': 'Remote', 'hybrid': 'Hybrid', 'onsite': 'On-site'}
        work_loc = icons.get(pos['remote_type'], pos['remote_type'])
    work_display = f'<span class="tag work-loc">&#127760; {esc(work_loc)}</span>' if work_loc else ''

    # Stipendio (V2 — declared + estimated separati)
    salary = ''
    has_declared = pos['salary_declared_min'] or pos['salary_declared_max']
    has_estimated = pos['salary_estimated_min'] or pos['salary_estimated_max']
    if has_declared:
        lo = f"{pos['salary_declared_min']//1000}K" if pos['salary_declared_min'] else '?'
        hi = f"{pos['salary_declared_max']//1000}K" if pos['salary_declared_max'] else '?'
        cur = pos['salary_declared_currency'] or 'EUR'
        salary = f'<span class="tag salary">&#128176; {lo}-{hi} {cur} <span class="salary-type" title="dichiarato">&#9989;</span></span>'
    elif has_estimated:
        lo = f"{pos['salary_estimated_min']//1000}K" if pos['salary_estimated_min'] else '?'
        hi = f"{pos['salary_estimated_max']//1000}K" if pos['salary_estimated_max'] else '?'
        cur = pos['salary_estimated_currency'] or 'EUR'
        src = pos['salary_estimated_source'] or 'stima'
        salary = f'<span class="tag salary">&#128176; {lo}-{hi} {cur} <span class="salary-type salary-estimated" title="{esc(src)}">&#128302;{esc(src)}</span></span>'

    # Deadline
    deadline = ''
    if pos['deadline'] and pos['deadline'] != 'non presente':
        deadline = f'<span class="tag deadline">&#9200; {esc(pos["deadline"])}</span>'

    score_display = f'<div class="score-circle {tier_class}">{score}</div>' if score is not None else '<div class="score-circle non-scored">-</div>'

    # Source link
    src_link = source_label(pos['source'], pos['url'])

    # Application section
    app_section = ''
    if pos['app_status']:
        pdfs = f'{pdf_link(pos["cv_pdf_path"], "CV")} {pdf_link(pos["cl_pdf_path"], "CL")}'
        critic = verdict_badge(pos['critic_verdict']) if pos['critic_verdict'] else '<span class="text-dim">in attesa review</span>'
        applied = f'<div class="applied-badge">&#9989; Candidata {esc(pos["applied_at"] or "")} via {esc(pos["applied_via"] or "")}</div>' if pos['applied_at'] else ''
        app_section = f'''
        <div class="app-section">
            <div class="app-docs">{pdfs}</div>
            <div class="app-critic">Critico: {critic}</div>
            {applied}
        </div>'''

    company_verdict = verdict_badge(pos['company_verdict']) if pos['company_verdict'] else ''

    # Pro/Contro
    pid = pos['id']
    hl = highlights.get(pid, {'pro': [], 'con': []})
    pros_html = ''
    cons_html = ''
    if hl['pro']:
        items = ''.join(f'<li>{esc(t)}</li>' for t in hl['pro'][:4])
        pros_html = f'<div class="hl-section hl-pro"><span class="hl-label">&#128994; Pro</span><ul>{items}</ul></div>'
    if hl['con']:
        items = ''.join(f'<li>{esc(t)}</li>' for t in hl['con'][:4])
        cons_html = f'<div class="hl-section hl-con"><span class="hl-label">&#128308; Contro</span><ul>{items}</ul></div>'
    highlights_html = f'<div class="highlights">{pros_html}{cons_html}</div>' if (pros_html or cons_html) else ''

    rejected_class = ' rejected' if is_rejected else ''
    rejected_banner = '<div class="rejected-banner">&#10060; REJECTED</div>' if is_rejected else ''

    return f'''
    <div class="card {tier_class}{rejected_class}">
        {rejected_banner}
        <div class="card-header">
            {score_display}
            <div class="card-title">
                <h3>{esc(pos['title'])}</h3>
                <div class="card-company">{esc(pos['company'])} {company_verdict}</div>
            </div>
            <div class="card-tier">{tier_label}</div>
        </div>
        <div class="card-tags">
            {hq_display} {work_display} {salary} {deadline}
        </div>
        <div class="card-status">
            {status_badge(pos['status'])} {src_link}
        </div>
        {highlights_html}
        {app_section}
    </div>'''


def render_team_status(team):
    online_count = sum(1 for a in team if a['online'])
    total_count = len([a for a in team if a['online'] or a['role'] != 'Critico'])
    # Only show agents that are online or are core team (not ad-hoc critici)
    core_agents = [a for a in team if a['online'] or a['session'] in (
        'SCOUT-1', 'SCOUT-2', 'ANALISTA-1', 'ANALISTA-2',
        'SCORER-1', 'SCORER-2', 'SCRITTORE-1', 'SCRITTORE-2',
        'SCRITTORE-3', 'CRITICO')]
    # Add any online critici-s* that aren't in core
    for a in team:
        if a['online'] and a not in core_agents:
            core_agents.append(a)

    role_colors = {
        'Scout': '#58a6ff', 'Analista': '#bc8cff', 'Scorer': '#d29922',
        'Scrittore': '#d18616', 'Critico': '#39d2c0',
    }
    cards = ''
    for a in core_agents:
        color = role_colors.get(a['role'], '#8b949e')
        status_dot = '&#128994;' if a['online'] else '&#128308;'
        status_text = 'ONLINE' if a['online'] else 'OFFLINE'
        opacity = '1' if a['online'] else '0.4'
        cards += f'''<div class="team-agent" style="opacity:{opacity};border-color:{color}40">
            <div class="team-dot">{status_dot}</div>
            <div class="team-name">{esc(a['session'])}</div>
            <div class="team-status" style="color:{color}">{status_text}</div>
        </div>'''

    return f'''<div class="team-section">
        <div class="team-header">&#129302; Team Status — <span style="color:var(--green)">{online_count} online</span></div>
        <div class="team-grid">{cards}</div>
    </div>'''


def generate_html(positions, stats, company_stats, highlights, team=None):
    now = datetime.now().strftime('%d/%m/%Y %H:%M')
    total = sum(v for k, v in stats.items() if k != 'excluded')
    seria_count = sum(1 for p in positions if (p['total_score'] or 0) >= 70)
    practice_count = sum(1 for p in positions if p['total_score'] and 40 <= p['total_score'] < 70)
    applied_count = stats.get('applied', 0)
    app_count = sum(1 for p in positions if p['app_status'])
    excluded_count = stats.get('excluded', 0)

    seria = [p for p in positions if (p['total_score'] or 0) >= 70]
    practice = [p for p in positions if p['total_score'] and 40 <= p['total_score'] < 70]
    riferimento = [p for p in positions if p['total_score'] is not None and p['total_score'] < 40]
    non_scored = [p for p in positions if p['total_score'] is None]

    seria_cards = '\n'.join(render_position_card(p, highlights) for p in seria)
    practice_cards = '\n'.join(render_position_card(p, highlights) for p in practice)
    riferimento_cards = '\n'.join(render_position_card(p, highlights) for p in riferimento)
    non_scored_cards = '\n'.join(render_position_card(p, highlights) for p in non_scored)

    return f'''<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<title>Job Hunter — Dashboard</title>
<style>
  :root {{
    --bg: #0d1117; --surface: #161b22; --surface2: #1c2333;
    --border: #30363d; --text: #e6edf3; --text-dim: #8b949e;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --blue: #58a6ff; --purple: #bc8cff; --orange: #d18616; --cyan: #39d2c0;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6; padding: 20px;
  }}
  .container {{ max-width: 1400px; margin: 0 auto; }}

  .header {{
    text-align: center; padding: 24px 20px;
    background: linear-gradient(135deg, #1a1e2e 0%, #0d1117 100%);
    border: 1px solid var(--border); border-radius: 16px; margin-bottom: 20px;
  }}
  .header h1 {{ font-size: 1.8em; margin-bottom: 2px; }}
  .header h1 span {{ color: var(--orange); }}
  .header .date {{ color: var(--blue); font-weight: 600; font-size: 0.85em; }}
  .header .live {{ color: var(--green); font-size: 0.75em; }}

  .stats {{
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px; margin-bottom: 20px;
  }}
  .stat-card {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px; text-align: center;
  }}
  .stat-card .number {{ font-size: 2em; font-weight: 700; line-height: 1; }}
  .stat-card .label {{ color: var(--text-dim); font-size: 0.75em; margin-top: 2px; }}
  .stat-green {{ color: var(--green); }}
  .stat-yellow {{ color: var(--yellow); }}
  .stat-red {{ color: var(--red); }}
  .stat-blue {{ color: var(--blue); }}
  .stat-purple {{ color: var(--purple); }}
  .stat-cyan {{ color: var(--cyan); }}

  .pipeline {{
    display: flex; justify-content: center; gap: 6px; flex-wrap: wrap;
    margin-bottom: 20px;
  }}
  .pipe-step {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 14px; text-align: center; min-width: 80px;
  }}
  .pipe-step .pipe-count {{ font-size: 1.3em; font-weight: 700; }}
  .pipe-step .pipe-label {{ font-size: 0.7em; color: var(--text-dim); }}
  .pipe-arrow {{ display: flex; align-items: center; color: var(--text-dim); }}

  .section-title {{
    font-size: 1.2em; margin: 24px 0 12px; padding-bottom: 6px;
    border-bottom: 2px solid var(--border);
  }}

  .cards {{
    display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 12px;
  }}

  .card {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px; transition: border-color 0.2s;
  }}
  .card:hover {{ border-color: var(--text-dim); }}
  .card.seria {{ border-left: 3px solid var(--green); }}
  .card.practice {{ border-left: 3px solid var(--yellow); }}
  .card.riferimento {{ border-left: 3px solid var(--blue); }}
  .card.non-scored {{ border-left: 3px solid var(--text-dim); }}
  .card.rejected {{
    opacity: 0.45; border-left: 3px solid var(--red) !important;
    position: relative;
  }}
  .card.rejected .card-title h3 {{ text-decoration: line-through; }}
  .rejected-banner {{
    background: var(--red); color: #fff; font-weight: 700; font-size: 0.8em;
    padding: 4px 14px; border-radius: 6px; margin-bottom: 8px;
    text-align: center; letter-spacing: 1px;
  }}

  .card-header {{ display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }}
  .card-title {{ flex: 1; }}
  .card-title h3 {{ font-size: 0.95em; line-height: 1.3; }}
  .card-company {{ color: var(--text-dim); font-size: 0.8em; }}
  .card-tier {{ font-size: 0.7em; white-space: nowrap; font-weight: 600; }}

  .score-circle {{
    width: 44px; height: 44px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font-weight: 700;
    font-size: 1em; flex-shrink: 0;
  }}
  .score-circle.seria {{ background: #3fb95020; color: var(--green); border: 2px solid var(--green); }}
  .score-circle.practice {{ background: #d2992220; color: var(--yellow); border: 2px solid var(--yellow); }}
  .score-circle.riferimento {{ background: #58a6ff20; color: var(--blue); border: 2px solid var(--blue); }}
  .score-circle.non-scored {{ background: #8b949e20; color: var(--text-dim); border: 2px solid var(--text-dim); }}

  .card-tags {{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }}
  .tag {{
    font-size: 0.8em; background: var(--surface2); padding: 2px 8px;
    border-radius: 6px; white-space: nowrap;
  }}
  .tag.hq {{ border-left: 2px solid var(--purple); }}
  .tag.work-loc {{ border-left: 2px solid var(--cyan); }}
  .tag.salary {{ border-left: 2px solid var(--yellow); }}
  .tag.deadline {{ border-left: 2px solid var(--orange); }}
  .salary-type {{ font-size: 0.8em; opacity: 0.7; }}
  .salary-estimated {{
    opacity: 1; color: var(--orange); font-weight: 600;
    background: #d1861620; padding: 1px 5px; border-radius: 4px;
    border: 1px dashed var(--orange); font-size: 0.75em;
  }}

  .card-status {{ display: flex; align-items: center; gap: 8px; font-size: 0.8em; margin-bottom: 6px; }}

  .badge {{
    display: inline-block; padding: 2px 8px; border-radius: 6px;
    font-size: 0.75em; font-weight: 600;
  }}
  .badge.badge-applied {{
    background: var(--green) !important; color: #000 !important;
    border: none !important; padding: 3px 12px; font-size: 0.85em;
    letter-spacing: 0.5px; text-transform: uppercase;
    box-shadow: 0 0 8px #3fb95060;
    animation: pulse-applied 2s ease-in-out infinite;
  }}
  @keyframes pulse-applied {{
    0%, 100% {{ box-shadow: 0 0 8px #3fb95060; }}
    50% {{ box-shadow: 0 0 16px #3fb950a0; }}
  }}

  .source-link {{
    color: var(--blue); text-decoration: none; font-size: 0.8em;
    font-weight: 600; padding: 2px 8px; border: 1px solid #58a6ff30;
    border-radius: 6px; transition: background 0.2s;
  }}
  .source-link:hover {{ background: #58a6ff15; }}

  .highlights {{
    display: flex; gap: 10px; margin: 6px 0; font-size: 0.8em;
  }}
  .hl-section {{ flex: 1; }}
  .hl-label {{ font-weight: 600; font-size: 0.85em; }}
  .hl-section ul {{ margin: 2px 0 0 16px; padding: 0; }}
  .hl-section li {{ margin: 1px 0; line-height: 1.3; }}
  .hl-pro {{ color: #8bcea0; }}
  .hl-con {{ color: #e89090; }}

  .app-section {{
    background: var(--surface2); border-radius: 8px; padding: 8px 10px;
    margin-top: 6px; font-size: 0.8em;
  }}
  .app-docs {{ display: flex; gap: 10px; margin-bottom: 4px; }}
  .pdf-link {{
    color: var(--cyan); text-decoration: none; font-weight: 600;
    padding: 2px 8px; border: 1px solid #39d2c040; border-radius: 6px;
    transition: background 0.2s;
  }}
  .pdf-link:hover {{ background: #39d2c015; }}
  .app-critic {{ margin-top: 3px; }}
  .applied-badge {{
    margin-top: 6px; color: #000; font-weight: 700;
    background: var(--green); padding: 4px 12px; border-radius: 8px;
    font-size: 0.9em; display: inline-block;
    box-shadow: 0 0 10px #3fb95060;
  }}

  .text-dim {{ color: var(--text-dim); }}

  .team-section {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 14px; margin-bottom: 16px;
  }}
  .team-header {{
    font-size: 1em; font-weight: 700; margin-bottom: 10px;
  }}
  .team-grid {{
    display: flex; flex-wrap: wrap; gap: 8px;
  }}
  .team-agent {{
    display: flex; align-items: center; gap: 6px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px 12px; font-size: 0.8em;
    border-left: 3px solid;
  }}
  .team-dot {{ font-size: 0.7em; }}
  .team-name {{ font-weight: 600; }}
  .team-status {{ font-size: 0.7em; font-weight: 700; }}

  .collapsible {{ cursor: pointer; }}
  .collapsible-content {{ display: none; }}
  .collapsible-content.open {{ display: block; }}

  @media (max-width: 500px) {{
    .cards {{ grid-template-columns: 1fr; }}
    .stats {{ grid-template-columns: repeat(3, 1fr); }}
  }}
</style>
</head>
<body>
<div class="container">

<div class="header">
  <h1>&#127919; Job Hunter — <span>Dashboard</span></h1>
  <div class="date">Aggiornata: {now}</div>
  <div class="live">&#128994; LIVE — auto-refresh 10s</div>
</div>

{render_team_status(team) if team else ''}

<div class="stats">
  <div class="stat-card"><div class="number stat-blue">{total}</div><div class="label">Posizioni attive</div></div>
  <div class="stat-card"><div class="number stat-green">{seria_count}</div><div class="label">Serie (&#8805;70)</div></div>
  <div class="stat-card"><div class="number stat-yellow">{practice_count}</div><div class="label">Practice (40-69)</div></div>
  <div class="stat-card"><div class="number stat-purple">{app_count}</div><div class="label">CV scritti</div></div>
  <div class="stat-card"><div class="number stat-cyan">{applied_count}</div><div class="label">Inviate</div></div>
  <div class="stat-card"><div class="number stat-red">{excluded_count}</div><div class="label">Escluse</div></div>
</div>

<div class="pipeline">
  <div class="pipe-step"><div class="pipe-count" style="color:var(--blue)">{stats.get('new', 0)}</div><div class="pipe-label">New</div></div>
  <div class="pipe-arrow">&#8594;</div>
  <div class="pipe-step"><div class="pipe-count" style="color:var(--purple)">{stats.get('checked', 0)}</div><div class="pipe-label">Checked</div></div>
  <div class="pipe-arrow">&#8594;</div>
  <div class="pipe-step"><div class="pipe-count" style="color:var(--yellow)">{stats.get('scored', 0)}</div><div class="pipe-label">Scored</div></div>
  <div class="pipe-arrow">&#8594;</div>
  <div class="pipe-step"><div class="pipe-count" style="color:var(--orange)">{stats.get('writing', 0) + stats.get('review', 0)}</div><div class="pipe-label">Writing</div></div>
  <div class="pipe-arrow">&#8594;</div>
  <div class="pipe-step"><div class="pipe-count" style="color:var(--green)">{stats.get('ready', 0)}</div><div class="pipe-label">Ready</div></div>
  <div class="pipe-arrow">&#8594;</div>
  <div class="pipe-step"><div class="pipe-count" style="color:var(--green)">{stats.get('applied', 0)}</div><div class="pipe-label">Applied</div></div>
</div>

<div class="section-title">&#128994; Candidature Serie (score &#8805; 70) — {len(seria)}</div>
<div class="cards">{seria_cards}</div>

<div class="section-title">&#128993; Practice Interview (score 40-69) — {len(practice)}</div>
<div class="cards">{practice_cards}</div>

{"" if not riferimento else f'<div class="section-title collapsible" onclick="toggle(this)">&#128309; Riferimento (score &lt; 40) — {len(riferimento)} &#9654;</div><div class="collapsible-content"><div class="cards">{riferimento_cards}</div></div>'}

{"" if not non_scored else f'<div class="section-title collapsible" onclick="toggle(this)">&#11044; Non ancora valutate — {len(non_scored)} &#9654;</div><div class="collapsible-content"><div class="cards">{non_scored_cards}</div></div>'}

</div>

<script>
function toggle(el) {{
  const content = el.nextElementSibling;
  content.classList.toggle('open');
  const arrow = content.classList.contains('open') ? '\\u25BC' : '\\u25B6';
  el.innerHTML = el.innerHTML.replace(/[\\u25B6\\u25BC]/, arrow);
}}
</script>
</body>
</html>'''


def save_version(output_path):
    os.makedirs(VERSIONS_DIR, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    version_path = os.path.join(VERSIONS_DIR, f'dashboard-{ts}.html')
    shutil.copy2(output_path, version_path)
    print(f"Versione salvata: {version_path}")
    return version_path


def main():
    parser = argparse.ArgumentParser(description='Genera dashboard HTML dal DB')
    parser.add_argument('--open', action='store_true', help='Apri nel browser')
    parser.add_argument('--version', action='store_true', help='Salva anche una copia versionata')
    parser.add_argument('--output', default=OUTPUT_PATH)
    args = parser.parse_args()

    conn = get_db()
    ensure_schema(conn)

    positions = get_all_positions(conn)
    stats = get_stats(conn)
    company_stats = get_company_stats(conn)
    highlights = get_highlights(conn)
    conn.close()

    team = get_team_status()
    html = generate_html(positions, stats, company_stats, highlights, team=team)

    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"Dashboard generata: {output}")
    print(f"Posizioni: {len(positions)} | Serie: {sum(1 for p in positions if (p['total_score'] or 0) >= 70)}")

    if args.version:
        save_version(output)

    if args.open:
        subprocess.run(['open', output])


if __name__ == '__main__':
    main()
