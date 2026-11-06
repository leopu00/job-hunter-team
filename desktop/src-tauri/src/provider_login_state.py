import json,os,re,subprocess,sys,time
NAMES={'claude':'claude','anthropic':'claude','codex':'codex','openai':'codex','kimi':'kimi','moonshot':'kimi'}
provider=''
def emit(state): print(json.dumps({'ok':True,'state':state,'provider':NAMES.get(provider,'none')},separators=(',',':'))); raise SystemExit(0)
def fail(code): print(json.dumps({'ok':False,'error':code},separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: fail('provider_login_unreadable')
if req!={'op':'state'}: fail('provider_login_unreadable')
home=os.environ.get('JHT_HOME') or '/jht_home'
try:
 with open(home+'/jht.config.json','r',encoding='utf-8') as handle: config=json.load(handle)
except Exception: config={}
if not isinstance(config,dict): config={}
provider=str(config.get('active_provider') or '').lower()
providers=config.get('providers') if isinstance(config.get('providers'),dict) else {}
entry=providers.get(provider) if isinstance(providers.get(provider),dict) else {}
CLAUDE='.claude/.credentials.json'; CODEX='.codex/auth.json'; KIMI='.kimi/credentials/kimi-code.json'
FILES={'claude':CLAUDE,'anthropic':CLAUDE,'codex':CODEX,'openai':CODEX,'kimi':KIMI,'moonshot':KIMI}
if provider not in FILES or (entry.get('auth_method') or 'subscription')!='subscription': emit('not_applicable')
CODEX_SAYS=r'access token could not be refreshed|log out and sign in again|refresh token (was|has been) (revoked|expired|already used)'
CLAUDE_SAYS=r'OAuth token has (expired|been revoked)|Please run /login|API Error: 401'
SAYS={CODEX:CODEX_SAYS,CLAUDE:CLAUDE_SAYS}.get(FILES[provider])
path=os.path.join(home,FILES[provider])
try: stat=os.stat(path)
except FileNotFoundError: emit('missing')
except OSError: emit('unreadable')
try:
 with open(path,'r',encoding='utf-8') as handle: saved=json.load(handle)
except Exception: emit('unreadable')
if not isinstance(saved,dict) or not saved: emit('unreadable')
def run(args):
 return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,universal_newlines=True,errors='replace').stdout
def rejected(since):
 if not SAYS: return False
 try: panes=run(['tmux','list-panes','-a','-F','#{pane_id} #{window_activity}']).split('\n')
 except Exception: return False
 for line in panes:
  parts=line.split()
  if len(parts)!=2 or not re.fullmatch(r'%[0-9]+',parts[0]) or not parts[1].isdigit() or int(parts[1])<=since: continue
  try: text=run(['tmux','capture-pane','-p','-t',parts[0],'-S','-40'])
  except Exception: continue
  if re.search(SAYS,text,re.I): return True
 return False
if rejected(stat.st_mtime): emit('expired')
if FILES[provider]==CODEX:
 stamp=saved.get('last_refresh'); seen=stat.st_mtime
 if isinstance(stamp,str) and re.match(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}',stamp):
  try:
   import calendar
   seen=calendar.timegm(time.strptime(stamp[:19],'%Y-%m-%dT%H:%M:%S'))
  except Exception: seen=stat.st_mtime
 if time.time()-seen>30*86400: emit('probably_expired')
emit('ready')
