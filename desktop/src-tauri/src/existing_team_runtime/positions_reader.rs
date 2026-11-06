pub(crate) const POSITIONS_READ_PY: &str = r#"import json,sqlite3,sys,re
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
def as_dict(row): return dict(row) if row is not None else None
def sid(value): return str(value) if value is not None else ''
def nullable(row,key): return row.get(key) if key in row else None
def truthy(row,key): return bool(row.get(key)) if key in row else False
def one(sql,args=()):
 try: return as_dict(db.execute(sql,args).fetchone())
 except sqlite3.Error: return None
def many(sql,args=()):
 try: return [as_dict(row) for row in db.execute(sql,args).fetchall()]
 except sqlite3.Error: return []
def first_by_position(table,names):
 present=columns(table); found={}
 for row in many('SELECT '+', '.join(['position_id']+[name for name in names if name in present])+' FROM '+table+' ORDER BY rowid'): found.setdefault(row['position_id'],row)
 return found
def columns(table):
 try: return {row[1] for row in db.execute('PRAGMA table_info('+table+')')}
 except sqlite3.Error: return set()
SCAM_FAMILY={'same_text_many_places':'text','advance_payment':'text','company_unverifiable':'company','private_chat_only':'contact'}
def scam(value):
 try: found=json.loads(value) if isinstance(value,str) else None
 except ValueError: return None
 codes=found.get('codes') if isinstance(found,dict) else None
 if not isinstance(codes,list): return None
 kept=[code for code in SCAM_FAMILY if code in codes]
 if not kept: return None
 return {'codes':kept,'bucket':'section' if len({SCAM_FAMILY[code] for code in kept})>1 else 'badge'}
def map_position(row,score=None,application=None,full=False):
 out={'id':sid(row.get('id')),'legacy_id':nullable(row,'legacy_id'),'title':nullable(row,'title'),'company':nullable(row,'company'),'company_id':sid(row.get('company_id')) if row.get('company_id') else None,'location':nullable(row,'location'),'remote_type':nullable(row,'remote_type'),'salary_declared_min':nullable(row,'salary_declared_min'),'salary_declared_max':nullable(row,'salary_declared_max'),'salary_declared_currency':nullable(row,'salary_declared_currency'),'salary_estimated_min':nullable(row,'salary_estimated_min'),'salary_estimated_max':nullable(row,'salary_estimated_max'),'salary_estimated_currency':nullable(row,'salary_estimated_currency'),'salary_estimated_source':nullable(row,'salary_estimated_source'),'url':nullable(row,'url'),'source':nullable(row,'source'),'jd_text':nullable(row,'jd_text'),'jd_summary':nullable(row,'jd_summary'),'scam_signals':scam(row.get('scam_signals')),'requirements':nullable(row,'requirements'),'found_by':nullable(row,'found_by'),'found_at':nullable(row,'found_at') or '','deadline':nullable(row,'deadline'),'status':nullable(row,'status'),'notes':nullable(row,'notes'),'last_checked':nullable(row,'last_checked'),'role_family':nullable(row,'role_family'),'loc_country':nullable(row,'loc_country'),'loc_city':nullable(row,'loc_city')}
 if full:
  out.update({'write_requested':truthy(row,'write_requested'),'write_requested_at':nullable(row,'write_requested_at'),'write_request_kind':nullable(row,'write_request_kind'),'geocode_requested':truthy(row,'geocode_requested'),'geocode_requested_at':nullable(row,'geocode_requested_at'),'office_geocoded':truthy(row,'office_geocoded'),'user_excluded_reason':nullable(row,'user_excluded_reason'),'user_excluded_note':nullable(row,'user_excluded_note'),'user_excluded_at':nullable(row,'user_excluded_at'),'user_excluded_prev_status':nullable(row,'user_excluded_prev_status'),'recheck_requested':truthy(row,'recheck_requested'),'recheck_requested_at':nullable(row,'recheck_requested_at'),'apply_requested':truthy(row,'apply_requested'),'apply_requested_at':nullable(row,'apply_requested_at'),'apply_requested_by':nullable(row,'apply_requested_by'),'last_open_check':nullable(row,'last_open_check')})
 else:
  out.update({'write_requested':truthy(row,'write_requested'),'score':nullable(score,'total_score') if score else None,'critic_score':nullable(application,'critic_score') if application else None,'critic_verdict':nullable(application,'critic_verdict') if application else None})
  if score and score.get('stack_match') is not None: out['scores']=map_score(score)
 return out
def map_score(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'total_score':row.get('total_score'),'stack_match':nullable(row,'stack_match'),'remote_fit':nullable(row,'remote_fit'),'salary_fit':nullable(row,'salary_fit'),'experience_fit':nullable(row,'experience_fit'),'strategic_fit':nullable(row,'strategic_fit'),'breakdown':nullable(row,'breakdown'),'notes':nullable(row,'notes'),'scored_by':nullable(row,'scored_by'),'scored_at':nullable(row,'scored_at') or ''}
def map_company(row): return {'id':sid(row.get('id')),'name':row.get('name'),'website':nullable(row,'website'),'hq':nullable(row,'hq_country'),'sector':nullable(row,'sector'),'size':nullable(row,'size'),'glassdoor_rating':nullable(row,'glassdoor_rating'),'red_flags':nullable(row,'red_flags'),'culture_notes':nullable(row,'culture_notes'),'analyzed_by':nullable(row,'analyzed_by'),'analyzed_at':nullable(row,'analyzed_at'),'verdict':nullable(row,'verdict'),'logo':nullable(row,'logo'),'about':nullable(row,'about')}
def map_application(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'cv_path':nullable(row,'cv_path'),'cl_path':nullable(row,'cl_path'),'cv_pdf_path':nullable(row,'cv_pdf_path'),'cl_pdf_path':nullable(row,'cl_pdf_path'),'cv_drive_id':nullable(row,'cv_drive_id'),'cl_drive_id':nullable(row,'cl_drive_id'),'critic_verdict':nullable(row,'critic_verdict'),'critic_score':nullable(row,'critic_score'),'critic_notes':nullable(row,'critic_notes'),'status':nullable(row,'status'),'written_at':nullable(row,'written_at'),'applied_at':nullable(row,'applied_at'),'applied_via':nullable(row,'applied_via'),'response':nullable(row,'response'),'response_at':nullable(row,'response_at'),'written_by':nullable(row,'written_by'),'reviewed_by':nullable(row,'reviewed_by'),'applied':truthy(row,'applied'),'interview_round':nullable(row,'interview_round')}
def map_ticket(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'request_text':row.get('request_text'),'kind':nullable(row,'kind') or 'custom','status':row.get('status'),'assigned_agent':nullable(row,'assigned_agent'),'response_text':nullable(row,'response_text'),'created_at':nullable(row,'created_at'),'resolved_at':nullable(row,'resolved_at')}
def state(status): return {'writing':'preparing','review':'preparing'}.get(status,status if status in ('new','checked','scored','ready','applied','response','excluded') else 'needs_attention')
def salary(row):
 declared=row.get('salary_declared_min') is not None or row.get('salary_declared_max') is not None
 return ((row.get('salary_declared_min'),row.get('salary_declared_max'),row.get('salary_declared_currency')) if declared else (row.get('salary_estimated_min'),row.get('salary_estimated_max'),row.get('salary_estimated_currency')))
def position_detail(pid):
 raw=one('SELECT * FROM positions WHERE id=?',(pid,))
 if raw is None: return None
 score=one('SELECT * FROM scores WHERE position_id=?',(pid,)); application=one('SELECT * FROM applications WHERE position_id=?',(pid,))
 highlights=[]
 for row in many('SELECT * FROM position_highlights WHERE position_id=? ORDER BY type',(pid,)): highlights.append({'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'type':row.get('type'),'text':row.get('text')})
 company=one('SELECT * FROM companies WHERE id=?',(raw.get('company_id'),)) if raw.get('company_id') else None
 tickets=[map_ticket(row) for row in many('SELECT * FROM position_tickets WHERE position_id=? ORDER BY created_at DESC,id DESC',(pid,))]
 note=one("SELECT body,updated_at FROM position_user_notes WHERE position_id=? AND origin='box'",(pid,)) if 'origin' in columns('position_user_notes') else one('SELECT body,updated_at FROM position_user_notes WHERE position_id=?',(pid,))
 excluded=one("SELECT ts FROM position_state_transitions WHERE position_id=? AND to_state='excluded' ORDER BY ts DESC,id DESC LIMIT 1",(pid,))
 return {'position':map_position(raw,full=True),'score':map_score(score) if score else None,'highlights':highlights,'company':map_company(company) if company else None,'application':map_application(application) if application else None,'tickets':tickets,'userNote':note,'exclusionEventAt':excluded.get('ts') if excluded else None}
def validate_strings(value): return isinstance(value,list) and 0<len(value)<=32 and all(isinstance(item,str) and 0<len(item)<=80 for item in value)
def validate_bands(value): return isinstance(value,list) and len(value)<=32 and all(isinstance(item,dict) and set(item)=={'lo','hi'} and type(item['lo']) in (int,float) and type(item['hi']) in (int,float) and item['lo']<=item['hi'] for item in value)
def city_key(row): return '%s|%s'%((row.get('loc_country') or '').strip() or '(unknown)',(row.get('loc_city') or '').strip() or '(country-only)')
def search_id(value):
 match=re.match(r'^(?:jht[\s\-_#]*|#\s*)?0*(\d{1,9})$',value,re.I)
 return int(match.group(1)) if match and int(match.group(1))>0 else None
def matching(item,filters):
 for key in ('statuses','remoteTypes','sources','verdicts','families','countries','cities'):
  if key in filters and not validate_strings(filters[key]): return None
 if 'scoreBands' in filters and not validate_bands(filters['scoreBands']): return None
 if 'criticBands' in filters and not validate_bands(filters['criticBands']): return None
 if filters.get('scam') not in (None,'hide','only'): return None
 for key in ('unscored','criticUnscored','writeRequested','scoredOnly','hideExcluded'):
  if key in filters and type(filters[key]) is not bool: return None
 if filters.get('scoredOnly') and item.get('score') is None: return False
 if filters.get('hideExcluded') and item.get('status')=='excluded': return False
 if filters.get('statuses') and item.get('status') not in filters['statuses']: return False
 if filters.get('remoteTypes') and item.get('remote_type') not in filters['remoteTypes']: return False
 if filters.get('sources') and item.get('source') not in filters['sources']: return False
 if filters.get('verdicts') and item.get('critic_verdict') not in filters['verdicts']: return False
 if filters.get('families') and ((item.get('role_family') or '').strip() or 'Da categorizzare') not in filters['families']: return False
 if filters.get('countries') and ((item.get('loc_country') or '').strip() or '(unknown)') not in filters['countries']: return False
 if filters.get('cities') and city_key(item) not in filters['cities']: return False
 score=item.get('score'); bands=filters.get('scoreBands',[])
 if bands or filters.get('unscored') is not None:
  if score is None or score==0:
   if not filters.get('unscored',False): return False
  elif not any(b['lo']<=score<=b['hi'] for b in bands): return False
 critic=item.get('critic_score'); bands=filters.get('criticBands',[])
 if bands or filters.get('criticUnscored') is not None:
  if critic is None:
   if not filters.get('criticUnscored',False): return False
  elif not any(b['lo']<=critic<=b['hi'] for b in bands): return False
 if 'writeRequested' in filters and bool(item.get('write_requested')) != filters['writeRequested']: return False
 query=filters.get('q')
 if query is not None:
  if not isinstance(query,str) or len(query)>120: return None
  q=query.strip().lower(); legacy=search_id(q)
  hay=' '.join(str(item.get(key) or '') for key in ('title','company','loc_city','loc_country','role_family','source')).lower()
  candidate_id=item.get('legacy_id')
  if candidate_id is None: candidate_id=item.get('id')
  if q and q not in hay and (legacy is None or str(candidate_id) != str(legacy)): return False
 return True
def sort_items(items,filters):
 key=filters.get('sort')
 if key is not None and (not isinstance(key,str) or key not in {'id','score','salary','monthly','last_action_by','critic','found_at','last_action_at','status','written_at','applied_at','title','company','role_family','source','location','remote','loc_country','loc_city'}): fail('positions_request_invalid')
 direction=filters.get('dir','desc')
 if direction not in ('asc','desc'): fail('positions_request_invalid')
 def raw(item):
  if key=='id':
   legacy=item.get('legacy_id')
   return legacy if legacy is not None else (int(item['id']) if str(item.get('id') or '').isdigit() else None)
  if key in ('salary','monthly'): return item.get('salary_min')
  if key=='remote': return item.get('remote_type')
  if key=='critic': return item.get('critic_score')
  if key=='last_action_by': return item.get('last_action_actor')
  return item.get(key or 'found_at')
 def value(item):
  found=raw(item)
  return found.casefold() if isinstance(found,str) else found
 if key:
  present=[item for item in items if value(item) is not None]; missing=[item for item in items if value(item) is None]
  present.sort(key=value,reverse=direction=='desc'); items[:]=present+missing
 return items
LIST_KEYS=('id','legacy_id','title','company','location','remote_type','source','found_at','status','role_family','loc_country','loc_city','score','critic_score','critic_verdict','written_at','applied_at','salary_min','salary_max','salary_currency','has_open_ticket','ticket_indicator','public_state','write_requested','scam_signals','office_lat','office_lon','office_address')
def light(item): return {key:item.get(key) for key in LIST_KEYS}
try: req=json.loads(sys.stdin.readline())
except Exception: fail('positions_request_invalid')
if not isinstance(req,dict) or set(req)-{'op','filters','id','offset','from','to'}: fail('positions_request_invalid')
op=req.get('op')
if op not in ('list','detail','facets','stats','piles','profile','cloud_sync','map','team_activity','team_activity_log','directives'): fail('positions_request_invalid')
DAY=re.compile(r'^\d{4}-\d{2}-\d{2}$')
if op=='team_activity' and (set(req)!={'op','from','to'} or not all(isinstance(req[key],str) and DAY.match(req[key]) for key in ('from','to')) or req['from']>req['to']): fail('positions_request_invalid')
if op!='team_activity' and (('from' in req) or ('to' in req)): fail('positions_request_invalid')
if op=='map' and (set(req)-{'op','offset'} or type(req.get('offset',0)) is not int or not 0<=req.get('offset',0)<=1000000): fail('positions_request_invalid')
if op!='map' and 'offset' in req: fail('positions_request_invalid')
if op=='detail' and (set(req)!={'op','id'} or not isinstance(req['id'],str) or not req['id'].isdigit() or len(req['id'])>20): fail('positions_request_invalid')
if op in ('facets','stats','piles','profile','cloud_sync','directives','team_activity_log') and set(req)!={'op'}: fail('positions_request_invalid')
if op=='list' and (set(req)-{'op','filters'} or (req.get('filters') is not None and not isinstance(req.get('filters'),dict))): fail('positions_request_invalid')
if op=='cloud_sync':
 # How the box's push to the website is going: its periodic push keeps the last outcome in
 # /jht_home/.cloud-periodic-push.json. Only these fields leave the team, each checked; the status
 # from a closed list. The box's cloud configuration, with its secret, is never opened.
 import os,stat
 STATUSES=('completed','idle','partial','timeout','auth_failed','failed','signature_unavailable')
 def when(value): return value if isinstance(value,str) and re.match(r'^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$',value) and len(value)<=32 else None
 try: fd=os.open('/jht_home/.cloud-periodic-push.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 except FileNotFoundError: emit({'ok':True,'data':{'state':'absent'}})
 except OSError: emit({'ok':True,'data':{'state':'unreadable'}})
 try:
  info=os.fstat(fd)
  raw=os.read(fd,65537) if stat.S_ISREG(info.st_mode) else None
 except OSError: raw=None
 finally: os.close(fd)
 try: found=json.loads(raw) if raw is not None and len(raw)<=65536 else None
 except ValueError: found=None
 if not isinstance(found,dict): emit({'ok':True,'data':{'state':'unreadable'}})
 status=found.get('status'); failures=found.get('consecutive_failures')
 emit({'ok':True,'data':{'state':'ok','status':status if status in STATUSES else 'other','last_success_at':when(found.get('last_success_at')),'last_attempt_at':when(found.get('last_attempt_at')),'consecutive_failures':failures if type(failures) is int and 0<=failures<=10**9 else 0}})
if op=='profile':
 # The candidate's profile is two things on the team's VPS and nothing else is read: the file
 # candidate_profile.yml and the narrative summaries/*.md. Its neighbours in the same folder (the
 # provider's configuration, the candidate's original documents, flags) are never opened. A name
 # that is not a plain file is reported, not followed. The reply is cut to a byte budget by dropping
 # the heaviest summary text first, and says so.
 import os,stat,hashlib
 PROFILE_DIR='/jht_home/profile'; YAML_MAX=65536; SUMMARY_MAX=32768; SUMMARY_FILES=32; BUDGET=1363148
 def plain_dir(path):
  try: return stat.S_ISDIR(os.lstat(path).st_mode)
  except OSError: return False
 def read_plain(path,limit):
  try: fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  except FileNotFoundError: return {'state':'absent'}
  except OSError: return {'state':'unreadable'}
  try:
   info=os.fstat(fd)
   if not stat.S_ISREG(info.st_mode): return {'state':'unreadable'}
   if info.st_size>limit: return {'state':'too_large','bytes':info.st_size}
   data=b''
   while len(data)<=limit:
    chunk=os.read(fd,limit+1-len(data))
    if not chunk: break
    data+=chunk
  except OSError: return {'state':'unreadable'}
  finally: os.close(fd)
  if len(data)>limit: return {'state':'too_large','bytes':len(data)}
  digest=hashlib.sha256(data).hexdigest()
  try: text=data.decode('utf-8')
  except UnicodeDecodeError: return {'state':'not_utf8','bytes':len(data),'sha256':digest}
  return {'state':'ok','bytes':len(data),'sha256':digest,'text':text}
 summaries={'state':'absent','items':[],'included':0,'of':0}
 if not plain_dir(PROFILE_DIR): profile={'state':'absent'}
 else:
  profile=read_plain(PROFILE_DIR+'/candidate_profile.yml',YAML_MAX)
  if plain_dir(PROFILE_DIR+'/summaries'):
   try: names=sorted(name[:-3] for name in os.listdir(PROFILE_DIR+'/summaries') if re.match(r'^[A-Za-z0-9_-]{1,64}\.md$',name))
   except OSError: names=None
   if names is None: summaries['state']='unreadable'
   else:
    items=[]
    for name in names[:SUMMARY_FILES]:
     item=read_plain(PROFILE_DIR+'/summaries/'+name+'.md',SUMMARY_MAX); item['name']=name; items.append(item)
    summaries={'state':'ok','items':items,'included':len(items),'of':len(names)}
 data={'profile':profile,'summaries':summaries}
 def size(): return len(json.dumps({'ok':True,'data':data},separators=(',',':')))
 while size()>BUDGET:
  heavy=[item for item in summaries['items'] if item.get('text') is not None]
  if not heavy: break
  victim=max(heavy,key=lambda item:len(item['text'])); victim['text']=None; victim['state']='over_budget'
 emit({'ok':True,'data':data})
import os
try:
 # A team that has never run has no jobs.db yet: that is no positions, not a failure. Only a file
 # missing from the team's home counts; a jobs.db that is there and cannot be read stays a failure,
 # and so does a missing home. The reads below then run on an empty database, as for a team with none.
 ident=[0,0]
 try: info=os.lstat('/jht_home/jobs.db'); ident=[info.st_ino,info.st_dev]; absent=False
 except FileNotFoundError: absent=os.path.isdir('/jht_home')
 if absent:
  db=sqlite3.connect(':memory:'); db.row_factory=sqlite3.Row
  db.executescript('CREATE TABLE positions(id INTEGER PRIMARY KEY,status TEXT,title TEXT,company TEXT,role_family TEXT,loc_country TEXT,loc_city TEXT,source TEXT,found_at TEXT);CREATE TABLE scores(position_id INTEGER,total_score INTEGER);CREATE TABLE applications(position_id INTEGER,critic_score INTEGER);')
 else:
  db=sqlite3.connect('file:/jht_home/jobs.db?mode=ro',uri=True); db.row_factory=sqlite3.Row; db.execute('PRAGMA query_only=ON')
 db.execute('SELECT 1 FROM positions LIMIT 1')
except Exception: fail('positions_unavailable')
if op=='detail': emit({'ok':True,'data':position_detail(int(req['id']))} if absent else {'ok':True,'data':position_detail(int(req['id'])),'ident':ident})
def trunc(value,size): return value[:size] if isinstance(value,str) else value
def number(value): return value if isinstance(value,(int,float)) and not isinstance(value,bool) else None
# An office coordinate the globe may place a pin on: a finite number within the globe, else None
# (a jobs.db without the columns, an empty or garbled value, are placed by their city instead).
def coord(value,limit): return value if number(value) is not None and value==value and -limit<=value<=limit else None
def text(value,size): return value[:size] if isinstance(value,str) else None
def dash_row(raw,score,application):
 sal=salary(raw); scored_at=nullable(score,'scored_at') if score else None; written_by=nullable(application,'written_by') if application else None
 candidates=[(raw.get('found_at'),'scout',raw.get('found_by')),(raw.get('last_checked'),'analista','analista'),(scored_at,'scorer',nullable(score,'scored_by') if score else None),(nullable(application,'written_at') if application else None,'scrittore',written_by),(nullable(application,'critic_reviewed_at') if application else None,'scrittore',written_by),(nullable(application,'applied_at') if application else None,'user','user'),(nullable(application,'response_at') if application else None,'user','user')]
 best=None
 for stamp,by,actor in candidates:
  if stamp and (best is None or stamp>best[0]): best=(stamp,by,actor or by)
 at,by,actor=best or ('','scout','scout')
 return {'id':sid(raw.get('id')),'legacy_id':nullable(raw,'legacy_id'),'title':trunc(nullable(raw,'title'),120),'company':trunc(nullable(raw,'company'),80),'location':trunc(nullable(raw,'location'),80),'remote_type':nullable(raw,'remote_type'),'status':raw.get('status'),'score':number(nullable(score,'total_score')) if score else None,'role_family':trunc(nullable(raw,'role_family'),60),'loc_country':trunc(nullable(raw,'loc_country'),40),'loc_city':trunc(nullable(raw,'loc_city'),60),'source':trunc(nullable(raw,'source'),60),'salary_min':number(sal[0]),'salary_max':number(sal[1]),'salary_currency':sal[2] or 'EUR','found_at':nullable(raw,'found_at'),'scored_at':scored_at,'last_action_at':at or nullable(raw,'found_at') or '','last_action_by':by,'last_action_actor':actor,'critic_score':number(nullable(application,'critic_score')) if application else None,'critic_verdict':nullable(application,'critic_verdict') if application else None}
# The columns the dashboard's rows are made of (not the job description, requirements or notes).
DASH_COLUMNS=('id','legacy_id','title','company','location','remote_type','status','role_family','loc_country','loc_city','source','found_at','found_by','last_checked','salary_declared_min','salary_declared_max','salary_declared_currency','salary_estimated_min','salary_estimated_max','salary_estimated_currency')
def dash_pick():
 have=columns('positions'); return ', '.join('p.'+name for name in DASH_COLUMNS if name in have)
def dash_rows(sql,args=()):
 raws=many(sql,args)
 # Many rows: the scores and applications are read once for all of them (only the columns a row uses), not one query each.
 scores_by=first_by_position('scores',('total_score','scored_at','scored_by')) if len(raws)>50 else None
 applications_by=first_by_position('applications',('critic_score','critic_verdict','written_at','written_by','critic_reviewed_at','applied_at','response_at')) if len(raws)>50 else None
 out=[]
 for raw in raws:
  pid=raw.get('id')
  score=scores_by.get(pid) if scores_by is not None else one('SELECT * FROM scores WHERE position_id=?',(pid,))
  application=applications_by.get(pid) if applications_by is not None else one('SELECT * FROM applications WHERE position_id=?',(pid,))
  out.append(dash_row(raw,score,application))
 return out
if op=='piles':
 # What the office draws as the piles of the roles: one aggregate over the positions, five counts. The phase of a position is
 # its status; a scored one the writer was already asked for is the writer's, a ready one is the critic's only when the critic
 # passed it (the verdict of the position's first application; none = not passed). Nothing else leaves the team.
 try:
  requested='COALESCE(p.write_requested,0)' if 'write_requested' in columns('positions') else '0'
  joined=('LEFT JOIN (SELECT position_id,critic_verdict FROM applications WHERE rowid IN (SELECT MIN(rowid) FROM applications GROUP BY position_id)) a ON a.position_id=p.id' if 'critic_verdict' in columns('applications') and 'position_id' in columns('applications') else '')
  passed="COALESCE(lower(a.critic_verdict)='pass',0)" if joined else '0'
  row=db.execute("SELECT SUM(p.status='new'),SUM(p.status='checked'),SUM(p.status='scored' AND NOT "+requested+"),SUM(p.status='review' OR (p.status='ready' AND NOT "+passed+")),SUM(p.status='ready' AND "+passed+") FROM positions p "+joined).fetchone()
 except sqlite3.Error: fail('positions_unavailable')
 emit({'ok':True,'data':dict(zip(('scout','analisti','scorer','scrittori','critici'),[int(value or 0) for value in row]))})
if op=='stats':
 POINTS=2000; EVENTS=3000; live="(p.status IS NULL OR p.status!='excluded')"
 try:
  counts={}
  for row in db.execute('SELECT status,COUNT(*) FROM positions GROUP BY status'): counts[row[0]]=row[1]
  total=sum(counts.values()); excluded=counts.get('excluded',0); active=total-excluded
  requested=requested_scored=0
  if 'write_requested' in columns('positions'):
   requested=db.execute("SELECT COUNT(*) FROM positions WHERE write_requested AND status IN ('scored','writing','review')").fetchone()[0]
   requested_scored=db.execute("SELECT COUNT(*) FROM positions WHERE write_requested AND status='scored'").fetchone()[0]
  stats={'total':total,'new':counts.get('new',0),'checked':counts.get('checked',0),'scored':counts.get('scored',0),'writing':counts.get('writing',0),'review':counts.get('review',0),'ready':counts.get('ready',0),'applied':counts.get('applied',0),'excluded':excluded,'response':counts.get('response',0),'scored_open':counts.get('scored',0)-requested_scored,'to_write':requested}
  scored=[row[0] for row in db.execute('SELECT s.total_score FROM positions p JOIN scores s ON s.position_id=p.id WHERE '+live+' AND s.total_score>0')] if 'total_score' in columns('scores') else []
  bands=[(76,100),(61,75),(41,60),(0,40)]
  distribution={'active':active,'withScore':len(scored),'avgScore':int(sum(scored)/len(scored)+0.5) if scored else None,'buckets':[{'min':lo,'max':hi,'count':sum(1 for value in scored if lo<=value<=hi)} for lo,hi in bands]}
  sources=[{'source':row[0] if row[0] is not None else 'sconosciuta','count':row[1]} for row in db.execute('SELECT source,COUNT(*) AS n FROM positions p WHERE '+live+' GROUP BY source ORDER BY n DESC LIMIT 8')]
  types=[{'role_family':trunc(row[0],60),'count':row[1]} for row in db.execute('SELECT role_family,COUNT(*) AS n FROM positions p WHERE '+live+' GROUP BY role_family ORDER BY n DESC LIMIT 40')]
  rows=dash_rows('SELECT '+dash_pick()+' FROM positions p WHERE '+live+' ORDER BY p.found_at DESC,p.id ASC LIMIT '+str(POINTS))
  scols=columns('scores')
  recent=dash_rows('SELECT p.* FROM positions p JOIN scores s ON s.position_id=p.id WHERE '+live+' AND s.total_score IS NOT NULL AND s.scored_at IS NOT NULL ORDER BY s.scored_at DESC,p.id ASC LIMIT 8') if 'scored_at' in scols else []
  acols=columns('applications'); events=[]
  if 'applied_at' in acols:
   events=[{'appliedAt':row['applied_at'],'response':row['response'] if 'response' in acols else None,'responseAt':row['response_at'] if 'response_at' in acols else None} for row in many('SELECT * FROM applications WHERE applied_at IS NOT NULL ORDER BY applied_at ASC,id ASC')]
 except sqlite3.Error: fail('positions_unavailable')
 data={'stats':stats,'distribution':distribution,'sources':sources,'types':types,'recent':recent,'points':{'rows':rows,'included':len(rows),'of':active},'events':{'rows':events[-EVENTS:],'included':min(len(events),EVENTS),'of':len(events)}}
 # The core throws away a reply over 2 MiB, and the bytes of a row depend on its text (a non-ASCII
 # character is six bytes once serialized): the reply is cut to a byte budget, newest rows kept, and
 # `included` says how many are left. The totals are exact whatever is cut.
 BUDGET=1363148
 def size(): return len(json.dumps({'ok':True,'data':data},separators=(',',':')))
 def weight(part): return len(json.dumps(data[part]['rows'],separators=(',',':')))
 while size()>BUDGET:
  part='points' if weight('points')>=weight('events') else 'events'
  rows_=data[part]['rows']
  if not rows_: break
  kept=int(len(rows_)*0.9)
  data[part]['rows']=rows_[-kept:] if part=='events' and kept else rows_[:kept]
  data[part]['included']=kept
 emit({'ok':True,'data':data})
if op=='facets':
 rows=[]
 try:
  for row in db.execute('SELECT p.id,p.status,p.title,p.company,p.role_family,p.loc_country,p.loc_city,s.total_score,a.critic_score,p.source FROM positions p LEFT JOIN scores s ON s.position_id=p.id LEFT JOIN applications a ON a.position_id=p.id ORDER BY p.id'):
   rows.append({'id':sid(row[0]),'status':row[1],'title':row[2],'company':row[3],'role_family':row[4],'loc_country':row[5],'loc_city':row[6],'score':row[7],'critic_score':row[8],'source':row[9]})
 except sqlite3.Error: fail('positions_unavailable')
 emit({'ok':True,'data':{'items':rows}})
if op=='directives':
 # The standing orders the user gave the team (the board of the Team page), as the web's own local reader gives
 # them: the columns it reads, in its order, at most LIMIT rows with each text bounded. A database without the
 # table, or without its id or text, has none.
 # The reply carries as many as fit in the byte budget of the map's reply (what the app takes is 2 MiB), in that
 # order, and says when it stopped short: a team with a great many long orders gets the first ones, never a failure.
 LIMIT=500; BUDGET=1363148
 try:
  have=columns('team_directives'); wanted=[name for name in ('id','body','kind','status','sort_order','created_by','created_at','updated_at','archived_at') if name in have]
  order=', '.join(name+' ASC' for name in ('status','sort_order','created_at') if name in have)
  items=[]; used=0; truncated=False
  if 'id' in wanted and 'body' in wanted:
   for raw in db.execute('SELECT '+', '.join(wanted)+' FROM team_directives'+(' ORDER BY '+order if order else '')+' LIMIT '+str(LIMIT+1)):
    row=as_dict(raw); row['body']=trunc(row['body'],4000)
    for name in ('kind','status','created_by','created_at','updated_at','archived_at'):
     if name in row: row[name]=trunc(row[name],60)
    used+=len(json.dumps(row,separators=(',',':')))+1
    if len(items)>=LIMIT or (items and used>BUDGET): truncated=True; break
    items.append(row)
 except sqlite3.Error: fail('positions_unavailable')
 emit({'ok':True,'data':{'items':items,'truncated':truncated}})
if op=='team_activity_log':
 # Every event of the team, newest first, each with the position it touched: the Activity log page. The same five
 # sources as `team_activity` (found_at, last_checked, scored_at, written_at, critic_reviewed_at), joined to the position
 # for its title, company and number. Text is cut here; at most EVENTS rows, and the reply is held to a byte budget
 # (the oldest events leave first), so nothing here fails for volume.
 EVENTS=5000; BUDGET=1363148
 sources=(('scout','positions','found_at','found_by','t.id'),('analista','positions','last_checked',None,'t.id'),('scorer','scores','scored_at','scored_by','t.position_id'),('scrittore','applications','written_at','written_by','t.position_id'),('critico','applications','critic_reviewed_at','reviewed_by','t.position_id'))
 try:
  pcols=columns('positions'); items=[]
  for role,table,column,actor,joined in sources:
   have=columns(table)
   if column not in have: continue
   if table!='positions' and 'position_id' not in have: continue
   if actor and actor in have: who='t.'+actor
   elif role=='analista' and 'last_actor' in pcols: who="CASE WHEN t.last_actor LIKE 'analista%' THEN t.last_actor ELSE NULL END"
   else: who='NULL'
   legacy='p.legacy_id' if 'legacy_id' in pcols else 'NULL'
   title='p.title' if 'title' in pcols else 'NULL'; company='p.company' if 'company' in pcols else 'NULL'
   sql='SELECT '+who+' AS actor, t.'+column+' AS ts, p.id AS pid, '+title+' AS title, '+company+' AS company, '+legacy+' AS legacy FROM '+table+' t LEFT JOIN positions p ON p.id='+joined+' WHERE t.'+column+' IS NOT NULL ORDER BY t.'+column+' DESC LIMIT '+str(EVENTS)
   for row in db.execute(sql):
    legacy_id=row['legacy']
    items.append({'role':role,'actor':trunc(row['actor'],40),'ts':trunc(row['ts'],40),'pid':None if row['pid'] is None else sid(row['pid']),'title':trunc(row['title'],200),'company':trunc(row['company'],120),'legacyId':legacy_id if type(legacy_id) is int else None})
  items.sort(key=lambda item:item['ts'] or '',reverse=True); items=items[:EVENTS]
  while items and len(json.dumps({'items':items},separators=(',',':')))>BUDGET: items=items[:max(1,len(items)*3//4)] if len(items)>1 else []
  emit({'ok':True,'data':{'items':items}})
 except sqlite3.Error: fail('positions_unavailable')
if op=='team_activity':
 # What each role of the team did, per day and per instance, in the range asked (at most a year), and the
 # newest events with the position they touched. The columns are the ones the web's own local reader reads
 # (found_at/last_checked of positions, scored_at of scores, written_at and critic_reviewed_at of applications);
 # a database without one of them counts none for it. Counts are made here, so the reply does not grow with the
 # history; the newest EVENTS rows are the feed and the timeline.
 EVENTS=2500; DAYS=366; first=req['from']; last=req['to']
 sources=(('scout','positions','found_at','found_by','id','id'),('analista','positions','last_checked',None,'id','id'),('scorer','scores','scored_at','scored_by','position_id','position_id'),('scrittore','applications','written_at','written_by','position_id','position_id'),('critico','applications','critic_reviewed_at','reviewed_by','position_id','position_id'))
 try:
  from datetime import date
  if (date.fromisoformat(last)-date.fromisoformat(first)).days>DAYS: fail('positions_request_invalid')
 except ValueError: fail('positions_request_invalid')
 try:
  daily=[]; newest=[]
  for role,table,column,actor,pid,_ in sources:
   have=columns(table)
   if column not in have: continue
   who=actor if actor and actor in have else 'NULL'
   where=' FROM '+table+' WHERE '+column+' IS NOT NULL AND substr('+column+',1,10) BETWEEN ? AND ?'
   for row in db.execute('SELECT '+who+' AS actor, substr('+column+',1,10) AS day, COUNT(*) AS n'+where+' GROUP BY actor, day',(first,last)):
    daily.append({'role':role,'actor':trunc(row['actor'],40),'day':row['day'],'n':row['n']})
   for row in db.execute('SELECT '+who+' AS actor, '+column+' AS ts, '+pid+' AS pid'+where+' ORDER BY '+column+' DESC LIMIT '+str(EVENTS),(first,last)):
    newest.append({'role':role,'actor':trunc(row['actor'],40),'ts':trunc(row['ts'],40),'pid':None if row['pid'] is None else sid(row['pid'])})
  # also the last time each instance was seen, whatever the range (the web shows it next to the instance)
  seen=[]
  for role,table,column,actor,pid,_ in sources:
   have=columns(table)
   if column not in have: continue
   who=actor if actor and actor in have else 'NULL'
   for row in db.execute('SELECT '+who+' AS actor, MAX('+column+') AS last FROM '+table+' WHERE '+column+' IS NOT NULL GROUP BY actor'):
    seen.append({'role':role,'actor':trunc(row['actor'],40),'last':trunc(row['last'],40)})
  newest.sort(key=lambda item:item['ts'] or '',reverse=True); newest=newest[:EVENTS]
  # The reply must fit in the byte budget of the map's reply. An instance is a name an agent writes, so there may be
  # a great many: when it does not fit, the feed first shrinks, then the instances that did least are counted under
  # their role (no event is lost from a count), down to no instance at all. Nothing here fails for volume.
  BUDGET=1363148
  def fold(rows,keep,merge):
   if keep is None: return rows
   total={}
   for row in base_daily: total[(row['role'],row['actor'])]=total.get((row['role'],row['actor']),0)+row['n']
   kept=set()
   for role in {key[0] for key in total}:
    ranked=sorted((key for key in total if key[0]==role and key[1] is not None),key=lambda key:(-total[key],key[1]))
    kept.update(ranked[:keep])
   merged={}
   for row in rows:
    key=(row['role'],row['actor'] if (row['role'],row['actor']) in kept else None)+((row['day'],) if 'day' in row else ())
    if key in merged: merge(merged[key],row)
    else: merged[key]=dict(row,actor=key[1])
   return list(merged.values())
  def add_n(into,row): into['n']+=row['n']
  def later(into,row): into['last']=max(into['last'] or '',row['last'] or '') or None
  base_daily,base_seen,base_newest=daily,seen,newest
  for rows,keep in ((EVENTS,None),(500,None),(500,12),(500,6),(500,3),(500,0)):
   newest=base_newest[:rows]; daily=fold(base_daily,keep,add_n); seen=fold(base_seen,keep,later)
   if len(json.dumps({'daily':daily,'newest':newest,'seen':seen},separators=(',',':')))<=BUDGET: break
  else: fail('positions_unavailable')
  pids=[item['pid'] for item in newest[:40] if item['pid'] is not None]
  meta={}
  have=columns('positions'); wanted=[name for name in ('id','legacy_id','title','company') if name in have]
  if pids and 'id' in wanted:
   for row in db.execute('SELECT '+', '.join(wanted)+' FROM positions WHERE id IN ('+','.join('?'*len(pids))+')',[int(pid) for pid in pids if pid.isdigit()]):
    meta[sid(row['id'])]={'legacy_id':row['legacy_id'] if 'legacy_id' in wanted else None,'title':trunc(row['title'],200) if 'title' in wanted else None,'company':trunc(row['company'],120) if 'company' in wanted else None}
 except sqlite3.Error: fail('positions_unavailable')
 emit({'ok':True,'data':{'daily':daily,'newest':newest,'seen':seen,'meta':meta}})
if op=='map':
 # What the globe needs of every position that is not excluded, and nothing else, in the list's order
 # (the pins of one city are laid out by that order). One reply carries as many as fit in the byte
 # budget; `next` is where the following reply starts, null at the end.
 MAP_BUDGET=1363148
 try:
  have=columns('positions')
  pick=', '.join('p.'+name for name in ('id','title','company','status','role_family','location','remote_type','loc_country','loc_city','found_at','office_lat','office_lon','office_address') if name in have)
  scores_by=first_by_position('scores',('total_score',))
  everyone=[]
  for raw in db.execute('SELECT '+pick+" FROM positions p WHERE (p.status IS NULL OR p.status!='excluded') ORDER BY p.found_at DESC,p.id ASC"):
   row=as_dict(raw); score=scores_by.get(row.get('id'))
   everyone.append({'id':sid(row.get('id')),'title':nullable(row,'title'),'company':nullable(row,'company'),'status':nullable(row,'status'),'role_family':nullable(row,'role_family'),'location':nullable(row,'location'),'remote_type':nullable(row,'remote_type'),'loc_country':nullable(row,'loc_country'),'loc_city':nullable(row,'loc_city'),'score':nullable(score,'total_score') if score else None,'found_at':nullable(row,'found_at') or '','office_lat':coord(row.get('office_lat'),90),'office_lon':coord(row.get('office_lon'),180),'office_address':text(row.get('office_address'),160)})
 except sqlite3.Error: fail('positions_unavailable')
 start=req.get('offset',0); items=[]; used=0
 for item in everyone[start:]:
  used+=len(json.dumps(item,separators=(',',':')))+1
  if items and used>MAP_BUDGET: break
  items.append(item)
 reached=start+len(items)
 emit({'ok':True,'data':{'items':items,'total':len(everyone),'next':reached if reached<len(everyone) else None}})
filters=req.get('filters') or {}; allowed={'statuses','remoteTypes','sources','verdicts','families','countries','cities','scoreBands','unscored','criticBands','criticUnscored','writeRequested','scoredOnly','hideExcluded','scam','q','limit','offset','sort','dir'}
if set(filters)-allowed: fail('positions_request_invalid')
if not isinstance(filters,dict) or any(value is None for value in filters.values()): fail('positions_request_invalid')
if matching({},filters) is None: fail('positions_request_invalid')
try:
 rows=[]; section_total=0
 # Only the columns the list shows or filters on (not the job description, the requirements or the
 # notes, which weigh most of a row), and the scores, applications and open tickets read once for all
 # the positions instead of three queries for each one.
 wanted=('id','legacy_id','title','company','location','remote_type','source','found_at','status','role_family','loc_country','loc_city','write_requested','scam_signals','salary_declared_min','salary_declared_max','salary_declared_currency','salary_estimated_min','salary_estimated_max','salary_estimated_currency','office_lat','office_lon','office_address')
 have=columns('positions'); pick=', '.join('p.'+name for name in wanted if name in have)
 scores_by=first_by_position('scores',('total_score',)); applications_by=first_by_position('applications',('critic_score','critic_verdict','applied_at','written_at'))
 open_tickets={row['position_id'] for row in many("SELECT DISTINCT position_id FROM position_tickets WHERE status IN ('open','assigned')")}
 for raw in db.execute('SELECT '+pick+' FROM positions p ORDER BY p.found_at DESC,p.id ASC'):
  position=as_dict(raw); pid=position.get('id'); score=scores_by.get(pid); application=applications_by.get(pid); item=map_position(position,score,application)
  declared=salary(position); pending=pid in open_tickets; item.update({'salary_min':declared[0],'salary_max':declared[1],'salary_currency':declared[2] or 'EUR','applied_at':nullable(application,'applied_at') if application else None,'written_at':nullable(application,'written_at') if application else None,'has_open_ticket':pending,'ticket_indicator':'pending' if pending else 'none','public_state':state(position.get('status')),'office_lat':coord(position.get('office_lat'),90),'office_lon':coord(position.get('office_lon'),180),'office_address':text(position.get('office_address'),160)})
  matched=matching(item,filters)
  if matched is None: fail('positions_request_invalid')
  if matched:
   section=(item.get('scam_signals') or {}).get('bucket')=='section'
   if section: section_total+=1
   if filters.get('scam') and section!=(filters['scam']=='only'): continue
   rows.append(item)
except sqlite3.Error: fail('positions_unavailable')
rows=sort_items(rows,filters)
limit=filters.get('limit'); offset=filters.get('offset',0)
if limit is not None and (type(limit) is not int or not 1<=limit<=600): fail('positions_request_invalid')
if type(offset) is not int or not 0<=offset<=100000: fail('positions_request_invalid')
window=rows[offset:offset+limit] if limit is not None else rows[offset:]
emit({'ok':True,'data':{'items':[light(item) for item in window],'total':len(rows),'scamSection':section_total}})
"#;
