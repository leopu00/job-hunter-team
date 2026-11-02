import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: emit({'ok':False,'error':'team_start_unavailable'})
if req!={'op':'read'}: emit({'ok':False,'error':'team_start_unavailable'})
home=os.environ.get('JHT_HOME') or '/jht_home'
skills=(os.environ.get('JHT_APP') or '/app')+'/shared/skills'
phase=None
workers=0
try:
 with open(home+'/state/first-run.json',encoding='utf-8') as handle: state=json.load(handle)
 if isinstance(state,dict):
  if state.get('phase') in ('awaiting_profile','burst','steady'): phase=state['phase']
  roster=state.get('roster')
  if phase is not None and isinstance(roster,dict):
   workers=sum(count for count in roster.values() if isinstance(count,int) and not isinstance(count,bool) and 0<=count<=1000)
except Exception: phase=None
declared=False
try:
 path=skills+'/plan_registry.py'
 if os.path.isfile(path):
  sys.path.append(skills)
  spec=importlib.util.spec_from_file_location('plan_registry',path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
  declared=mod.active_plan() is not None
except Exception: declared=False
emit({'ok':True,'phase':phase,'workers':workers,'planDeclared':declared})
