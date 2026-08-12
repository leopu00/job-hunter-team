import csv, json, sqlite3, subprocess
from datetime import datetime, timezone

FROM_TS = float(%d)
TO_TS = float(%d)
BUCKET = max(60, int(%d))
ROLE = '%s'

def iso_to_unix(s):
    # i ts di sqlite (CURRENT_TIMESTAMP) sono naive UTC: senza offset
    # esplicito il fuso va imposto, non dedotto dal sistema
    try:
        d = datetime.fromisoformat(str(s).replace(' ', 'T').replace('Z', '+00:00'))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except Exception:
        return 0.0

def bucket_of(t):
    return int(t // BUCKET) * BUCKET

def mine(name):
    n = str(name).lower()
    return n == ROLE or n.startswith(ROLE + '-')

def to_rows(acc, fn=lambda v: v):
    return [{'t': t, 'v': fn(acc[t])} for t in sorted(acc)]

out = {'ok': True, 'agent': ROLE, 'series': {}}

# ── token kT per bucket (serie cumulativa della skill → delta) ───────
try:
    now = datetime.now(timezone.utc).timestamp()
    since_min = max(5.0, (now - FROM_TS) / 60.0)
    raw = subprocess.check_output(
        ['python3', '/app/shared/skills/token-by-agent-series.py',
         '--since-min', str(round(since_min, 1)),
         '--bucket-sec', str(BUCKET)],
        text=True, stderr=subprocess.DEVNULL, timeout=240)
    data = json.loads(raw)
    all_names = data.get('agents', [])
    names = [a for a in all_names if mine(a)]
    prev = {a: 0.0 for a in all_names}
    acc = {}
    team = {}
    for row in data.get('series', []):
        t = iso_to_unix(row.get('ts'))
        keep = FROM_TS <= t <= TO_TS
        for a in all_names:
            cur = float(row.get(a) or 0)
            delta = max(0.0, cur - prev[a])
            prev[a] = cur
            if keep and delta > 0:
                team[bucket_of(t)] = team.get(bucket_of(t), 0.0) + delta
                if a in names:
                    acc[bucket_of(t)] = acc.get(bucket_of(t), 0.0) + delta
    out['series']['tokens_kt'] = to_rows(acc, lambda v: round(v, 2))
except Exception as e:
    out['tokens_error'] = str(e)
    acc, team = {}, {}

# ── quota finestre: delta usage%% della sentinella x fetta token del
# ruolo nel bucket. Auto-consistente: nessuna dipendenza dai pesi del
# token-meter (che pesa i token diversamente dalla serie per-agente).
try:
    lv = {}
    for line in open('/jht_home/logs/sentinel-data.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        t = iso_to_unix(row.get('ts'))
        # un bucket di margine PRIMA della finestra: il primo delta
        # visibile ha bisogno del livello precedente
        if t < FROM_TS - BUCKET or t > TO_TS:
            continue
        b = lv.setdefault(bucket_of(t), {'n': 0, 'u': 0.0, 'w': 0.0})
        b['n'] += 1
        b['u'] += float(row.get('usage') or 0)
        b['w'] += float(row.get('weekly_usage') or 0)
    ts_sorted = sorted(lv)
    p5, pw = [], []
    for i in range(1, len(ts_sorted)):
        t0, t1 = ts_sorted[i - 1], ts_sorted[i]
        if t1 < FROM_TS or t1 > TO_TS:
            continue
        a0, a1 = lv[t0], lv[t1]
        du = max(0.0, a1['u'] / max(1, a1['n']) - a0['u'] / max(1, a0['n']))
        dw = max(0.0, a1['w'] / max(1, a1['n']) - a0['w'] / max(1, a0['n']))
        share = acc.get(t1, 0.0) / team[t1] if team.get(t1) else 0.0
        if share > 0:
            p5.append({'t': t1, 'v': round(du * share, 3)})
            pw.append({'t': t1, 'v': round(dw * share, 4)})
    out['series']['pct_5h'] = p5
    out['series']['pct_weekly'] = pw
except Exception as e:
    out['pct_error'] = str(e)

# ── pause pacing del ruolo ───────────────────────────────────────────
try:
    acc = {}
    for line in open('/jht_home/logs/throttle-events.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        if str(row.get('event')) != 'start' or not mine(row.get('agent')):
            continue
        t = float(row.get('ts_unix') or 0)
        if FROM_TS <= t <= TO_TS:
            acc[bucket_of(t)] = acc.get(bucket_of(t), 0.0) +                 float(row.get('applied_sec') or 0)
    out['series']['throttle_s'] = to_rows(acc)
except Exception as e:
    out['throttle_error'] = str(e)

# ── azioni jobs.db del ruolo (conteggio per bucket) ──────────────────
try:
    acc = {}
    def add_ts(s):
        t = iso_to_unix(s)
        if FROM_TS <= t <= TO_TS:
            acc[bucket_of(t)] = acc.get(bucket_of(t), 0) + 1
    # Il path non si indovina nemmeno in lettura: '/jht_home/jobs.db'
    # scritto a mano legge il database SBAGLIATO quando JHT_DB punta
    # altrove, e una serie contata sul DB sbagliato è un grafico che mente
    # (DB-PATH-FALLS-BACK-INSTEAD-OF-STOPPING). La risoluzione sta DENTRO
    # questo try di proposito: se l'ambiente non dice dov'è il database,
    # l'errore actionable di _db finisce in db_error e le altre serie del
    # payload sopravvivono — questa sezione è best-effort come le sorelle.
    import sys
    sys.path.insert(0, '/app/shared/skills')
    from _db import DB_PATH
    db = sqlite3.connect('file:' + DB_PATH + '?mode=ro', uri=True)
    like = ROLE + '-%%'
    for (ts,) in db.execute(
            'SELECT ts FROM position_state_transitions '
            'WHERE by_agent = ? OR by_agent LIKE ?', (ROLE, like)):
        add_ts(ts)
    # scrittore e critico non passano dalle transitions: i loro eventi
    # vivono su applications (written_at / critic_reviewed_at)
    if ROLE == 'scrittore':
        for (ts,) in db.execute(
                'SELECT written_at FROM applications '
                'WHERE written_at IS NOT NULL'):
            add_ts(ts)
    if ROLE == 'critico':
        for (ts,) in db.execute(
                'SELECT critic_reviewed_at FROM applications '
                'WHERE critic_reviewed_at IS NOT NULL'):
            add_ts(ts)
    db.close()
    out['series']['db_actions'] = to_rows(acc)
except Exception as e:
    out['db_error'] = str(e)

# ── cpu/rss VERI del ruolo da agent-vitals.jsonl (sampler 19/07:
# attribuzione JHT_AGENT_NAME in /proc/*/environ, somma istanze,
# media per bucket). Vuoto finche' il sampler non gira.
try:
    acc = {}
    for line in open('/jht_home/logs/agent-vitals.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        t = iso_to_unix(row.get('ts'))
        if not (FROM_TS <= t <= TO_TS):
            continue
        cpu = rss = 0.0
        hit = False
        for name, v in (row.get('agents') or {}).items():
            if mine(name):
                hit = True
                cpu += float(v.get('cpu_pct') or 0)
                rss += float(v.get('rss_mb') or 0)
        if not hit:
            continue
        b = acc.setdefault(bucket_of(t), {'n': 0, 'cpu': 0.0, 'rss': 0.0})
        b['n'] += 1
        b['cpu'] += cpu
        b['rss'] += rss
    out['series']['cpu_agent_pct'] = [
        {'t': t, 'v': round(acc[t]['cpu'] / max(1, acc[t]['n']), 1)}
        for t in sorted(acc)]
    out['series']['ram_agent_mb'] = [
        {'t': t, 'v': round(acc[t]['rss'] / max(1, acc[t]['n']), 1)}
        for t in sorted(acc)]
except Exception as e:
    out['agent_vitals_error'] = str(e)

# ── contesto container: cpu/ram %% da vitals.jsonl (media per bucket) ─
try:
    acc = {}
    for line in open('/jht_home/logs/vitals.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        t = iso_to_unix(row.get('ts'))
        if not (FROM_TS <= t <= TO_TS):
            continue
        b = acc.setdefault(bucket_of(t), {'n': 0, 'cpu': 0.0, 'ram': 0.0})
        b['n'] += 1
        b['cpu'] += float((row.get('cpu') or {}).get('pct') or 0)
        b['ram'] += float((row.get('mem') or {}).get('pct') or 0)
    out['series']['cpu_pct'] = [
        {'t': t, 'v': round(acc[t]['cpu'] / max(1, acc[t]['n']), 1)}
        for t in sorted(acc)]
    out['series']['ram_pct'] = [
        {'t': t, 'v': round(acc[t]['ram'] / max(1, acc[t]['n']), 1)}
        for t in sorted(acc)]
except Exception as e:
    out['vitals_error'] = str(e)

print(json.dumps(out, separators=(',', ':')))
