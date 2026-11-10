import calendar,json,os,re,subprocess,sys,time
NAMES={'claude':'claude','anthropic':'claude','codex':'codex','openai':'codex','kimi':'kimi','moonshot':'kimi'}
provider=''
def emit(state): print(json.dumps({'ok':True,'state':state,'provider':NAMES.get(provider,'none')},separators=(',',':'))); raise SystemExit(0)
def fail(code): print(json.dumps({'ok':False,'error':code},separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: fail('provider_login_unreadable')
if req!={'op':'state'}: fail('provider_login_unreadable')
home=os.environ.get('JHT_HOME') or '/jht_home'
# no settings yet is a team with no provider; settings that cannot be read are a failed check, never «nothing to check»
try:
 with open(home+'/jht.config.json','r',encoding='utf-8') as handle: config=json.load(handle)
except FileNotFoundError: config={}
except Exception: fail('provider_login_unreadable')
if not isinstance(config,dict): fail('provider_login_unreadable')
provider=str(config.get('active_provider') or '').lower()
providers=config.get('providers') if isinstance(config.get('providers'),dict) else {}
entry=providers.get(provider) if isinstance(providers.get(provider),dict) else {}
CLAUDE='.claude/.credentials.json'; CODEX='.codex/auth.json'; KIMI='.kimi/credentials/kimi-code.json'
FILES={'claude':CLAUDE,'anthropic':CLAUDE,'codex':CODEX,'openai':CODEX,'kimi':KIMI,'moonshot':KIMI}
if provider not in FILES or (entry.get('auth_method') or 'subscription')!='subscription': emit('not_applicable')
# with Pi in charge of the OpenAI account the sign-in is Pi's own file, with one entry per service: it is the sign-in of THIS account only when
# its own entry is there (a file with only Anthropic's entry, a Claude subscription billed per token from Pi, is «not signed in»). The NAMES of
# the entries are looked at, never a value. The two names are the ones of shared/runtime/pi-login-keys.list (tests/test_provider_login_state.py)
PI_NAMES=('openai',)
if config.get('harness')=='pi' and FILES[provider]==CODEX:
 pi_path=os.path.join(home,'.pi','agent','auth.json')
 try: pi=os.stat(pi_path)
 except FileNotFoundError: emit('missing')
 except OSError: emit('unreadable')
 if pi.st_size<=0 or pi.st_size>262144: emit('unreadable')
 try:
  with open(pi_path,'r',encoding='utf-8') as handle: pi_saved=json.load(handle)
 except Exception: emit('unreadable')
 if not isinstance(pi_saved,dict): emit('unreadable')
 emit('ready' if any(isinstance(pi_saved.get(name),dict) and pi_saved.get(name) for name in PI_NAMES) else 'missing')
CODEX_SAYS=r'access token could not be refreshed|log out and sign in again|refresh token (was|has been) (revoked|expired|already used)'
CLAUDE_SAYS=r'OAuth token has (expired|been revoked)|Please run /login|API Error: 401'
SAYS={CODEX:CODEX_SAYS,CLAUDE:CLAUDE_SAYS}.get(FILES[provider])
# a refusal counts only while it is the last thing the pane said: a few lines of prompt and status may follow it, an answer may not
TAIL=6
path=os.path.join(home,FILES[provider])
try: stat=os.stat(path)
except FileNotFoundError: emit('missing')
except OSError: emit('unreadable')
try:
 with open(path,'r',encoding='utf-8') as handle: saved=json.load(handle)
except Exception: emit('unreadable')
def text(value): return isinstance(value,str) and value.strip()!=''
def is_login(saved):
 if not isinstance(saved,dict) or not saved: return False
 if FILES[provider]==CODEX:
  tokens=saved.get('tokens')
  return isinstance(tokens,dict) and (text(tokens.get('access_token')) or text(tokens.get('refresh_token')))
 if FILES[provider]==CLAUDE:
  oauth=saved.get('claudeAiOauth')
  return isinstance(oauth,dict) and (text(oauth.get('accessToken')) or text(oauth.get('refreshToken')))
 return True
if not is_login(saved): emit('unreadable')
def run(args):
 try: return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,universal_newlines=True,errors='replace')
 except Exception: fail('provider_login_unreadable')
def panes(since):
 listed=run(['tmux','list-panes','-a','-F','#{pane_id} #{window_activity}'])
 if listed.returncode!=0:
  # no tmux server is a team with no agent running: nothing to read. Any other failure is a check that did not happen.
  if re.search(r'no server running|error connecting to',listed.stderr): return []
  fail('provider_login_unreadable')
 found=[]
 for line in listed.stdout.split('\n'):
  parts=line.split()
  if len(parts)==2 and re.fullmatch(r'%[0-9]+',parts[0]) and parts[1].isdigit() and int(parts[1])>since: found.append(parts[0])
 return found
def refused_last(pane):
 shown=run(['tmux','capture-pane','-p','-t',pane,'-S','-40'])
 if shown.returncode!=0: return False
 lines=[line for line in shown.stdout.split('\n') if line.strip()]
 hits=[index for index,line in enumerate(lines) if re.search(SAYS,line,re.I)]
 return bool(hits) and len(lines)-1-hits[-1]<=TAIL
if SAYS and any(refused_last(pane) for pane in panes(stat.st_mtime)): emit('expired')
if FILES[provider]==CODEX:
 stamp=saved.get('last_refresh'); seen=stat.st_mtime
 if isinstance(stamp,str) and re.match(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}',stamp):
  try: seen=calendar.timegm(time.strptime(stamp[:19],'%Y-%m-%dT%H:%M:%S'))
  except Exception: seen=stat.st_mtime
 if time.time()-seen>30*86400: emit('probably_expired')
emit('ready')
