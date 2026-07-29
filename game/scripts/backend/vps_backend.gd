class_name VpsBackend
extends BackendAdapter
## Backend REALE: parla via SSH con una VPS del team (container Docker
## `jht`, stato in /jht_home). Legge, non scrive: l'app osserva il team.
## Eccezioni autorizzate da Leone: la chat utente↔agente e il TICKET
## utente→team (gate 1 dell'11/07) — mai scritture dirette sui dati.
##
## Ciclo: start() → CONNECTING → handshake ssh → CONNECTED → poll del
## roster (sessioni tmux nel container = agenti attivi) finché stop().
## Tutto l'I/O vive in un Thread; verso il bus solo call_deferred.

const POLL_SECS := 8.0
const SSH_TIMEOUT := 8
const CHAT_MARK := "---JHT-CHAT---"
const THROTTLE_MARK := "---JHT-THROTTLE---"


## Known-hosts dedicato per singolo server. SetupService lo popola da
## ssh-keyscan PRIMA del primo login; tutti i trasporti successivi usano
## StrictHostKeyChecking=yes, quindi un cambio chiave diventa un errore netto.
static func known_hosts_path(host: String) -> String:
	var root := OS.get_environment("JHT_HOME")
	if root == "":
		root = (OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
				else OS.get_environment("HOME")).path_join(".jht")
	return root.path_join("ssh/known_hosts/" + host.sha256_text())


static func ensure_known_host(host: String) -> Dictionary:
	var path := known_hosts_path(host)
	if FileAccess.file_exists(path):
		return {"ok": true, "path": path}
	var output: Array = []
	var code := OS.execute("ssh-keyscan", ["-T", "5", "-t", "ed25519", host],
			output, true)
	var raw := "\n".join(PackedStringArray(output)).strip_edges()
	if code != 0 or raw == "":
		return {"ok": false, "message": "chiave host SSH non disponibile"}
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "message": "known-hosts non scrivibile"}
	file.store_string(raw + "\n")
	file.close()
	if OS.get_name() != "Windows":
		OS.execute("chmod", ["600", path])
	return {"ok": true, "path": path}

## Stato EFFETTIVO del turno, non semplice presenza tmux. Le tre TUI
## supportate mostrano un marker di interrupt mentre il modello/tool sta
## lavorando; quando il composer è fermo il marker sparisce. In dubbio si
## ritorna idle: è meglio un falso fermo che inventare lavoro e movimento.
const AGENT_ACTIVITY_PY := """
import json, subprocess, time

def run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=4).stdout
    except Exception:
        return None

def tail_of(session):
    pane = run(['tmux', 'capture-pane', '-t', session, '-p'])
    if pane is None:
        return None
    return '\\n'.join(pane.splitlines()[-14:]).lower()

def classify(tail):
    busy = any(x in tail for x in (
        'esc to interrupt', 'to interrupt', 'ctrl+c to stop',
        'ctrl-c to stop', 'working (', 'thinking…', 'thinking...'))
    paused = any(x in tail for x in (
        'max number of steps reached', 'send another message to continue',
        'usage limit reached', 'rate limit reached', 'paused'))
    if busy:
        if any(x in tail for x in ('running tool', 'running command', 'web search', 'fetching')):
            return 'working', 'tool in esecuzione'
        if 'thinking' in tail:
            return 'working', 'elaborazione'
        return 'working', 'turno in corso'
    if paused:
        return 'paused', 'in attesa di ripresa'
    return 'idle', 'sessione attiva, nessun turno in corso'

raw = run(['tmux', 'list-sessions', '-F', '#{session_name}']) or ''
out = {}
retry = []
for session in [x.strip() for x in raw.splitlines() if x.strip()]:
    tail = tail_of(session)
    if tail is None:
        # cattura fallita: NON è idle, il client mantiene l'ultimo stato
        out[session] = {'status': 'unknown', 'detail': 'pane non osservabile'}
        continue
    status, detail = classify(tail)
    if status == 'idle':
        retry.append(session)  # forse è il flicker della barra: ricontrolla
    out[session] = {'status': status, 'detail': detail}
# Secondo campione per i soli 'idle' (falsi idle 03:5x): la TUI nasconde
# il marker per un attimo tra due step dello stesso turno — se al secondo
# sguardo il marker c'è, l'agente sta lavorando.
if retry:
    time.sleep(0.35)
    for session in retry:
        tail = tail_of(session)
        if tail is None:
            continue
        status, detail = classify(tail)
        if status != 'idle':
            out[session] = {'status': status, 'detail': detail}
print(json.dumps(out, ensure_ascii=False))
"""

## Roster, chat e throttle in UN solo giro ssh e UNA sola docker exec: la
## catena POSIX (;, 2>/dev/null) vive in un blocco a apici singoli parsato
## dalla sh DENTRO il container. Vincolo Windows: in locale il trasporto è
## PowerShell 5.1, che di quella sintassi non capisce niente (2>/dev/null
## diventa il file C:\dev\null — l'"Out-File: impossibile trovare una parte
## del percorso" del test Leone 23/07); un blocco a apici singoli invece lo
## attraversa come argomento unico. tmux ls resta in formato default e il
## nome sessione si estrae dai ':'.
## `exec 2>&1` sta DENTRO gli apici, cioè dentro la sh del container: il
## redirect non deve mai finire alla shell dell'host (su Windows sarebbe
## PowerShell 5.1, che scriverebbe un file chiamato `1`). Un solo flusso da
## leggere significa che il lettore non può restare fermo su stderr mentre
## il container riempie stdout — era metà del blocco del poll (25/07).
const POLL_CMD := "docker exec jht sh -lc 'exec 2>&1; tmux ls 2>/dev/null; echo ---JHT-CHAT---; " \
		# Un team in modalita intensiva puo produrre molte righe fra due poll,
		# ma 500 righe di messaggi del bridge (2 KB l'una) sono quasi un mega
		# riversato in una pipe che su Windows ne regge poche decine: il poll
		# si piantava e il gioco non vedeva mai gli agenti reali (T440s,
		# 25/07). 120 righe restano molto piu del necessario — c'e comunque il
		# cursore a timestamp che scarta quelle gia viste.
		+ "tail -n 120 /jht_home/logs/messages.jsonl 2>/dev/null; " \
		+ "echo ---JHT-THROTTLE---; " \
		# true finale: su un'install fresca throttle-events.jsonl non esiste
		# ancora e l'exit 1 del tail verrebbe scambiato per un guasto del
		# trasporto (2 giri → badge ERROR). code!=0 ora significa solo
		# docker/ssh rotti davvero.
		+ "tail -n 60 /jht_home/logs/throttle-events.jsonl 2>/dev/null; true'"

## Snapshot posizioni dal jobs.db (stesso dataset leggero dei facets del
## web), letto con python3 nel container (sqlite3 CLI assente).
##
## ⚠️ GOTCHA OS.execute (macOS): gli argomenti vengono re-wrappati in
## una sh -c con quoting naive — doppi apici, $, # e newline DENTRO un
## argomento si corrompono SEMPRE. Ricetta obbligata per i comandi
## remoti: solo apici singoli, una riga sola, e le stringhe che
## servirebbero allo script python passate via sys.argv.
const POSITIONS_PY := "import sys,sqlite3,json; db=sqlite3.connect(sys.argv[1]); " \
		+ "db.row_factory=sqlite3.Row; q=lambda s: [dict(r) for r in db.execute(s)]; " \
		+ "print(json.dumps(dict(p=q(sys.argv[2]),h=q(sys.argv[3]),t=q(sys.argv[4])," \
		+ "tr=q(sys.argv[5]))))"
## La lista serve i facet, il dettaglio tutto il resto (mai jd_text: enorme).
const POSITIONS_SELECT := "SELECT p.id,p.title,p.company,p.status,p.role_family," \
		+ "p.loc_country,p.loc_city,p.work_mode,p.source,p.url,p.jd_summary," \
		+ "p.found_by,p.found_at,p.last_checked,p.deadline,p.is_open,p.created_at," \
		+ "p.write_requested,p.geocode_requested,p.recheck_requested," \
		+ "p.user_excluded_reason,p.user_excluded_note," \
		+ "p.salary_declared_min,p.salary_declared_max,p.salary_declared_currency," \
		+ "p.salary_estimated_min,p.salary_estimated_max,p.salary_estimated_currency," \
		+ "p.office_lat,p.office_lon,p.office_address,p.office_verified," \
		+ "s.total_score,s.stack_match,s.remote_fit,s.salary_fit,s.experience_fit," \
		+ "s.strategic_fit,s.scored_by,s.scored_at,s.notes AS score_notes," \
		+ "a.critic_score,a.critic_verdict,a.critic_notes,a.written_by,a.written_at," \
		+ "a.status AS application_status,a.cv_path,a.cv_pdf_path,a.cl_path,a.cl_pdf_path," \
		+ "a.reviewed_by,a.critic_reviewed_at,a.applied_at " \
		+ "FROM positions p LEFT JOIN scores s ON s.position_id=p.id " \
		+ "LEFT JOIN applications a ON a.position_id=p.id " \
		+ "ORDER BY p.created_at DESC"
const HIGHLIGHTS_SELECT := "SELECT position_id,type,text FROM position_highlights ORDER BY id"
const TICKETS_SELECT := "SELECT position_id,request_text,kind,status,assigned_agent," \
		+ "response_text,created_at FROM position_tickets ORDER BY id"
## Il registro attività del team (/team/log del web): chi ha fatto cosa,
## con attribuzione per-istanza (scout-2, scorer-1...).
const TRANSITIONS_SELECT := "SELECT t.position_id,t.from_state,t.to_state,t.ts," \
		+ "t.by_agent,p.title,p.company FROM position_state_transitions t " \
		+ "LEFT JOIN positions p ON p.id=t.position_id ORDER BY t.id DESC LIMIT 80"

const POSITIONS_EVERY := 4  # giri di poll tra due letture del jobs.db
const SETTINGS_EVERY := 8   # config/usage cambiano raramente
const METRICS_EVERY := 1    # dashboard VPS: un campione ogni ~8 secondi

## Metriche host + container, lette sulla VPS senza privilegi aggiuntivi e
## senza scritture. Il doppio campione /proc/stat rende la CPU percentuale.
const HOST_METRICS_PY := """
import json, os, time, shutil, subprocess

def cpu():
    v = list(map(int, open('/proc/stat').readline().split()[1:]))
    return sum(v), v[3] + (v[4] if len(v) > 4 else 0)

def meminfo():
    out = {}
    for line in open('/proc/meminfo'):
        k, v = line.split(':', 1)
        out[k] = int(v.strip().split()[0]) * 1024
    return out

a_t, a_i = cpu(); time.sleep(0.18); b_t, b_i = cpu()
cpu_pct = 100.0 * (1.0 - (b_i-a_i) / max(1, b_t-a_t))
m = meminfo(); mt = m.get('MemTotal', 1); ma = m.get('MemAvailable', 0)
st = m.get('SwapTotal', 0); sf = m.get('SwapFree', 0)
d = shutil.disk_usage('/')
rx = tx = 0
for line in open('/proc/net/dev').read().splitlines()[2:]:
    name, vals = line.split(':', 1)
    if name.strip() == 'lo': continue
    p = vals.split(); rx += int(p[0]); tx += int(p[8])
sample = dict(
    ts=time.time(), cpu_pct=round(cpu_pct, 1),
    ram_pct=round(100*(mt-ma)/mt, 1), ram_used=mt-ma, ram_total=mt,
    swap_pct=round(100*(st-sf)/st, 1) if st else 0,
    disk_pct=round(100*d.used/d.total, 1), disk_used=d.used, disk_total=d.total,
    load1=round(os.getloadavg()[0], 2), uptime_s=float(open('/proc/uptime').read().split()[0]),
    rx_bytes=rx, tx_bytes=tx)
try:
    raw = subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}','jht'], text=True)
    ds = json.loads(raw.strip())
    sample['container_cpu_pct'] = float(str(ds.get('CPUPerc','0')).replace('%',''))
    sample['container_mem_pct'] = float(str(ds.get('MemPerc','0')).replace('%',''))
    sample['container_mem'] = str(ds.get('MemUsage','—'))
    ins = json.loads(subprocess.check_output(['docker','inspect','jht'], text=True))[0]
    sample['container_status'] = str(ins.get('State',{}).get('Status','?'))
    sample['container_pids'] = int(ins.get('State',{}).get('Pid',0) != 0)
    sample['container_restarts'] = int(ins.get('RestartCount',0))
except Exception as e:
    sample['container_status'] = 'errore metriche'
print(json.dumps(sample))
"""

## RSS per sessione tmux (pane + intero albero discendenti) e serie token
## reali già prodotte dal token-meter della VPS.
const AGENT_METRICS_PY := """
import json, subprocess, time
from collections import deque
from datetime import datetime

def run(args):
    try: return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL)
    except Exception: return ''

panes = {}
for line in run(['tmux','list-panes','-a','-F','#{session_name}|#{pane_pid}']).splitlines():
    try:
        name, pid = line.split('|', 1); panes[name.lower()] = int(pid)
    except Exception: pass
procs = {}
for line in run(['ps','-eo','pid=,ppid=,rss=']).splitlines():
    try:
        pid, ppid, rss = map(int, line.split()); procs[pid] = (ppid, rss)
    except Exception: pass
children = {}
for pid, (ppid, rss) in procs.items(): children.setdefault(ppid, []).append(pid)
def tree_rss(root):
    todo=[root]; seen=set(); total=0
    while todo:
        pid=todo.pop()
        if pid in seen: continue
        seen.add(pid); total += procs.get(pid,(0,0))[1]; todo.extend(children.get(pid,[]))
    return total * 1024
agent_ram = {name: tree_rss(pid) for name,pid in panes.items()}
agent_cpu={}
agent_vitals_ts=''
agent_vitals_age_s=-1
try:
    with open('/jht_home/logs/agent-vitals.jsonl') as f:
        tail=deque((line for line in f if line.strip()), maxlen=1)
    if tail:
        vitals=json.loads(tail[0])
        agent_vitals_ts=str(vitals.get('ts') or '')
        for name, values in (vitals.get('agents') or {}).items():
            agent_cpu[str(name).lower()]=float((values or {}).get('cpu_pct') or 0)
        if agent_vitals_ts:
            sampled=datetime.fromisoformat(agent_vitals_ts.replace('Z','+00:00')).timestamp()
            agent_vitals_age_s=max(0, round(time.time()-sampled, 1))
except Exception: pass
series=[]
generated_at=''
window_h=0
bucket_sec=0
try:
    usage=json.load(open('/jht_home/logs/agent-usage-table.json'))
    series=(usage.get('series_kt_per_bucket') or [])[-36:]
    generated_at=str(usage.get('generated_at') or '')
    window_h=float(usage.get('window_h') or 0)
    bucket_sec=int(usage.get('bucket_sec') or 0)
except Exception: pass
print(json.dumps({'agent_ram':agent_ram,'agent_cpu':agent_cpu,
                  'agent_vitals_ts':agent_vitals_ts,
                  'agent_vitals_age_s':agent_vitals_age_s,
                  'token_series':series,
                  'generated_at':generated_at,'window_h':window_h,
                  'bucket_sec':bucket_sec}))
"""

## Storico usage in un solo round-trip: serie della sentinella (usage%
## 5h + weekly, append-only da luglio), token-meter.csv (token pesati,
## campione ogni 30s) e ricostruzione per-agente dai log CLI (la stessa
## skill del pacing, /app/shared/skills). Filtro e downsampling avvengono
## QUI sulla VPS: il gioco riceve al massimo qualche centinaio di bucket,
## mai i file interi. Placeholder: %d from_ts, %d to_ts, %d bucket_sec.
const USAGE_HISTORY_PY := """
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
"""

## Storico del SINGOLO RUOLO per la scheda agente: token per bucket
## (tutte le istanze del ruolo), conversione in % delle finestre 5h e
## weekly (ratio EMA del token-meter + window-ratio-meter), pause del
## pacing, azioni sul jobs.db (transizioni + eventi scrittore/critico
## dalle applications) e cpu/ram del CONTAINER da vitals.jsonl come
## contesto (telemetria per-agente storica: non esiste, vedi report
## 19/07). Placeholder: %d from, %d to, %d bucket, '%s' ruolo (validato
## [a-z0-9-] dal chiamante — mai testo libero qui dentro).
const AGENT_HISTORY_PY := """
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
            acc[bucket_of(t)] = acc.get(bucket_of(t), 0.0) + \
                float(row.get('applied_sec') or 0)
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
    db = sqlite3.connect('file:/jht_home/jobs.db?mode=ro', uri=True)
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
"""

## Config team + usage REALI, già in forma di coppie [etichetta, valore]
## per le sezioni della sidebar. SOLO campi safe: mai chiavi/credenziali.
const SETTINGS_PY := """
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
    raw['languages'] = ', '.join(map(str, prof.get('languages') or []))
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
"""

## Le TUI fullscreen (in particolare Claude) usano l'alternate screen:
## tmux vede soltanto l'altezza corrente della pane e history_size resta 0,
## anche con capture-pane -S -. Lo storico visibile nel terminale e invece
## persistito dal provider in JSONL. Ne costruiamo una vista testuale
## read-only, limitata ma profonda, da anteporre alla pane live.
##
## Non esportiamo i blocchi `thinking` riservati del provider: la vista
## replica l'attivita osservabile (testo, tool e relativi output), proprio
## come il terminale, senza trasformarsi in un canale interattivo.
const TERMINAL_HISTORY_PY := """
import base64, json
from collections import deque
from pathlib import Path

agent = base64.b64decode('%s').decode('utf-8')
project = Path('/jht_home/.claude/projects') / ('-jht-home-agents-' + agent)
files = list(project.glob('*.jsonl')) if project.is_dir() else []
if not files:
    print(json.dumps({'ok': False, 'text_b64': '', 'events': 0}))
    raise SystemExit
source = max(files, key=lambda p: p.stat().st_mtime)
rows = deque(maxlen=1200)
with source.open('r', encoding='utf-8', errors='replace') as handle:
    for row in handle:
        rows.append(row)

def clean(value, limit):
    if isinstance(value, str):
        text = value
    elif value is None:
        return ''
    else:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except Exception:
            text = str(value)
    text = text.replace(chr(0), '').strip()
    if len(text) > limit:
        text = text[:limit] + '\u2026'
    return text

def content_text(value, limit):
    if isinstance(value, str):
        return clean(value, limit)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                part = item.get('text', item.get('content', ''))
            else:
                part = item
            rendered = clean(part, limit)
            if rendered:
                parts.append(rendered)
        return clean('\\n'.join(parts), limit)
    if isinstance(value, dict):
        return clean(value.get('text', value.get('content', value)), limit)
    return clean(value, limit)

out = []
events = 0
for row in rows:
    try:
        item = json.loads(row)
    except Exception:
        continue
    kind = str(item.get('type', ''))
    message = item.get('message') or {}
    blocks = message.get('content', []) if isinstance(message, dict) else []
    if isinstance(blocks, str):
        blocks = [{'type': 'text', 'text': blocks}]
    if not isinstance(blocks, list):
        continue
    stamp = str(item.get('timestamp', ''))[11:19]
    lead = ('[' + stamp + '] ') if stamp else ''
    if kind == 'assistant':
        for block in blocks:
            if not isinstance(block, dict):
                continue
            block_kind = str(block.get('type', ''))
            if block_kind == 'text':
                body = clean(block.get('text', ''), 8000)
                if body:
                    out.append('\u25cf ' + lead + body)
                    events += 1
            elif block_kind == 'tool_use':
                name = clean(block.get('name', 'tool'), 80)
                data = block.get('input', {})
                detail = ''
                if isinstance(data, dict):
                    for key in ('command', 'file_path', 'path', 'url', 'query', 'pattern'):
                        if data.get(key):
                            detail = clean(data.get(key), 1800)
                            break
                if not detail:
                    detail = clean(data, 1000)
                out.append('\u2514 ' + lead + name + (': ' + detail if detail else ''))
                events += 1
    elif kind == 'user':
        for block in blocks:
            if not isinstance(block, dict) or block.get('type') != 'tool_result':
                continue
            body = content_text(block.get('content', ''), 3000)
            if body:
                out.append('  ' + lead + 'output: ' + body)
                events += 1

text = '\\n\\n'.join(out)
if len(text) > 450000:
    text = '\u2026 storico precedente omesso \u2026\\n\\n' + text[-450000:]
payload = base64.b64encode(text.encode('utf-8')).decode('ascii')
print(json.dumps({'ok': True, 'text_b64': payload, 'events': events,
                  'source': source.name}))
"""

## Snapshot per la console del Coordinatore: legge soltanto file di policy e
## jobs.db. Le query sono contatori operativi, non modificano le posizioni.
const COORDINATOR_STATE_PY := """
import json, os, sqlite3, sys
sys.path.insert(0, '/app/shared/skills')
from _db import DB_PATH, ensure_schema
from enrichment_policy import load_policy, logo_min_score

profile = os.path.join(os.path.dirname(DB_PATH), 'profile')
maintenance_path = os.path.join(profile, 'capitano-maintenance.json')
maintenance_raw = {}
try:
    maintenance_raw = json.load(open(maintenance_path, encoding='utf-8'))
except Exception:
    pass
orders = maintenance_raw.get('orders', {}) if isinstance(maintenance_raw, dict) else {}
if not isinstance(orders, dict):
    orders = {}
maintenance = {
    'enabled': maintenance_raw.get('mode') == 'maintenance',
    'stop_search': bool(orders.get('stop_search', True)),
    'discard_expired_rotating': bool(orders.get('discard_expired_rotating', True)),
    'cv_min_score': int(orders.get('cv_min_score', 90)),
    'pre_check_liveness_for_cv': bool(orders.get('pre_check_liveness_for_cv', True)),
}

policy = load_policy()
# Compatibilità rolling-deploy: il gioco può essere più nuovo dell'immagine
# container per qualche minuto. Le opzioni fini si leggono dal JSON già
# normalizzato anche quando gli helper nuovi non sono ancora nell'immagine.
geo_section = policy.get('geocode_missing', {})
geo = {
    'min_score': geo_section.get('min_score'),
    'non_remote_only': bool(geo_section.get('non_remote_only', True)),
}
recheck_section = policy.get('recheck_weekly', {})
recheck = {
    'min_score': int(recheck_section.get('min_score', 70)),
    'older_than_days': int(recheck_section.get('older_than_days', 7)),
}
enrichment = {
    'economy': bool(policy.get('economy', False)),
    'logo_enabled': bool(policy.get('logo', {}).get('enabled', True)),
    'logo_min_score': logo_min_score(policy),
    'geocode_enabled': bool(policy.get('geocode_missing', {}).get('enabled', True)),
    'geocode_min_score': geo.get('min_score'),
    'geocode_non_remote_only': bool(geo.get('non_remote_only', True)),
    'recheck_enabled': bool(policy.get('recheck_weekly', {}).get('enabled', True)),
    'recheck_min_score': int(recheck.get('min_score', 70)),
    'recheck_older_days': int(recheck.get('older_than_days', 7)),
}

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
ensure_schema(conn)
def count(sql, params=()):
    try:
        return int(conn.execute(sql, params).fetchone()[0])
    except Exception:
        return 0

queue_counts = {
    'new': count("SELECT COUNT(*) FROM positions WHERE status='new'"),
    'analysis': count("SELECT COUNT(*) FROM positions WHERE status='checked'"),
    'scored': count("SELECT COUNT(*) FROM positions WHERE status='scored'"),
    'expired': count("SELECT COUNT(*) FROM positions WHERE status!='excluded' AND expires_at IS NOT NULL AND expires_at < datetime('now')"),
}
geo_sql = ("SELECT COUNT(*) FROM positions p "
           "WHERE p.status!='excluded' "
           "AND (p.office_lat IS NULL OR p.office_geocoded IS NULL OR p.office_geocoded=0)")
geo_params = []
if geo.get('min_score') is not None:
    geo_sql += " AND EXISTS (SELECT 1 FROM scores s WHERE s.position_id=p.id AND s.total_score>=?)"
    geo_params.append(int(geo['min_score']))
if geo.get('non_remote_only', True):
    geo_sql += " AND LOWER(COALESCE(p.work_mode,''))!='remote'"
queue_counts['geocode'] = count(geo_sql, tuple(geo_params))

logo_score = logo_min_score(policy)
logo_sql = ("SELECT COUNT(*) FROM companies c "
            "WHERE (c.logo_fetched IS NULL OR c.logo_fetched=0) "
            "AND EXISTS (SELECT 1 FROM positions p WHERE p.company_id=c.id AND p.status!='excluded')")
logo_params = []
if logo_score is not None:
    logo_sql += " AND EXISTS (SELECT 1 FROM positions p JOIN scores s ON s.position_id=p.id WHERE p.company_id=c.id AND p.status!='excluded' AND s.total_score>=?)"
    logo_params.append(int(logo_score))
queue_counts['logos'] = count(logo_sql, tuple(logo_params))
queue_counts['recheck'] = count("SELECT COUNT(DISTINCT p.id) FROM positions p "
   "JOIN scores s ON s.position_id=p.id "
   "WHERE p.status!='excluded' AND s.total_score>=? "
   "AND (p.last_checked IS NULL OR p.last_checked < datetime('now', ?))",
   (int(recheck['min_score']), '-' + str(int(recheck['older_than_days'])) + ' days'))

directives = []
for row in conn.execute("SELECT id,body,kind,status,sort_order,created_at,updated_at "
                        "FROM team_directives WHERE status='active' "
                        "ORDER BY sort_order,created_at"):
    directives.append(dict(row))
conn.close()
print(json.dumps({'ok': True, 'maintenance': maintenance,
                  'enrichment': enrichment, 'queue_counts': queue_counts,
                  'directives': directives}, ensure_ascii=False))
"""

## Payload validato e scritto atomicamente nei due file canonici. Il JSON
## arriva base64 nello script (mai interpolato in una shell).
const COORDINATOR_SAVE_PY := """
import base64, json, os, sys
sys.path.insert(0, '/app/shared/skills')
from _db import DB_PATH
data = json.loads(base64.b64decode('%s').decode('utf-8'))
profile = os.path.join(os.path.dirname(DB_PATH), 'profile')
os.makedirs(profile, exist_ok=True)

def boolean(value, default=False):
    return value if isinstance(value, bool) else default
def integer(value, default, lo, hi):
    try: value = int(value)
    except Exception: value = default
    return max(lo, min(hi, value))
def nullable_score(value):
    if value is None or str(value).strip().lower() in ('', 'null', 'none'):
        return None
    return integer(value, 0, 0, 100)
def atomic(path, value):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write('\\n')
    os.replace(tmp, path)

m = data.get('maintenance', {})
maintenance_path = os.path.join(profile, 'capitano-maintenance.json')
if boolean(m.get('enabled')):
    maintenance = {
        'mode': 'maintenance',
        'orders': {
            'stop_search': boolean(m.get('stop_search'), True),
            'discard_expired_rotating': boolean(m.get('discard_expired_rotating'), True),
            'cv_min_score': integer(m.get('cv_min_score'), 90, 0, 100),
            'pre_check_liveness_for_cv': boolean(m.get('pre_check_liveness_for_cv'), True),
        },
    }
    atomic(maintenance_path, maintenance)
else:
    try: os.unlink(maintenance_path)
    except FileNotFoundError: pass

e = data.get('enrichment', {})
policy = {
    'economy': boolean(e.get('economy')),
    'logo': {
        'enabled': boolean(e.get('logo_enabled'), True),
        'min_score': nullable_score(e.get('logo_min_score')),
    },
    'geocode_missing': {
        'enabled': boolean(e.get('geocode_enabled'), True),
        'min_score': nullable_score(e.get('geocode_min_score')),
        'non_remote_only': boolean(e.get('geocode_non_remote_only'), True),
    },
    'recheck_weekly': {
        'enabled': boolean(e.get('recheck_enabled'), True),
        'min_score': integer(e.get('recheck_min_score'), 70, 0, 100),
        'older_than_days': integer(e.get('recheck_older_days'), 7, 1, 365),
    },
}
atomic(os.path.join(profile, 'enrichment-policy.json'), policy)
print(json.dumps({'ok': True, 'maintenance': maintenance if boolean(m.get('enabled')) else None,
                  'enrichment': policy}, ensure_ascii=False))
"""

const COORDINATOR_DIRECTIVE_PY := """
import base64, json, sys
sys.path.insert(0, '/app/shared/skills')
from _db import get_db, ensure_schema
data = json.loads(base64.b64decode('%s').decode('utf-8'))
conn = get_db(); ensure_schema(conn)
action = str(data.get('action', ''))
if action == 'add':
    body = str(data.get('body', '')).strip()
    kind = str(data.get('kind', 'order'))
    if not body or len(body) > 2000 or kind not in ('order','strategy','formation','note'):
        raise ValueError('direttiva non valida')
    order = conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 FROM team_directives WHERE status='active'").fetchone()[0]
    conn.execute("INSERT INTO team_directives(body,kind,status,sort_order,created_by) VALUES(?,?,'active',?,'user')", (body,kind,order))
elif action == 'archive':
    directive_id = int(data.get('id', 0))
    if directive_id <= 0: raise ValueError('id non valido')
    conn.execute("UPDATE team_directives SET status='archived', archived_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=? AND status='active'", (directive_id,))
else:
    raise ValueError('azione non valida')
conn.commit(); conn.close()
print(json.dumps({'ok': True, 'action': action}, ensure_ascii=False))
"""

## Stato della deroga agli automatismi di spesa. Non reimplementa nulla:
## interroga shared/skills/burn_intent.py, che è il punto unico di verità
## letto anche dai bridge e dal prompt del Capitano.
##
## `remaining_sec` invece dell'orario di scadenza: fra host e container il
## fuso può differire, mentre un delta in secondi non richiede che i due
## parlino la stessa lingua sui timestamp.
##
## `never_yields`, `default_hours` e `max_hours` viaggiano col dato perché
## l'avviso all'utente li NOMINA: se un giorno la lista cambia nel modulo
## Python, l'avviso cambia con lei senza aspettare una release del gioco.
const BURN_INTENT_PY := """
import json, sys
sys.path.insert(0, '/app/shared/skills')
try:
    import burn_intent
except Exception:
    # Deploy sfasato: il gioco può essere più nuovo dell'immagine del
    # container per qualche minuto. Dirlo è meglio che offrire un
    # interruttore che non comanda nulla (come COORDINATOR_STATE_PY).
    print(json.dumps({'ok': True, 'supported': False}))
    raise SystemExit(0)

from datetime import datetime, timezone

st = burn_intent.status()
remaining = 0.0
if st.get('active'):
    try:
        expires = datetime.fromisoformat(str(st.get('expires_at')))
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
    except Exception:
        remaining = float(st.get('remaining_min') or 0) * 60.0
st['ok'] = True
st['supported'] = True
st['remaining_sec'] = int(max(0.0, remaining))
st['never_yields'] = list(burn_intent.NEVER_YIELDS)
st['default_hours'] = burn_intent.DEFAULT_HOURS
st['max_hours'] = burn_intent.MAX_HOURS
print(json.dumps(st, ensure_ascii=False))
"""

## Concessione/revoca. Passa da grant()/revoke() del modulo, così scrittura
## atomica, clamp delle ore e riga di audit restano dove sono già testati:
## il gioco pilota la deroga, non ne tiene una seconda copia.
const BURN_INTENT_SET_PY := """
import base64, json, sys
sys.path.insert(0, '/app/shared/skills')
import burn_intent

data = json.loads(base64.b64decode('%s').decode('utf-8'))
# Il motivo finisce nell'audit log e nel banner letto dagli agenti: è la
# traccia di CHI ha tolto i freni, e resta in italiano come gli altri
# messaggi che il backend manda al team.
if bool(data.get('active')):
    payload = burn_intent.grant(data.get('hours', burn_intent.DEFAULT_HOURS),
                                "concessa dall'utente dal pannello del Coordinatore",
                                'user')
    out = {'ok': True, 'action': 'grant', 'expires_at': payload['expires_at'],
           'hours': payload['hours']}
else:
    burn_intent.revoke("revocata dall'utente dal pannello del Coordinatore")
    out = {'ok': True, 'action': 'revoke'}
print(json.dumps(out, ensure_ascii=False))
"""

var _ip := ""
var _key := ""
var _user := "root"
var _thread: Thread
var _stop := false
var _last_chat_ts := ""
var _worker_tasks: Array[int] = []
var _worker_tasks_mutex := Mutex.new()
## Conversazione utente↔agente aperta ("capitano"/"assistente", "" = no).
var _convo_agent := ""
## Sessione osservata dalla vista attività interna (mai interattiva).
var _terminal_agent := ""
var _terminal_history_agent := ""
var _terminal_history_text := ""
var _terminal_history_loaded := false
var _terminal_history_tick := 0


func start(config: Dictionary) -> void:
	live = true  # dati veri: spegne il badge SIMULAZIONE quando connesso
	_ip = str(config.get("ip", "")).strip_edges()
	_key = expand_user_path(str(config.get("key_path", "")))
	# Config salvata prima del campo utente (o campo lasciato vuoto): root,
	# il default storico e quello di Hetzner.
	_user = str(config.get("user", "root")).strip_edges()
	if _user == "":
		_user = "root"
	if not FileAccess.file_exists(_key):
		bus.publish_state(BackendBus.ERROR,
				"chiave SSH non trovata: %s" % _key)
		return
	var ssh_version: Array = []
	if OS.execute("ssh", ["-V"], ssh_version, true) == -1:
		bus.publish_state(BackendBus.ERROR,
				"client OpenSSH non installato o non presente nel PATH")
		return
	var pinned := ensure_known_host(_ip)
	if not bool(pinned.get("ok", false)):
		bus.publish_state(BackendBus.ERROR, str(pinned.get("message", "errore fingerprint SSH")))
		return
	bus.publish_state(BackendBus.CONNECTING, "handshake ssh con %s…" % _ip)
	_stop = false
	_thread = Thread.new()
	_thread.start(_run)


func stop() -> void:
	_stop = true
	if _thread and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null
	# Le scritture one-shot (chat/profilo/orari/ticket) vivono nel pool
	# globale: se il backend viene distrutto prima del join, possono ancora
	# dereferenziare `bus` durante il teardown dell'engine.
	_worker_tasks_mutex.lock()
	var pending := _worker_tasks.duplicate()
	_worker_tasks.clear()
	_worker_tasks_mutex.unlock()
	for task_id: int in pending:
		WorkerThreadPool.wait_for_task_completion(task_id)


## Espande soltanto un vero prefisso home. Su Windows HOME spesso non
## esiste: USERPROFILE e' la sorgente nativa (C:/Users/...).
static func expand_user_path(path: String, home_override: String = "") -> String:
	var value := path.strip_edges()
	if not (value.begins_with("~/") or value.begins_with("~\\")):
		return value
	var home := home_override
	if home == "":
		home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
				else OS.get_environment("HOME")
	if home == "":
		home = OS.get_environment("HOME") if OS.get_name() == "Windows" \
				else OS.get_environment("USERPROFILE")
	if home == "":
		return value
	return home.rstrip("/\\").path_join(value.substr(2))


func _queue_worker(callable: Callable) -> void:
	if _stop:
		return
	# Un task completato conserva il proprio slot finche non viene waited.
	# Reap opportunistico: le sessioni lunghe con molta chat non accumulano ID.
	var completed: Array[int] = []
	_worker_tasks_mutex.lock()
	for i in range(_worker_tasks.size() - 1, -1, -1):
		var old_id := _worker_tasks[i]
		if WorkerThreadPool.is_task_completed(old_id):
			completed.append(old_id)
			_worker_tasks.remove_at(i)
	_worker_tasks_mutex.unlock()
	for old_id: int in completed:
		WorkerThreadPool.wait_for_task_completion(old_id)
	var task_id := WorkerThreadPool.add_task(callable)
	_worker_tasks_mutex.lock()
	_worker_tasks.append(task_id)
	_worker_tasks_mutex.unlock()


## ── Thread di I/O ─────────────────────────────────────────────────────

func _run() -> void:
	# handshake: la VPS risponde e il container jht esiste?
	# Apici singoli attorno al template Go: senza, su Windows PowerShell
	# (_ssh → powershell -Command) interpreta {{.State.Status}} come
	# script-block e corrompe l'intero `docker inspect` → probe in ERROR,
	# backend mai CONNECTED, badge SIMULAZIONE e chat scartata in local.
	# Gli apici singoli sono innocui e portabili (sh li rispetta uguale).
	var probe := _ssh("echo JHT_OK; docker inspect jht --format '{{.State.Status}}'")
	if _stop:
		return
	if probe["code"] != 0 or not probe["out"].contains("JHT_OK"):
		_deferred_state(BackendBus.ERROR, _short_error(probe))
		return
	if not probe["out"].contains("running"):
		_deferred_state(BackendBus.ERROR, "container jht non in esecuzione")
		return
	_deferred_state(BackendBus.CONNECTED, _ip)

	# poll di roster + chat (+ posizioni, più raro) finché non ci fermano
	var failures := 0
	var tick := 0
	while not _stop:
		var res := _ssh(POLL_CMD)
		if _stop:
			return
		if res["code"] == 0:
			if failures > 0:
				failures = 0
				_deferred_state(BackendBus.CONNECTED, _ip)
			var parts: PackedStringArray = str(res["out"]).split(CHAT_MARK)
			var chat_raw := ""
			var throttle_raw := ""
			if parts.size() > 1:
				var tail: PackedStringArray = parts[1].split(THROTTLE_MARK)
				chat_raw = tail[0]
				if tail.size() > 1:
					throttle_raw = tail[1]
			var activity := {}
			var activity_res := _ssh_python(AGENT_ACTIVITY_PY)
			if OS.get_environment("JHT_ROSTER_TRACE") == "1":
				print("ACTIVITY-TRACE code=", activity_res["code"], " out=",
						str(activity_res["out"]).left(2000))
			if activity_res["code"] == 0:
				activity = _smooth_activity(_parse_activity(str(activity_res["out"])))
			var roster := _parse_roster(parts[0], _parse_throttles(throttle_raw), activity)
			# mappa uid → sessione tmux per la chat (dict nuovo assegnato
			# in blocco: niente stati intermedi visti dagli altri thread)
			var sessions := {}
			for a in roster:
				sessions[a["uid"]] = a["session"]
			_agent_sessions = sessions
			bus.call_deferred("publish_agents", roster)
			if chat_raw != "":
				_ingest_chat(chat_raw)
		else:
			failures += 1
			if failures >= 2:  # un blip singolo non è un guasto
				_deferred_state(BackendBus.ERROR, _short_error(res))
		if tick % POSITIONS_EVERY == 0:
			_fetch_positions()
		if tick % SETTINGS_EVERY == 0:
			_fetch_settings()
		if tick % METRICS_EVERY == 0:
			_fetch_metrics()
		if _convo_agent != "":
			_fetch_convo(_convo_agent)
		if _terminal_agent != "":
			_fetch_terminal(_terminal_agent)
		if _profile_watch:
			_fetch_profile_status()
		tick += 1
		# con una conversazione aperta il giro accorcia: la risposta
		# dell'agente deve comparire in fretta, non dopo 8 secondi
		_sleep(2.5 if (_convo_agent != "" or _terminal_agent != "") else POLL_SECS)


## jobs.db → positions_updated: snapshot completo con highlights e
## ticket già agganciati per posizione (la vista filtra e naviga locale).
func _fetch_positions() -> void:
	var res := _ssh("docker exec -i jht python3 -c '" + POSITIONS_PY \
			+ "' /jht_home/jobs.db '" + POSITIONS_SELECT + "' '" \
			+ HIGHLIGHTS_SELECT + "' '" + TICKETS_SELECT + "' '" \
			+ TRANSITIONS_SELECT + "'")
	if _stop or res["code"] != 0:
		if not _stop:
			Log.call_deferred("debug", "backend", "fetch posizioni KO: code=%s %s" % [
					res["code"], str(res["out"]).left(120)])
		return
	var raw := str(res["out"]).strip_edges()
	# stdout può avere righe di warning attorno: il JSON è la riga con {
	for line in raw.split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				# transitions vanno sul bus PRIMA del segnale: le viste
				# le leggono al positions_updated (unico tick dati)
				bus.set_deferred("transitions", data.get("tr", []))
				bus.call_deferred("publish_positions", _assemble_positions(data))
			return

## jht.config.json + usage table → BackendBus.live_settings (le sezioni
## config della sidebar e la pagina Utilizzo mostrano il reale).
func _fetch_settings() -> void:
	var res := _ssh_python(SETTINGS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				bus.call_deferred("publish_settings", data)
			return

func _fetch_metrics() -> void:
	var res := _ssh_host_python(HOST_METRICS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				var agent_res := _ssh_python(AGENT_METRICS_PY)
				if agent_res["code"] == 0:
					for agent_line in str(agent_res["out"]).split("\n"):
						if agent_line.begins_with("{"):
							var agent_data: Variant = JSON.parse_string(agent_line)
							if agent_data is Dictionary:
								data.merge(agent_data, true)
							break
				bus.call_deferred("publish_telemetry", data)
			return


## Unisce le tre SELECT: highlights e ticket dentro la loro posizione.
static func _assemble_positions(data: Dictionary) -> Array:
	var by_id := {}
	var rows: Array = data.get("p", [])
	for p in rows:
		p["highlights"] = []
		p["tickets"] = []
		by_id[p["id"]] = p
	for h in data.get("h", []):
		if by_id.has(h.get("position_id")):
			by_id[h["position_id"]]["highlights"].append(h)
	for t in data.get("t", []):
		if by_id.has(t.get("position_id")):
			by_id[t["position_id"]]["tickets"].append(t)
	return rows


## Coda di messages.jsonl → chat_message sul bus, solo il nuovo rispetto
## al cursore (ts ISO UTC: il confronto lessicografico è cronologico).
## Il primo giro stabilisce soltanto il cursore: lo storico non deve
## esplodere in una parete di fumetti appena si apre l'ufficio.
func _ingest_chat(raw: String) -> void:
	var msgs: Array = []
	for line in raw.split("\n"):
		if line.strip_edges() == "":
			continue
		var d: Variant = JSON.parse_string(line)
		if d == null or not (d is Dictionary):
			continue
		var m := _to_chat_msg(d)
		if not m.is_empty() and str(m["ts"]) > _last_chat_ts:
			msgs.append(m)
	if msgs.is_empty():
		return
	if _last_chat_ts == "":
		_last_chat_ts = str(msgs[-1]["ts"])
		return
	_last_chat_ts = str(msgs[-1]["ts"])
	for m in msgs:
		bus.call_deferred("publish_chat", m)


## Una riga di messages.jsonl → il contratto {ts, from, to, text}.
## Scarta il rumore non-agente (tick del bridge/pacing senza mittente).
## Il testo è COMPLETO (body quando c'è, mai troncato: feedback Leone
## 21:2x): chi ha vincoli di spazio (i fumetti) accorcia da sé.
static func _to_chat_msg(d: Dictionary) -> Dictionary:
	var from := _uid_norm(str(d.get("from", "")))
	if from == "" or from == "pacing" or from == "bridge":
		return {}
	var to := _uid_norm(str(d.get("to", "")))
	if to == "":
		to = _uid_norm(str(d.get("session", "")))
	var text := str(d.get("body", "")).strip_edges()
	if text == "":
		text = str(d.get("preview", "")).strip_edges()
	if text == "":
		return {}
	# messages.jsonl conserva spesso anche l'envelope umano nel body:
	# "[@a -> @b] [INFO] contenuto". From/to/type sono gia campi JSON;
	# rimuoverli dal fumetto lascia spazio al messaggio vero.
	if text.begins_with("[@"):
		var close := text.find("]")
		if close >= 0:
			text = text.substr(close + 1).strip_edges()
	if text.begins_with("["):
		var type_close := text.find("]")
		if type_close >= 0:
			text = text.substr(type_close + 1).strip_edges()
	return {"ts": str(d.get("ts", "")), "from": from, "to": to, "text": text}


## Nomi del sistema reale → UID del gioco (capitano → coordinatore).
## Il suffisso -worker e parte dell'identita d'istanza: SENTINELLA e
## SENTINELLA-WORKER possono essere vive insieme e devono restare due avatar.
static func _uid_norm(name: String) -> String:
	var s := name.strip_edges().to_lower()
	return "coordinatore" if s == "capitano" else s


## ── Chat bidirezionale utente ↔ agente ───────────────────────────────
## Invio = il canale della desktop app: persist del messaggio utente in
## chat.jsonl + payload [@utente -> @<agent>] [CHAT] consegnato alla tmux
## dell'agente con jht-tmux-send (busy-wait + verify + submit). Il testo
## NON attraversa mai una shell come argomento (gotcha OS.execute):
## viaggia su file temporaneo locale, arriva via stdin e diventa argomento
## solo nella sh DENTRO il container ("$msg").
## Chat 1-a-1 con OGNI agente del roster: l'uid del gioco si risolve in
## directory (/jht_home/agents/<dir>/) e sessione tmux raw dal poll.

var _agent_sessions := {}  # uid → nome sessione tmux (dal roster)

## uid del gioco → directory dell'agente sotto /jht_home/agents/
## (il coordinatore del gioco è il capitano del sistema reale).
static func _agent_dir(uid: String) -> String:
	return "capitano" if uid == "coordinatore" else uid

func _agent_session(uid: String) -> String:
	return str(_agent_sessions.get(uid, _agent_dir(uid).to_upper()))

func open_chat(agent: String) -> void:
	_convo_agent = agent

func close_chat() -> void:
	_convo_agent = ""

func open_terminal(agent: String) -> void:
	_terminal_agent = agent
	_terminal_history_agent = agent
	_terminal_history_text = ""
	_terminal_history_loaded = false
	_terminal_history_tick = 0
	# Primo frame senza attendere la fine dell'eventuale sleep del poll.
	_queue_worker(_fetch_terminal.bind(agent))

func close_terminal() -> void:
	_terminal_agent = ""
	_terminal_history_agent = ""
	_terminal_history_text = ""
	_terminal_history_loaded = false
	_terminal_history_tick = 0

func _fetch_terminal(agent: String) -> void:
	if _stop or agent == "" or agent != _terminal_agent:
		return
	_terminal_history_tick += 1
	# Lo storico provider e molto piu profondo della pane ma non serve
	# rileggerne megabyte a ogni frame: prima apertura + refresh ~1/minuto.
	if not _terminal_history_loaded or _terminal_history_tick >= 24:
		var history := _fetch_terminal_history(agent)
		if _stop or agent != _terminal_agent:
			return
		_terminal_history_agent = agent
		_terminal_history_text = history
		_terminal_history_loaded = true
		_terminal_history_tick = 0
	var session := _agent_session(agent)
	if not _safe_tmux_session(session):
		_terminal_result(agent, "", "nome sessione tmux non valido")
		return
	# `-S -` legge tutto lo scrollback disponibile (lo stesso contratto della
	# dashboard privata quando l'utente chiede la vista top). Non usiamo -e:
	# niente sequenze ANSI nella UI e, soprattutto, nessuna send-keys o
	# paste-buffer.
	# Base64 nasce dentro il container: alcune TUI lasciano celle NUL nella
	# pane e farle attraversare direttamente OS.execute costringe Godot a
	# decodificarle come testo, producendo warning e caratteri sostitutivi.
	var res := _ssh("docker exec jht sh -lc 'tmux capture-pane -p -S - -t " \
			+ session + " | base64'")
	if _stop or agent != _terminal_agent:
		return
	if res["code"] != 0:
		_terminal_result(agent, "", _short_error(res))
		return
	var encoded := str(res["out"]).replace("\n", "").replace("\r", "")
	var raw := Marshalls.base64_to_raw(encoded)
	var clean := PackedByteArray()
	for byte in raw:
		if byte != 0:
			clean.append(byte)
	var content := clean.get_string_from_utf8()
	if content.length() > 500000:
		content = "… output precedente omesso …\n" + content.right(500000)
	var combined := content
	if _terminal_history_agent == agent and _terminal_history_text != "":
		combined = "── STORICO SESSIONE ─────────────────────────────\n\n" \
				+ _terminal_history_text \
				+ "\n\n── PANE TMUX LIVE ──────────────────────────────\n\n" \
				+ content
	_terminal_result(agent, combined, "")

func _fetch_terminal_history(agent: String) -> String:
	var agent_dir := _agent_dir(agent)
	if not _safe_tmux_session(agent_dir):
		return ""
	var encoded_agent := Marshalls.utf8_to_base64(agent_dir)
	var res := _ssh_python(TERMINAL_HISTORY_PY % encoded_agent)
	if res["code"] != 0:
		return ""
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var parsed: Variant = JSON.parse_string(line)
		if not (parsed is Dictionary) or not bool(parsed.get("ok", false)):
			return ""
		var payload := str(parsed.get("text_b64", ""))
		if payload == "":
			return ""
		return Marshalls.base64_to_raw(payload).get_string_from_utf8()
	return ""

static func _safe_tmux_session(session: String) -> bool:
	if session == "" or session.length() > 96:
		return false
	for code in session.to_ascii_buffer():
		var c := int(code)
		if not ((c >= 48 and c <= 57) or (c >= 65 and c <= 90) \
				or (c >= 97 and c <= 122) or c in [45, 46, 95]):
			return false
	return true

func _terminal_result(agent: String, text: String, error: String) -> void:
	bus.call_deferred("publish_agent_terminal", agent, text, error)


## ── Console operativa del Coordinatore ──────────────────────────────

func fetch_coordinator_state() -> void:
	_queue_worker(_do_fetch_coordinator_state)

func _do_fetch_coordinator_state() -> void:
	var res := _ssh_python(COORDINATOR_STATE_PY)
	if _stop:
		return
	var parsed := _json_result(res)
	if parsed.is_empty() or not bool(parsed.get("ok", false)):
		bus.call_deferred("publish_coordinator_action", "load", false,
				_short_error(res) if res["code"] != 0 else "stato coordinatore non leggibile")
		return
	bus.call_deferred("publish_coordinator_state", parsed)

func save_coordinator_settings(settings: Dictionary) -> void:
	_queue_worker(_do_save_coordinator_settings.bind(settings.duplicate(true)))

func _do_save_coordinator_settings(settings: Dictionary) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify(settings))
	var res := _ssh_python(COORDINATOR_SAVE_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	bus.call_deferred("publish_coordinator_action", "save", ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	_do_fetch_coordinator_state()
	# I file sono enforcement a codice; questo messaggio sveglia inoltre il
	# Capitano e gli fa ricalcolare subito assegnazioni e code.
	_do_send_chat("coordinatore",
			"Impostazioni operative aggiornate dalla console. Rileggi " \
			+ "/jht_home/profile/capitano-maintenance.json (se presente) e " \
			+ "/jht_home/profile/enrichment-policy.json; applicale ora e " \
			+ "ribilancia il team rispettando budget e code.")

func add_team_directive(body: String, kind: String) -> void:
	var clean := body.strip_edges()
	if clean == "" or clean.length() > 2000:
		bus.publish_coordinator_action("directive_add", false, "direttiva non valida")
		return
	_queue_worker(_do_team_directive.bind({"action": "add", "body": clean,
			"kind": kind}))

func archive_team_directive(directive_id: int) -> void:
	if directive_id <= 0:
		bus.publish_coordinator_action("directive_archive", false, "id non valido")
		return
	_queue_worker(_do_team_directive.bind({"action": "archive", "id": directive_id}))

func _do_team_directive(action: Dictionary) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify(action))
	var res := _ssh_python(COORDINATOR_DIRECTIVE_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	var action_name := "directive_add" if str(action.get("action")) == "add" \
			else "directive_archive"
	bus.call_deferred("publish_coordinator_action", action_name, ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	_do_fetch_coordinator_state()
	_do_send_chat("coordinatore",
			"La bacheca permanente del team è cambiata. Esegui " \
			+ "python3 /app/shared/skills/team_directives.py active, " \
			+ "poi applica le direttive attive.")


## ── Deroga a termine agli automatismi di spesa ──────────────────────
##
## Un solo percorso per le due macchine: `_ssh_python` scrive lo script su
## `docker exec -i jht python3 -`, e LocalBackend sostituisce SOLO il
## trasporto (`_ssh_stdin_file` con docker diretto invece di ssh). Da qui in
## giù locale e VPS eseguono lo stesso identico Python nello stesso
## container, come già fanno console del Coordinatore, bacheca e ticket.

func fetch_burn_intent() -> void:
	_queue_worker(_do_fetch_burn_intent)

func _do_fetch_burn_intent() -> void:
	var res := _ssh_python(BURN_INTENT_PY)
	if _stop:
		return
	var parsed := _json_result(res)
	if parsed.is_empty() or not bool(parsed.get("ok", false)):
		# Fail-closed di sola lettura: non sapere non è "deroga spenta".
		bus.call_deferred("publish_burn_intent", {"readable": false,
				"error": _short_error(res) if res["code"] != 0 \
						else "stato della deroga non leggibile"})
		return
	parsed["readable"] = true
	bus.call_deferred("publish_burn_intent", parsed)

func set_burn_intent(active: bool, hours: float) -> void:
	_queue_worker(_do_set_burn_intent.bind(active, hours))

func _do_set_burn_intent(active: bool, hours: float) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify({
			"active": active, "hours": hours}))
	var res := _ssh_python(BURN_INTENT_SET_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	bus.call_deferred("publish_burn_intent_action", active, ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	# Si rilegge SEMPRE il flag appena scritto: l'interruttore deve mostrare
	# ciò che il team leggerà, non ciò che l'utente ha chiesto. Se il clamp
	# ha ridotto le ore, o se il file non è dove pensiamo, si vede subito.
	_do_fetch_burn_intent()
	# I bridge rileggono il flag da soli al prossimo tick (≤5 min). Questo
	# messaggio serve a un'altra cosa: con gli automatismi sospesi l'unica
	# sorveglianza rimasta è il Capitano, e deve saperlo ADESSO — nella notte
	# del 27/07 una deroga tecnica non arrivata agli agenti fu annullata in
	# buona fede da chi seguiva correttamente il proprio prompt.
	if active:
		_do_send_chat("coordinatore",
				"L'utente ha concesso una deroga A TERMINE agli automatismi " \
				+ "di spesa dal pannello. Esegui " \
				+ "python3 /app/shared/skills/burn_intent.py status: finché " \
				+ "risulta attiva sospendi daily-halt, gate orario, " \
				+ "WORKER_FLOOR e ladder, e non rimetterli a posto. Restano " \
				+ "attivi weekly-halt, host_agent_cap, SC-09 e freeze_team. " \
				+ "Senza gli automatismi la sorveglianza è tua: ferma tu un " \
				+ "agente che consuma senza produrre.")
	else:
		_do_send_chat("coordinatore",
				"L'utente ha revocato la deroga agli automatismi di spesa. " \
				+ "Verifica con python3 /app/shared/skills/burn_intent.py " \
				+ "status e torna al pacing predefinito.")

static func _json_result(res: Dictionary) -> Dictionary:
	if int(res.get("code", -1)) != 0:
		return {}
	for line in str(res.get("out", "")).split("\n"):
		if not line.begins_with("{"):
			continue
		var parsed: Variant = JSON.parse_string(line)
		if parsed is Dictionary:
			return parsed
	return {}

func send_chat(agent: String, text: String) -> void:
	if text.strip_edges() == "":
		return
	# thread one-shot: 3 giri ssh non devono congelare né la UI né il poll
	_queue_worker(_do_send_chat.bind(agent, text.strip_edges(), ""))

func send_chat_with_context(agent: String, text: String, context: String) -> void:
	if text.strip_edges() == "":
		return
	_queue_worker(_do_send_chat.bind(agent, text.strip_edges(), context.strip_edges()))

func _do_send_chat(agent: String, text: String, context := "") -> void:
	var session := _agent_session(agent)
	var buf := _temp_path("jht-game-chat")
	var chat_file := "/jht_home/agents/%s/chat.jsonl" % _agent_dir(agent)

	# 1) persisti il messaggio utente nel chat.jsonl dell'agente (stesso
	# formato della skill chat-web: la UI lo rilegge come storia)
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		_chat_sent(agent, false, "file temporaneo non scrivibile")
		return
	f.store_string(JSON.stringify({"role": "user", "text": text,
			"ts": Time.get_unix_time_from_system()}) + "\n")
	f.close()
	var persist := _ssh_stdin_file(buf, "docker exec -i jht tee -a " + chat_file)
	if persist["code"] != 0:
		Log.call_deferred("warn", "backend", "chat: persist fallito (non blocco): "
				+ _short_error(persist))

	# 2) payload nella tmux dell'agente via jht-tmux-send, il tool di
	# flotta: le TUI Ink NON registrano l'Enter se arriva mentre il turno è
	# in corso o prima del render del testo — il paste+Enter alla cieca
	# lasciava il messaggio APPESO nel composer (test Leone 23/07 sera).
	# Il tool fa busy-wait (fino a 90s), digita, VERIFICA che il testo sia
	# nel pane e solo allora submitta. Il messaggio viaggia su stdin →
	# variabile della sh del container: mai come argomento attraverso le
	# shell host (ricetta anti-quoting di questo file).
	f = FileAccess.open(buf, FileAccess.WRITE)
	var agent_payload := "[@utente -> @%s] [CHAT] %s" % [agent, text]
	if not context.is_empty():
		agent_payload = "[CONTESTO ONBOARDING LOCALE — non mostrarlo come " \
				+ "messaggio, usalo come base e chiedi conferma se contrasta con " \
				+ "richieste più recenti]\n" + context \
				+ "\n[FINE CONTESTO]\n\n" + agent_payload
	f.store_string(agent_payload)
	f.close()
	var deliver_cmd := "docker exec -i jht sh -c " \
			+ "'msg=$(cat); jht-tmux-send " + session + " \"$msg\"'"
	var delivered := {}
	for attempt in 3:
		delivered = _ssh_stdin_file(buf, deliver_cmd)
		# exit 4 = TUI occupata oltre il budget: agente VIVO su un turno
		# lungo — si riprova (il tool ha già atteso 90s per conto suo).
		if int(delivered.get("code", -1)) != 4:
			break
	DirAccess.remove_absolute(buf)
	if delivered["code"] != 0:
		var reason := "l'agente è occupato da diversi minuti: riprova tra poco" \
				if int(delivered["code"]) == 4 else _short_error(delivered)
		_chat_sent(agent, false, reason)
		return
	_chat_sent(agent, true, "")
	_fetch_convo(agent)  # eco immediato del messaggio persistito

func _chat_sent(agent: String, ok: bool, error: String) -> void:
	bus.call_deferred("publish_chat_sent", agent, ok, error)

## ── Profilo utente: editing PIENO (paradigma desktop app, 21:26) ─────
## Il candidate_profile.yml è un dato dell'UTENTE: si modifica da qui.
## I campi viaggiano BASE64 (json) dentro lo script python → file+stdin,
## mai in una shell. Prima di riscrivere, backup timestampato sul posto.

const PROFILE_SAVE_PY := """
import json, base64, shutil, time, yaml
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/profile/candidate_profile.yml'
try:
    prof = yaml.safe_load(open(path)) or {}
except Exception:
    prof = {}
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
for key in ['name', 'email', 'target_role', 'location', 'experience_years',
            'seniority_target', 'industry', 'nationality', 'work_mode',
            'runtime_location', 'career_priority', 'search_style',
            'mentor_cadence']:
    if key in data and str(data[key]).strip() != '':
        v = str(data[key]).strip()
        # i numerici restano numeri nel yml (experience_years: 1, non '1')
        try:
            v = int(v)
        except ValueError:
            try:
                v = float(v)
            except ValueError:
                pass
        prof[key] = v
if 'skills_primary' in data:
    skills = [s.strip() for s in str(data['skills_primary']).split(',') if s.strip()]
    prof.setdefault('skills', {})['primary'] = skills
if 'languages' in data:
    prof['languages'] = [s.strip() for s in str(data['languages']).split(',') if s.strip()]
if data.get('salary_min') or data.get('salary_max'):
    sal_key = 'salary_target' if 'salary_target' in prof or 'salary' not in prof else 'salary'
    sal = prof.get(sal_key) if isinstance(prof.get(sal_key), dict) else {}
    lo_key = 'lo' if 'lo' in sal else 'min'
    hi_key = 'hi' if 'hi' in sal else 'max'
    if data.get('salary_min'):
        sal[lo_key] = int(float(data['salary_min']))
    if data.get('salary_max'):
        sal[hi_key] = int(float(data['salary_max']))
    sal['currency'] = str(data.get('salary_currency', sal.get('currency', 'EUR')))
    prof[sal_key] = sal
yaml.safe_dump(prof, open(path, 'w'), allow_unicode=True, sort_keys=False)
print(json.dumps(dict(ok=True)))
"""

## Storico usage on-demand (pannelli di monitoraggio risorse). Un solo
## worker alla volta: le richieste durante un fetch in corso vengono
## scartate — il pannello riprova al prossimo cambio di finestra.
var _usage_history_busy := false

func fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	if _usage_history_busy:
		return
	_usage_history_busy = true
	_queue_worker(_do_fetch_usage_history.bind(from_ts, to_ts, bucket_sec))

func _do_fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	var query := {"from_ts": from_ts, "to_ts": to_ts, "bucket_sec": bucket_sec}
	var res := _ssh_python(USAGE_HISTORY_PY % [int(from_ts), int(to_ts), bucket_sec])
	_usage_history_busy = false
	if _stop:
		return
	if res["code"] == 0:
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var data: Variant = JSON.parse_string(line)
				if data is Dictionary:
					bus.call_deferred("publish_usage_history", query, data)
					return
	bus.call_deferred("publish_usage_history", query,
			{"ok": false, "error": _short_error(res)})

var _agent_history_busy := false
## Richiesta arrivata mentre il worker era occupato: si tiene SOLO
## l'ultima (è la finestra corrente) e parte appena il giro si libera.
## Prima veniva scartata in silenzio e il grafico restava sotto il velo
## di caricamento finché qualcosa non lo ritriggava.
var _agent_history_next := {}

## Ruolo SEMPRE validato prima dell'interpolazione nello script python:
## niente testo libero dentro il payload remoto.
func fetch_agent_history(agent: String, from_ts: float, to_ts: float,
		bucket_sec: int) -> void:
	var query := {"agent": agent, "from_ts": from_ts, "to_ts": to_ts,
			"bucket_sec": bucket_sec}
	var re := RegEx.create_from_string("^[a-z0-9-]{1,40}$")
	if re.search(agent) == null:
		bus.call_deferred("publish_agent_history", query,
				{"ok": false, "error": "ruolo non valido"})
		return
	if _agent_history_busy:
		_agent_history_next = query
		return
	_agent_history_busy = true
	_queue_worker(_do_fetch_agent_history.bind(query))

func _do_fetch_agent_history(query: Dictionary) -> void:
	var res := _ssh_python(AGENT_HISTORY_PY % [int(query["from_ts"]),
			int(query["to_ts"]), int(query["bucket_sec"]),
			str(query["agent"])])
	_agent_history_busy = false
	if _stop:
		return
	var payload: Dictionary = {"ok": false, "error": _short_error(res)}
	if res["code"] == 0:
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var data: Variant = JSON.parse_string(line)
				if data is Dictionary:
					payload = data
					break
	bus.call_deferred("publish_agent_history", query, payload)
	if not _agent_history_next.is_empty():
		var next: Dictionary = _agent_history_next
		_agent_history_next = {}
		fetch_agent_history(str(next["agent"]), float(next["from_ts"]),
				float(next["to_ts"]), int(next["bucket_sec"]))

func save_profile(fields: Dictionary) -> void:
	_queue_worker(_do_save_profile.bind(fields))

func _do_save_profile(fields: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(fields))
	var res := _ssh_python(PROFILE_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "profile_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()  # il profilo aggiornato rientra subito in vista


## ── Onboarding in-game (wizard: il badge si compila con l'assistente) ─
## Stato del profilo = STESSA semantica di GET /api/profile del web:
## ready = ready.flag esiste OPPURE tutti i campi required ok. La
## checklist required replica web/lib/profile-completion.ts (2026-06-06):
## name, email, target_role, location, experience_years,
## seniority_target, ≥2 skill, ≥1 lingua. Chi SCRIVE il profilo resta
## l'agente assistente: il gioco osserva e basta, come la pagina web.

const PROFILE_STATUS_PY := """
import json, os
prof = {}
try:
    import yaml
    prof = yaml.safe_load(open('/jht_home/profile/candidate_profile.yml')) or {}
except Exception:
    pass
def s(v):
    return str(v).strip() if v is not None else ''
skills = prof.get('skills') or {}
skill_list = []
if isinstance(skills, dict):
    for v in skills.values():
        if isinstance(v, list):
            skill_list += [s(x) for x in v if s(x)]
elif isinstance(skills, list):
    skill_list = [s(x) for x in skills if s(x)]
def lang_str(x):
    if isinstance(x, dict):
        return ' '.join(s(v) for v in x.values() if s(v))
    return s(x)
langs = prof.get('languages') or []
if not isinstance(langs, list):
    langs = [langs]
langs = [lang_str(x) for x in langs if lang_str(x)]
pos = prof.get('positioning') or {}
contacts = pos.get('contacts') or {}
email = s(prof.get('email')) or s(contacts.get('email'))
seniority = s(prof.get('seniority_target')) or s(pos.get('seniority_target'))
required = dict(
    name=s(prof.get('name')) != '',
    email=email != '',
    target_role=s(prof.get('target_role')) != '',
    location=s(prof.get('location')) != '',
    experience_years=prof.get('experience_years') is not None,
    seniority_target=seniority != '',
    skills=len(skill_list) >= 2,
    languages=len(langs) >= 1,
)
ready = os.path.exists('/jht_home/profile/ready.flag') or all(required.values())
view = dict(
    name=s(prof.get('name')), email=email,
    target_role=s(prof.get('target_role')), location=s(prof.get('location')),
    experience_years=s(prof.get('experience_years')),
    seniority_target=seniority, skills=skill_list[:12], languages=langs[:8],
)
print(json.dumps(dict(profile=view, required=required, ready=ready),
                 ensure_ascii=False))
"""

var _profile_watch := false

func open_profile_watch() -> void:
	_profile_watch = true

func close_profile_watch() -> void:
	_profile_watch = false

func _fetch_profile_status() -> void:
	var res := _ssh_python(PROFILE_STATUS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var d: Variant = JSON.parse_string(line)
			if d is Dictionary:
				bus.call_deferred("publish_profile_status", d)
			return

## Avvio idempotente dell'assistente (equivalente di POST
## /api/assistente/start): se la sessione ASSISTENTE non c'è, lancia
## start-agent.sh dentro il container. Il || e il detach (setsid -f al
## posto di docker -d) vivono nella sh del container, dentro apici
## singoli: PowerShell 5.1 (trasporto locale Windows) non ha || e senza
## questo blocco l'assistente non partiva MAI in locale (Leone 23/07).
func ensure_assistant() -> void:
	_queue_worker(_do_ensure_assistant)

func _do_ensure_assistant() -> void:
	_ssh("docker exec jht sh -lc 'tmux has-session -t ASSISTENTE 2>/dev/null " \
			+ "|| setsid -f bash /app/.launcher/start-agent.sh assistente'")

## Upload CV/documenti nella drop-zone del container (/jht_user/allegati,
## stessa destinazione di POST /api/assistente/upload). Il file viaggia
## binario su stdin di OpenSSH → tee nel container: mai in una shell come
## argomento. Vincoli identici alla route web: estensioni note, max 10MB.

const UPLOAD_DIR := "/jht_user/allegati"
const UPLOAD_MAX_BYTES := 10 * 1024 * 1024
const UPLOAD_EXTS := ["pdf", "doc", "docx", "txt", "md", "png", "jpg",
		"jpeg", "csv", "xlsx", "xls", "json", "yaml", "yml"]

func upload_document(local_path: String) -> void:
	_queue_worker(_do_upload_document.bind(local_path))

func _do_upload_document(local_path: String) -> void:
	if not FileAccess.file_exists(local_path):
		_doc_uploaded(false, "", "file non trovato: " + local_path)
		return
	var ext := local_path.get_extension().to_lower()
	if not UPLOAD_EXTS.has(ext):
		_doc_uploaded(false, "", "estensione non ammessa: ." + ext)
		return
	var f := FileAccess.open(local_path, FileAccess.READ)
	if f == null:
		_doc_uploaded(false, "", "file non leggibile")
		return
	var size := f.get_length()
	f.close()
	if size > UPLOAD_MAX_BYTES:
		_doc_uploaded(false, "", "file oltre i 10 MB")
		return
	var safe := _safe_filename(local_path.get_file())
	var remote := UPLOAD_DIR + "/" + safe
	var mk := _ssh("docker exec jht mkdir -p " + UPLOAD_DIR)
	if mk["code"] != 0:
		_doc_uploaded(false, "", _short_error(mk))
		return
	# >/dev/null dentro la sh del container: al livello host sarebbe un
	# redirect PowerShell verso il file C:\dev\null (Windows locale).
	var res := _ssh_stdin_file(local_path,
			"docker exec -i jht sh -lc 'tee " + remote + " >/dev/null'")
	if res["code"] != 0:
		_doc_uploaded(false, "", _short_error(res))
		return
	_doc_uploaded(true, remote, "")

func _doc_uploaded(ok: bool, remote_path: String, error: String) -> void:
	bus.call_deferred("emit_signal", "document_uploaded", ok, remote_path, error)

## Nome file sicuro per il viaggio in shell remota: solo [A-Za-z0-9._-],
## il resto diventa _ (stessa igiene della route web di upload).
static func _safe_filename(name: String) -> String:
	var out := ""
	for i in name.length():
		var c := name[i]
		var code := c.unicode_at(0)
		var is_ok: bool = (code >= 48 and code <= 57) \
				or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) \
				or c == "." or c == "_" or c == "-"
		out += c if is_ok else "_"
	out = out.lstrip(".")
	return out if out != "" else "documento"


## ── Documenti prodotti (anteprima CV in-game) ────────────────────────
## Lettura on-demand di un file registrato in cv_path/cl_path. Il path
## arriva dal jobs.db ma resta input non fidato per la shell (gotcha
## OS.execute): viaggia BASE64 dentro lo script python, e il contenuto
## torna BASE64 (regge anche i pdf binari). Solo le aree dati note del
## container, mai il filesystem libero.

const ARTIFACT_MAX_BYTES := 10 * 1024 * 1024  # stesso tetto dell'upload

const ARTIFACT_PY := """
import base64, json, os
path = base64.b64decode('%s').decode('utf-8')
real = os.path.realpath(path)
if not (real.startswith('/jht_user/') or real.startswith('/jht_home/')):
    print(json.dumps(dict(ok=False, error='percorso fuori dalle aree dati')))
elif not os.path.isfile(real):
    print(json.dumps(dict(ok=False, error='file non trovato sul container')))
elif os.path.getsize(real) > %d:
    print(json.dumps(dict(ok=False, error='file oltre i 10 MB')))
else:
    with open(real, 'rb') as f:
        print(json.dumps(dict(ok=True, b64=base64.b64encode(f.read()).decode())))
"""

func fetch_artifact(path: String) -> void:
	# thread one-shot: un pdf da qualche centinaio di KB non deve
	# congelare né la UI né il giro di poll
	_queue_worker(_do_fetch_artifact.bind(path))

func _do_fetch_artifact(path: String) -> void:
	var res := _ssh_python(ARTIFACT_PY % [Marshalls.utf8_to_base64(path),
			ARTIFACT_MAX_BYTES])
	var ok := false
	var data := PackedByteArray()
	var err := ""
	if res["code"] != 0:
		err = _short_error(res)
	else:
		err = "risposta illeggibile dalla VPS"
		for line in str(res["out"]).split("\n"):
			if not line.begins_with("{"):
				continue
			var d: Variant = JSON.parse_string(line)
			if d is Dictionary:
				ok = bool(d.get("ok", false))
				err = str(d.get("error", ""))
				if ok:
					data = Marshalls.base64_to_raw(str(d.get("b64", "")))
			break
	bus.call_deferred("publish_artifact", path, ok, data, err)


## ── Orari di lavoro: editing PIENO (paradigma desktop app) ───────────
## working_hours vive in jht.config.json: si aggiorna SOLO quella
## sezione (load→update→dump preserva tutto il resto, credenziali
## incluse — che non lasciano mai il container), con backup prima.

const HOURS_SAVE_PY := """
import json, base64, shutil, time
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/jht.config.json'
c = json.load(open(path))
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
c.setdefault('team', {})['working_hours'] = data
json.dump(c, open(path, 'w'), indent=2, ensure_ascii=False)
print(json.dumps(dict(ok=True)))
"""

func save_working_hours(wh: Dictionary) -> void:
	_queue_worker(_do_save_hours.bind(wh))

func _do_save_hours(wh: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(wh))
	var res := _ssh_python(HOURS_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "hours_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()


## ── Ticket utente→team (gate 1: l'unica scrittura sul jobs.db) ───────
## Stesso INSERT della route /api/positions/[id]/ticket del web: ticket
## 'open' kind 'custom' su position_tickets, che il Capitano nota e
## smista (ticket.py list-open). Il testo utente è velenoso per la shell
## (gotcha OS.execute) → viaggia BASE64 dentro lo script python, che a
## sua volta arriva al container via file+stdin: niente quoting, mai.

const TICKET_MAX_LEN := 2000  # stesso limite della route web

const TICKET_PY := """
import sqlite3, base64, json
text = base64.b64decode('%s').decode('utf-8')
pid = %d
db = sqlite3.connect('/jht_home/jobs.db')
try:
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA foreign_keys=ON')
    if db.execute('SELECT id FROM positions WHERE id=?', (pid,)).fetchone() is None:
        print(json.dumps(dict(ok=False, error='posizione inesistente')))
    else:
        cur = db.execute(
            "INSERT INTO position_tickets (position_id, request_text, kind, status) "
            "VALUES (?, ?, 'custom', 'open')", (pid, text))
        db.commit()
        print(json.dumps(dict(ok=True, id=cur.lastrowid)))
finally:
    db.close()
"""

func create_ticket(position_id: int, text: String) -> void:
	var t := text.strip_edges().left(TICKET_MAX_LEN)
	if t == "" or position_id <= 0:
		return
	# thread one-shot: l'INSERT remoto non deve congelare UI né poll
	_queue_worker(_do_create_ticket.bind(position_id, t))

func _do_create_ticket(position_id: int, text: String) -> void:
	var res := _ssh_python(TICKET_PY % [Marshalls.utf8_to_base64(text), position_id])
	var ok := false
	var err := ""
	if res["code"] != 0:
		err = _short_error(res)
	else:
		err = "risposta illeggibile dalla VPS"
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var d: Variant = JSON.parse_string(line)
				if d is Dictionary:
					ok = bool(d.get("ok", false))
					err = str(d.get("error", ""))
				break
	bus.call_deferred("emit_signal", "ticket_created", position_id, ok, err)
	if ok:
		_fetch_positions()  # il ticket nuovo compare subito nel dettaglio


## Tail del chat.jsonl dell'agente → publish_agent_chat (storia completa
## recente, la UI ridisegna da zero: niente cursori da tenere in sync;
## il bus spegne l'indicatore di attesa quando vede la risposta).
func _fetch_convo(agent: String) -> void:
	var res := _ssh("docker exec jht tail -n 120 /jht_home/agents/%s/chat.jsonl"
			% _agent_dir(agent))
	if _stop or res["code"] != 0:
		return
	var msgs: Array = []
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("text", "")) != "":
			msgs.append(d)
	bus.call_deferred("publish_agent_chat", agent, msgs)

## File temporaneo locale in una directory scrivibile su ogni OS: il
## /tmp hardcodato non esiste su Windows (FileAccess.open → null).
static func _temp_path(stem: String) -> String:
	return OS.get_cache_dir().path_join(
			"%s-%d-%d.tmp" % [stem, OS.get_process_id(), Time.get_ticks_usec()])

## Esegue uno script python DENTRO il container passandolo via stdin
## (python3 -): nessun limite di quoting, script multi-linea liberi.
func _ssh_python(script: String) -> Dictionary:
	var buf := _temp_path("jht-game-py")
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		return {"code": -1, "out": "file temporaneo non scrivibile"}
	f.store_string(script)
	f.close()
	var res := _ssh_stdin_file(buf, "docker exec -i jht python3 -")
	DirAccess.remove_absolute(buf)
	return res

## Come _ssh_python, ma sul sistema host della VPS: serve per /proc,
## filesystem root e docker stats, invisibili dall'interno del container.
func _ssh_host_python(script: String) -> Dictionary:
	var buf := _temp_path("jht-game-host-py")
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		return {"code": -1, "out": "file temporaneo non scrivibile"}
	f.store_string(script)
	f.close()
	var res := _ssh_stdin_file(buf, "python3 -")
	DirAccess.remove_absolute(buf)
	return res


## Invia un file sullo stdin di OpenSSH senza passare da cmd.exe/bash.
## I path della chiave e della cache possono contenere spazi (tipico su
## Windows); argv + pipe evita sia rotture di quoting sia command injection.
## Lo stdout remoto viene rediretto sul pipe stderr separato, cosi possiamo
## chiudere stdin (EOF per `python3 -`) e continuare a raccogliere l'output.
func _ssh_stdin_file(local_file: String, remote_cmd: String) -> Dictionary:
	var payload := FileAccess.get_file_as_bytes(local_file)
	if payload.is_empty() and FileAccess.get_open_error() != OK:
		return {"code": -1, "out": "file temporaneo non leggibile"}
	var args := PackedStringArray([
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known_hosts_path(_ip),
		"%s@%s" % [_user, _ip],
		remote_cmd + " 1>&2",
	])
	var process := OS.execute_with_pipe("ssh", args, true)
	if process.is_empty():
		return {"code": -1, "out": "client OpenSSH non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()  # EOF: python3/tee/tmux possono terminare
	# get_as_text() usa get_length(), che sui pipe vale 0: leggere a blocchi
	# drena davvero il canale e impedisce anche il deadlock su output grandi.
	# Un read corto NON è EOF: il produttore può essere solo più lento del
	# reader (JSON troncati "Unterminated string" coi b64 dell'anteprima
	# CV, 19/07). Si legge finché il processo vive, poi si svuota il
	# residuo: a scrittore morto read torna 0 solo a pipe davvero vuoto.
	var pid := int(process["pid"])
	var output_bytes := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output_bytes.append_array(chunk)
		if chunk.size() == 0:
			if not OS.is_process_running(pid):
				break
			OS.delay_msec(5)
	stderr.close()
	while OS.is_process_running(pid):
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output_bytes.get_string_from_utf8()}


## Un giro di ssh non interattivo. Ritorna {code, out} (stdout+stderr).
## Il remote_cmd deve rispettare la ricetta anti-quoting (vedi sopra).
func _ssh(remote_cmd: String) -> Dictionary:
	var out: Array = []
	var code := OS.execute("ssh", [
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known_hosts_path(_ip),
		"%s@%s" % [_user, _ip],
		remote_cmd,
	], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## throttle-events.jsonl (start/end del pacing reale) → throttle ATTIVI
## per istanza: {uid: {left: sec rimanenti, total: sec richiesti}}.
## Le righe sono in ordine: per ogni agente conta l'ULTIMO evento — uno
## start senza end la cui finestra copre "adesso" è un throttle in corso.
static func _parse_throttles(raw: String) -> Dictionary:
	var last := {}  # uid → ultimo evento
	for line in raw.split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("agent", "")) != "":
			last[_uid_norm(str(d["agent"]))] = d
	var now := Time.get_unix_time_from_system()
	var active := {}
	for uid in last:
		var ev: Dictionary = last[uid]
		if str(ev.get("event", "")) != "start":
			continue
		var total := float(ev.get("applied_sec", 0.0))
		var until := float(ev.get("ts_unix", 0.0)) + total
		if until > now:
			active[uid] = {"left": until - now, "total": total}
	return active

## stdout dello script attività → sessione tmux → {status, detail}.
## Warning esterni vengono ignorati: vale soltanto una riga JSON oggetto.
## Isteresi anti-flicker (falsi idle 03:5x): un 'working' scade a 'idle'
## solo dopo 2 poll consecutivi senza marker — la barra della TUI può
## nascondere il marker nell'attimo della cattura anche a metà turno.
## 'unknown' (cattura fallita) mantiene sempre l'ultimo stato osservato.
## Vive nel thread di poll: nessun accesso concorrente.
var _last_status := {}
var _last_detail := {}
var _idle_strikes := {}

func _smooth_activity(activity: Dictionary) -> Dictionary:
	var out := {}
	for session in activity:
		var obs: Dictionary = activity[session]
		var status := str(obs.get("status", "idle"))
		var prev := str(_last_status.get(session, ""))
		if status == "unknown":
			obs = {"status": prev if prev != "" else "idle",
					"detail": str(_last_detail.get(session, "stato non osservato"))}
		elif status == "idle" and prev == "working":
			var strikes := int(_idle_strikes.get(session, 0)) + 1
			if strikes < 2:
				_idle_strikes[session] = strikes
				obs = {"status": "working",
						"detail": str(_last_detail.get(session, "turno in corso"))}
			else:
				_idle_strikes[session] = 0
		else:
			_idle_strikes[session] = 0
		out[session] = obs
		_last_status[session] = str(obs.get("status", "idle"))
		_last_detail[session] = str(obs.get("detail", ""))
	return out

static func _parse_activity(raw: String) -> Dictionary:
	for line in raw.split("\n"):
		if not line.begins_with("{"):
			continue
		var data: Variant = JSON.parse_string(line)
		if data is Dictionary:
			return data
	return {}

## Sessioni tmux (formato default "NOME: 1 windows …") → snapshot roster
## per il contratto agents_updated. CAPITANO → coordinatore; "scout-2" →
## slug scout, name "Scout 2", uid "scout-2" (chiave per-istanza, la
## stessa dei throttle e delle transitions). status dall'osservazione del
## pane: working solo col marker TUI di turno in corso, altrimenti idle;
## throttled prevale quando c'è una pausa del pacing reale —
## la scelta seduto-vs-ricreazione è della scena, sulla stima
## throttle_secs (secondi RIMANENTI; throttle_total = durata piena).
## Un agente killato non compare proprio: despawn = uscita dalla porta.
static func _parse_roster(raw: String, throttles: Dictionary = {}, activity: Dictionary = {}) -> Array:
	var agents: Array = []
	for line in raw.split("\n"):
		if not line.contains(":"):
			continue
		var session := line.split(":")[0].strip_edges()
		if session == "" or session.contains(" "):
			continue
		var uid := _uid_norm(session)
		# Il ruolo decide sprite/postazione; l'UID decide quale processo e
		# quale vignetta. Un worker specializzato condivide il ruolo base.
		var base := uid.trim_suffix("-worker")
		var num := ""
		var parts := base.split("-")
		if parts.size() > 1:
			var suffix: String = parts[parts.size() - 1]
			if suffix.is_valid_int():
				num = suffix
				base = "-".join(parts.slice(0, parts.size() - 1))
			elif suffix.begins_with("s") and suffix.substr(1).is_valid_int():
				# Sub-agenti temporanei (critico-s1, ...): UID distinto,
				# stesso ruolo/postazioni del reparto padre.
				num = suffix.to_upper()
				base = "-".join(parts.slice(0, parts.size() - 1))
		var slug := base
		var name := slug.capitalize()
		if num != "":
			name += " " + num
		elif uid.ends_with("-worker"):
			name += " Worker"
		# Il cognome è funzione dell'uid, come la scrivania e il volto: qui
		# entra UNA volta e da qui raggiunge ogni pannello che mostra
		# `name` (scheda agente, elenco VPS, targa dei dialoghi, risorse).
		# L'uid resta intero dentro l'etichetta, e chi non ha un cognome —
		# i sub-agenti `critico-s1`, i `-worker` — tiene esattamente il nome
		# che aveva prima.
		name = AgentNames.display_name(uid, name)
		var observed: Dictionary = activity.get(session, activity.get(uid, {}))
		var status := str(observed.get("status", "idle"))
		if status not in ["working", "idle", "paused"]:
			status = "idle"
		var detail := str(observed.get("detail", "sessione attiva, stato non osservato"))
		var t_left := 0.0
		var t_total := 0.0
		if throttles.has(uid):
			t_left = float(throttles[uid]["left"])
			t_total = float(throttles[uid]["total"])
			status = "throttled"
			detail = "pacing: pausa temporizzata"
		agents.append({
			"slug": slug, "role": slug, "name": name, "uid": uid,
			"session": session,  # nome tmux RAW: serve alla chat 1-a-1
			"active": true, "status": status, "desk_hint": "",
			"activity_detail": detail,
			"throttle_secs": t_left, "throttle_total": t_total,
		})
	return agents


func _deferred_state(state: int, detail: String) -> void:
	bus.call_deferred("publish_state", state, detail)


## La riga utile dell'errore ssh, senza sommergere la UI.
static func _short_error(res: Dictionary) -> String:
	for line in str(res["out"]).split("\n"):
		var l := line.strip_edges()
		if l != "" and not l.begins_with("Warning:"):
			return l.left(120)
	return "ssh fallita (exit %s)" % res["code"]


## Sonno interrompibile: reagisce a stop() entro ~0.2s.
func _sleep(secs: float) -> void:
	var waited := 0.0
	while waited < secs and not _stop:
		OS.delay_msec(200)
		waited += 0.2
