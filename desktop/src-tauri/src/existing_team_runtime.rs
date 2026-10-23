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
const OWN_VPS_FILE: &str = "own-vps-marker.json";
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
filters=req.get('filters') or {}; allowed={'statuses','remoteTypes','sources','verdicts','families','countries','cities','scoreBands','unscored','criticBands','criticUnscored','writeRequested','scoredOnly','hideExcluded','scam','q','limit','offset','sort','dir'}
if set(filters)-allowed: fail('positions_request_invalid')
if not isinstance(filters,dict) or any(value is None for value in filters.values()): fail('positions_request_invalid')
if matching({},filters) is None: fail('positions_request_invalid')
try:
 rows=[]; section_total=0
 for raw in db.execute('SELECT p.* FROM positions p ORDER BY p.found_at DESC,p.id ASC'):
  position=as_dict(raw); pid=position.get('id'); score=one('SELECT * FROM scores WHERE position_id=?',(pid,)); application=one('SELECT * FROM applications WHERE position_id=?',(pid,)); item=map_position(position,score,application)
  declared=salary(position); pending=ticket_count(pid)>0; item.update({'salary_min':declared[0],'salary_max':declared[1],'salary_currency':declared[2] or 'EUR','applied_at':nullable(application,'applied_at') if application else None,'written_at':nullable(application,'written_at') if application else None,'has_open_ticket':pending,'ticket_indicator':'pending' if pending else 'none','public_state':state(position.get('status')),'office_lat':coord(position.get('office_lat'),90),'office_lon':coord(position.get('office_lon'),180),'office_address':text(position.get('office_address'),160)})
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
    scam: Option<String>,
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
            && self
                .scam
                .as_ref()
                .map_or(true, |value| matches!(value.as_str(), "hide" | "only"))
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

/// What the app's own provisioning of a VPS writes, privately, once the host is set up and its key
/// pinned: the account, the host (address and port) and the fingerprint of the host key it is
/// bound to. It is the positive mark of «a VPS of the person's own»; the absence of other files
/// is not (JHT-T30). Never returned by a command, never read from the renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnVpsMarker {
    schema: u8,
    scope: String,
    address: String,
    port: u16,
    host_key: String,
}

fn own_vps_marker_valid(marker: &OwnVpsMarker) -> bool {
    let key = marker.host_key.as_bytes();
    marker.schema == 1
        && !marker.scope.is_empty()
        && marker.scope.len() <= 128
        && !marker.address.is_empty()
        && marker.address.len() <= 255
        && marker.address == marker.address.trim()
        && marker.port != 0
        && marker.host_key.starts_with("SHA256:")
        && key.len() <= 128
        && key.iter().all(|byte| byte.is_ascii_graphic())
}

/// The marker this scope has, if there is one and it is well formed: a private file of the account,
/// canonical, of this account, and nothing else.
fn read_own_vps_marker_at(root: &Path, scope: &AccountScope) -> Option<OwnVpsMarker> {
    let bytes = read_bytes(
        &path(root, scope, OWN_VPS_FILE),
        "existing_team_runtime_own_vps_missing",
        "existing_team_runtime_own_vps_invalid",
    )
    .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let marker: OwnVpsMarker = serde_json::from_value(value.clone()).ok()?;
    (serde_json::to_value(&marker).ok()? == value && own_vps_marker_valid(&marker) && marker.scope == scope.digest())
        .then_some(marker)
}

/// Writes the marker for the VPS the app has just set up and pinned. Only the provisioning calls it,
/// after the host's key is confirmed: `host_key` is the fingerprint of that pinned key. It replaces the
/// marker of an earlier host of the same account.
pub(crate) fn mark_own_vps_at(
    root: &Path,
    scope: &AccountScope,
    address: &str,
    port: u16,
    host_key: &str,
) -> Result<(), &'static str> {
    let marker = OwnVpsMarker {
        schema: 1,
        scope: scope.digest().to_owned(),
        address: address.trim().to_owned(),
        port,
        host_key: host_key.to_owned(),
    };
    if !own_vps_marker_valid(&marker) {
        return Err("existing_team_runtime_own_vps_invalid");
    }
    let bytes = serde_json::to_vec(&marker).map_err(|_| "existing_team_runtime_unavailable")?;
    let destination = path(root, scope, OWN_VPS_FILE);
    let parent = destination.parent().ok_or("existing_team_runtime_unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "existing_team_runtime_unavailable")?;
    if fs::symlink_metadata(parent).map_err(|_| "existing_team_runtime_unavailable")?.file_type().is_symlink() {
        return Err("existing_team_runtime_unavailable");
    }
    set_private_dir_permissions(parent).map_err(|_| "existing_team_runtime_unavailable")?;
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
    let mut file = options.open(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
    let written = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(&bytes).map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all().map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "existing_team_runtime_unavailable")
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
        return written;
    }
    if read_own_vps_marker_at(root, scope).as_ref() != Some(&marker) {
        return Err("existing_team_runtime_unavailable");
    }
    Ok(())
}

pub(crate) fn mark_own_vps(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    address: &str,
    port: u16,
    host_key: &str,
) -> Result<(), &'static str> {
    mark_own_vps_at(&root(app)?, scope, address, port, host_key)
}

/// Where a VPS of the person's own stands (JHT-T30). The reads and the writes do not ask the same:
///
/// - `Marked`: the app's own provisioning wrote the mark for this host, and the host key pinned NOW is
///   the marked one. The full connection: reads and writes.
/// - `Claimable`: no existing team in the account and no mark for this host: a VPS the app set up before
///   the mark existed (or the mark is of another host). Reads yes; writes only after the person claims it.
/// - `KeyChanged`: the mark is for this host and port, but the key pinned now is another: the VPS was
///   reinstalled or replaced. Reads yes; writes need a new claim, and the message says so.
/// - `NotOwn`: an existing team's candidate or selection in the account, this computer, or no pin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OwnVpsState {
    Marked,
    Claimable,
    KeyChanged,
    NotOwn,
}

impl OwnVpsState {
    /// The word the page reads.
    pub(crate) fn word(self) -> &'static str {
        match self {
            OwnVpsState::Marked => "marked",
            OwnVpsState::Claimable => "claimable",
            OwnVpsState::KeyChanged => "key_changed",
            OwnVpsState::NotOwn => "not_own",
        }
    }

    /// Why a write is refused here, or none when it may go: the codes the page turns into the
    /// invitation to claim the VPS. An existing team has its own rule (the full link), not this one.
    pub(crate) fn write_refusal(self) -> Option<&'static str> {
        match self {
            OwnVpsState::Marked => None,
            OwnVpsState::Claimable => Some("own_vps_claim_required"),
            OwnVpsState::KeyChanged => Some("own_vps_key_changed"),
            OwnVpsState::NotOwn => Some("own_vps_claim_refused"),
        }
    }
}

/// The state of the VPS `host` for this account, from the saved files and the key pinned now
/// (`pinned_key`, read from the local pin by the caller). Read from the files, never from what the
/// renderer says. An existing team's candidate or selection in the account always wins: it is that
/// team's rule, never an own VPS, mark or no mark.
pub(crate) fn own_vps_state_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
) -> OwnVpsState {
    let (ExecutionHost::Vps { address, port, .. }, Some(pinned_key)) = (host, pinned_key) else {
        return OwnVpsState::NotOwn;
    };
    if !matches!(saved_binding_at(root, scope), Ok((false, false))) {
        return OwnVpsState::NotOwn;
    }
    match read_own_vps_marker_at(root, scope) {
        Some(marker) if marker.address == address.trim() && marker.port == *port => {
            if marker.host_key == pinned_key {
                OwnVpsState::Marked
            } else {
                OwnVpsState::KeyChanged
            }
        }
        _ => OwnVpsState::Claimable,
    }
}

/// WRITES to a VPS of the person's own (the panel's actions, the chat's messages, the judgements):
/// only with the mark. «The scope has no candidate and no selection» is not a permission to write.
pub(crate) fn own_vps_for_writes_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
) -> bool {
    own_vps_state_at(root, scope, host, pinned_key) == OwnVpsState::Marked
}

/// READS of a VPS the app set up (positions, agents, the setup's snapshot): the mark, or what held
/// before the mark existed, a scope with no candidate and no selection (only the existing-team
/// commands write them). A VPS the app set up before the mark must not go back to being unreadable;
/// what it cannot do without the mark is write. A read exposes the person's own data to the person.
pub(crate) fn own_vps_for_reads_at(root: &Path, scope: &AccountScope) -> bool {
    matches!(saved_binding_at(root, scope), Ok((false, false)))
}

/// The person says that this VPS was set up by them with the app (JHT-T30). Writes the mark, and only
/// when all of it holds: the VPS is a host with a pinned key, the account has no existing team (a
/// read-only view or a connection to one always has its candidate or selection), the VPS answers as
/// the team of this account (`identity_matches`, from the identity probe), and the person confirmed. Atomic
/// (the mark is written once, after the checks); a refusal leaves no file.
pub(crate) fn claim_own_vps_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
    identity_matches: bool,
) -> Result<(), &'static str> {
    let ExecutionHost::Vps { address, port, .. } = host else {
        return Err("own_vps_claim_refused");
    };
    match own_vps_state_at(root, scope, host, pinned_key) {
        OwnVpsState::Marked => return Ok(()),
        OwnVpsState::Claimable | OwnVpsState::KeyChanged => {}
        OwnVpsState::NotOwn => return Err("own_vps_claim_refused"),
    }
    if !identity_matches {
        return Err("own_vps_claim_refused");
    }
    let key = pinned_key.ok_or("own_vps_claim_refused")?;
    mark_own_vps_at(root, scope, address, *port, key).map_err(|_| "own_vps_claim_refused")
}

/// The script the identity probe runs in the VPS's container, through the read channel of the host's
/// wrapper (the chat's): it starts nothing and prints one boolean. The account's id arrives on standard
/// input and nothing of `cloud.json` comes back. An unreadable file is «no».
const OWN_VPS_IDENTITY_PY: &str = r#"import json,sys
try:
 expected=json.loads(sys.stdin.readline()).get('user_id')
 cloud=json.load(open('/jht_home/cloud.json'))
 match=isinstance(expected,str) and len(expected)>=16 and cloud.get('user_id')==expected
except Exception:
 match=False
print(json.dumps({'match':match}))"#;

/// What the probe sends: the script in hex, then the expected id. Never an argument.
pub(crate) fn own_vps_identity_input(user_id: &str) -> Option<Vec<u8>> {
    if !crate::onboarding::valid_team_id(user_id) {
        return None;
    }
    let mut input = hex_encode(OWN_VPS_IDENTITY_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(json!({ "user_id": user_id }).to_string().as_bytes());
    input.push(b'\n');
    Some(input)
}

/// The probe's one answer: exactly `{"match": true}`. Anything else, an error, a different shape: no.
pub(crate) fn own_vps_identity_matches(stdout: &[u8]) -> bool {
    serde_json::from_slice::<Value>(stdout.trim_ascii())
        .ok()
        .and_then(|value| {
            let object = value.as_object()?;
            (object.len() == 1).then(|| object.get("match") == Some(&Value::Bool(true)))
        })
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OwnVpsClaimRequest {
    confirmed: bool,
}

/// `account_id` is the one the backend authenticated itself, never one the page sent.
fn claim_own_vps_impl(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    account_id: &str,
    request: &OwnVpsClaimRequest,
) -> Result<(), &'static str> {
    if !request.confirmed {
        return Err("own_vps_claim_not_confirmed");
    }
    let input = own_vps_identity_input(account_id).ok_or("own_vps_claim_refused")?;
    let host = direct_chat::load_persisted_host(app, scope).map_err(|_| "own_vps_claim_refused")?;
    if !matches!(host, ExecutionHost::Vps { .. }) {
        return Err("own_vps_claim_refused");
    }
    let validated = crate::runtime_host::validate_host_for_scope(app, &host, scope).map_err(|_| "own_vps_claim_refused")?;
    let pinned = crate::runtime_host::pinned_host_fingerprint(&validated).map_err(|_| "own_vps_claim_refused")?;
    let root = root(app)?;
    // Before any network: an existing team, or no VPS of the app's, is refused here.
    match own_vps_state_at(&root, scope, &host, Some(&pinned)) {
        OwnVpsState::Marked => return Ok(()),
        OwnVpsState::NotOwn => return Err("own_vps_claim_refused"),
        OwnVpsState::Claimable | OwnVpsState::KeyChanged => {}
    }
    let started = std::time::Instant::now();
    let log = crate::runtime_log::RuntimeLog::new(app);
    // The probe goes where the chat's reads go, to the wrapper's python channel, which reads the
    // attested container and never starts it.
    let probe = run_ssh_command(&validated, &crate::agent_control::own_vps_read_command(), Some(&input), Duration::from_secs(30), None);
    let outcome = match &probe {
        Ok(result) if result.success() => {
            let matches = own_vps_identity_matches(&result.stdout);
            claim_own_vps_at(&root, scope, &host, Some(&pinned), matches)
        }
        _ => Err("own_vps_claim_unreachable"),
    };
    // The runtime log keeps that a claim was made and how it ended: no host, no account, no answer.
    if let Some(log) = log {
        log.record("own_vps_claim", outcome.map(|_| 0), &[], &[], started.elapsed());
    }
    outcome
}

/// «This VPS I set up with the app» (JHT-T30). Only the app's own window, only with the person's
/// confirmation, never by itself: nothing calls it but the page's button. The page sends no identifier:
/// the account is the one whose session this backend holds and verified (`authenticated_account_id`),
/// and it must be the account the app is working in; the identity probe asks the VPS about that account.
#[tauri::command]
pub(crate) async fn own_vps_claim(
    window: tauri::Window,
    app: tauri::AppHandle,
    keys: State<'_, crate::auth_store::SystemKeyCache>,
    scopes: State<'_, AccountScopeState>,
    request: OwnVpsClaimRequest,
) -> Result<(), &'static str> {
    if !direct_chat::window_may_write(window.label()) {
        return Err("own_vps_claim_refused");
    }
    let expected = scopes.active().map_err(|_| "own_vps_claim_refused")?;
    let account_id = crate::auth_store::authenticated_account_id(&app, &keys).await?;
    if crate::account_scope::scope_of_authenticated(account_id.as_bytes()) != expected {
        return Err("own_vps_claim_refused");
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "own_vps_claim_refused")?;
        claim_own_vps_impl(&app, &worker_expected, &account_id, &request)
    })
    .await
    .unwrap_or(Err("own_vps_claim_unreachable"));
    scopes.lock_expected(&expected).map_err(|_| "own_vps_claim_refused")?;
    result
}

/// «Forget the team» for an account: the existing-team candidate and selection, and the own-VPS mark.
/// After it nothing in the scope says a team is connected, and no VPS is the person's own until the
/// app provisions one again. Missing files are fine; any other failure is reported, and the rest are
/// still tried.
#[allow(dead_code)] // the command that forgets a team calls it; the guarantee is tested here
pub(crate) fn forget_team_at(root: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    let mut outcome = Ok(());
    for name in [CANDIDATE_FILE, SELECTION_FILE, OWN_VPS_FILE] {
        match fs::remove_file(path(root, scope, name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => outcome = Err("existing_team_runtime_unavailable"),
        }
    }
    outcome
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

/// The full connection («Confirm and connect») of a team this profile may have selected already:
/// opening the same team read only saves the selection first. The same target is kept as it is;
/// a selection of another one is `existing_team_runtime_target_changed`, never replaced.
pub(crate) fn activate_or_keep(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    activate_or_keep_at(&root(app)?, scope, host, probed)
}

pub(crate) fn activate_or_keep_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    match activate_at(root, scope, host, probed) {
        Err("existing_team_runtime_already_selected") => match selected_at(root, scope, host)? {
            Some(selected) if selected == *probed => Ok(()),
            _ => Err("existing_team_runtime_target_changed"),
        },
        other => other,
    }
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

/// The pinned target of an existing team, or `None` for a VPS the person made with the app: it has
/// no existing-team selection to find (`selected` refuses a VPS without one), it is theirs and
/// connected, and it is reached through the host's wrapper. For READING it is theirs when the scope
/// has no candidate and no selection (`own_vps_for_reads_at`, read from the files, never from the
/// renderer): a half-saved existing team stays the refusal it is. WRITING needs more, the mark the
/// app's own setup writes (`own_vps_for_writes_at`), and the page offers to claim a VPS that has none. Every reader of a VPS team goes through here.
pub(crate) fn selected_or_own(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    selected_or_own_at(&root(app)?, scope, host)
}

/// The fingerprint of the host key the person confirmed for this host, read from the local pin; none
/// when the host does not validate or has no pin (and then no write to an own VPS goes).
pub(crate) fn pinned_key_for(app: &tauri::AppHandle, scope: &AccountScope, host: &ExecutionHost) -> Option<String> {
    let validated = crate::runtime_host::validate_host_for_scope(app, host, scope).ok()?;
    crate::runtime_host::pinned_host_fingerprint(&validated).ok()
}

pub(crate) fn selected_or_own_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    match selected_at(root, scope, host) {
        Err("existing_team_runtime_selection_required") if own_vps_for_reads_at(root, scope) => Ok(None),
        other => other,
    }
}

/// The command a reader of the team's data runs, always with the same input (the app's own script
/// in hex, then the request): the pinned container of an existing team, or, on the VPS the app set
/// up itself, its host's wrapper on the python channel the chat uses (only when the wrapper carries
/// the chat's protocol line; the channel reads the attested container and never starts it).
pub(crate) fn read_command_for(
    selected: Option<ActivatedTarget>,
    host: &ExecutionHost,
) -> Result<String, &'static str> {
    match selected {
        Some(target) => python_command(&target.runtime),
        None if matches!(host, ExecutionHost::Vps { .. }) => Ok(crate::direct_chat::REMOTE_PYTHON_STDIN.to_owned()),
        None => Err("existing_team_runtime_required"),
    }
}

pub(crate) fn read_command(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<String, &'static str> {
    read_command_for(selected_or_own(app, scope, host)?, host)
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

/// The container engine of the VPS, chosen the same way by every remote script: Docker when it is
/// there and is Docker, otherwise Podman (a VPS can run the team on rootless Podman, with no
/// `docker` at all; a `docker` that is Podman's shim answers with Podman's shapes, so it is Podman).
/// None of the two: the script stops with `$1`, the exit code the caller reads as «not reachable».
pub(crate) fn engine_selection(exit: u8) -> String {
    format!(
        r#"if command -v docker >/dev/null 2>&1 && ! docker --version 2>/dev/null | grep -qi podman; then JHT_ENGINE=docker
elif command -v podman >/dev/null 2>&1; then JHT_ENGINE=podman
else exit {exit}; fi"#
    )
}

/// Prefixes a source-owned operation with a fresh CID/index/manifest check.
/// The descriptor is intentionally distinct from the container image index.
///
/// Docker (containerd store): the container's image is the index, the descriptor is the platform
/// manifest and `image inspect --platform` names it. Podman has neither: its image id is the
/// config (`sha256:` added, Podman prints it bare), the index is the image's `.Digest` (the one
/// the container records as `.ImageDigest`) and the platform manifest is the image's other
/// RepoDigest of the fixed repository. The same five values are checked again by every command.
pub(crate) fn command(target: &RuntimeTarget, operation: &str) -> Result<String, &'static str> {
    if !valid_target(target) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        r#"set -eu
JHT_CID='{cid}'; JHT_IMAGE='{image}'; JHT_PLATFORM_IMAGE='{platform}'; JHT_REVISION='{revision}'; JHT_DIGEST='{digest}'; JHT_PLATFORM='{os}/{architecture}'
{engine}
if [ "$JHT_ENGINE" = podman ]; then
JHT_CONTAINER="$(podman inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{.ImageDigest}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|${{JHT_IMAGE#sha256:}}|true|$JHT_REVISION|$JHT_DIGEST" ] || exit 70
JHT_DEFAULT="$(podman image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{.Digest}}}}|,{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "${{JHT_IMAGE#sha256:}}")" || exit 70
case "$JHT_DEFAULT" in "${{JHT_IMAGE#sha256:}}|"$JHT_PLATFORM"|$JHT_REVISION|$JHT_DIGEST|"*",ghcr.io/leopu00/jht@$JHT_DIGEST,"*) ;; *) exit 70 ;; esac
case "$JHT_DEFAULT" in *",ghcr.io/leopu00/jht@$JHT_PLATFORM_IMAGE,"*) ;; *) exit 70 ;; esac
else
JHT_CONTAINER="$(docker inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{index .ImageManifestDescriptor "digest"}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|$JHT_IMAGE|true|$JHT_REVISION|$JHT_PLATFORM_IMAGE" ] || exit 70
JHT_DEFAULT="$(docker image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_DEFAULT" in "$JHT_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
JHT_EXPLICIT="$(docker image inspect --platform "$JHT_PLATFORM" --format '{{{{.Id}}}}|{{{{.Os}}}}/{{{{.Architecture}}}}|{{{{index .Config.Labels "org.opencontainers.image.revision"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_EXPLICIT" in "$JHT_PLATFORM_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
fi
{operation}"#,
        engine = engine_selection(70),
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
/// builtin of the VPS shell, so the pipe into the engine's `exec -i` puts it on no argument list,
/// which anyone who lists the host's processes could read.
pub(crate) fn team_probe_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        r#"IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
printf '%s\n' "$JHT_EXPECTED_TEAM" | "$JHT_ENGINE" exec -i "$JHT_CID" node -e '
const fs=require("fs"), expected=fs.readFileSync(0,"utf8").replace(/\n$/,"");
let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1"); console.log("providerConfigured="+(configured?"1":"0")); console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0")); console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0")); console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' || exit $?
if "$JHT_ENGINE" exec "$JHT_CID" tmux has-session -t CAPITANO 2>/dev/null; then JHT_CAPTAIN=1; else JHT_CAPTAIN=0; fi
if "$JHT_ENGINE" exec "$JHT_CID" tmux has-session -t ASSISTENTE 2>/dev/null; then JHT_ASSISTANT=1; else JHT_ASSISTANT=0; fi
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
        "\"$JHT_ENGINE\" exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash /app/.launcher/start-agent.sh assistente </dev/null",
    )
}

pub(crate) fn python_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'")
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
            "\"$JHT_ENGINE\" exec -i \"$JHT_CID\" sh -c 'msg=$(cat); exec jht-tmux-send {session} \"$msg\"'"
        ),
    )
}

/// The agents the chat may be opened with: the closed list of `agent_chat.py`, which refuses any
/// other name again on its side.
const CHAT_AGENTS: [&str; 8] = [
    "capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico",
];

/// What the app asks of the chat in a pinned container: four operations, each with its few
/// arguments. The user's text is never one of them: it goes on standard input (the words of an
/// answer too, with the options taken).
pub(crate) enum ChatOperation<'a> {
    Read { agent: &'a str, cursor: Option<&'a str> },
    Send { agent: &'a str, client_message_id: &'a str },
    /// The person's answer to one of the agent's questions.
    Answer { agent: &'a str, question_id: &'a str },
    /// Enter pressed once more on a message still in the agent's composer: never the text again.
    Enter { agent: &'a str, message_id: &'a str },
}

impl ChatOperation<'_> {
    /// Answer and Enter came after the first chat actions: a host's wrapper must say it has them.
    pub(crate) fn needs_answer_actions(&self) -> bool {
        matches!(self, ChatOperation::Answer { .. } | ChatOperation::Enter { .. })
    }
}

/// The id of a question as the chat's read gives it (`aq:<agent>:<seconds>-<hex>`): letters,
/// digits, `:`, `_` and `-`, at most 96.
pub(crate) fn chat_question_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'-'))
}

fn chat_token(value: &str, max: usize, digits_only: bool) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.bytes().all(|b| {
            if digits_only {
                b.is_ascii_digit()
            } else {
                b.is_ascii_alphanumeric() || b == b'-'
            }
        })
}

/// The arguments of a chat operation, every one checked against its closed list or alphabet:
/// the operation word, the agent, then the cursor or the client id. Whatever builds a command
/// for the chat takes them from here, so there is one place that says what may enter one.
fn chat_arguments(operation: &ChatOperation<'_>) -> Result<Vec<String>, &'static str> {
    match operation {
        ChatOperation::Read { agent, cursor } => {
            if !CHAT_AGENTS.contains(agent) {
                return Err("invalid_agent");
            }
            let mut arguments = vec!["read".to_owned(), (*agent).to_owned()];
            match cursor {
                None => {}
                Some(cursor) if chat_token(cursor, 12, true) => arguments.push((*cursor).to_owned()),
                Some(_) => return Err("invalid_request"),
            }
            Ok(arguments)
        }
        ChatOperation::Send { agent, client_message_id } => {
            if !CHAT_AGENTS.contains(agent) {
                return Err("invalid_agent");
            }
            if !chat_token(client_message_id, 64, false) {
                return Err("invalid_request");
            }
            Ok(vec!["send".to_owned(), (*agent).to_owned(), (*client_message_id).to_owned()])
        }
        ChatOperation::Answer { agent, question_id } => {
            if !CHAT_AGENTS.contains(agent) {
                return Err("invalid_agent");
            }
            if !chat_question_id(question_id) {
                return Err("invalid_request");
            }
            Ok(vec!["answer".to_owned(), (*agent).to_owned(), (*question_id).to_owned()])
        }
        ChatOperation::Enter { agent, message_id } => {
            if !CHAT_AGENTS.contains(agent) {
                return Err("invalid_agent");
            }
            if !chat_token(message_id, 64, false) {
                return Err("invalid_request");
            }
            Ok(vec!["enter".to_owned(), (*agent).to_owned(), (*message_id).to_owned()])
        }
    }
}

fn quoted(arguments: &[String]) -> String {
    arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| if index == 0 { argument.clone() } else { format!("'{argument}'") })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The chat of a pinned team: `agent_chat.py` with fixed arguments, in the verified container
/// (`command` checks container, image, platform and digest first: exit 70 otherwise). Every token
/// is checked before it enters the string, so the string holds nothing the person or the renderer
/// wrote. It replaces `python_command` for the chat: no interpreter that runs what it is sent.
pub(crate) fn chat_command(
    target: &RuntimeTarget,
    operation: &ChatOperation<'_>,
) -> Result<String, &'static str> {
    let arguments = quoted(&chat_arguments(operation)?);
    command(
        target,
        &format!("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py {arguments}"),
    )
}

/// The same operation through the host's `jht` wrapper (a local team, a VPS that was never
/// pinned): `desktop-chat read|chat-send|chat-answer|chat-enter ...`. The wrapper runs the same
/// script in the container. An older wrapper answers 2 to an action it does not know: for read
/// and send the caller keeps the older path, answer and enter have none.
pub(crate) fn chat_wrapper_arguments(operation: &ChatOperation<'_>) -> Result<Vec<String>, &'static str> {
    let mut arguments = chat_arguments(operation)?;
    if matches!(arguments[0].as_str(), "send" | "answer" | "enter") {
        arguments[0] = format!("chat-{}", arguments[0]);
    }
    arguments.insert(0, "desktop-chat".to_owned());
    Ok(arguments)
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

/// The tests that grant or revoke share the one static of the process: cargo runs tests in parallel.
#[cfg(test)]
pub(crate) static FULL_LINK_TEST_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn snapshot_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "\"$JHT_ENGINE\" exec \"$JHT_CID\" node -e 'const fs=require(\"fs\"); let c={}; try{c=JSON.parse(fs.readFileSync(\"/jht_home/jht.config.json\",\"utf8\"))}catch{}; const p=String(c.active_provider||\"\").toLowerCase(); const marker={claude:\"/jht_home/.claude/.credentials.json\",anthropic:\"/jht_home/.claude/.credentials.json\",codex:\"/jht_home/.codex/auth.json\",openai:\"/jht_home/.codex/auth.json\",kimi:\"/jht_home/.kimi/credentials/kimi-code.json\",moonshot:\"/jht_home/.kimi/credentials/kimi-code.json\"}[p]; const ok=[\"claude\",\"anthropic\",\"codex\",\"openai\",\"kimi\",\"moonshot\"].includes(p); console.log(\"runtimeInstalled=1\\ncontainerRunning=1\\nproviderConfigured=\"+(ok?\"1\":\"0\")+\"\\nproviderAuthenticated=\"+(marker&&fs.existsSync(marker)?\"1\":\"0\")+\"\\nprofileReady=\"+(fs.existsSync(\"/jht_home/profile/ready.flag\")?\"1\":\"0\")+\"\\nassistantWelcomed=\"+(fs.existsSync(\"/jht_home/profile/welcomed.flag\")?\"1\":\"0\"));'")
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
    let command = match read_command(app, scope, &host) {
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
        assert!(command.contains("\"$JHT_ENGINE\" exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash"));
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
    fn the_chat_command_is_the_fixed_script_in_the_verified_container_with_only_checked_tokens() {
        let read = chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some("123") }).expect("a read");
        assert!(read.contains("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'capitano' '123'"));
        assert!(read.contains("|| exit 70") && read.starts_with("set -eu\nJHT_CID='"), "the pinned container is verified first");
        let first = chat_command(&target(), &ChatOperation::Read { agent: "mentor", cursor: None }).expect("a first page");
        assert!(first.ends_with("agent_chat.py read 'mentor'"));
        let send = chat_command(&target(), &ChatOperation::Send { agent: "assistente", client_message_id: "id-1-A" }).expect("a send");
        assert!(send.ends_with("agent_chat.py send 'assistente' 'id-1-A'"));
        assert!(!send.contains("python3 -c") && !send.contains("exec(bytes.fromhex"), "no interpreter that runs what it is sent");
    }

    #[test]
    fn the_wrapper_arguments_are_the_same_checked_tokens_behind_the_wrappers_two_actions() {
        let read = chat_wrapper_arguments(&ChatOperation::Read { agent: "capitano", cursor: Some("4096") }).unwrap();
        assert_eq!(read, ["desktop-chat", "read", "capitano", "4096"]);
        let first = chat_wrapper_arguments(&ChatOperation::Read { agent: "mentor", cursor: None }).unwrap();
        assert_eq!(first, ["desktop-chat", "read", "mentor"]);
        let send = chat_wrapper_arguments(&ChatOperation::Send { agent: "assistente", client_message_id: "id-1" }).unwrap();
        assert_eq!(send, ["desktop-chat", "chat-send", "assistente", "id-1"]);
        assert_eq!(
            chat_wrapper_arguments(&ChatOperation::Send { agent: "capitano", client_message_id: "a b" }),
            Err("invalid_request")
        );
        assert_eq!(
            chat_wrapper_arguments(&ChatOperation::Read { agent: "root", cursor: None }),
            Err("invalid_agent")
        );
    }

    #[test]
    fn an_answer_and_an_enter_carry_only_their_checked_ids_and_never_the_persons_words() {
        let answer = ChatOperation::Answer { agent: "capitano", question_id: "aq:capitano:1792700000-a1b2c3" };
        assert!(answer.needs_answer_actions());
        assert!(chat_command(&target(), &answer).unwrap().ends_with("agent_chat.py answer 'capitano' 'aq:capitano:1792700000-a1b2c3'"));
        assert_eq!(
            chat_wrapper_arguments(&answer).unwrap(),
            ["desktop-chat", "chat-answer", "capitano", "aq:capitano:1792700000-a1b2c3"]
        );
        let enter = ChatOperation::Enter { agent: "mentor", message_id: "0b1c2d3e-4f50" };
        assert!(enter.needs_answer_actions());
        assert!(chat_command(&target(), &enter).unwrap().ends_with("agent_chat.py enter 'mentor' '0b1c2d3e-4f50'"));
        assert_eq!(chat_wrapper_arguments(&enter).unwrap(), ["desktop-chat", "chat-enter", "mentor", "0b1c2d3e-4f50"]);
        assert!(!ChatOperation::Read { agent: "capitano", cursor: None }.needs_answer_actions());
        assert!(!ChatOperation::Send { agent: "capitano", client_message_id: "id" }.needs_answer_actions());
        // anything a shell could read as more than one word, or longer than the ids are, never enters
        let long_question = "q".repeat(97);
        for id in ["", "a b", "a'b", "a;b", "$(x)", "a\nb", "\u{e9}", long_question.as_str()] {
            assert_eq!(
                chat_wrapper_arguments(&ChatOperation::Answer { agent: "capitano", question_id: id }),
                Err("invalid_request"),
                "{id:?}"
            );
        }
        let long_message = "m".repeat(65);
        for id in ["", "a:b", "a_b", "a b", long_message.as_str()] {
            assert_eq!(
                chat_wrapper_arguments(&ChatOperation::Enter { agent: "capitano", message_id: id }),
                Err("invalid_request"),
                "{id:?}"
            );
        }
        assert_eq!(chat_wrapper_arguments(&ChatOperation::Answer { agent: "root", question_id: "q1" }), Err("invalid_agent"));
        assert_eq!(chat_wrapper_arguments(&ChatOperation::Enter { agent: "root", message_id: "m1" }), Err("invalid_agent"));
    }

    #[test]
    fn golden_the_operation_line_of_each_chat_command_is_exactly_this() {
        let last = |command: String| command.lines().last().expect("a last line").to_owned();
        assert_eq!(
            last(chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some("4096") }).unwrap()),
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'capitano' '4096'"
        );
        assert_eq!(
            last(chat_command(&target(), &ChatOperation::Read { agent: "mentor", cursor: None }).unwrap()),
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'mentor'"
        );
        assert_eq!(
            last(chat_command(&target(), &ChatOperation::Send { agent: "assistente", client_message_id: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" }).unwrap()),
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py send 'assistente' '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'"
        );
    }

    #[test]
    fn nothing_outside_the_closed_forms_enters_the_chat_command() {
        for agent in ["", "CAPITANO", "capitano ", "capitano'; id #", "scout-1", "../mentor", "capitano\n", "agente"] {
            assert_eq!(chat_command(&target(), &ChatOperation::Read { agent, cursor: None }), Err("invalid_agent"), "{agent:?}");
            assert_eq!(chat_command(&target(), &ChatOperation::Send { agent, client_message_id: "id" }), Err("invalid_agent"), "{agent:?}");
        }
        let long_cursor = "9".repeat(13);
        for cursor in ["", "-1", "1.5", "12x", "1 2", "1;id", "'", long_cursor.as_str()] {
            assert_eq!(chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some(cursor) }), Err("invalid_request"), "{cursor:?}");
        }
        let long_id = "x".repeat(65);
        for id in ["", "a b", "a'b", "a;b", "a$(id)", "a`id`", "a\nb", "è", "with_underscore", long_id.as_str()] {
            assert_eq!(chat_command(&target(), &ChatOperation::Send { agent: "capitano", client_message_id: id }), Err("invalid_request"), "{id:?}");
        }
        let mut broken = target();
        broken.container_id = "x".into();
        assert_eq!(
            chat_command(&broken, &ChatOperation::Read { agent: "capitano", cursor: None }),
            Err("existing_team_runtime_candidate_invalid")
        );
    }

    #[test]
    fn every_reader_of_the_vps_the_app_set_up_goes_through_its_wrapper_and_an_existing_team_through_its_pin() {
        let root = std::env::temp_dir().join(format!("jht-own-vps-read-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&root);
        let scope = AccountScope::synthetic(b"scope-own-read");
        let vps = ExecutionHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: "/keys/id_ed25519".into(),
        };
        // a VPS the app set up before the mark existed: nothing saved for the scope, its READS go to the host's wrapper
        assert!(matches!(selected_or_own_at(&root, &scope, &vps), Ok(None)), "no candidate, no selection: read as before");
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        assert!(matches!(selected_or_own_at(&root, &scope, &vps), Ok(None)));
        let own = read_command_for(None, &vps).unwrap();
        assert_eq!(own, crate::direct_chat::REMOTE_PYTHON_STDIN);
        assert!(own.contains("grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' \"$JHT_BIN\""));
        assert!(own.ends_with("exec \"$JHT_BIN\" desktop-chat python"));
        // an existing team keeps today's command, the pinned container
        let pinned = ActivatedTarget::synthetic_for_tests();
        assert_eq!(read_command_for(Some(pinned.clone()), &vps).unwrap(), python_command(&pinned.runtime).unwrap());
        // a half-saved existing team (a candidate without its selection) stays refused, mark or no mark
        let dir = account_dir(&root, &scope);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
        assert_eq!(selected_or_own_at(&root, &scope, &vps).err(), Some("existing_team_runtime_selection_required"));
        // this computer is never «a VPS of one's own»: no wrapper command for it
        assert_eq!(read_command_for(None, &ExecutionHost::Local), Err("existing_team_runtime_required"));
        let _ = fs::remove_dir_all(&root);
    }

    const PINNED_KEY: &str = "SHA256:Vq0PqE2cPNwUj8mP6X7Zr6l9kKq3b8m1sT4n2uYfA0c";

    fn own_vps_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("jht-own-vps-{}-{}-{tag}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn own_host(address: &str, port: u16) -> ExecutionHost {
        ExecutionHost::Vps { address: address.into(), user: "jht".into(), port, key_path: "/keys/id_ed25519".into() }
    }

    /// The state with the key pinned now being `PINNED_KEY`.
    fn state_of(root: &Path, scope: &AccountScope, host: &ExecutionHost) -> OwnVpsState {
        own_vps_state_at(root, scope, host, Some(PINNED_KEY))
    }

    fn may_write(root: &Path, scope: &AccountScope, host: &ExecutionHost, key: Option<&str>) -> bool {
        own_vps_for_writes_at(root, scope, host, key)
    }

    #[test]
    fn a_vps_of_the_persons_own_is_written_to_only_with_the_mark_the_provisioning_writes() {
        let root = own_vps_root("mark");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        // an old VPS, set up before the mark: reads yes, writes no (until the person claims it)
        assert!(own_vps_for_reads_at(&root, &scope), "no candidate, no selection: read as before");
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "no mark: no write");
        assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable);
        assert_eq!(state_of(&root, &scope, &vps).write_refusal(), Some("own_vps_claim_required"));
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "the mark, this host, this key: writes too");
        assert_eq!(state_of(&root, &scope, &vps).write_refusal(), None);
        // the mark is private, and says nothing but the account, the host and the key
        let file = path(&root, &scope, OWN_VPS_FILE);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let written: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(written.as_object().unwrap().len(), 5);
        // it is the account's: another account has no mark
        assert!(!may_write(&root, &AccountScope::synthetic(b"another-scope"), &vps, Some(PINNED_KEY)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn another_host_another_port_or_another_key_is_not_the_marked_one() {
        let root = own_vps_root("other");
        let scope = AccountScope::synthetic(b"scope-own");
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        assert!(may_write(&root, &scope, &own_host("203.0.113.7", 22), Some(PINNED_KEY)));
        // the mark of another host or port: this one is a VPS to claim, not a marked one
        assert_eq!(state_of(&root, &scope, &own_host("203.0.113.8", 22)), OwnVpsState::Claimable, "another host");
        assert_eq!(state_of(&root, &scope, &own_host("203.0.113.7", 2222)), OwnVpsState::Claimable, "another port");
        assert!(!may_write(&root, &scope, &own_host("203.0.113.8", 22), Some(PINNED_KEY)));
        assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 2222), Some(PINNED_KEY)));
        // the same host with another key: reinstalled or replaced. Reads stay, writes ask for a new claim, with their own word
        let other = Some("SHA256:another-key-than-the-marked-one");
        assert_eq!(own_vps_state_at(&root, &scope, &own_host("203.0.113.7", 22), other), OwnVpsState::KeyChanged);
        assert_eq!(OwnVpsState::KeyChanged.write_refusal(), Some("own_vps_key_changed"));
        assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), other), "another key");
        assert!(own_vps_for_reads_at(&root, &scope), "reads do not depend on the key");
        // no pin to compare, or this computer: never a VPS of one's own
        assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), None), "no pin to compare");
        assert_eq!(own_vps_state_at(&root, &scope, &own_host("203.0.113.7", 22), None), OwnVpsState::NotOwn);
        assert_eq!(own_vps_state_at(&root, &scope, &ExecutionHost::Local, Some(PINNED_KEY)), OwnVpsState::NotOwn);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_existing_teams_files_win_over_any_mark_for_reads_and_writes() {
        let root = own_vps_root("files");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        let dir = account_dir(&root, &scope);
        // the person's own VPS, and then a selection appears (an existing team gets connected to): the
        // existing team's rule is back, and the full connection must be confirmed again
        fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a selection that appears later: no longer the person's own");
        assert!(!own_vps_for_reads_at(&root, &scope), "nor read as one");
        fs::remove_file(dir.join(SELECTION_FILE)).unwrap();
        assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "and without it, theirs again");
        fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a candidate: an existing team");
        assert!(!own_vps_for_reads_at(&root, &scope));
        fs::remove_file(dir.join(CANDIDATE_FILE)).unwrap();
        fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a selection alone: an existing team too, and never mistaken");
        assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::NotOwn);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_mark_that_is_not_exactly_what_the_provisioning_writes_is_no_mark() {
        let root = own_vps_root("forged");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        let file = path(&root, &scope, OWN_VPS_FILE);
        let good = fs::read(&file).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&good).unwrap();
        let rewrite = |value: &serde_json::Value| {
            fs::write(&file, serde_json::to_vec(value).unwrap()).unwrap();
            set_private_permissions(&file).unwrap();
        };
        for (name, mutate) in [
            ("an extra field", Box::new(|v: &mut serde_json::Value| { v["extra"] = json!(1); }) as Box<dyn Fn(&mut serde_json::Value)>),
            ("another schema", Box::new(|v: &mut serde_json::Value| { v["schema"] = json!(2); })),
            ("another account", Box::new(|v: &mut serde_json::Value| { v["scope"] = json!("0".repeat(32)); })),
            ("a key that is no fingerprint", Box::new(|v: &mut serde_json::Value| { v["host_key"] = json!("not-a-fingerprint"); })),
            ("no port", Box::new(|v: &mut serde_json::Value| { v["port"] = json!(0); })),
            ("a padded address", Box::new(|v: &mut serde_json::Value| { v["address"] = json!(" 203.0.113.7"); })),
        ] {
            let mut forged = value.clone();
            mutate(&mut forged);
            rewrite(&forged);
            assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "{name}");
            assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable, "{name}: a VPS to claim, not a marked one");
        }
        // not JSON, not an object, too long: no mark
        for bytes in [b"not json".to_vec(), b"[]".to_vec(), vec![b'{'; MAX_BYTES + 1]] {
            fs::write(&file, &bytes).unwrap();
            set_private_permissions(&file).unwrap();
            assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)));
        }
        // the right bytes, but readable by others or a link to somewhere else: no mark
        fs::write(&file, &good).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "not private");
            set_private_permissions(&file).unwrap();
            assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "private again");
            let elsewhere = root.join("elsewhere.json");
            fs::write(&elsewhere, &good).unwrap();
            set_private_permissions(&elsewhere).unwrap();
            fs::remove_file(&file).unwrap();
            std::os::unix::fs::symlink(&elsewhere, &file).unwrap();
            assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a link");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_account_mark_of_another_account_does_not_open_this_one() {
        let root = own_vps_root("copy");
        let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
        let vps = own_host("203.0.113.7", 22);
        mark_own_vps_at(&root, &one, "203.0.113.7", 22, PINNED_KEY).unwrap();
        fs::create_dir_all(account_dir(&root, &two)).unwrap();
        fs::copy(path(&root, &one, OWN_VPS_FILE), path(&root, &two, OWN_VPS_FILE)).unwrap();
        set_private_permissions(&path(&root, &two, OWN_VPS_FILE)).unwrap();
        assert!(may_write(&root, &one, &vps, Some(PINNED_KEY)));
        assert!(!may_write(&root, &two, &vps, Some(PINNED_KEY)), "the copy says it is account one's");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn forgetting_the_team_takes_the_mark_away_with_the_rest() {
        let root = own_vps_root("forget");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)));
        let dir = account_dir(&root, &scope);
        fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
        fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
        forget_team_at(&root, &scope).unwrap();
        assert!(!path(&root, &scope, OWN_VPS_FILE).exists() && !dir.join(CANDIDATE_FILE).exists() && !dir.join(SELECTION_FILE).exists());
        // the mark is gone: a VPS to claim again, and nothing is written to it until then
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "no mark: no write any more");
        assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable);
        // nothing there is fine; the same again is fine
        forget_team_at(&root, &scope).unwrap();
        forget_team_at(&root, &AccountScope::synthetic(b"never-seen")).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_mark_is_replaced_for_a_new_host_and_refuses_what_is_not_a_host_and_a_key() {
        let root = own_vps_root("replace");
        let scope = AccountScope::synthetic(b"scope-own");
        mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
        mark_own_vps_at(&root, &scope, " 203.0.113.9 ", 22, PINNED_KEY).unwrap();
        assert!(may_write(&root, &scope, &own_host("203.0.113.9", 22), Some(PINNED_KEY)));
        assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), Some(PINNED_KEY)), "the old host is no longer marked");
        for (address, port, key) in [("", 22, PINNED_KEY), ("203.0.113.7", 0, PINNED_KEY), ("203.0.113.7", 22, ""), ("203.0.113.7", 22, "no-sha256-prefix"), ("203.0.113.7", 22, "SHA256:with space")] {
            assert_eq!(mark_own_vps_at(&root, &scope, address, port, key), Err("existing_team_runtime_own_vps_invalid"), "{address}:{port} {key}");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn claiming_an_old_vps_writes_the_mark_only_when_the_person_confirmed_and_it_answers_as_theirs() {
        let root = own_vps_root("claim");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        // old VPS without the mark: writes no, and then, after the claim, yes
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)));
        // it does not answer as the team of this account: refused, and no file is left
        assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), false), Err("own_vps_claim_refused"));
        assert!(!path(&root, &scope, OWN_VPS_FILE).exists(), "a refused claim leaves nothing");
        // no pin, or this computer: refused
        assert_eq!(claim_own_vps_at(&root, &scope, &vps, None, true), Err("own_vps_claim_refused"));
        assert_eq!(claim_own_vps_at(&root, &scope, &ExecutionHost::Local, Some(PINNED_KEY), true), Err("own_vps_claim_refused"));
        assert!(!path(&root, &scope, OWN_VPS_FILE).exists());
        // it answers as theirs: marked, and writes go
        claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), true).unwrap();
        assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "after the claim, writes go");
        // claiming again is a no-op
        claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), false).unwrap();
        // the key changed: claimed again with the new key, the mark follows it
        let other = "SHA256:Zz9PqE2cPNwUj8mP6X7Zr6l9kKq3b8m1sT4n2uYfA0c";
        assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(other)), OwnVpsState::KeyChanged);
        assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(other), false), Err("own_vps_claim_refused"), "the new key needs the probe too");
        claim_own_vps_at(&root, &scope, &vps, Some(other), true).unwrap();
        assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(other)), OwnVpsState::Marked);
        assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(PINNED_KEY)), OwnVpsState::KeyChanged, "the old key is the changed one now");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_existing_team_is_never_claimed_as_the_persons_own() {
        let root = own_vps_root("claim-existing");
        let scope = AccountScope::synthetic(b"scope-own");
        let vps = own_host("203.0.113.7", 22);
        let dir = account_dir(&root, &scope);
        fs::create_dir_all(&dir).unwrap();
        for file in [CANDIDATE_FILE, SELECTION_FILE] {
            fs::write(dir.join(file), b"{}").unwrap();
            assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), true), Err("own_vps_claim_refused"), "{file}");
            assert!(!path(&root, &scope, OWN_VPS_FILE).exists(), "{file}: no mark written");
            fs::remove_file(dir.join(file)).unwrap();
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_claim_request_carries_the_confirmation_and_nothing_the_page_could_say_about_the_account() {
        let ok: OwnVpsClaimRequest = serde_json::from_value(json!({"confirmed": true})).unwrap();
        assert!(ok.confirmed);
        // an id sent by the page is refused, whichever name it comes with
        for field in ["userId", "user_id", "accountId", "scope", "host"] {
            let mut body = json!({"confirmed": true});
            body[field] = json!("a".repeat(32));
            assert!(serde_json::from_value::<OwnVpsClaimRequest>(body).is_err(), "{field}");
        }
        assert!(serde_json::from_value::<OwnVpsClaimRequest>(json!({})).is_err(), "no confirmation: no request");
    }

    #[test]
    fn the_claim_asks_the_backend_for_the_account_and_ties_it_to_the_active_scope() {
        let source = include_str!("existing_team_runtime.rs");
        let command = &source[source.find("pub(crate) async fn own_vps_claim(").unwrap()..];
        let command = &command[..command.find("
}
").unwrap()];
        assert!(command.contains("authenticated_account_id(&app, &keys)"), "the account comes from the verified session");
        assert!(command.contains("scope_of_authenticated(account_id.as_bytes()) != expected"), "and is the active scope's");
        assert!(command.contains("claim_own_vps_impl(&app, &worker_expected, &account_id, &request)"));
    }

    #[test]
    fn the_identity_probe_sends_the_id_on_input_and_trusts_only_one_true_answer() {
        let id = "a".repeat(32);
        let input = String::from_utf8(own_vps_identity_input(&id).unwrap()).unwrap();
        let mut lines = input.lines();
        assert_eq!(lines.next().unwrap(), hex_encode(OWN_VPS_IDENTITY_PY.as_bytes()), "the script, in hex");
        assert_eq!(serde_json::from_str::<Value>(lines.next().unwrap()).unwrap(), json!({"user_id": id}));
        assert!(lines.next().is_none() && input.ends_with('\n'));
        assert!(!OWN_VPS_IDENTITY_PY.contains(&id), "the id is never in the script");
        assert!(own_vps_identity_input("short").is_none() && own_vps_identity_input("a;b").is_none());
        assert!(own_vps_identity_matches(br#"{"match": true}"#));
        for bad in [&br#"{"match": false}"#[..], br#"{"match": true, "x": 1}"#, br#"{"match": "true"}"#, br#"[true]"#, b"", b"match", br#"{"error":"x"}"#] {
            assert!(!own_vps_identity_matches(bad), "{}", String::from_utf8_lossy(bad));
        }
    }

    #[test]
    fn the_full_link_belongs_to_the_confirmed_team_in_this_run_only() {
        let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
            json!({"op": "list", "filters": {"limit": 50, "offset": 0, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true, "scam": "hide"}}),
            json!({"op": "list", "filters": {"limit": 25, "offset": 25, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true, "scam": "only"}}),
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
    fn the_positions_list_carries_the_scam_signals_checked_and_filters_on_them() {
        let keys = POSITIONS_READ_PY.split("LIST_KEYS=(").nth(1).unwrap().split(')').next().unwrap();
        assert!(keys.contains("'scam_signals'"));
        // checked, not passed through: only the known codes survive, and the bucket is recomputed
        assert!(POSITIONS_READ_PY.contains("'scam_signals':scam(row.get('scam_signals'))"));
        assert!(POSITIONS_READ_PY.contains("SCAM_FAMILY={'same_text_many_places':'text'"));
        assert!(POSITIONS_READ_PY.contains("if filters.get('scam') not in (None,'hide','only'): return None"));
        // the count of the section is over everything the other filters match, whichever view is asked
        assert!(POSITIONS_READ_PY.contains("if section: section_total+=1"));
        for value in ["hide", "only"] {
            let request = parse_positions_request(json!({"op": "list", "filters": {"scam": value}}))
                .expect("a scam filter parses");
            assert_eq!(
                serde_json::to_value(request).unwrap(),
                json!({"op": "list", "filters": {"scam": value}})
            );
        }
        assert!(parse_positions_request(json!({"op": "list", "filters": {"scam": "all"}})).is_err());
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
            "'data':{'items':[light(item) for item in window],'total':len(rows),'scamSection':section_total}",
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
