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
