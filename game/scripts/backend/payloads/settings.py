import json, os
out = {}
try:
    c = json.load(open('/jht_home/jht.config.json'))
except Exception:
    c = {}
ap = str(c.get('active_provider', ''))
p = (c.get('providers') or {}).get(ap, {}) or {}
auth_paths = {
    'claude': ['/jht_home/.claude/.credentials.json'],
    'anthropic': ['/jht_home/.claude/.credentials.json'],
    'openai': ['/jht_home/.codex/auth.json', '/jht_home/.codex/credentials.json'],
    'codex': ['/jht_home/.codex/auth.json', '/jht_home/.codex/credentials.json'],
    'kimi': ['/jht_home/.kimi/credentials/kimi-code.json',
             '/jht_home/.config/kimi-cli/credentials.json'],
    'moonshot': ['/jht_home/.kimi/credentials/kimi-code.json',
                 '/jht_home/.config/kimi-cli/credentials.json'],
}
out['active_provider'] = ap
out['provider_auth_ready'] = any(os.path.isfile(x) and os.path.getsize(x) > 0
                                 for x in auth_paths.get(ap.lower(), []))
sub = p.get('subscription')
if isinstance(sub, dict):
    sub = sub.get('email') or ', '.join(str(v) for v in sub.values())
out['provider'] = [
    ['Provider attivo', ap or '—'],
    ['Modello', str(p.get('model', '—'))],
    ['Abbonamento', str(sub or '—')],
    ['Autenticazione', str(p.get('auth_method', '—'))],
]
wh = ((c.get('team') or {}).get('working_hours') or {})
out['hours'] = [
    ['Timezone', str(wh.get('timezone', '—'))],
    ['Finestre di lavoro', json.dumps(wh.get('windows', '—'), ensure_ascii=False)[:120]],
]
out['hours_raw'] = wh
n = c.get('notifications') or {}
out['email'] = [
    ['Notifiche', 'attive' if n.get('enabled') else 'spente'],
    ['Canali', ', '.join(map(str, n.get('channels') or [])) or '—'],
]
try:
    ec = json.load(open('/jht_home/credentials/email_monitor.json'))
except Exception:
    ec = {}
out['email_account'] = {
    'configured': bool(ec.get('user')),
    'email': str(ec.get('user') or ''),
    'host': str(ec.get('imap_host') or ''),
}
try:
    cc = json.load(open('/jht_home/cloud.json'))
except Exception:
    cc = {}
out['cloud_account'] = {
    'configured': bool(cc.get('enabled') and cc.get('token')),
    'base_url': str(cc.get('base_url') or ''),
    'user_id': str(cc.get('user_id') or ''),
    'token_name': str(cc.get('token_name') or ''),
}
tg = (((c.get('channels') or {}).get('telegram') or {}).get('bots') or {})
out['telegram_bots'] = {
    role: {
        'configured': bool((tg.get(role) or {}).get('bot_token')),
        'chat_ready': bool((tg.get(role) or {}).get('chat_id')),
    }
    for role in ('assistente', 'capitano', 'mentor')
}
a = c.get('analytics') or {}
out['advanced'] = [
    ['Config version', str(c.get('version', '—'))],
    ['Analytics', 'on' if a.get('enabled') else 'off'],
    ['Retention (giorni)', str(a.get('retention_days', '—'))],
]
try:
    import yaml
    prof = yaml.safe_load(open('/jht_home/profile/candidate_profile.yml')) or {}
    rows = []
    for key, label in [('name', 'Nome'), ('target_role', 'Ruolo target'),
                       ('location', 'Localita'), ('experience_years', 'Anni di esperienza'),
                       ('seniority_target', 'Seniority target'), ('industry', 'Settore'),
                       ('nationality', 'Nazionalita')]:
        if prof.get(key) is not None:
            rows.append([label, str(prof[key])])
    skills = (prof.get('skills') or {}).get('primary') or []
    if skills:
        rows.append(['Skill primarie', ', '.join(map(str, skills[:8]))])
    sal = prof.get('salary_target') or prof.get('salary') or {}
    if isinstance(sal, dict) and sal:
        lo = sal.get('min') or sal.get('lo')
        hi = sal.get('max') or sal.get('hi')
        cur = sal.get('currency') or 'EUR'
        if lo or hi:
            rows.append(['Salary target', str(lo) + ' - ' + str(hi) + ' ' + str(cur)])
    elif sal:
        rows.append(['Salary target', str(sal)[:80]])
    if rows:
        out['profile'] = rows
    raw = {}
    for key in ['name', 'email', 'target_role', 'location', 'experience_years',
                'seniority_target', 'industry', 'nationality']:
        if prof.get(key) is not None:
            raw[key] = str(prof[key])
    raw['skills_primary'] = ', '.join(map(str, skills))
    # Il profilo canonico usa anche oggetti {language, level}. Esporre str(dict)
    # alla LineEdit produceva testo Python e il successivo Salva lo corrompeva.
    language_parts = []
    for item in prof.get('languages') or []:
        if isinstance(item, dict):
            name = str(item.get('language') or item.get('name') or '').strip()
            level = str(item.get('level') or '').strip()
            if name:
                language_parts.append(name + (' (' + level + ')' if level else ''))
        elif str(item).strip():
            language_parts.append(str(item).strip())
    raw['languages'] = ', '.join(language_parts)
    if isinstance(sal, dict):
        raw['salary_min'] = str(sal.get('min') or sal.get('lo') or '')
        raw['salary_max'] = str(sal.get('max') or sal.get('hi') or '')
        raw['salary_currency'] = str(sal.get('currency') or 'EUR')
    out['profile_raw'] = raw
except Exception:
    pass
try:
    ps = json.load(open('/jht_home/logs/pacing-bridge-state.json'))
    out['work_phase'] = str(ps.get('work_phase', ''))
except Exception:
    pass
# Finestra di consumo del provider: serve al gioco per DIRE all'utente
# perche il team non risponde. Senza, chi scrive in chat durante un
# lockout vede solo silenzio e conclude che l'app e rotta.
try:
    last = None
    with open('/jht_home/logs/sentinel-data.jsonl') as fh:
        for row in fh:
            row = row.strip()
            if row:
                last = row
    s = json.loads(last) if last else {}
    usage = s.get('usage')
    if isinstance(usage, (int, float)):
        out['budget_window'] = {
            'usage_pct': float(usage),
            'reset_at': str(s.get('reset_at') or ''),
            'reset_at_unix': s.get('reset_at_unix'),
            'weekly_pct': s.get('weekly_usage'),
            'status': str(s.get('status') or ''),
            'sample_ts': str(s.get('ts') or ''),
        }
except Exception:
    pass
try:
    u = json.load(open('/jht_home/logs/agent-usage-table.json'))
    tot = {}
    for row in u.get('series_kt_per_bucket', []):
        for k, v in row.items():
            if k != 'ts':
                tot[k] = round(tot.get(k, 0) + float(v), 1)
    out['usage'] = {'window_h': u.get('window_h'), 'per_agent_kt': tot,
                    'generated_at': str(u.get('generated_at', ''))}
except Exception:
    pass
print(json.dumps(out, ensure_ascii=False))
