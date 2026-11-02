import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def unavailable(): emit({'ok':False,'error':'profile_unavailable'})
try: req=json.loads(sys.stdin.readline())
except Exception: unavailable()
if req!={'op':'read'}: unavailable()
home=os.environ.get('JHT_HOME') or '/jht_home'
skills=(os.environ.get('JHT_APP') or '/app')+'/shared/skills'
checker=skills+'/validate_profile.py'
profile=home+'/profile/candidate_profile.yml'
if not os.path.isfile(checker) or not os.path.isfile(profile): unavailable()
try:
 import yaml
 sys.path.append(skills)
 spec=importlib.util.spec_from_file_location('validate_profile',checker); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 if not hasattr(mod,'team_minimum_missing'): unavailable()
except SystemExit: raise
except Exception: unavailable()
try:
 if os.path.getsize(profile)>1048576: emit({'ok':False,'error':'profile_unreadable'})
 with open(profile,encoding='utf-8') as handle: data=yaml.safe_load(handle)
except SystemExit: raise
except Exception: emit({'ok':False,'error':'profile_unreadable'})
if data is None or data=={}: unavailable()
if not isinstance(data,dict): emit({'ok':False,'error':'profile_unreadable'})
try: missing=mod.team_minimum_missing(data)
except Exception: emit({'ok':False,'error':'profile_unreadable'})
def mapping(value): return value if isinstance(value,dict) else {}
cand=mapping(data.get('candidate')); pers=mapping(data.get('personal')); pos=mapping(data.get('positioning'))
def first(*values):
 for value in values:
  if isinstance(value,str) and value.strip(): return value.strip()
roles=data.get('target_roles')
years=data.get('experience_years')
shown={'name':first(cand.get('name'),pers.get('name'),data.get('name')),
 'target_role':first(cand.get('target_role'),data.get('target_role'),roles[0] if isinstance(roles,list) and roles else None),
 'location':first(data.get('location'),pers.get('location')),
 'seniority_target':first(data.get('seniority_target'),pos.get('seniority_target')),
 'experience_years':str(years) if isinstance(years,(int,float)) and not isinstance(years,bool) else None}
def counted(name):
 try:
  if name=='skills': return int(mod._skill_count(cand.get('skills') if cand.get('skills') is not None else data.get('skills')))
  return int(mod._items(cand.get('languages'),data.get('languages')))
 except Exception: return 0
rows=[]
for key in ('name','email','target_role','location','experience_years','seniority_target','skills','languages'):
 row={'key':key,'ok':key not in missing}
 if key in shown and shown[key]: row['preview']=''.join(c for c in shown[key] if c.isprintable())[:60]
 if key in ('skills','languages'): row['count']=counted(key)
 rows.append(row)
emit({'ok':True,'fields':rows})
