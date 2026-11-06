pub(super) const CHAT_READ_PY: &str = r#"import hashlib,json,os,sys
req=json.loads(sys.stdin.readline())
agent=str(req.get('agent') or '')
allowed={'capitano','assistente','mentor','scout','analista','scorer','scrittore','critico'}
if agent not in allowed: raise SystemExit(2)
path='/jht_home/agents/'+{'scout':'scout-1','analista':'analista-1','scorer':'scorer-1','scrittore':'scrittore-1'}.get(agent,agent)+'/chat.jsonl'
if not os.path.isfile(path):
 print(json.dumps({'messages':[],'cursor':'0'})); raise SystemExit(0)
size=os.path.getsize(path); raw_cursor=req.get('cursor')
try: cursor=max(0,min(size,int(raw_cursor))) if raw_cursor not in (None,'') else max(0,size-131072)
except Exception: raise SystemExit(2)
messages=[]
with open(path,'rb') as f:
 f.seek(cursor)
 if cursor: f.readline()
 while len(messages)<120:
  start=f.tell(); raw=f.readline()
  if not raw: break
  if len(raw)>65536: continue
  try: row=json.loads(raw.decode('utf-8'))
  except Exception: continue
  text=str(row.get('text') or '').strip()
  if not text: continue
  role=str(row.get('role') or '').lower()
  role='user' if role=='user' else ('agent' if role in ('assistant','agent') else 'system')
  try: at=float(row.get('ts') or 0)
  except Exception: at=0
  mid=str(row.get('message_id') or hashlib.sha256((agent+':'+str(start)+':').encode()+raw).hexdigest())
  messages.append({'id':mid,'role':role,'text':text,'at':at})
 cursor=f.tell()
print(json.dumps({'messages':messages,'cursor':str(cursor)},ensure_ascii=False))"#;

pub(super) const CHAT_PERSIST_PY: &str = r#"import hashlib,json,os,sys,time
req=json.loads(sys.stdin.readline()); agent=str(req.get('agent') or '')
allowed={'capitano','assistente','mentor','scout','analista','scorer','scrittore','critico'}
if agent not in allowed: raise SystemExit(2)
cid=str(req.get('clientMessageId') or ''); text=str(req.get('text') or '').strip(); mode=str(req.get('mode') or '')
if not cid or len(cid)>128 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in cid): raise SystemExit(2)
path='/jht_home/agents/'+{'scout':'scout-1','analista':'analista-1','scorer':'scorer-1','scrittore':'scrittore-1'}.get(agent,agent)+'/chat.jsonl'
def existing():
 if not os.path.isfile(path): return None
 size=os.path.getsize(path)
 with open(path,'rb') as f:
  f.seek(max(0,size-1048576))
  if f.tell(): f.readline()
  for raw in f:
   try: row=json.loads(raw.decode('utf-8'))
   except Exception: continue
   if row.get('client_message_id')==cid: return row
found=existing()
if found:
 print(json.dumps({'exists':True,'clientMessageId':cid,'accepted':True,'messageId':found.get('message_id'),'at':found.get('ts')})); raise SystemExit(0)
if mode=='check': print(json.dumps({'exists':False})); raise SystemExit(0)
if mode!='append' or not text or len(text)>4000: raise SystemExit(2)
os.makedirs(os.path.dirname(path),exist_ok=True); at=time.time(); mid=hashlib.sha256((cid+':'+str(at)).encode()).hexdigest()
row={'role':'user','text':text,'ts':at,'done':True,'client_message_id':cid,'message_id':mid}
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
try:
 os.write(fd,(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n').encode()); os.fsync(fd)
finally: os.close(fd)
found=existing()
if not found or found.get('message_id')!=mid: raise SystemExit(3)
print(json.dumps({'exists':False,'clientMessageId':cid,'accepted':True,'messageId':mid,'at':at}))"#;

/// The team's language, read and written at the one place every reader of it looks first
/// (`/jht_home/i18n-prefs.json`, the artefact of docs/internal/2026-08-12-language-source-contract.md),
/// with the same atomic replace as the game's `language_save.py`. `read` tells the language the team
/// speaks now (the file, then `$JHT_LANG`, then `host.env`, then English) and what the file itself says.
/// `set` writes only while that language is the English everything starts with: a language already
/// chosen is never replaced, and the reply says so (`changed: false`) instead of failing. `choose` is
/// the person's own choice (Settings, or the question after the app's language changed): it replaces
/// whatever the team spoke, and the agents take it from their next message.
pub(super) const TEAM_LANGUAGE_PY: &str = r#"import json,os,sys,tempfile
valid=('en','it','hu','es','de','fr','pt')
req=json.loads(sys.stdin.readline()); op=req.get('op')
home='/jht_home'; path=home+'/i18n-prefs.json'
def stored():
 try:
  with open(path,encoding='utf-8') as f: value=json.load(f).get('locale')
 except Exception: return None
 return value if value in valid else None
def bootstrap():
 value=(os.environ.get('JHT_LANG') or '').strip()
 if value in valid: return value
 try:
  with open(home+'/host.env',encoding='utf-8') as f:
   for line in f:
    key,_,value=line.strip().partition('=')
    value=value.strip().strip('"').strip("'")
    if key.strip()=='JHT_LANG' and value in valid: return value
 except Exception: pass
 return None
current=stored() or bootstrap() or 'en'
if op=='read': print(json.dumps({'locale':current,'stored':stored()})); raise SystemExit(0)
locale=req.get('locale')
if op not in ('set','choose') or locale not in valid: raise SystemExit(2)
if (op=='set' and current!='en') or (op=='choose' and stored()==locale): print(json.dumps({'locale':current,'stored':stored(),'changed':False})); raise SystemExit(0)
fd,temporary=tempfile.mkstemp(prefix='.i18n-prefs.',dir=home)
try:
 with os.fdopen(fd,'w',encoding='utf-8') as out:
  json.dump({'locale':locale},out,indent=2,ensure_ascii=False); out.write('\n'); out.flush(); os.fsync(out.fileno())
 os.chmod(temporary,0o644); os.replace(temporary,path)
except Exception:
 try: os.unlink(temporary)
 except OSError: pass
 raise
print(json.dumps({'locale':locale,'stored':locale,'changed':True}))"#;
