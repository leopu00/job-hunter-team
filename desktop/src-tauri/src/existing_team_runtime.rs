//! Account-scoped, producer-delivered target for an already existing team.
//!
//! The candidate is written outside the renderer from a custodial receipt.
//! The app only activates it after the existing-team identity probe succeeds.
//! A legacy container name is never a fallback for a selected VPS target.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    runtime_host::{
        run_ssh_command, set_private_dir_permissions, set_private_permissions, ExecutionHost,
        ProcessResult,
    },
    vps_link,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

const CANDIDATE_FILE: &str = "existing-team-runtime-candidate.json";
const SELECTION_FILE: &str = "existing-team-runtime-selection.json";
const MAX_BYTES: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(15);

const POSITIONS_READ_PY: &str = r#"import json,sqlite3,sys,re
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
def columns(table):
 try: return {row[1] for row in db.execute('PRAGMA table_info('+table+')')}
 except sqlite3.Error: return set()
def map_position(row,score=None,application=None,full=False):
 out={'id':sid(row.get('id')),'legacy_id':nullable(row,'legacy_id'),'title':nullable(row,'title'),'company':nullable(row,'company'),'company_id':sid(row.get('company_id')) if row.get('company_id') else None,'location':nullable(row,'location'),'remote_type':nullable(row,'remote_type'),'salary_declared_min':nullable(row,'salary_declared_min'),'salary_declared_max':nullable(row,'salary_declared_max'),'salary_declared_currency':nullable(row,'salary_declared_currency'),'salary_estimated_min':nullable(row,'salary_estimated_min'),'salary_estimated_max':nullable(row,'salary_estimated_max'),'salary_estimated_currency':nullable(row,'salary_estimated_currency'),'salary_estimated_source':nullable(row,'salary_estimated_source'),'url':nullable(row,'url'),'source':nullable(row,'source'),'jd_text':nullable(row,'jd_text'),'jd_summary':nullable(row,'jd_summary'),'requirements':nullable(row,'requirements'),'found_by':nullable(row,'found_by'),'found_at':nullable(row,'found_at') or '','deadline':nullable(row,'deadline'),'status':nullable(row,'status'),'notes':nullable(row,'notes'),'last_checked':nullable(row,'last_checked'),'role_family':nullable(row,'role_family'),'loc_country':nullable(row,'loc_country'),'loc_city':nullable(row,'loc_city')}
 if full:
  out.update({'write_requested':truthy(row,'write_requested'),'write_requested_at':nullable(row,'write_requested_at'),'write_request_kind':nullable(row,'write_request_kind'),'geocode_requested':truthy(row,'geocode_requested'),'geocode_requested_at':nullable(row,'geocode_requested_at'),'office_geocoded':truthy(row,'office_geocoded'),'user_excluded_reason':nullable(row,'user_excluded_reason'),'user_excluded_note':nullable(row,'user_excluded_note'),'user_excluded_at':nullable(row,'user_excluded_at'),'user_excluded_prev_status':nullable(row,'user_excluded_prev_status'),'recheck_requested':truthy(row,'recheck_requested'),'recheck_requested_at':nullable(row,'recheck_requested_at'),'apply_requested':truthy(row,'apply_requested'),'apply_requested_at':nullable(row,'apply_requested_at'),'apply_requested_by':nullable(row,'apply_requested_by'),'last_open_check':nullable(row,'last_open_check')})
 else:
  out.update({'write_requested':truthy(row,'write_requested'),'score':nullable(score,'total_score') if score else None,'critic_score':nullable(application,'critic_score') if application else None,'critic_verdict':nullable(application,'critic_verdict') if application else None})
  if score and score.get('stack_match') is not None: out['scores']=map_score(score)
 return out
def map_score(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'total_score':row.get('total_score'),'stack_match':nullable(row,'stack_match'),'remote_fit':nullable(row,'remote_fit'),'salary_fit':nullable(row,'salary_fit'),'experience_fit':nullable(row,'experience_fit'),'strategic_fit':nullable(row,'strategic_fit'),'breakdown':nullable(row,'breakdown'),'notes':nullable(row,'notes'),'scored_by':nullable(row,'scored_by'),'scored_at':nullable(row,'scored_at') or ''}
def map_company(row): return {'id':sid(row.get('id')),'name':row.get('name'),'website':nullable(row,'website'),'hq':nullable(row,'hq_country'),'sector':nullable(row,'sector'),'size':nullable(row,'size'),'glassdoor_rating':nullable(row,'glassdoor_rating'),'red_flags':nullable(row,'red_flags'),'culture_notes':nullable(row,'culture_notes'),'analyzed_by':nullable(row,'analyzed_by'),'analyzed_at':nullable(row,'analyzed_at'),'verdict':nullable(row,'verdict'),'logo':nullable(row,'logo')}
def map_application(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'cv_path':nullable(row,'cv_path'),'cl_path':nullable(row,'cl_path'),'cv_pdf_path':nullable(row,'cv_pdf_path'),'cl_pdf_path':nullable(row,'cl_pdf_path'),'cv_drive_id':nullable(row,'cv_drive_id'),'cl_drive_id':nullable(row,'cl_drive_id'),'critic_verdict':nullable(row,'critic_verdict'),'critic_score':nullable(row,'critic_score'),'critic_notes':nullable(row,'critic_notes'),'status':nullable(row,'status'),'written_at':nullable(row,'written_at'),'applied_at':nullable(row,'applied_at'),'applied_via':nullable(row,'applied_via'),'response':nullable(row,'response'),'response_at':nullable(row,'response_at'),'written_by':nullable(row,'written_by'),'reviewed_by':nullable(row,'reviewed_by'),'applied':truthy(row,'applied'),'interview_round':nullable(row,'interview_round')}
def map_ticket(row): return {'id':sid(row.get('id')),'position_id':sid(row.get('position_id')),'request_text':row.get('request_text'),'kind':nullable(row,'kind') or 'custom','status':row.get('status'),'assigned_agent':nullable(row,'assigned_agent'),'response_text':nullable(row,'response_text'),'created_at':nullable(row,'created_at'),'resolved_at':nullable(row,'resolved_at')}
def state(status): return {'writing':'preparing','review':'preparing'}.get(status,status if status in ('new','checked','scored','ready','applied','response','excluded') else 'needs_attention')
def salary(row):
 declared=row.get('salary_declared_min') is not None or row.get('salary_declared_max') is not None
 return ((row.get('salary_declared_min'),row.get('salary_declared_max'),row.get('salary_declared_currency')) if declared else (row.get('salary_estimated_min'),row.get('salary_estimated_max'),row.get('salary_estimated_currency')))
def ticket_count(pid):
 row=one("SELECT COUNT(*) AS n FROM position_tickets WHERE position_id=? AND status IN ('open','assigned')",(pid,))
 return int(row.get('n',0)) if row else 0
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
LIST_KEYS=('id','legacy_id','title','company','location','remote_type','source','found_at','status','role_family','loc_country','loc_city','score','critic_score','critic_verdict','written_at','applied_at','salary_min','salary_max','salary_currency','has_open_ticket','ticket_indicator','public_state','write_requested','office_lat','office_lon','office_address')
def light(item): return {key:item.get(key) for key in LIST_KEYS}
try: req=json.loads(sys.stdin.readline())
except Exception: fail('positions_request_invalid')
if not isinstance(req,dict) or set(req)-{'op','filters','id'}: fail('positions_request_invalid')
op=req.get('op')
if op not in ('list','detail','facets','stats','profile'): fail('positions_request_invalid')
if op=='detail' and (set(req)!={'op','id'} or not isinstance(req['id'],str) or not req['id'].isdigit() or len(req['id'])>20): fail('positions_request_invalid')
if op in ('facets','stats','profile') and set(req)!={'op'}: fail('positions_request_invalid')
if op=='list' and (set(req)-{'op','filters'} or (req.get('filters') is not None and not isinstance(req.get('filters'),dict))): fail('positions_request_invalid')
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
try:
 db=sqlite3.connect('file:/jht_home/jobs.db?mode=ro',uri=True); db.row_factory=sqlite3.Row; db.execute('PRAGMA query_only=ON'); db.execute('SELECT 1 FROM positions LIMIT 1')
except Exception: fail('positions_unavailable')
if op=='detail': emit({'ok':True,'data':position_detail(int(req['id']))})
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
def dash_rows(sql,args=()):
 out=[]
 for raw in many(sql,args):
  pid=raw.get('id'); out.append(dash_row(raw,one('SELECT * FROM scores WHERE position_id=?',(pid,)),one('SELECT * FROM applications WHERE position_id=?',(pid,))))
 return out
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
  rows=dash_rows('SELECT p.* FROM positions p WHERE '+live+' ORDER BY p.found_at DESC,p.id ASC LIMIT '+str(POINTS))
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
filters=req.get('filters') or {}; allowed={'statuses','remoteTypes','sources','verdicts','families','countries','cities','scoreBands','unscored','criticBands','criticUnscored','writeRequested','scoredOnly','hideExcluded','q','limit','offset','sort','dir'}
if set(filters)-allowed: fail('positions_request_invalid')
if not isinstance(filters,dict) or any(value is None for value in filters.values()): fail('positions_request_invalid')
if matching({},filters) is None: fail('positions_request_invalid')
try:
 rows=[]
 for raw in db.execute('SELECT p.* FROM positions p ORDER BY p.found_at DESC,p.id ASC'):
  position=as_dict(raw); pid=position.get('id'); score=one('SELECT * FROM scores WHERE position_id=?',(pid,)); application=one('SELECT * FROM applications WHERE position_id=?',(pid,)); item=map_position(position,score,application)
  declared=salary(position); pending=ticket_count(pid)>0; item.update({'salary_min':declared[0],'salary_max':declared[1],'salary_currency':declared[2] or 'EUR','applied_at':nullable(application,'applied_at') if application else None,'written_at':nullable(application,'written_at') if application else None,'has_open_ticket':pending,'ticket_indicator':'pending' if pending else 'none','public_state':state(position.get('status')),'office_lat':coord(position.get('office_lat'),90),'office_lon':coord(position.get('office_lon'),180),'office_address':text(position.get('office_address'),160)})
  matched=matching(item,filters)
  if matched is None: fail('positions_request_invalid')
  if matched: rows.append(item)
except sqlite3.Error: fail('positions_unavailable')
rows=sort_items(rows,filters)
limit=filters.get('limit'); offset=filters.get('offset',0)
if limit is not None and (type(limit) is not int or not 1<=limit<=600): fail('positions_request_invalid')
if type(offset) is not int or not 0<=offset<=100000: fail('positions_request_invalid')
window=rows[offset:offset+limit] if limit is not None else rows[offset:]
emit({'ok':True,'data':{'items':[light(item) for item in window],'total':len(rows)}})
"#;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeTarget {
    pub(crate) container_id: String,
    pub(crate) image_id: String,
    pub(crate) platform_image_id: String,
    pub(crate) oci_revision: String,
    pub(crate) digest: String,
    pub(crate) os: String,
    pub(crate) architecture: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
enum PositionsRequest {
    List {
        #[serde(skip_serializing_if = "Option::is_none")]
        filters: Option<PositionFilters>,
    },
    Detail {
        id: String,
    },
    Facets,
    Stats,
    Profile,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PositionFilters {
    #[serde(skip_serializing_if = "Option::is_none")]
    statuses: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remote_types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verdicts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    families: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    countries: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    score_bands: Option<Vec<ScoreBand>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unscored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    critic_bands: Option<Vec<ScoreBand>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    critic_unscored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    write_requested: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scored_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hide_excluded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    offset: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dir: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ScoreBand {
    lo: f64,
    hi: f64,
}

impl PositionFilters {
    fn valid_strings(values: &Option<Vec<String>>) -> bool {
        values.as_ref().map_or(true, |values| {
            (1..=32).contains(&values.len())
                && values.iter().all(|value| (1..=80).contains(&value.len()))
        })
    }

    fn valid_bands(values: &Option<Vec<ScoreBand>>) -> bool {
        values.as_ref().map_or(true, |values| {
            values.len() <= 32
                && values
                    .iter()
                    .all(|band| band.lo.is_finite() && band.hi.is_finite() && band.lo <= band.hi)
        })
    }

    fn valid(&self) -> bool {
        [
            &self.statuses,
            &self.remote_types,
            &self.sources,
            &self.verdicts,
            &self.families,
            &self.countries,
            &self.cities,
        ]
        .into_iter()
        .all(Self::valid_strings)
            && Self::valid_bands(&self.score_bands)
            && Self::valid_bands(&self.critic_bands)
            && self.q.as_ref().map_or(true, |value| value.len() <= 120)
            && self.limit.map_or(true, |value| (1..=600).contains(&value))
            && self.offset.map_or(true, |value| value <= 100_000)
            && self.sort.as_ref().map_or(true, |value| {
                matches!(
                    value.as_str(),
                    "id" | "score"
                        | "salary"
                        | "monthly"
                        | "last_action_by"
                        | "critic"
                        | "found_at"
                        | "last_action_at"
                        | "status"
                        | "written_at"
                        | "applied_at"
                        | "title"
                        | "company"
                        | "role_family"
                        | "source"
                        | "location"
                        | "remote"
                        | "loc_country"
                        | "loc_city"
                )
            })
            && self
                .dir
                .as_ref()
                .map_or(true, |value| matches!(value.as_str(), "asc" | "desc"))
    }
}

impl PositionsRequest {
    fn valid(&self) -> bool {
        match self {
            Self::List { filters } => filters.as_ref().map_or(true, PositionFilters::valid),
            Self::Detail { id } => {
                (1..=20).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit())
            }
            Self::Facets | Self::Stats | Self::Profile => true,
        }
    }
}

fn object_or_null(value: Option<&Value>) -> bool {
    value.is_some_and(|value| value.is_null() || value.is_object())
}

fn array(value: Option<&Value>) -> bool {
    value.is_some_and(Value::is_array)
}

fn valid_positions_reply(request: &PositionsRequest, reply: &Value) -> bool {
    let Some(object) = reply.as_object() else {
        return false;
    };
    if object.get("ok").and_then(Value::as_bool) != Some(true) || object.len() != 2 {
        return false;
    }
    let Some(data) = object.get("data") else {
        return false;
    };
    match request {
        PositionsRequest::List { .. } | PositionsRequest::Facets => data
            .as_object()
            .and_then(|data| data.get("items"))
            .is_some_and(|items| {
                items
                    .as_array()
                    .is_some_and(|items| items.iter().all(|item| item.is_object()))
            }),
        PositionsRequest::Stats => data.as_object().is_some_and(|data| {
            data.len() == 7
                && ["stats", "distribution"]
                    .iter()
                    .all(|key| data.get(*key).is_some_and(Value::is_object))
                && ["sources", "types", "recent"]
                    .iter()
                    .all(|key| array(data.get(*key)))
                && ["points", "events"].iter().all(|key| {
                    data.get(*key).and_then(Value::as_object).is_some_and(|part| {
                        array(part.get("rows"))
                            && part.get("included").is_some_and(Value::is_u64)
                            && part.get("of").is_some_and(Value::is_u64)
                    })
                })
        }),
        PositionsRequest::Profile => data.as_object().is_some_and(|data| {
            data.len() == 2
                && data
                    .get("profile")
                    .and_then(Value::as_object)
                    .is_some_and(|profile| profile.get("state").is_some_and(Value::is_string))
                && data.get("summaries").and_then(Value::as_object).is_some_and(|summaries| {
                    summaries.get("state").is_some_and(Value::is_string)
                        && array(summaries.get("items"))
                        && summaries.get("included").is_some_and(Value::is_u64)
                        && summaries.get("of").is_some_and(Value::is_u64)
                })
        }),
        PositionsRequest::Detail { .. } => {
            data.is_null()
                || data.as_object().is_some_and(|data| {
                    data.len() == 8
                        && data.get("position").is_some_and(Value::is_object)
                        && object_or_null(data.get("score"))
                        && array(data.get("highlights"))
                        && object_or_null(data.get("company"))
                        && object_or_null(data.get("application"))
                        && array(data.get("tickets"))
                        && object_or_null(data.get("userNote"))
                        && data
                            .get("exclusionEventAt")
                            .is_some_and(|value| value.is_null() || value.is_string())
                })
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Candidate {
    schema: u8,
    host: ExecutionHost,
    team_id: String,
    runtime: RuntimeTarget,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    schema: u8,
    host: ExecutionHost,
    team_id: String,
    candidate_sha256: String,
}

/// A valid saved selection, read by the rules of every read of one: the host,
/// the team and the SHA-256 of every byte of the candidate it was made from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SavedSelection {
    pub(crate) host: ExecutionHost,
    pub(crate) team_id: String,
    pub(crate) candidate_sha256: String,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ActivatedTarget {
    pub(crate) team_id: String,
    pub(crate) runtime: RuntimeTarget,
    candidate_sha256: String,
}

impl ActivatedTarget {
    #[cfg(test)]
    pub(crate) fn synthetic_for_tests() -> Self {
        Self {
            team_id: "t".repeat(16),
            runtime: RuntimeTarget {
                container_id: "a".repeat(64),
                image_id: format!("sha256:{}", "b".repeat(64)),
                platform_image_id: format!("sha256:{}", "c".repeat(64)),
                oci_revision: "d".repeat(40),
                digest: format!("sha256:{}", "e".repeat(64)),
                os: "linux".into(),
                architecture: "amd64".into(),
            },
            candidate_sha256: "f".repeat(64),
        }
    }

    pub(crate) fn candidate_sha256(&self) -> &str {
        &self.candidate_sha256
    }
}

/// The identity of a read-only connection, as one opaque value the renderer may hold: the account
/// scope and the candidate's SHA-256 (the candidate's bytes carry the host, the team and the
/// container). Two connections that differ in any of them never share a key.
pub(crate) fn connection_key(scope: &AccountScope, target: &ActivatedTarget) -> String {
    sha256(format!("{}\n{}", scope.digest(), target.candidate_sha256).as_bytes())
}

pub(crate) fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn team_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

pub(crate) fn valid_target(target: &RuntimeTarget) -> bool {
    hex(&target.container_id, 64)
        && target
            .image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target
            .platform_image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.platform_image_id != target.image_id
        && hex(&target.oci_revision, 40)
        && target
            .digest
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.os == "linux"
        && matches!(target.architecture.as_str(), "amd64" | "arm64")
}

fn account_dir(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts").join(scope.digest())
}

fn path(root: &Path, scope: &AccountScope, name: &str) -> PathBuf {
    account_dir(root, scope).join(name)
}

fn private_file(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            missing
        } else {
            invalid
        }
    })?;
    let parent = path.parent().ok_or(invalid)?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|_| invalid)?;
    if meta.file_type().is_symlink()
        || !meta.file_type().is_file()
        || meta.len() == 0
        || meta.len() > MAX_BYTES as u64
        || parent_meta.file_type().is_symlink()
        || !parent_meta.is_dir()
    {
        return Err(invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.uid() != unsafe { libc::geteuid() }
            || meta.uid() != parent_meta.uid()
            || meta.permissions().mode() & 0o777 != 0o600
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err(invalid);
        }
    }
    Ok(())
}

fn read_bytes(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<Vec<u8>, &'static str> {
    private_file(path, missing, invalid)?;
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|_| invalid)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid);
    }
    Ok(bytes)
}

pub(crate) fn root(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "existing_team_runtime_unavailable")
}

/// Validates candidate bytes in memory: the same rules `read_candidate_at`
/// applies on every read, so a writer can check what it is about to publish.
pub(crate) fn parse_candidate_bytes(bytes: &[u8]) -> Result<Candidate, &'static str> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "existing_team_runtime_candidate_invalid")?;
    let candidate: Candidate = serde_json::from_value(value.clone())
        .map_err(|_| "existing_team_runtime_candidate_invalid")?;
    if value
        != serde_json::to_value(&candidate)
            .map_err(|_| "existing_team_runtime_candidate_invalid")?
        || candidate.schema != 1
        || !team_id(&candidate.team_id)
        || !valid_target(&candidate.runtime)
    {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(candidate)
}

fn read_candidate_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(Candidate, String), &'static str> {
    let bytes = read_bytes(
        &path(root, scope, CANDIDATE_FILE),
        "existing_team_runtime_candidate_required",
        "existing_team_runtime_candidate_invalid",
    )?;
    let candidate = parse_candidate_bytes(&bytes)?;
    Ok((candidate, sha256(&bytes)))
}

/// Reads the producer-delivered candidate and binds it to the explicit
/// existing-team request. It does not activate or persist anything.
pub(crate) fn candidate_for_request(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<ActivatedTarget, &'static str> {
    candidate_for_request_at(&root(app)?, scope, host, team)
}

pub(crate) fn candidate_for_request_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<ActivatedTarget, &'static str> {
    let (candidate, candidate_sha256) = read_candidate_at(root, scope)?;
    if candidate.host != *host || candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    Ok(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256,
    })
}

/// Whether this scope has a candidate and whether it has a selection (a file of
/// any kind counts, even an invalid one or a dangling symlink). Local only.
pub(crate) fn saved_binding_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(bool, bool), &'static str> {
    let present = |name: &str| match fs::symlink_metadata(path(root, scope, name)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("existing_team_runtime_unavailable"),
    };
    Ok((present(CANDIDATE_FILE)?, present(SELECTION_FILE)?))
}

/// The host and team of the candidate this scope has, for the backend's own use
/// (reopening a saved team). It never leaves the backend: no command returns it.
pub(crate) fn candidate_identity_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(ExecutionHost, String), &'static str> {
    let (candidate, _) = read_candidate_at(root, scope)?;
    Ok((candidate.host, candidate.team_id))
}

/// Gets the custodial host only after binding it to the explicit team id.
/// The CLI companion never accepts a host, target or pin from stdin.
pub(crate) fn candidate_host_for_team(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    team: &str,
) -> Result<(ExecutionHost, ActivatedTarget), &'static str> {
    let (candidate, candidate_sha256) = read_candidate_at(&root(app)?, scope)?;
    if candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    let target = ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256,
    };
    Ok((candidate.host, target))
}

fn candidate_matches_probed(
    candidate: &Candidate,
    candidate_sha256: &str,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> bool {
    candidate.host == *host
        && candidate.team_id == probed.team_id
        && candidate.runtime == probed.runtime
        && candidate_sha256 == probed.candidate_sha256
}

fn selection_may_be_absent(
    host: &ExecutionHost,
    candidate_exists: bool,
) -> Result<(), &'static str> {
    if candidate_exists || matches!(host, ExecutionHost::Vps { .. }) {
        Err("existing_team_runtime_selection_required")
    } else {
        Ok(())
    }
}

fn write_selection_at(
    root: &Path,
    scope: &AccountScope,
    candidate: &Candidate,
    hash: &str,
) -> Result<(), &'static str> {
    let parent = account_dir(root, scope);
    fs::create_dir_all(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    set_private_dir_permissions(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    let destination = path(root, scope, SELECTION_FILE);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("existing_team_runtime_already_selected");
    }
    let payload = serde_json::to_vec(&Selection {
        schema: 1,
        host: candidate.host.clone(),
        team_id: candidate.team_id.clone(),
        candidate_sha256: hash.to_owned(),
    })
    .map_err(|_| "existing_team_runtime_unavailable")?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "existing_team_runtime_unavailable")?
        .as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "existing_team_runtime_unavailable")?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(&payload)
            .map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all()
            .map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "existing_team_runtime_unavailable")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

/// What the in-app registration may do in this scope. Decided locally, before a
/// single SSH call, by ONE predicate that discover and register both use.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RegistrationGate {
    /// Neither a candidate nor a selection: a new candidate may be published.
    Fresh,
    /// A valid selection and no candidate: only the candidate whose bytes the
    /// selection attests may be published back. The selection is never written.
    Restore(SavedSelection),
}

/// A candidate of ANY kind (invalid, a symlink, even a dangling one) means the
/// existing path owns this scope. So does a selection that is not a valid
/// private one: only a valid selection without its candidate can be restored.
pub(crate) fn registration_gate_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<RegistrationGate, &'static str> {
    match fs::symlink_metadata(path(root, scope, CANDIDATE_FILE)) {
        Ok(_) => return Err("existing_team_runtime_candidate_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    match fs::symlink_metadata(path(root, scope, SELECTION_FILE)) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RegistrationGate::Fresh)
        }
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    // One read, with the rules of `selected_at` (O_NOFOLLOW, private, canonical).
    read_selection_at(root, scope)
        .map(RegistrationGate::Restore)
        .map_err(|_| "existing_team_runtime_already_selected")
}

/// The exact bytes of a candidate for this host, team and verified runtime and
/// their SHA-256, validated in memory by the same rules every read applies.
pub(crate) fn candidate_bytes(
    host: &ExecutionHost,
    team: &str,
    runtime: &RuntimeTarget,
) -> Result<(Vec<u8>, String), &'static str> {
    let candidate = Candidate {
        schema: 1,
        host: host.clone(),
        team_id: team.to_owned(),
        runtime: runtime.clone(),
    };
    let bytes =
        serde_json::to_vec(&candidate).map_err(|_| "existing_team_runtime_candidate_invalid")?;
    // Every read refuses more than MAX_BYTES: never publish what could not be read back.
    if bytes.len() > MAX_BYTES || parse_candidate_bytes(&bytes)? != candidate {
        return Err("existing_team_runtime_candidate_invalid");
    }
    let hash = sha256(&bytes);
    Ok((bytes, hash))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CandidateWrite {
    Written,
    /// The definitive file appeared first with exactly these bytes (a second
    /// registration that raced this one).
    Identical,
}

/// Publishes a candidate without ever replacing one. The bytes are validated in
/// memory and again on the private temporary file BEFORE `hard_link` makes them
/// definitive and immutable; the link fails if the definitive file exists, and
/// there is no fallback to `rename`, which would overwrite. It never creates
/// the account directory: the confirmed SSH pin already lives inside it.
pub(crate) fn write_candidate_at(
    root: &Path,
    scope: &AccountScope,
    bytes: &[u8],
) -> Result<CandidateWrite, &'static str> {
    write_candidate_hooked(root, scope, bytes, &mut || {})
}

/// `before_link` runs once the bytes are staged and validated, right before
/// the definitive file is created: the window a concurrent writer can use.
pub(crate) fn write_candidate_hooked(
    root: &Path,
    scope: &AccountScope,
    bytes: &[u8],
    before_link: &mut dyn FnMut(),
) -> Result<CandidateWrite, &'static str> {
    parse_candidate_bytes(bytes)?;
    let parent = account_dir(root, scope);
    let parent_meta =
        fs::symlink_metadata(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    if parent_meta.file_type().is_symlink() || !parent_meta.is_dir() {
        return Err("existing_team_runtime_unavailable");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if parent_meta.uid() != unsafe { libc::geteuid() }
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err("existing_team_runtime_unavailable");
        }
    }
    let destination = path(root, scope, CANDIDATE_FILE);
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Err("existing_team_runtime_candidate_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "existing_team_runtime_unavailable")?
        .as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "existing_team_runtime_unavailable")?;
    let staged = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(bytes)
            .map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all()
            .map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        let staged = read_bytes(
            &temporary,
            "existing_team_runtime_unavailable",
            "existing_team_runtime_unavailable",
        )?;
        if staged != bytes {
            return Err("existing_team_runtime_unavailable");
        }
        parse_candidate_bytes(&staged)?;
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    before_link();
    let linked = fs::hard_link(&temporary, &destination);
    let _ = fs::remove_file(&temporary);
    match linked {
        Ok(()) => {
            let published = read_bytes(
                &destination,
                "existing_team_runtime_unavailable",
                "existing_team_runtime_unavailable",
            )?;
            if published == bytes {
                Ok(CandidateWrite::Written)
            } else {
                Err("existing_team_runtime_unavailable")
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            match read_bytes(
                &destination,
                "existing_team_runtime_candidate_conflict",
                "existing_team_runtime_candidate_conflict",
            ) {
                Ok(existing) if existing == bytes => Ok(CandidateWrite::Identical),
                _ => Err("existing_team_runtime_candidate_conflict"),
            }
        }
        Err(_) => Err("existing_team_runtime_unavailable"),
    }
}

/// Called only after the exact host/team identity and both required sessions
/// have passed the read-only remote probe.
pub(crate) fn activate(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    activate_at(&root(app)?, scope, host, probed)
}

pub(crate) fn activate_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    let (candidate, hash) = read_candidate_at(root, scope)?;
    if !candidate_matches_probed(&candidate, &hash, host, probed) {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    write_selection_at(root, scope, &candidate, &hash)
}

/// The one parser of a selection's bytes, for `selected_at` and the
/// registration gate alike: canonical JSON, schema 1, a valid team id and the
/// SHA-256 of a candidate.
fn parse_selection_bytes(bytes: &[u8]) -> Result<SavedSelection, &'static str> {
    let invalid = "existing_team_runtime_selection_invalid";
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    let selection: Selection = serde_json::from_value(value.clone()).map_err(|_| invalid)?;
    if value != serde_json::to_value(&selection).map_err(|_| invalid)?
        || selection.schema != 1
        || !team_id(&selection.team_id)
        || !hex(&selection.candidate_sha256, 64)
    {
        return Err(invalid);
    }
    Ok(SavedSelection {
        host: selection.host,
        team_id: selection.team_id,
        candidate_sha256: selection.candidate_sha256,
    })
}

fn read_selection_at(root: &Path, scope: &AccountScope) -> Result<SavedSelection, &'static str> {
    let bytes = read_bytes(
        &path(root, scope, SELECTION_FILE),
        "existing_team_runtime_selection_invalid",
        "existing_team_runtime_selection_invalid",
    )?;
    parse_selection_bytes(&bytes)
}

/// A local connection without a selection preserves the existing local path.
/// Every VPS operation requires a selection; once present, it must see the
/// same candidate bytes, host and team or fail closed.
pub(crate) fn selected(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    selected_at(&root(app)?, scope, host)
}

pub(crate) fn selected_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    let selection_path = path(root, scope, SELECTION_FILE);
    if let Err(error) = fs::symlink_metadata(&selection_path) {
        return if error.kind() == std::io::ErrorKind::NotFound {
            let candidate_exists = match fs::symlink_metadata(path(root, scope, CANDIDATE_FILE)) {
                Ok(_) => true,
                Err(candidate_error) if candidate_error.kind() == std::io::ErrorKind::NotFound => {
                    false
                }
                Err(_) => return Err("existing_team_runtime_candidate_invalid"),
            };
            selection_may_be_absent(host, candidate_exists)?;
            Ok(None)
        } else {
            Err("existing_team_runtime_selection_invalid")
        };
    }
    let selection = read_selection_at(root, scope)?;
    let (candidate, hash) = read_candidate_at(root, scope)?;
    if selection.host != *host
        || candidate.host != *host
        || selection.team_id != candidate.team_id
        || selection.candidate_sha256 != hash
    {
        return Err("existing_team_runtime_target_changed");
    }
    Ok(Some(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256: hash,
    }))
}

/// Prefixes a source-owned operation with a fresh CID/index/manifest check.
/// The descriptor is intentionally distinct from the container image index.
pub(crate) fn command(target: &RuntimeTarget, operation: &str) -> Result<String, &'static str> {
    if !valid_target(target) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        r#"set -eu
JHT_CID='{cid}'; JHT_IMAGE='{image}'; JHT_PLATFORM_IMAGE='{platform}'; JHT_REVISION='{revision}'; JHT_DIGEST='{digest}'; JHT_PLATFORM='{os}/{architecture}'
JHT_CONTAINER="$(docker inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{index .ImageManifestDescriptor "digest"}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|$JHT_IMAGE|true|$JHT_REVISION|$JHT_PLATFORM_IMAGE" ] || exit 70
JHT_DEFAULT="$(docker image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_DEFAULT" in "$JHT_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
JHT_EXPLICIT="$(docker image inspect --platform "$JHT_PLATFORM" --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_EXPLICIT" in "$JHT_PLATFORM_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
{operation}"#,
        cid = target.container_id,
        image = target.image_id,
        platform = target.platform_image_id,
        revision = target.oci_revision,
        digest = target.digest,
        os = target.os,
        architecture = target.architecture
    ))
}

/// The team id (the account's user id) arrives on stdin and stays on stdin: `printf` is a
/// builtin of the VPS shell, so the pipe into `docker exec -i` puts it on no argument list,
/// which anyone who lists the host's processes could read.
pub(crate) fn team_probe_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        r#"IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
printf '%s\n' "$JHT_EXPECTED_TEAM" | docker exec -i "$JHT_CID" node -e '
const fs=require("fs"), expected=fs.readFileSync(0,"utf8").replace(/\n$/,"");
let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1"); console.log("providerConfigured="+(configured?"1":"0")); console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0")); console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0")); console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' || exit $?
if docker exec "$JHT_CID" tmux has-session -t CAPITANO 2>/dev/null; then JHT_CAPTAIN=1; else JHT_CAPTAIN=0; fi
if docker exec "$JHT_CID" tmux has-session -t ASSISTENTE 2>/dev/null; then JHT_ASSISTANT=1; else JHT_ASSISTANT=0; fi
printf 'captainRunning=%s\nassistantRunning=%s\n' "$JHT_CAPTAIN" "$JHT_ASSISTANT""#,
    )
}

/// Starts the ASSISTENTE session inside the pinned container. It is the script the CLI's
/// `jht team start assistente` runs in a container (`/app/.launcher/start-agent.sh assistente`),
/// reached through `command`, so the container, image, platform and digest are verified first
/// (exit 70 otherwise) and the default container is never named. The script is idempotent
/// (a lock per session, an exact `tmux has-session`), opens the team's provider and injects the
/// one-shot welcome message, which spends the provider account's tokens.
pub(crate) fn assistant_start_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        "docker exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash /app/.launcher/start-agent.sh assistente </dev/null",
    )
}

pub(crate) fn python_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "exec docker exec -i \"$JHT_CID\" python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'")
}

pub(crate) fn delivery_command(
    target: &RuntimeTarget,
    session: &str,
) -> Result<String, &'static str> {
    let session = match session {
        "CAPITANO" | "ASSISTENTE" | "MENTOR" | "SCOUT-1" | "ANALISTA-1" | "SCORER-1"
        | "SCRITTORE-1" | "CRITICO" => session,
        _ => return Err("invalid_agent"),
    };
    command(
        target,
        &format!(
            "docker exec -i \"$JHT_CID\" sh -c 'msg=$(cat); exec jht-tmux-send {session} \"$msg\"'"
        ),
    )
}

/// The full connection of an existing team ("Conferma e collega") in this run of the app: the
/// connection key of the one team the person confirmed. Only the native side of that command
/// sets it, and only when it succeeds. What writes to the team (the chat, the agent controls) is
/// allowed only to a team that holds it: the read-only view activates a target too, and never
/// holds it. It lives in memory: an app run that has not confirmed starts without it, so after a
/// restart it fails closed. The commands that read it must refuse any window but `main` first.
static FULL_LINK: Mutex<Option<String>> = Mutex::new(None);

pub(crate) fn grant_full_link(scope: &AccountScope, target: &ActivatedTarget) {
    if let Ok(mut slot) = FULL_LINK.lock() {
        *slot = Some(connection_key(scope, target));
    }
}

pub(crate) fn full_link_granted(scope: &AccountScope, target: &ActivatedTarget) -> bool {
    FULL_LINK
        .lock()
        .map(|slot| slot.as_deref() == Some(connection_key(scope, target).as_str()))
        .unwrap_or(false)
}

pub(crate) fn revoke_full_link() {
    if let Ok(mut slot) = FULL_LINK.lock() {
        *slot = None;
    }
}

pub(crate) fn snapshot_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "docker exec \"$JHT_CID\" node -e 'const fs=require(\"fs\"); let c={}; try{c=JSON.parse(fs.readFileSync(\"/jht_home/jht.config.json\",\"utf8\"))}catch{}; const p=String(c.active_provider||\"\").toLowerCase(); const marker={claude:\"/jht_home/.claude/.credentials.json\",anthropic:\"/jht_home/.claude/.credentials.json\",codex:\"/jht_home/.codex/auth.json\",openai:\"/jht_home/.codex/auth.json\",kimi:\"/jht_home/.kimi/credentials/kimi-code.json\",moonshot:\"/jht_home/.kimi/credentials/kimi-code.json\"}[p]; const ok=[\"claude\",\"anthropic\",\"codex\",\"openai\",\"kimi\",\"moonshot\"].includes(p); console.log(\"runtimeInstalled=1\\ncontainerRunning=1\\nproviderConfigured=\"+(ok?\"1\":\"0\")+\"\\nproviderAuthenticated=\"+(marker&&fs.existsSync(marker)?\"1\":\"0\")+\"\\nprofileReady=\"+(fs.existsSync(\"/jht_home/profile/ready.flag\")?\"1\":\"0\")+\"\\nassistantWelcomed=\"+(fs.existsSync(\"/jht_home/profile/welcomed.flag\")?\"1\":\"0\"));'")
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

/// A read that failed before anything ran on the VPS, with its kind for the app
/// (vps_link): a pin that no longer reads blocks, anything else is the application.
fn positions_failure(code: &'static str) -> Value {
    vps_link::failure_reply(vps_link::classify_setup_failure(code))
}

fn positions_answer_failure(code: &'static str) -> Value {
    vps_link::failure_reply(vps_link::LinkOutcome { kind: vps_link::LinkKind::Application, code })
}

/// The top-level keys of candidate_profile.yml the candidate's profile is built from: exactly the
/// ones the cloud's own mapper reads (web/lib/profile-yaml-map.ts). Any other key of the file is
/// counted and dropped here, so it never reaches the app or the CLI.
const PROFILE_FIELDS: &[&str] = &[
    "aspirations",
    "birth_year",
    "candidate",
    "certifications",
    "domain_expertise",
    "education",
    "email",
    "experience",
    "experience_months",
    "experience_years",
    "goals",
    "has_degree",
    "industry",
    "interests",
    "languages",
    "location",
    "location_preferences",
    "name",
    "nationality",
    "notes",
    "personal",
    "positioning",
    "preferences",
    "projects",
    "sector_details",
    "seniority_target",
    "skills",
    "strengths",
    "target_role",
    "target_role_category_id",
    "target_roles",
    "target_roles_priority",
    "target_specialty",
    "timezone",
    "work_authorization",
];

/// A YAML anchor (`&name`) and an alias (`*name`) both in the text: expanding aliases can blow a
/// small file up without bound, and the parser does not limit it, so such a file is refused with
/// its own reason instead of being parsed. Prose rarely has both as separate words.
fn profile_has_aliases(text: &str) -> bool {
    let bytes = text.as_bytes();
    let (mut anchor, mut alias) = (false, false);
    for (index, &byte) in bytes.iter().enumerate() {
        if byte != b'&' && byte != b'*' {
            continue;
        }
        let starts_token = index == 0
            || matches!(bytes[index - 1], b' ' | b'\t' | b'\n' | b'\r' | b'[' | b'{' | b',' | b':' | b'-');
        let named = bytes
            .get(index + 1)
            .is_some_and(|next| next.is_ascii_alphanumeric() || matches!(next, b'_' | b'-'));
        if starts_token && named {
            if byte == b'&' {
                anchor = true;
            } else {
                alias = true;
            }
        }
    }
    anchor && alias
}

/// What the profile file says: `("ok", fields, kept, dropped)` with only the whitelisted keys, or
/// the reason it could not be read as a profile, with no field at all.
fn profile_fields(text: &str) -> (&'static str, Value, usize, usize) {
    if profile_has_aliases(text) {
        return ("aliases_unsupported", Value::Null, 0, 0);
    }
    match serde_yaml::from_str::<Value>(text) {
        Ok(Value::Object(top)) => {
            let total = top.len();
            let kept: serde_json::Map<String, Value> = top
                .into_iter()
                .filter(|(key, _)| PROFILE_FIELDS.contains(&key.as_str()))
                .collect();
            let count = kept.len();
            ("ok", Value::Object(kept), count, total - count)
        }
        Ok(_) => ("not_a_mapping", Value::Null, 0, 0),
        Err(_) => ("invalid_yaml", Value::Null, 0, 0),
    }
}

/// The reader sends the profile file as text; the app and the CLI get it as fields. The raw text
/// is dropped here, with the keys outside the whitelist, and the reply says how the file was read
/// (`parse`), how many keys were kept and how many dropped.
fn shape_profile(mut reply: Value) -> Value {
    let Some(profile) = reply
        .get_mut("data")
        .and_then(|data| data.get_mut("profile"))
        .and_then(Value::as_object_mut)
    else {
        return positions_failure("positions_unavailable");
    };
    let text = profile.remove("text");
    let (parse, fields, kept, dropped) = match text.as_ref().and_then(Value::as_str) {
        Some(text) => profile_fields(text),
        None => ("none", Value::Null, 0, 0),
    };
    profile.insert("parse".into(), json!(parse));
    profile.insert("fields".into(), fields);
    profile.insert("kept".into(), json!(kept));
    profile.insert("dropped".into(), json!(dropped));
    reply
}

fn request_has_explicit_null_filter(request: &Value) -> bool {
    let Some(object) = request.as_object() else {
        return false;
    };
    match object.get("filters") {
        None => false,
        Some(Value::Null) => true,
        Some(Value::Object(filters)) => filters.values().any(Value::is_null),
        Some(_) => false,
    }
}

fn parse_positions_request(request: Value) -> Result<PositionsRequest, ()> {
    if request_has_explicit_null_filter(&request) {
        return Err(());
    }
    match serde_json::from_value::<PositionsRequest>(request) {
        Ok(request) if request.valid() => Ok(request),
        _ => Err(()),
    }
}

/// Fixed read-only jobs-db bridge shared by the Tauri command and the
/// one-shot CLI companion. Callers provide only an account scope and typed
/// request; host, target and SQL remain source-owned.
pub(crate) fn positions_read_for_scope(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    request: Value,
) -> Value {
    let request = match parse_positions_request(request) {
        Ok(request) => request,
        Err(()) => return positions_failure("positions_request_invalid"),
    };
    let request_bytes = match serde_json::to_vec(&request) {
        Ok(bytes) if bytes.len() <= 8192 => bytes,
        _ => return positions_failure("positions_request_invalid"),
    };
    let host = match direct_chat::load_persisted_host(app, scope) {
        Ok(host) => host,
        Err(error) => return positions_failure(error),
    };
    let validated = match crate::runtime_host::validate_host_for_scope(app, &host, scope) {
        Ok(validated) => validated,
        Err(error) => return positions_failure(error),
    };
    let target = match selected(app, scope, &host) {
        Ok(Some(target)) => target,
        Ok(None) => return positions_failure("existing_team_runtime_required"),
        Err(error) => return positions_failure(error),
    };
    let command = match python_command(&target.runtime) {
        Ok(command) => command,
        Err(error) => return positions_failure(error),
    };
    // A key found changed stays blocked for this scope and VPS until the person confirms it again: no `ssh`
    // that is refused and no `ssh-keyscan` per read (the memory is vps_link's).
    let (block_key, pinned) = match &validated {
        crate::runtime_host::ValidatedHost::Vps { address, port, .. } => (
            Some(vps_link::block_key(scope.digest(), address, *port)),
            crate::runtime_host::pinned_host_fingerprint(&validated).ok(),
        ),
        crate::runtime_host::ValidatedHost::Local => (None, None),
    };
    read_unless_blocked(block_key, pinned, || {
        positions_read_with(
            &request,
            &request_bytes,
            |input| run_ssh_command(&validated, &command, Some(input), READ_TIMEOUT, None),
            || crate::runtime_host::host_key_matches_pin(&validated),
        )
    })
}

/// Runs the read unless this VPS's key is already known to have changed; remembers the block when the read
/// finds it. `pinned` is the fingerprint of the pin the read goes out against.
fn read_unless_blocked(block_key: Option<String>, pinned: Option<String>, read: impl FnOnce() -> Value) -> Value {
    if let Some(key) = &block_key {
        if vps_link::remembered_block(key, pinned.as_deref()) {
            return vps_link::blocked_reply();
        }
    }
    let reply = read();
    if vps_link::is_key_changed(&reply) {
        if let (Some(key), Some(pinned)) = (&block_key, &pinned) {
            vps_link::remember_block(key, pinned);
        }
    }
    reply
}

/// The read once the host and the pinned target are known: one SSH run, then
/// its reply. A failed run says why, in vps_link's kinds: the network (retried
/// by the app), the team, a team that is not the pinned one, a changed SSH key.
fn positions_read_with(
    request: &PositionsRequest,
    request_bytes: &[u8],
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    key_matches_pin: impl FnOnce() -> Option<bool>,
) -> Value {
    let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(request_bytes);
    input.push(b'\n');
    let output = match run(&input) {
        Ok(output) if output.success() => output,
        failed => {
            return vps_link::failure_reply(vps_link::classify_failure(
                &failed,
                key_matches_pin,
                "positions_unavailable",
            ))
        }
    };
    if output.stdout.len() > 2 * 1024 * 1024 {
        return positions_answer_failure("positions_unavailable");
    }
    let reply: Value = match serde_json::from_slice(&output.stdout) {
        Ok(reply) => reply,
        Err(_) => return positions_answer_failure("positions_unavailable"),
    };
    if valid_positions_reply(request, &reply) {
        return if matches!(request, PositionsRequest::Profile) {
            shape_profile(reply)
        } else {
            reply
        };
    }
    match reply.get("error").and_then(Value::as_str) {
        Some("positions_request_invalid") => positions_answer_failure("positions_request_invalid"),
        _ => positions_answer_failure("positions_unavailable"),
    }
}

/// Fixed read-only jobs-db bridge for the desktop adapter. The renderer sends
/// typed operation data only; it never supplies a host, container or SQL.
#[tauri::command]
pub(crate) async fn existing_team_positions_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(positions_failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        Ok(positions_read_for_scope(&app, &worker_expected, request))
    })
    .await
    .unwrap_or_else(|_| Err("positions_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(positions_failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(positions_failure))
}

/// Which team the desktop reads: the pinned revision and image digest of the
/// saved target, for the header. Local files only, no SSH; values valid_target
/// already checked (40 hex, `sha256:` + 64 hex).
fn link_identity_for_scope(app: &tauri::AppHandle, scope: &AccountScope) -> Value {
    let host = match direct_chat::load_persisted_host(app, scope) {
        Ok(host) => host,
        Err(error) => return positions_failure(error),
    };
    match selected(app, scope, &host) {
        Ok(Some(target)) => json!({
            "ok": true,
            "revision": target.runtime.oci_revision,
            "digest": target.runtime.digest,
        }),
        Ok(None) => positions_failure("existing_team_runtime_required"),
        Err(error) => positions_failure(error),
    }
}

#[tauri::command]
pub(crate) async fn existing_team_link_identity(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(positions_failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        Ok(link_identity_for_scope(&app, &worker_expected))
    })
    .await
    .unwrap_or_else(|_| Err("existing_team_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(positions_failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(positions_failure))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assistant_start_runs_the_launcher_script_in_the_pinned_container_after_its_checks() {
        let runtime = RuntimeTarget {
            container_id: "a".repeat(64),
            image_id: format!("sha256:{}", "b".repeat(64)),
            platform_image_id: format!("sha256:{}", "c".repeat(64)),
            oci_revision: "d".repeat(40),
            digest: format!("sha256:{}", "e".repeat(64)),
            os: "linux".into(),
            architecture: "amd64".into(),
        };
        let command = assistant_start_command(&runtime).expect("a valid target");
        let checks = command.find("exit 70").expect("the pin is checked");
        let script = command.find("bash /app/.launcher/start-agent.sh assistente").expect("the one script");
        assert!(checks < script, "the container is verified before anything runs in it");
        assert!(command.contains("docker exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash"));
        assert!(command.contains(&format!("JHT_CID='{}'", runtime.container_id)));
        assert!(!command.contains("docker exec jht"));
        assert_eq!(command.matches("start-agent.sh").count(), 1);
        // a target that is not a whole, pinned one builds nothing
        let mut broken = runtime.clone();
        broken.platform_image_id = broken.image_id.clone();
        assert_eq!(assistant_start_command(&broken), Err("existing_team_runtime_candidate_invalid"));
    }

    #[test]
    fn profile_request_is_closed_and_the_reader_opens_only_the_two_profile_paths() {
        assert!(matches!(parse_positions_request(json!({"op": "profile"})), Ok(PositionsRequest::Profile)));
        // whatever a caller adds (a path, a file name, a field list) is gone before the reader:
        // the core forwards the parsed request, never the received one
        for extra in [json!({"op": "profile", "path": "/jht_home/x"}), json!({"op": "profile", "filters": {}}), json!({"op": "profile", "id": "1"})] {
            let forwarded = parse_positions_request(extra.clone())
                .map(|request| serde_json::to_value(request).expect("request serializes"));
            assert_eq!(forwarded, Ok(json!({"op": "profile"})), "{extra}");
        }
        assert!(POSITIONS_READ_PY.contains("if op=='profile':"));
        assert!(POSITIONS_READ_PY.contains("PROFILE_DIR+'/candidate_profile.yml'"));
        assert!(POSITIONS_READ_PY.contains("PROFILE_DIR+'/summaries/'"));
        assert!(POSITIONS_READ_PY.contains("os.O_NOFOLLOW"));
        // the neighbours of the profile in the same folder are never named: the provider's
        // configuration, the candidate's original documents, the flags
        let reader = POSITIONS_READ_PY.split("if op=='profile':").nth(1).unwrap().split("db=sqlite3.connect").next().unwrap();
        for forbidden in ["jht.config", "sources", "credentials", "cloud.json", ".claude", ".codex", ".kimi", "ready.flag", "welcomed.flag", "req.get"] {
            assert!(!reader.contains(forbidden), "the profile reader names {forbidden}");
        }
    }

    #[test]
    fn profile_reply_must_have_both_parts_whole() {
        let good = json!({"ok": true, "data": {
            "profile": {"state": "absent"},
            "summaries": {"state": "absent", "items": [], "included": 0, "of": 0}
        }});
        assert!(valid_positions_reply(&PositionsRequest::Profile, &good));
        for broken in [
            json!({"ok": true, "data": {"profile": {"state": "absent"}}}),
            json!({"ok": true, "data": {"profile": {"state": 1}, "summaries": {"state": "ok", "items": [], "included": 0, "of": 0}}}),
            json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": {}, "included": 0, "of": 0}}}),
            json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": [], "included": -1, "of": 0}}}),
            json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": [], "included": 0, "of": 0}, "extra": 1}}),
        ] {
            assert!(!valid_positions_reply(&PositionsRequest::Profile, &broken), "{broken}");
        }
    }

    #[test]
    fn profile_file_is_read_as_whitelisted_fields_and_the_rest_is_counted_and_dropped() {
        let text = "name: Synthetic Person\ntarget_role: Synthetic Role\nskills:\n  primary: [Alpha, Beta]\nprovider_token: synthetic-secret-value\ninternal_note: synthetic\ncandidate:\n  contacts:\n    phone: '000'\n";
        let (parse, fields, kept, dropped) = profile_fields(text);
        assert_eq!((parse, kept, dropped), ("ok", 4, 2));
        let fields = fields.as_object().unwrap();
        assert_eq!(fields.keys().map(String::as_str).collect::<Vec<_>>(), ["candidate", "name", "skills", "target_role"]);
        assert!(!serde_json::to_string(fields).unwrap().contains("synthetic-secret-value"));
    }

    #[test]
    fn profile_file_that_cannot_be_read_says_why_and_gives_no_field() {
        assert_eq!(profile_fields("name: [unclosed").0, "invalid_yaml");
        // a repeated key is not an error to the file's own writer (the last one wins), nor here
        let repeated = profile_fields("name: a\nname: b\n");
        assert_eq!((repeated.0, repeated.1["name"].as_str()), ("ok", Some("b")));
        assert_eq!(profile_fields("- just\n- a list\n").0, "not_a_mapping");
        assert_eq!(profile_fields("").0, "not_a_mapping");
        assert_eq!(profile_fields("12").0, "not_a_mapping");
        let bomb = "a: &a [x, x, x]\nb: &b [*a, *a, *a]\nc: &c [*b, *b, *b]\nd: [*c, *c, *c]\n";
        let (parse, fields, kept, dropped) = profile_fields(bomb);
        assert_eq!((parse, kept, dropped), ("aliases_unsupported", 0, 0));
        assert!(fields.is_null());
        // prose with an asterisk or an ampersand is not an alias
        let prose = "name: Q&A *emphasis* and R&D\nnotes: |\n  * a bullet\n  & more\n";
        assert_eq!(profile_fields(prose).0, "ok");
    }

    #[test]
    fn profile_reply_drops_the_raw_text_and_declares_what_it_did() {
        let reply = json!({"ok": true, "data": {
            "profile": {"state": "ok", "bytes": 20, "sha256": "a".repeat(64), "text": "name: Synthetic\nextra_key: x\n"},
            "summaries": {"state": "ok", "items": [{"name": "about", "state": "ok", "bytes": 3, "sha256": "b".repeat(64), "text": "hi"}], "included": 1, "of": 1}
        }});
        let shaped = shape_profile(reply);
        let profile = &shaped["data"]["profile"];
        assert!(profile.get("text").is_none());
        assert_eq!((profile["parse"].as_str(), profile["kept"].as_u64(), profile["dropped"].as_u64()), (Some("ok"), Some(1), Some(1)));
        assert_eq!(profile["fields"], json!({"name": "Synthetic"}));
        assert!(!shaped.to_string().contains("extra_key"));
        assert_eq!(shaped["data"]["summaries"]["items"][0]["text"], "hi");

        let absent = shape_profile(json!({"ok": true, "data": {"profile": {"state": "absent"}, "summaries": {"state": "absent", "items": [], "included": 0, "of": 0}}}));
        assert_eq!(absent["data"]["profile"]["parse"], "none");
        assert!(absent["data"]["profile"]["fields"].is_null());
    }

    fn target() -> RuntimeTarget {
        RuntimeTarget {
            container_id: "a".repeat(64),
            image_id: format!("sha256:{}", "b".repeat(64)),
            platform_image_id: format!("sha256:{}", "c".repeat(64)),
            oci_revision: "d".repeat(40),
            digest: format!("sha256:{}", "e".repeat(64)),
            os: "linux".into(),
            architecture: "amd64".into(),
        }
    }

    #[test]
    fn the_full_link_belongs_to_the_confirmed_team_in_this_run_only() {
        let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
        let activated = |hash: &str| ActivatedTarget { team_id: "t".repeat(16), runtime: target(), candidate_sha256: hash.to_owned() };
        revoke_full_link();
        assert!(!full_link_granted(&one, &activated("h1")), "an app run that has not confirmed starts without it");
        grant_full_link(&one, &activated("h1"));
        assert!(full_link_granted(&one, &activated("h1")));
        assert!(!full_link_granted(&two, &activated("h1")), "another account never has it");
        assert!(!full_link_granted(&one, &activated("h2")), "nor another candidate of the same account");
        revoke_full_link();
        assert!(!full_link_granted(&one, &activated("h1")));
    }

    #[test]
    fn connection_key_differs_for_another_scope_or_another_candidate_and_only_then() {
        let activated = |hash: &str| ActivatedTarget { team_id: "t".repeat(16), runtime: target(), candidate_sha256: hash.to_owned() };
        let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
        let key = connection_key(&one, &activated(&"1".repeat(64)));
        assert!(hex(&key, 64));
        assert_eq!(key, connection_key(&one, &activated(&"1".repeat(64))));
        assert_ne!(key, connection_key(&two, &activated(&"1".repeat(64))));
        assert_ne!(key, connection_key(&one, &activated(&"2".repeat(64))));
    }

    #[test]
    fn target_command_keeps_container_index_and_platform_descriptor_distinct() {
        let command = command(&target(), "true").unwrap();
        assert!(command.contains("JHT_IMAGE='sha256:"));
        assert!(command.contains("JHT_PLATFORM_IMAGE='sha256:"));
        assert!(command.contains(r#"index .ImageManifestDescriptor "digest""#));
        assert!(command.contains("--platform \"$JHT_PLATFORM\""));
        assert!(!command.contains("docker exec jht"));
        assert!(!command.contains("docker inspect jht"));
    }

    #[test]
    fn target_rejects_equal_index_and_platform_descriptor() {
        let mut invalid = target();
        invalid.platform_image_id = invalid.image_id.clone();
        assert_eq!(
            command(&invalid, "true"),
            Err("existing_team_runtime_candidate_invalid")
        );
    }

    #[test]
    fn positions_request_is_closed_and_supports_complete_filter_shape() {
        let request: PositionsRequest = serde_json::from_value(json!({
            "op": "list",
            "filters": {
                "statuses": ["scored"],
                "remoteTypes": ["full_remote"],
                "verdicts": ["PASS"],
                "families": ["Data"],
                "countries": ["IT"],
                "cities": ["IT|Rome"],
                "scoreBands": [{"lo": 80, "hi": 100}],
                "unscored": false,
                "criticBands": [{"lo": 7, "hi": 10}],
                "criticUnscored": false,
                "writeRequested": true,
                "q": "JHT-42",
                "limit": 50,
                "offset": 0,
                "sort": "score",
                "dir": "desc"
            }
        }))
        .expect("complete filter request parses");
        assert!(request.valid());

        let unknown = serde_json::from_value::<PositionsRequest>(json!({
            "op": "list", "filters": null, "sql": "SELECT 1"
        }));
        assert!(unknown.is_err());
        let malformed = serde_json::from_value::<PositionsRequest>(json!({
            "op": "detail", "id": 42
        }));
        assert!(malformed.is_err());
    }

    #[test]
    fn positions_requests_the_desktop_pages_send_are_accepted_by_the_strict_decoder() {
        // The exact payloads the Positions and Position pages put on the wire
        // (desktop/src/pages/positions/existing-team-readonly.test.tsx records
        // the first one): a refusal here would be a request nobody can read.
        for payload in [
            // the Positions page, default view, first and later page (desktop test pins the same)
            json!({"op": "list", "filters": {"limit": 50, "offset": 0, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true}}),
            json!({"op": "list", "filters": {"limit": 25, "offset": 25, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true}}),
            json!({"op": "list", "filters": {"limit": 600, "offset": 600, "sort": "found_at", "dir": "desc"}}),
            json!({"op": "list", "filters": {"q": "row 07", "sort": "score", "dir": "asc", "limit": 100, "offset": 0}}),
            json!({"op": "list", "filters": {
                "statuses": ["scored", "ready"], "remoteTypes": ["full_remote"], "sources": ["board-a"],
                "verdicts": ["PASS"], "families": ["Data"], "countries": ["IT"], "cities": ["IT|Rome"],
                "scoreBands": [{"lo": 80.5, "hi": 99.5}], "unscored": true,
                "criticBands": [{"lo": 7.5, "hi": 9.5}], "criticUnscored": true,
                "writeRequested": false, "scoredOnly": true, "hideExcluded": false,
                "q": "x", "limit": 600, "offset": 0, "sort": "found_at", "dir": "desc"
            }}),
            json!({"op": "detail", "id": "101"}),
            json!({"op": "facets"}),
            json!({"op": "stats"}),
        ] {
            let request = parse_positions_request(payload.clone())
                .unwrap_or_else(|()| panic!("the decoder refused {payload}"));
            let wire = serde_json::to_vec(&request).expect("request serializes");
            assert!(wire.len() <= 8192);
            // what the native side forwards is what the page asked, nothing added or dropped
            assert_eq!(serde_json::from_slice::<Value>(&wire).expect("wire is json"), payload);
        }
    }

    #[test]
    fn stats_is_a_closed_read_only_op_with_a_composite_reply() {
        assert!(matches!(parse_positions_request(json!({"op": "stats"})), Ok(PositionsRequest::Stats)));
        // serde keeps a unit variant open to extra keys (as it does for `facets`),
        // but the core forwards the parsed request, never the received one: whatever
        // a caller adds is gone before it reaches the reader, which refuses it anyway
        let forwarded = parse_positions_request(json!({"op": "stats", "filters": {}, "id": "1"}))
            .map(|request| serde_json::to_value(request).expect("request serializes"));
        assert_eq!(forwarded, Ok(json!({"op": "stats"})));

        let part = json!({"rows": [], "included": 0, "of": 0});
        let good = json!({"ok": true, "data": {
            "stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
            "points": part, "events": part
        }});
        assert!(valid_positions_reply(&PositionsRequest::Stats, &good));
        for broken in [
            json!({"ok": true, "data": {"items": []}}),
            json!({"ok": true, "data": {"stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [], "points": part}}),
            json!({"ok": true, "data": {"stats": [], "distribution": {}, "sources": [], "types": [], "recent": [], "points": part, "events": part}}),
            json!({"ok": true, "data": {"stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
                "points": {"rows": [], "included": -1, "of": 0}, "events": part}}),
        ] {
            assert!(!valid_positions_reply(&PositionsRequest::Stats, &broken), "{broken}");
        }
        // the Python reader serves this op and nothing else under it
        assert!(POSITIONS_READ_PY.contains("if op=='stats':"));
        assert!(POSITIONS_READ_PY.contains("mode=ro"));
    }

    /// The read of the team's positions says why it failed, in the kinds the header acts on.
    fn read_stats(
        run: Result<ProcessResult, &'static str>,
        key_matches_pin: Option<bool>,
    ) -> (Value, usize) {
        let mut scans = 0;
        let reply = positions_read_with(
            &PositionsRequest::Stats,
            br#"{"op":"stats"}"#,
            |input| {
                // the fixed reader and the request travel on stdin, never in the command
                assert!(input.ends_with(b"{\"op\":\"stats\"}\n"));
                run
            },
            || {
                scans += 1;
                key_matches_pin
            },
        );
        (reply, scans)
    }

    fn exited(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() })
    }

    #[test]
    fn a_failed_positions_read_says_network_application_version_or_blocked() {
        let failure = |code: &str, kind: &str| json!({"ok": false, "error": code, "kind": kind});
        assert_eq!(read_stats(Err("process_timeout"), None), (failure("timeout", "network"), 0));
        assert_eq!(read_stats(exited(255, ""), None), (failure("ssh_unavailable", "network"), 1));
        assert_eq!(read_stats(exited(255, ""), Some(true)), (failure("ssh_unavailable", "network"), 1));
        assert_eq!(read_stats(exited(255, ""), Some(false)), (failure("host_key_changed", "blocked"), 1));
        assert_eq!(
            read_stats(exited(72, ""), Some(false)),
            (failure("existing_team_identity_mismatch", "application"), 0)
        );
        assert_eq!(
            read_stats(exited(70, ""), None),
            (failure("existing_team_runtime_changed", "version"), 0)
        );
        assert_eq!(read_stats(exited(0, "not json"), None), (failure("positions_unavailable", "application"), 0));
        assert_eq!(
            read_stats(exited(0, r#"{"ok":false,"error":"positions_request_invalid"}"#), None),
            (failure("positions_request_invalid", "application"), 0)
        );
        // a pin file that no longer reads blocks before anything runs
        assert_eq!(positions_failure("host_key_mismatch"), failure("host_key_mismatch", "blocked"));
        assert_eq!(positions_failure("host_not_configured"), failure("host_not_configured", "application"));
    }

    #[test]
    fn once_the_key_is_found_changed_the_next_reads_do_not_go_out_until_the_pin_changes() {
        use std::cell::Cell;
        let key = Some(vps_link::block_key("scope-read-test", "vps.example", 22));
        let pin = Some("SHA256:confirmed".to_string());
        let goes_out = Cell::new(0);
        let blocked_read = || {
            goes_out.set(goes_out.get() + 1);
            vps_link::blocked_reply()
        };
        // The first read goes out (ssh, then one keyscan) and finds the key changed.
        let first = read_unless_blocked(key.clone(), pin.clone(), blocked_read);
        assert!(vps_link::is_key_changed(&first));
        assert_eq!(goes_out.get(), 1);
        // The next ones answer at once: no ssh, no keyscan.
        for _ in 0..3 {
            let reply = read_unless_blocked(key.clone(), pin.clone(), blocked_read);
            assert!(vps_link::is_key_changed(&reply));
        }
        assert_eq!(goes_out.get(), 1, "a read that is blocked is not run");
        // The person confirmed the new key: the pin is another one and the read goes out again.
        let reopened = read_unless_blocked(key.clone(), Some("SHA256:reconfirmed".to_string()), || {
            goes_out.set(goes_out.get() + 1);
            json!({"ok": true})
        });
        assert_eq!(reopened, json!({"ok": true}));
        assert_eq!(goes_out.get(), 2);
        // A network failure is never remembered as a block.
        let net = read_unless_blocked(key.clone(), Some("SHA256:reconfirmed".to_string()), || {
            vps_link::failure_reply(vps_link::LinkOutcome { kind: vps_link::LinkKind::Network, code: "timeout" })
        });
        assert_eq!(net["kind"], "network");
        let after_net = read_unless_blocked(key, Some("SHA256:reconfirmed".to_string()), || json!({"ok": true}));
        assert_eq!(after_net, json!({"ok": true}));
    }

    #[test]
    fn a_working_positions_read_is_passed_on_unchanged() {
        let part = json!({"rows": [], "included": 0, "of": 0});
        let good = json!({"ok": true, "data": {
            "stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
            "points": part, "events": part
        }});
        assert_eq!(read_stats(exited(0, &good.to_string()), None), (good, 0));
    }

    #[test]
    fn the_positions_list_carries_the_office_coordinates_only_when_they_are_on_the_globe() {
        let keys = POSITIONS_READ_PY.split("LIST_KEYS=(").nth(1).unwrap().split(')').next().unwrap();
        for key in ["'office_lat'", "'office_lon'", "'office_address'"] {
            assert!(keys.contains(key), "{key} in LIST_KEYS");
        }
        // checked, not passed through: a value off the globe, garbled or absent is None
        assert!(POSITIONS_READ_PY.contains("'office_lat':coord(position.get('office_lat'),90)"));
        assert!(POSITIONS_READ_PY.contains("'office_lon':coord(position.get('office_lon'),180)"));
        assert!(POSITIONS_READ_PY.contains("'office_address':text(position.get('office_address'),160)"));
        assert!(POSITIONS_READ_PY.contains("value==value and -limit<=value<=limit"));
    }

    #[test]
    fn positions_request_omits_absent_filter_options() {
        let request = parse_positions_request(json!({
            "op": "list", "filters": {"q": "engineer"}
        }))
        .expect("query-only request parses");
        let cloned = request.clone();
        assert_eq!(
            serde_json::to_value(cloned).expect("request serializes"),
            json!({"op": "list", "filters": {"q": "engineer"}})
        );
    }

    #[test]
    fn positions_request_rejects_explicit_null_before_serde_normalizes_it() {
        let absent =
            parse_positions_request(json!({"op": "list"})).expect("absent filters remain allowed");
        assert_eq!(
            serde_json::to_value(absent).expect("absent filters serialize"),
            json!({"op": "list"})
        );
        assert!(parse_positions_request(json!({"op": "list", "filters": {"q": null}})).is_err());
        assert!(parse_positions_request(json!({"op": "list", "filters": null})).is_err());
    }

    #[test]
    fn activation_requires_the_candidate_bytes_and_runtime_that_were_probed() {
        let host = ExecutionHost::Local;
        let candidate = Candidate {
            schema: 1,
            host: host.clone(),
            team_id: "team_existing_0123".into(),
            runtime: target(),
        };
        let probed = ActivatedTarget {
            team_id: candidate.team_id.clone(),
            runtime: candidate.runtime.clone(),
            candidate_sha256: "f".repeat(64),
        };
        assert!(candidate_matches_probed(
            &candidate,
            &"f".repeat(64),
            &host,
            &probed
        ));

        let mut changed = candidate.clone();
        changed.runtime.oci_revision = "a".repeat(40);
        assert!(!candidate_matches_probed(
            &changed,
            &"f".repeat(64),
            &host,
            &probed
        ));
        assert!(!candidate_matches_probed(
            &candidate,
            &"e".repeat(64),
            &host,
            &probed
        ));
    }

    #[test]
    fn vps_selection_is_required_while_local_connections_remain_separate() {
        assert_eq!(
            selection_may_be_absent(&ExecutionHost::Local, false),
            Ok(())
        );
        assert_eq!(
            selection_may_be_absent(&ExecutionHost::Local, true),
            Err("existing_team_runtime_selection_required")
        );
        assert_eq!(
            selection_may_be_absent(
                &ExecutionHost::Vps {
                    address: "example.invalid".into(),
                    user: "worker".into(),
                    port: 22,
                    key_path: "/private/key".into(),
                },
                false,
            ),
            Err("existing_team_runtime_selection_required")
        );
    }

    #[test]
    fn embedded_reader_has_fixed_composite_position_projections() {
        for field in [
            "'position':map_position(raw,full=True)",
            "'score':map_score(score) if score else None",
            "'highlights':highlights",
            "'company':map_company(company) if company else None",
            "'application':map_application(application) if application else None",
            "'tickets':tickets",
            "'userNote':note",
            "'exclusionEventAt':excluded.get('ts') if excluded else None",
            "'data':{'items':rows}",
            // the ID column sorts by what the table shows: a row without a legacy id by its own id
            "return legacy if legacy is not None else (int(item['id'])",
            // `stats` is cut to a byte budget, whatever the text of the rows weighs once serialized
            "BUDGET=1363148",
            // the list is a light projection with the matching total, so a page of it
            // stays far under the 2 MiB the core accepts back
            "'data':{'items':[light(item) for item in window],'total':len(rows)}",
            // the sidebar's source list is counted from the facets, one light reply
            "'critic_score':row[8],'source':row[9]}",
        ] {
            assert!(POSITIONS_READ_PY.contains(field), "missing {field}");
        }
        assert!(POSITIONS_READ_PY.contains("mode=ro"));
        assert!(POSITIONS_READ_PY.contains("PRAGMA query_only=ON"));
        assert!(!POSITIONS_READ_PY.contains("req.get('sql')"));
    }

    #[test]
    fn positions_reply_requires_composite_data_envelope() {
        let detail = PositionsRequest::Detail { id: "42".into() };
        assert!(valid_positions_reply(
            &detail,
            &json!({"ok":true,"data":{"position":{},"score":null,"highlights":[],"company":null,"application":null,"tickets":[],"userNote":null,"exclusionEventAt":null}})
        ));
        assert!(!valid_positions_reply(
            &detail,
            &json!({"ok":true,"data":{"position":{}}})
        ));

        let list = PositionsRequest::List { filters: None };
        assert!(valid_positions_reply(
            &list,
            &json!({"ok":true,"data":{"items":[{}]}})
        ));
        assert!(!valid_positions_reply(&list, &json!({"ok":true,"data":[]})));
    }
}
