import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: emit({'ok':False,'error':'stats_unavailable'})
if not isinstance(req,dict) or set(req)-{'op','nights'}: emit({'ok':False,'error':'stats_unavailable'})
op=req.get('op')
if op not in ('read','clear'): emit({'ok':False,'error':'stats_unavailable'})
nights=req.get('nights',30)
if not isinstance(nights,int) or isinstance(nights,bool) or nights<1 or nights>90: emit({'ok':False,'error':'stats_unavailable'})
os.environ.setdefault('JHT_HOME','/jht_home')
path='/app/shared/skills/work_stats.py'
if not os.path.isfile(path): emit({'ok':False,'error':'stats_unavailable'})
try:
 spec=importlib.util.spec_from_file_location('work_stats',path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
except Exception: emit({'ok':False,'error':'stats_unreadable' if op=='read' else 'stats_clear_failed'})
try:
 out=mod.read(nights) if op=='read' else mod.clear()
except Exception as error:
 code=getattr(error,'code',None)
 emit({'ok':False,'error':code if code in ('stats_unreadable','stats_clear_failed') else ('stats_unreadable' if op=='read' else 'stats_clear_failed')})
out['ok']=True
emit(out)
