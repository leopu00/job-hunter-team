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
