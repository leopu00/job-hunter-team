import csv, json, subprocess
from datetime import datetime, timezone

FROM_TS = float(%d)
TO_TS = float(%d)
BUCKET = max(60, int(%d))

def iso_to_unix(s):
    try:
        return datetime.fromisoformat(str(s)).timestamp()
    except Exception:
        return 0.0

def bucket_of(t):
    return int(t // BUCKET) * BUCKET

out = {'ok': True, 'sentinel': [], 'meter': [], 'throttle': [], 'agents': {}}

# ── sentinel-data.jsonl: usage%% finestra 5h, weekly, velocity, proj ──
try:
    acc = {}
    for line in open('/jht_home/logs/sentinel-data.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        t = iso_to_unix(row.get('ts'))
        if t < FROM_TS or t > TO_TS:
            continue
        b = acc.setdefault(bucket_of(t), {'n': 0, 'usage': 0.0, 'weekly': 0.0,
                                          'velocity': 0.0, 'velocity_ideal': 0.0,
                                          'projection': 0.0})
        b['n'] += 1
        b['usage'] += float(row.get('usage') or 0)
        b['weekly'] += float(row.get('weekly_usage') or 0)
        b['velocity'] += float(row.get('velocity_smooth') or 0)
        b['velocity_ideal'] += float(row.get('velocity_ideal') or 0)
        b['projection'] += float(row.get('projection') or 0)
    for t in sorted(acc):
        b = acc[t]
        n = max(1, b['n'])
        out['sentinel'].append({'t': t,
            'usage': round(b['usage'] / n, 2),
            'weekly': round(b['weekly'] / n, 2),
            'velocity': round(b['velocity'] / n, 2),
            'velocity_ideal': round(b['velocity_ideal'] / n, 2),
            'projection': round(b['projection'] / n, 2)})
except Exception as e:
    out['sentinel_error'] = str(e)

# ── throttle-events.jsonl: secondi di pausa pacing per bucket ────────
try:
    acc = {}
    for line in open('/jht_home/logs/throttle-events.jsonl'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        if str(row.get('event')) != 'start':
            continue
        t = float(row.get('ts_unix') or 0)
        if t < FROM_TS or t > TO_TS:
            continue
        b = acc.setdefault(bucket_of(t), {'throttle_s': 0.0, 'pauses': 0})
        b['throttle_s'] += float(row.get('applied_sec') or 0)
        b['pauses'] += 1
    for t in sorted(acc):
        d = dict(acc[t]); d['t'] = t
        out['throttle'].append(d)
except Exception as e:
    out['throttle_error'] = str(e)

# ── token-meter.csv: livello token pesati (finestra rolling 5h) ──────
try:
    acc = {}
    with open('/jht_home/logs/token-meter.csv') as f:
        for row in csv.DictReader(f):
            t = iso_to_unix(row.get('ts'))
            if t < FROM_TS or t > TO_TS:
                continue
            # ultimo campione del bucket: e' un livello, non un delta
            acc[bucket_of(t)] = {
                'weighted_kt': round(float(row.get('weighted') or 0) / 1000.0, 1),
                'events': int(float(row.get('events') or 0))}
    for t in sorted(acc):
        d = dict(acc[t]); d['t'] = t
        out['meter'].append(d)
except Exception as e:
    out['meter_error'] = str(e)

# ── per-agente: kT delta per bucket dai log CLI (skill del pacing) ───
try:
    now = datetime.now(timezone.utc).timestamp()
    since_min = max(5.0, (now - FROM_TS) / 60.0)
    raw = subprocess.check_output(
        ['python3', '/app/shared/skills/token-by-agent-series.py',
         '--since-min', str(round(since_min, 1)),
         '--bucket-sec', str(BUCKET)],
        text=True, stderr=subprocess.DEVNULL, timeout=240)
    data = json.loads(raw)
    # la skill produce serie CUMULATIVE per agente: qui si torna al
    # delta per bucket (il "quanto in quel momento" dei grafici),
    # scorrendo TUTTE le righe cosi' il primo bucket in range non
    # eredita il cumulato precedente.
    names = data.get('agents', [])
    prev = {a: 0.0 for a in names}
    series = []
    totals = {a: 0.0 for a in names}
    for row in data.get('series', []):
        t = iso_to_unix(row.get('ts'))
        keep = FROM_TS <= t <= TO_TS
        slim = {'t': t}
        for a in names:
            cur = float(row.get(a) or 0)
            delta = max(0.0, cur - prev[a])
            prev[a] = cur
            if keep and delta > 0:
                slim[a] = round(delta, 2)
                totals[a] += delta
        if keep:
            series.append(slim)
    out['agents'] = {
        'names': names,
        'series': series,
        'totals_kt': {a: round(v, 2) for a, v in totals.items()}}
except Exception as e:
    out['agents_error'] = str(e)

print(json.dumps(out, separators=(',', ':')))
