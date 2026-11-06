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
    cell::Cell,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

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


mod candidate;
pub(crate) use candidate::{parse_candidate_bytes, candidate_for_request, candidate_for_request_at, saved_binding_at, candidate_identity_at, candidate_host_for_team, RegistrationGate, registration_gate_at, candidate_bytes, CandidateWrite, write_candidate_at, };
use candidate::{read_candidate_at, candidate_matches_probed, };
mod full_link;
pub(crate) use full_link::{grant_full_link, full_link_granted, revoke_full_link, FULL_LINK_MAX_AGE_S, FullLinkRestore, FullLinkForgotten, unix_now, remember_full_link_at, forget_full_link_at, restore_full_link_at, };
mod identity;
pub(crate) use identity::{RuntimeTarget, Candidate, SavedSelection, ActivatedTarget, connection_key, hex, sha256, team_id, valid_target, };
use identity::{Selection, };
mod own_vps;
pub(crate) use own_vps::{mark_own_vps_at, mark_own_vps, OwnVpsState, own_vps_state_at, own_vps_for_writes_at, own_vps_for_reads_at, claim_own_vps_at, };
#[cfg(test)]
use own_vps::OwnVpsMarker;
mod own_vps_claim;
pub(crate) use own_vps_claim::{own_vps_identity_input, own_vps_identity_matches, OwnVpsClaimRequest, own_vps_claim, };
use own_vps_claim::{OWN_VPS_IDENTITY_PY, claim_own_vps_impl, };
mod rebind;
pub(crate) use rebind::{forget_team_at, RebindBase, rebind_base_at, clear_for_rebind_at, clear_link_at, };
mod selection;
pub(crate) use selection::{activate, activate_at, activate_or_keep, activate_or_keep_at, selected, selected_or_own, pinned_key_for, selected_or_own_at, selected_at, };
use selection::{selection_may_be_absent, write_selection_at, parse_selection_bytes, read_selection_at, };
mod storage;
pub(crate) use storage::{root, };
use storage::{CANDIDATE_FILE, SELECTION_FILE, OWN_VPS_FILE, MAX_BYTES, account_dir, path, private_file, read_bytes, };
#[cfg(test)]
pub(crate) use full_link::FULL_LINK_TEST_LOCK;
pub(crate) use own_vps_claim::__cmd__own_vps_claim;
pub(crate) use own_vps_claim::__tauri_command_name_own_vps_claim;

const READ_TIMEOUT: Duration = Duration::from_secs(15);

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
    /// How many positions each role of the pipeline has to work on (the office's piles): five counts, nothing else.
    Piles,
    /// What the globe needs of every position, from `offset` on (see the script's `map`).
    Map {
        #[serde(default)]
        offset: u32,
    },
    Profile,
    /// What each role did per day and instance in a range of days, and the newest events (see the script's `team_activity`).
    #[serde(rename = "team_activity")]
    TeamActivity {
        from: String,
        to: String,
    },
    /// Every event of the team, newest first, each with the position it touched (the script's `team_activity_log`).
    #[serde(rename = "team_activity_log")]
    TeamActivityLog,
    /// The standing orders of the user's board (the script's `directives`), read only.
    Directives,
    /// How the box's push to the website is going (its periodic push's last outcome).
    #[serde(rename = "cloud_sync")]
    CloudSync,
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
    /// The kind of read, as the load-times log names it (one of `runtime_log::POSITIONS_READ_KINDS`).
    fn op(&self) -> &'static str {
        crate::runtime_log::POSITIONS_READ_KINDS[match self {
            Self::List { .. } => 0,
            Self::Detail { .. } => 1,
            Self::Facets => 2,
            Self::Stats => 3,
            Self::Map { .. } => 4,
            Self::Profile => 5,
            Self::CloudSync => 6,
            Self::TeamActivity { .. } => 7,
            Self::Directives => 8,
            Self::Piles => 9,
            Self::TeamActivityLog => 10,
        }]
    }

    fn valid(&self) -> bool {
        match self {
            Self::List { filters } => filters.as_ref().map_or(true, PositionFilters::valid),
            Self::Detail { id } => {
                (1..=20).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit())
            }
            Self::Map { offset } => *offset <= 1_000_000,
            Self::TeamActivity { from, to } => valid_day(from) && valid_day(to) && from <= to,
            Self::Facets | Self::Stats | Self::Piles | Self::Profile | Self::CloudSync | Self::Directives | Self::TeamActivityLog => true,
        }
    }
}

/// A calendar day as the activity range names it: `YYYY-MM-DD`, digits only (the reader checks the date itself).
fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| if index == 4 || index == 7 { *byte == b'-' } else { byte.is_ascii_digit() })
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
        PositionsRequest::List { .. } | PositionsRequest::Facets | PositionsRequest::Directives | PositionsRequest::TeamActivityLog => data
            .as_object()
            .and_then(|data| data.get("items"))
            .is_some_and(|items| {
                items
                    .as_array()
                    .is_some_and(|items| items.iter().all(|item| item.is_object()))
            }),
        PositionsRequest::Map { .. } => data.as_object().is_some_and(|data| {
            data.len() == 3
                && array(data.get("items"))
                && data["items"].as_array().is_some_and(|items| items.iter().all(Value::is_object))
                && data.get("total").is_some_and(Value::is_u64)
                && data.get("next").is_some_and(|next| next.is_null() || next.is_u64())
        }),
        PositionsRequest::Piles => data.as_object().is_some_and(|data| {
            data.len() == 5 && ["scout", "analisti", "scorer", "scrittori", "critici"].iter().all(|key| data.get(*key).is_some_and(Value::is_u64))
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
        PositionsRequest::TeamActivity { .. } => data.as_object().is_some_and(|data| {
            data.len() == 4
                && ["daily", "newest", "seen"]
                    .iter()
                    .all(|key| data.get(*key).and_then(Value::as_array).is_some_and(|items| items.iter().all(Value::is_object)))
                && data.get("meta").is_some_and(Value::is_object)
        }),
        PositionsRequest::CloudSync => data.as_object().is_some_and(|data| {
            let text_or_null = |key: &str| data.get(key).is_some_and(|value| value.is_null() || value.is_string());
            match data.get("state").and_then(Value::as_str) {
                Some("absent" | "unreadable") => data.len() == 1,
                Some("ok") => {
                    data.len() == 5
                        && data.get("status").and_then(Value::as_str).is_some_and(|status| {
                            matches!(
                                status,
                                "completed" | "idle" | "partial" | "timeout" | "auth_failed" | "failed"
                                    | "signature_unavailable" | "other"
                            )
                        })
                        && text_or_null("last_success_at")
                        && text_or_null("last_attempt_at")
                        && data.get("consecutive_failures").is_some_and(Value::is_u64)
                }
                _ => false,
            }
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

const PYTHON_STDIN_EXEC: &str = "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'";

pub(crate) fn python_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, PYTHON_STDIN_EXEC)
}

/// The same read WITHOUT the checks of `command`: only the engine and `exec` on the container's whole
/// id (64 hex digits, checked here before it goes into the command). It is for a target whose checks
/// passed a few seconds ago (see `read_amortising_checks`): a container that was replaced has another
/// id, and `exec` on the old one fails closed.
pub(crate) fn python_command_unchecked(target: &RuntimeTarget) -> Result<String, &'static str> {
    if !valid_target(target) || !hex(&target.container_id, 64) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        "set -eu\nJHT_CID='{cid}'\n{engine}\n{operation}",
        cid = target.container_id,
        engine = engine_selection(70),
        operation = PYTHON_STDIN_EXEC
    ))
}

/// How long the checks of a pinned container are not repeated for reads of the positions.
const CHECKS_KEPT_MS: u64 = 45_000;
/// The targets whose checks passed, at most this many, in memory only.
const CHECKS_KEPT_TARGETS: usize = 8;

/// The targets whose checks (container, image, revision, digest) passed on a complete read, and
/// when. Only in this process's memory, never on disk; the key is a hash of the whole identity of the
/// connection (account, host, port, user, key, team and every value of the pinned target).
pub(crate) struct VerifiedTargets {
    entries: Mutex<Vec<(String, u64)>>,
}

impl VerifiedTargets {
    pub(crate) const fn new() -> Self {
        Self { entries: Mutex::new(Vec::new()) }
    }

    fn fresh(&self, key: &str, now_ms: u64) -> bool {
        self.entries.lock().is_ok_and(|entries| {
            entries.iter().any(|(kept, at)| kept == key && now_ms.saturating_sub(*at) < CHECKS_KEPT_MS && now_ms >= *at)
        })
    }

    fn remember(&self, key: &str, now_ms: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|(kept, at)| kept != key && now_ms.saturating_sub(*at) < CHECKS_KEPT_MS);
            entries.push((key.to_owned(), now_ms));
            while entries.len() > CHECKS_KEPT_TARGETS {
                entries.remove(0);
            }
        }
    }

    fn forget(&self, key: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|(kept, _)| kept != key);
        }
    }
}

static VERIFIED_TARGETS: VerifiedTargets = VerifiedTargets::new();

fn clock_ms() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// The key of a pinned target's verified state; none for anything but a VPS with a whole pinned target.
fn checks_key(scope: &AccountScope, host: &crate::runtime_host::ValidatedHost, team_id: &str, runtime: &RuntimeTarget) -> Option<String> {
    let crate::runtime_host::ValidatedHost::Vps { address, user, port, key_path, known_hosts } = host else {
        return None;
    };
    if !valid_target(runtime) {
        return None;
    }
    Some(sha256(
        format!(
            "{}\n{address}\n{user}\n{port}\n{}\n{}\n{team_id}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
            scope.digest(),
            key_path.display(),
            known_hosts.display(),
            runtime.container_id,
            runtime.image_id,
            runtime.platform_image_id,
            runtime.oci_revision,
            runtime.digest,
            runtime.os,
            runtime.architecture,
        )
        .as_bytes(),
    ))
}

/// One read of the positions, with the checks of the pinned container done on the first and then only
/// every 45 s: `run(true)` is the complete command with its checks, `run(false)` the shortcut.
/// - the entry is made only by a complete read that succeeded, and a shortcut that worked neither
///   makes nor renews it: the checks come back at the latest 45 s after the last complete read;
/// - any reply that is not a success (a refusal such as exit 70, a timeout, a reply that is not
///   valid) deletes the entry, and a failed shortcut is followed at once by ONE complete read;
/// - with no key (not a VPS with a pinned target) every read is complete.
/// Returns the reply and whether the checks were skipped.
fn read_amortising_checks(
    memory: &VerifiedTargets,
    key: Option<&str>,
    now_ms: impl Fn() -> u64,
    mut run: impl FnMut(bool) -> Value,
) -> (Value, bool) {
    let succeeded = |reply: &Value| reply.get("ok") == Some(&Value::Bool(true));
    let Some(key) = key else {
        return (run(true), false);
    };
    if memory.fresh(key, now_ms()) {
        let reply = run(false);
        if succeeded(&reply) {
            return (reply, true);
        }
        memory.forget(key);
    }
    let reply = run(true);
    if succeeded(&reply) {
        memory.remember(key, now_ms());
    } else {
        memory.forget(key);
    }
    (reply, false)
}

pub(crate) fn delivery_command(
    target: &RuntimeTarget,
    session: &str,
) -> Result<String, &'static str> {
    if !chat_session_ok(session) {
        return Err("invalid_agent");
    }
    command(
        target,
        &format!(
            "\"$JHT_ENGINE\" exec -i \"$JHT_CID\" sh -c 'msg=$(cat); exec jht-tmux-send {session} \"$msg\"'"
        ),
    )
}

/// The agents the chat may be opened with: the closed list of `agent_chat.py`, which refuses any
/// other name again on its side.
pub(crate) const CHAT_AGENTS: [&str; 8] = [
    "capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico",
];

/// The roles that have several sessions and are also spoken to by instance: `analista-2` is the session
/// ANALISTA-2 and the folder `agents/analista-2` (the launcher's own names). `agent_chat.py` has the same grammar.
const NUMBERED_CHAT_ROLES: [&str; 4] = ["scout", "analista", "scorer", "scrittore"];

/// An instance of a numbered role: the role, then a number from 1 to 9999 with no zero in front. Nothing else.
pub(crate) fn chat_instance(agent: &str) -> Option<(&'static str, u16)> {
    let (role, number) = agent.split_once('-')?;
    let role = NUMBERED_CHAT_ROLES.iter().copied().find(|known| *known == role)?;
    if number.is_empty() || number.len() > 4 || number.starts_with('0') || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((role, number.parse().ok()?))
}

/// An id the chat may be opened with: the eight fixed ones, or an instance of a numbered role.
pub(crate) fn chat_agent_ok(agent: &str) -> bool {
    CHAT_AGENTS.contains(&agent) || chat_instance(agent).is_some()
}

/// The tmux session of a chat id («scout» is the first instance, SCOUT-1).
pub(crate) fn chat_session(agent: &str) -> Option<String> {
    let fixed = match agent {
        "capitano" => "CAPITANO",
        "assistente" => "ASSISTENTE",
        "mentor" => "MENTOR",
        "scout" => "SCOUT-1",
        "analista" => "ANALISTA-1",
        "scorer" => "SCORER-1",
        "scrittore" => "SCRITTORE-1",
        "critico" => "CRITICO",
        _ => "",
    };
    if !fixed.is_empty() {
        return Some(fixed.to_owned());
    }
    let (role, number) = chat_instance(agent)?;
    Some(format!("{}-{number}", role.to_ascii_uppercase()))
}

/// A session the chat may write to: the session of an id above, in capitals and nothing else.
pub(crate) fn chat_session_ok(session: &str) -> bool {
    session == session.to_ascii_uppercase() && chat_session(&session.to_ascii_lowercase()).is_some_and(|known| known == session)
}

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
/// The fixed tokens sent to `agent_chat.py`, validated before they become process arguments.
/// Local and pinned runtimes use this same list, so neither has a wider command surface.
pub(crate) fn chat_arguments(operation: &ChatOperation<'_>) -> Result<Vec<String>, &'static str> {
    match operation {
        ChatOperation::Read { agent, cursor } => {
            if !chat_agent_ok(agent) {
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
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            if !chat_token(client_message_id, 64, false) {
                return Err("invalid_request");
            }
            Ok(vec!["send".to_owned(), (*agent).to_owned(), (*client_message_id).to_owned()])
        }
        ChatOperation::Answer { agent, question_id } => {
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            if !chat_question_id(question_id) {
                return Err("invalid_request");
            }
            Ok(vec!["answer".to_owned(), (*agent).to_owned(), (*question_id).to_owned()])
        }
        ChatOperation::Enter { agent, message_id } => {
            if !chat_agent_ok(agent) {
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
    // This computer's team: no SSH, no pinned target; the same reader runs in its container.
    if matches!(validated, crate::runtime_host::ValidatedHost::Local) {
        return positions_read_local(app, scope, &request, &request_bytes);
    }
    let selected = match selected_or_own(app, scope, &host) {
        Ok(selected) => selected,
        Err(error) => return positions_failure(error),
    };
    let team = selected.as_ref().map(|target| (target.team_id.clone(), target.runtime.clone()));
    let command = match read_command_for(selected, &host) {
        Ok(command) => command,
        Err(error) => return positions_failure(error),
    };
    // The chat's ssh connection, lent to this read when the chat is connected to the same VPS and team:
    // a read of its own pays a new handshake (and the key exchange) every time.
    let shared = app.try_state::<direct_chat::DirectChatState>().and_then(|chat| {
        direct_chat::shared_master(chat.inner(), scope, &validated, team.as_ref().map(|(id, runtime)| (id.as_str(), runtime)))
    });
    // A key found changed stays blocked for this scope and VPS until the person confirms it again: no `ssh`
    // that is refused and no `ssh-keyscan` per read (the memory is vps_link's).
    let (block_key, pinned) = match &validated {
        crate::runtime_host::ValidatedHost::Vps { address, port, .. } => (
            Some(vps_link::block_key(scope.digest(), address, *port)),
            crate::runtime_host::pinned_host_fingerprint(&validated).ok(),
        ),
        crate::runtime_host::ValidatedHost::Local => (None, None),
    };
    let started = Instant::now();
    // ssh time, bytes out, bytes in and whether the chat's connection was lent, over every run of this read
    let timing = Cell::new((Duration::ZERO, 0usize, 0usize, false));
    let fast_command = team.as_ref().and_then(|(_, runtime)| python_command_unchecked(runtime).ok());
    let key = team.as_ref().and_then(|(team_id, runtime)| checks_key(scope, &validated, team_id, runtime));
    let key = key.filter(|_| fast_command.is_some());
    let mut skipped = false;
    let reply = read_unless_blocked(block_key, pinned, || {
        let (reply, skipped_checks) = read_amortising_checks(&VERIFIED_TARGETS, key.as_deref(), clock_ms, |complete| {
            let chosen = match (&fast_command, complete) {
                (Some(fast), false) => fast,
                _ => &command,
            };
            positions_read_with(
                &request,
                &request_bytes,
                |input| {
                    let ssh_started = Instant::now();
                    let lent = shared.as_deref().filter(|socket| direct_chat::lent_socket_still_ours(socket));
                    let mut result = None;
                    if let Some(socket) = lent {
                        // The master went away between the check and the read (255): one try on a connection of its own.
                        match run_ssh_command(&validated, chosen, Some(input), READ_TIMEOUT, Some(socket)) {
                            Ok(output) if output.code != 255 => result = Some(Ok(output)),
                            _ => {}
                        }
                    }
                    let used_lent = result.is_some();
                    let result = result.unwrap_or_else(|| run_ssh_command(&validated, chosen, Some(input), READ_TIMEOUT, None));
                    let received = result.as_ref().map_or(0, |output| output.stdout.len());
                    let (ssh, out, _, was_lent) = timing.get();
                    timing.set((ssh + ssh_started.elapsed(), out + input.len(), received, was_lent || used_lent));
                    result
                },
                || crate::runtime_host::host_key_matches_pin(&validated),
            )
        });
        skipped = skipped_checks;
        reply
    });
    let (ssh, bytes_out, bytes_in, used_lent) = timing.get();
    if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
        log.record_positions_read(&crate::runtime_log::PositionsReadTiming {
            op: request.op(),
            shared: used_lent,
            checks_skipped: skipped,
            ok: reply.get("ok") == Some(&Value::Bool(true)),
            total: started.elapsed(),
            ssh,
            bytes_out,
            bytes_in,
        });
    }
    reply
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

/// How long the check «is the team's container up» may take, once a read failed.
const LOCAL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The read of this computer's team. The reader and the request travel on stdin to the host wrapper's
/// `desktop-chat python`, the channel the chat and «Export my data» use: it finds the attested container, runs
/// the reader in it and never starts anything. Before it runs, this account must own the runtime's folder (a
/// check only: the read never claims it) and the wrapper must speak the chat's protocol.
fn positions_read_local(app: &tauri::AppHandle, scope: &AccountScope, request: &PositionsRequest, request_bytes: &[u8]) -> Value {
    let started = Instant::now();
    let wrapper = match local_reader_wrapper(app, scope) {
        Ok(wrapper) => wrapper,
        Err(error) => return positions_failure(error),
    };
    let reply = positions_read_local_with(
        request,
        request_bytes,
        &crate::local_swipe::scope_tag(scope),
        local_machine_is_off,
        |input| crate::onboarding::run_verified_local_wrapper(&wrapper, &["desktop-chat", "python"], Some(input), READ_TIMEOUT),
        || {
            crate::onboarding::run_verified_local_wrapper(&wrapper, &["desktop-chat", "probe"], None, LOCAL_PROBE_TIMEOUT)
                .map(|probe| probe.success())
                .unwrap_or(false)
        },
        || positions_saved_reply(app, request),
    );
    if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
        log.record_positions_read(&crate::runtime_log::PositionsReadTiming {
            op: request.op(),
            shared: false,
            checks_skipped: false,
            ok: reply.get("ok") == Some(&Value::Bool(true)),
            total: started.elapsed(),
            ssh: Duration::ZERO,
            bytes_out: request_bytes.len(),
            bytes_in: 0,
        });
    }
    reply
}

/// The host wrapper a read of this computer's team goes through, once this account is the runtime's owner.
pub(crate) fn local_reader_wrapper(app: &tauri::AppHandle, scope: &AccountScope) -> Result<std::path::PathBuf, &'static str> {
    let mut found = None;
    let checked = (|| {
        let marker = crate::account_scope::local_owner_marker_path(app)?;
        crate::account_scope::verify_local_runtime_owner(&marker, scope)?;
        let wrapper = crate::onboarding::verified_local_wrapper_path(app)?;
        found = Some(wrapper.clone());
        if !crate::onboarding::wrapper_has_desktop_chat(&wrapper) {
            return Err("local_chat_wrapper_outdated");
        }
        Ok(wrapper)
    })();
    // Every refusal leaves a line: pages that read nothing were silent, and the code said only «outdated».
    if let Err(code) = checked {
        if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
            let wrapper = found.or_else(|| crate::onboarding::expected_wrapper_path(app));
            log.record_local_reader_refusal(code, wrapper.as_deref(), app.path().home_dir().ok().as_deref());
        }
    }
    checked
}

/// Whether the machine that runs this computer's team is stopped. Only Windows has a machine of its own (Podman's); on
/// the other systems the container is asked and the answer to a container that is off comes from the wrapper.
pub(crate) fn local_machine_is_off() -> bool {
    #[cfg(windows)]
    {
        // One question a few seconds apart, not one per read: a page asks several things in a row.
        static LAST: std::sync::Mutex<Option<(Instant, bool)>> = std::sync::Mutex::new(None);
        const FRESH: Duration = Duration::from_secs(3);
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, off)) = *last {
            if at.elapsed() < FRESH {
                return off;
            }
        }
        let off = crate::podman::jht_machine_is_off();
        *last = Some((Instant::now(), off));
        off
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// One run of the reader in this computer's container, then its reply. A run that fails is told apart by asking
/// whether the team is up (`team_is_up`, asked only then): a container that is off says so, in the chat's own
/// words; anything else is the reader's failure.
fn positions_read_local_with(
    request: &PositionsRequest,
    request_bytes: &[u8],
    token_tag: &str,
    machine_is_off: impl FnOnce() -> bool,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
    saved: impl FnOnce() -> Option<Value>,
) -> Value {
    // The team's machine is stopped (asked by a read of its state, which starts nothing): the wrapper is not called at all,
    // because a call to the engine of a stopped machine is not known to leave it alone. The pages show what the team saved.
    if machine_is_off() {
        return saved().unwrap_or_else(|| positions_failure("local_team_not_running"));
    }
    let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(request_bytes);
    input.push(b'\n');
    match run(&input) {
        Ok(output) if output.success() => positions_reply_from_output(request, output, Some(token_tag)),
        // The container is off: the pages show what the team saved, read here from a private copy of its jobs.db, and say so.
        _ if !team_is_up() => saved().unwrap_or_else(|| positions_failure("local_team_not_running")),
        _ => positions_answer_failure("positions_unavailable"),
    }
}

/// The saved data of this computer's team for a read, checked like the container's own reply: a well-formed answer of the shape
/// the request asked for (with the moment they were written beside it), or a failure of the saved data, or nothing.
fn positions_saved_reply(app: &tauri::AppHandle, request: &PositionsRequest) -> Option<Value> {
    let home = crate::account_scope::local_runtime_home(app).ok()?;
    let work = app.path().app_local_data_dir().ok()?.join("host-db");
    let asked = serde_json::to_value(request).ok()?;
    let mut reply = crate::host_positions::read_saved(&home, &work, &asked)?;
    let saved = reply.as_object_mut().and_then(|object| object.remove("saved"));
    if reply.get("ok") == Some(&Value::Bool(true)) {
        if !valid_positions_reply(request, &reply) {
            return Some(positions_answer_failure("positions_unavailable"));
        }
        reply.as_object_mut()?.insert("saved".into(), saved?);
        return Some(reply);
    }
    match reply.get("error").and_then(Value::as_str) {
        Some("host_db_unsafe") => Some(positions_answer_failure("host_db_unsafe")),
        Some("host_db_busy") => Some(positions_answer_failure("host_db_busy")),
        Some("host_db_unreadable") => Some(positions_answer_failure("host_db_unreadable")),
        Some("host_db_invalid") => Some(positions_answer_failure("host_db_invalid")),
        Some("host_db_timeout") => Some(positions_answer_failure("host_db_timeout")),
        Some("positions_request_invalid") => Some(positions_answer_failure("positions_request_invalid")),
        _ => Some(positions_answer_failure("positions_unavailable")),
    }
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
    positions_reply_from_output(request, output, None)
}

/// What the reader printed, as the page's reply: a bounded, well-formed answer of the shape the request asked
/// for, or why it is not one. The same for the VPS and for this computer's container.
fn positions_reply_from_output(request: &PositionsRequest, output: ProcessResult, token_tag: Option<&str>) -> Value {
    if output.stdout.len() > 2 * 1024 * 1024 {
        return positions_answer_failure("positions_unavailable");
    }
    let mut reply: Value = match serde_json::from_slice(&output.stdout) {
        Ok(reply) => reply,
        Err(_) => return positions_answer_failure("positions_unavailable"),
    };
    // The identity of the database file, which only a detail read of this computer's team turns into a token.
    let ident = reply.as_object_mut().and_then(|object| object.remove("ident"));
    if valid_positions_reply(request, &reply) {
        if matches!(request, PositionsRequest::Profile) {
            return shape_profile(reply);
        }
        if let (Some(tag), PositionsRequest::Detail { .. }, Some(ident)) = (token_tag, request, ident) {
            if let Some(token) = crate::local_swipe::token_from_ident(tag, &ident) {
                if let Some(data) = reply.get_mut("data").and_then(Value::as_object_mut) {
                    data.insert("token".into(), Value::String(token));
                }
            }
        }
        return reply;
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
    fn the_cloud_sync_read_is_a_closed_request_and_a_closed_reply() {
        assert!(matches!(parse_positions_request(json!({"op": "cloud_sync"})), Ok(PositionsRequest::CloudSync)));
        assert!(POSITIONS_READ_PY.contains("if op=='cloud_sync':"));
        // the token lives in cloud.json: the reader never names it
        let reader = POSITIONS_READ_PY.split("if op=='cloud_sync':").nth(1).unwrap().split("if op=='profile':").next().unwrap();
        assert!(!reader.contains("cloud.json") && !reader.contains("token"));
        let ok = |data: Value| json!({"ok": true, "data": data});
        for good in [
            json!({"state": "absent"}),
            json!({"state": "unreadable"}),
            json!({"state": "ok", "status": "auth_failed", "last_success_at": "2026-10-07T12:12:46.425Z", "last_attempt_at": null, "consecutive_failures": 45000}),
            json!({"state": "ok", "status": "other", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0}),
        ] {
            assert!(valid_positions_reply(&PositionsRequest::CloudSync, &ok(good.clone())), "{good}");
        }
        for broken in [
            json!({"state": "absent", "status": "idle"}),
            json!({"state": "ok", "status": "auth_failed", "last_success_at": null, "last_attempt_at": null}),
            json!({"state": "ok", "status": "exploded", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0}),
            json!({"state": "ok", "status": "idle", "last_success_at": 1, "last_attempt_at": null, "consecutive_failures": 0}),
            json!({"state": "ok", "status": "idle", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": -1}),
            json!({"state": "ok", "status": "idle", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0, "token": "x"}),
            json!({"state": "other"}),
            json!(null),
        ] {
            assert!(!valid_positions_reply(&PositionsRequest::CloudSync, &ok(broken.clone())), "{broken}");
        }
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
    fn an_instance_of_a_numbered_role_is_a_closed_form_of_the_chat_command() {
        let last = |command: String| command.lines().last().expect("a last line").to_owned();
        assert_eq!(
            last(chat_command(&target(), &ChatOperation::Read { agent: "analista-2", cursor: None }).unwrap()),
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'analista-2'"
        );
        assert_eq!(
            chat_wrapper_arguments(&ChatOperation::Send { agent: "scout-12", client_message_id: "id-1" }).unwrap(),
            ["desktop-chat", "chat-send", "scout-12", "id-1"]
        );
        assert_eq!(chat_session("scout-12").as_deref(), Some("SCOUT-12"));
        assert_eq!(chat_session("scout").as_deref(), Some("SCOUT-1"));
        assert!(chat_session_ok("SCRITTORE-9999") && chat_session_ok("CRITICO"));
        for bad in ["scout", "SCOUT", "SCOUT-0", "SCOUT-01", "scout-2", "SCOUT-2 ", "CRITICO-2", "CAPITANO-1", ""] {
            assert!(!chat_session_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn nothing_outside_the_closed_forms_enters_the_chat_command() {
        for agent in [
            "", "CAPITANO", "capitano ", "capitano'; id #", "scout-0", "scout-01", "scout-10000", "scout-1-2", "SCOUT-1", "scout-2\n",
            "scout-2'; id #", "critico-2", "../mentor", "capitano\n", "agente",
        ] {
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
        let source = include_str!("existing_team_runtime/own_vps_claim.rs");
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
    fn piles_is_a_closed_read_only_op_that_answers_five_counts_and_nothing_else() {
        assert!(matches!(parse_positions_request(json!({"op": "piles"})), Ok(PositionsRequest::Piles)));
        // like stats: whatever else a caller adds is gone before the reader, which refuses it anyway
        let forwarded = parse_positions_request(json!({"op": "piles", "filters": {}, "id": "1"}))
            .map(|request| serde_json::to_value(request).expect("request serializes"));
        assert_eq!(forwarded, Ok(json!({"op": "piles"})));
        assert!(PositionsRequest::Piles.valid());
        let good = json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}});
        assert!(valid_positions_reply(&PositionsRequest::Piles, &good));
        for broken in [
            json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7}}),
            json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0, "rows": []}}),
            json!({"ok": true, "data": {"scout": -1, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
            json!({"ok": true, "data": {"scout": 1.5, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
            json!({"ok": true, "data": {"scout": "3", "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
            json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": null}}),
            json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "other": 0}}),
            json!({"ok": true, "data": [3, 1, 2, 7, 0]}),
            json!({"ok": true, "data": null}),
            json!({"ok": true, "data": {"scout": 0, "analisti": 0, "scorer": 0, "scrittori": 0, "critici": 0}, "extra": 1}),
        ] {
            assert!(!valid_positions_reply(&PositionsRequest::Piles, &broken), "{broken}");
        }
        // the reader knows the op, takes no field but `op`, and every kind of read has its name in the load-times log
        assert!(POSITIONS_READ_PY.contains("if op=='piles':"));
        assert!(POSITIONS_READ_PY.contains("('facets','stats','piles','profile','cloud_sync','directives','team_activity_log') and set(req)!={'op'}"));
        assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[9], "piles");
        assert_eq!(PositionsRequest::Piles.op(), "piles");
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

    // ---- the checks of the pinned container, not repeated for a few seconds ----

    fn synthetic_runtime() -> RuntimeTarget {
        ActivatedTarget::synthetic_for_tests().runtime
    }

    fn vps(key: &str) -> crate::runtime_host::ValidatedHost {
        crate::runtime_host::ValidatedHost::Vps {
            address: "synthetic.example.invalid".into(),
            user: "synthetic".into(),
            port: 22,
            key_path: PathBuf::from(key),
            known_hosts: PathBuf::from("/synthetic/known_hosts"),
        }
    }

    fn ok_reply() -> Value {
        json!({"ok": true, "data": {"items": []}})
    }

    fn refusal() -> Value {
        json!({"ok": false, "error": "existing_team_runtime_changed"})
    }

    /// Runs `reads` reads one after the other at the given times, with a fake executor that answers
    /// from `script` (true = ok), and says for each read whether it was the complete command.
    fn drive_reads(memory: &VerifiedTargets, key: &str, clock: &std::cell::Cell<u64>, steps: &[(u64, &[bool])]) -> Vec<(Vec<bool>, bool, bool)> {
        steps
            .iter()
            .map(|(at, answers)| {
                clock.set(*at);
                let mut asked = Vec::new();
                let mut next = answers.iter();
                let (reply, skipped) = read_amortising_checks(memory, Some(key), || clock.get(), |complete| {
                    asked.push(complete);
                    if *next.next().expect("a reply for every run") { ok_reply() } else { refusal() }
                });
                (asked, skipped, reply["ok"] == true)
            })
            .collect()
    }

    #[test]
    fn the_checks_are_made_on_the_first_read_and_not_repeated_for_45_seconds() {
        let memory = VerifiedTargets::new();
        let clock = std::cell::Cell::new(0);
        let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (10_000, &[true]), (44_000, &[true]), (46_000, &[true]), (50_000, &[true])]);
        // complete, shortcut, shortcut, and at 46 s (45 s after the last COMPLETE read, not after the
        // last shortcut) complete again, then the shortcut
        assert_eq!(seen[0], (vec![true], false, true));
        assert_eq!(seen[1], (vec![false], true, true));
        assert_eq!(seen[2], (vec![false], true, true));
        assert_eq!(seen[3], (vec![true], false, true), "a shortcut that worked does not renew the entry");
        assert_eq!(seen[4], (vec![false], true, true));
    }

    #[test]
    fn a_container_that_was_replaced_is_never_read_on_the_shortcut_and_is_refused() {
        let memory = VerifiedTargets::new();
        let clock = std::cell::Cell::new(0);
        // the shortcut fails (`exec` on the old id), the complete read answers exit 70's refusal: once each
        let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (5_000, &[false, false]), (6_000, &[true]), (7_000, &[true])]);
        assert_eq!(seen[1], (vec![false, true], false, false), "one shortcut, then ONE complete read, then the refusal");
        // the refusal deleted the entry: the next read is complete, and so makes it again
        assert_eq!(seen[2], (vec![true], false, true));
        assert_eq!(seen[3], (vec![false], true, true));
    }

    #[test]
    fn a_failed_shortcut_falls_back_at_once_and_only_once() {
        let memory = VerifiedTargets::new();
        let clock = std::cell::Cell::new(0);
        // the shortcut fails, the complete read works (a stopped and restarted container): the entry is made again
        let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (1_000, &[false, true]), (2_000, &[true])]);
        assert_eq!(seen[1], (vec![false, true], false, true));
        assert_eq!(seen[2], (vec![false], true, true));
        // never a third run in one read
        let memory = VerifiedTargets::new();
        let runs = std::cell::Cell::new(0);
        read_amortising_checks(&memory, Some("target"), || 0, |_| { runs.set(runs.get() + 1); ok_reply() });
        read_amortising_checks(&memory, Some("target"), || 1, |_| { runs.set(runs.get() + 1); refusal() });
        assert_eq!(runs.get(), 3, "one complete read, then a failed shortcut and ONE complete read");
    }

    #[test]
    fn another_account_host_key_team_or_target_gets_no_shortcut() {
        let scope = AccountScope::synthetic(b"scope-one");
        let runtime = synthetic_runtime();
        let key = checks_key(&scope, &vps("/k/one"), "team-one", &runtime).expect("a pinned target on a VPS");
        let mut other_runtime = |edit: fn(&mut RuntimeTarget)| {
            let mut changed = runtime.clone();
            edit(&mut changed);
            checks_key(&scope, &vps("/k/one"), "team-one", &changed).expect("still whole")
        };
        let keys = [
            checks_key(&AccountScope::synthetic(b"scope-two"), &vps("/k/one"), "team-one", &runtime).unwrap(),
            checks_key(&scope, &vps("/k/two"), "team-one", &runtime).unwrap(),
            checks_key(&scope, &vps("/k/one"), "team-two", &runtime).unwrap(),
            other_runtime(|target| target.container_id = "9".repeat(64)),
            other_runtime(|target| target.image_id = format!("sha256:{}", "9".repeat(64))),
            other_runtime(|target| target.platform_image_id = format!("sha256:{}", "9".repeat(64))),
            other_runtime(|target| target.oci_revision = "9".repeat(40)),
            other_runtime(|target| target.digest = format!("sha256:{}", "9".repeat(64))),
        ];
        for other in &keys {
            assert_ne!(other, &key);
        }
        // and it holds in the memory: a read of the first target does not open a shortcut for the others
        let memory = VerifiedTargets::new();
        read_amortising_checks(&memory, Some(&key), || 0, |_| ok_reply());
        for other in &keys {
            let (_, skipped) = read_amortising_checks(&memory, Some(other), || 1_000, |_| ok_reply());
            assert!(!skipped, "{other}");
        }
        // a target that is not whole, or not on a VPS, has no key and is read complete every time
        let mut broken = runtime.clone();
        broken.container_id = "abc".into();
        assert!(checks_key(&scope, &vps("/k/one"), "team-one", &broken).is_none());
        assert!(checks_key(&scope, &crate::runtime_host::ValidatedHost::Local, "team-one", &runtime).is_none());
        let runs = std::cell::Cell::new(0);
        for _ in 0..3 {
            let (_, skipped) = read_amortising_checks(&memory, None, || 0, |complete| { assert!(complete); runs.set(runs.get() + 1); ok_reply() });
            assert!(!skipped);
        }
        assert_eq!(runs.get(), 3);
    }

    #[test]
    fn the_shortcut_has_no_checks_and_runs_only_on_a_whole_container_id() {
        let runtime = synthetic_runtime();
        let fast = python_command_unchecked(&runtime).unwrap();
        let full = python_command(&runtime).unwrap();
        assert_eq!(fast.matches("inspect").count(), 0);
        assert!(full.contains("inspect"));
        assert!(fast.contains(&format!("JHT_CID='{}'", runtime.container_id)));
        assert!(fast.ends_with(PYTHON_STDIN_EXEC));
        // the engine is still chosen, and the id is the only thing the command is made of
        assert!(fast.contains("JHT_ENGINE=docker") && fast.contains("JHT_ENGINE=podman"));
        for bad in ["", "abc", &"A".repeat(64), &format!("{}'; id #", "a".repeat(40)), &"g".repeat(64), &"a".repeat(65)] {
            let mut target = runtime.clone();
            target.container_id = bad.to_string();
            assert_eq!(python_command_unchecked(&target), Err("existing_team_runtime_candidate_invalid"), "{bad:?}");
        }
    }

    #[test]
    fn the_checks_memory_forgets_after_the_time_and_stays_small() {
        let memory = VerifiedTargets::new();
        memory.remember("a", 0);
        assert!(memory.fresh("a", 44_999) && !memory.fresh("a", 45_000));
        // a clock that went back is no proof
        memory.remember("b", 10_000);
        assert!(!memory.fresh("b", 5_000));
        for n in 0..20 {
            memory.remember(&format!("t{n}"), 100_000 + n);
        }
        assert!(memory.entries.lock().unwrap().len() <= CHECKS_KEPT_TARGETS);
        memory.forget("t19");
        assert!(!memory.fresh("t19", 100_050));
    }

    #[test]
    fn the_globes_read_is_a_closed_read_only_op_with_a_closed_reply() {
        assert!(matches!(parse_positions_request(json!({"op": "map"})), Ok(PositionsRequest::Map { offset: 0 })));
        let forwarded = parse_positions_request(json!({"op": "map", "offset": 5000}))
            .map(|request| serde_json::to_value(request).expect("request serializes"));
        assert_eq!(forwarded, Ok(json!({"op": "map", "offset": 5000})));
        // what is not an offset, or comes with something else, never reaches the reader
        for bad in [
            json!({"op": "map", "offset": -1}),
            json!({"op": "map", "offset": "0"}),
            json!({"op": "map", "offset": 1_000_001}),
            json!({"op": "map", "filters": {}}),
            json!({"op": "map", "id": "1"}),
            json!({"op": "list", "offset": 0}),
        ] {
            assert!(parse_positions_request(bad.clone()).is_err(), "{bad}");
        }
        let request = PositionsRequest::Map { offset: 0 };
        let good = json!({"ok": true, "data": {"items": [{"id": "1"}], "total": 1, "next": null}});
        assert!(valid_positions_reply(&request, &good));
        assert!(valid_positions_reply(&request, &json!({"ok": true, "data": {"items": [], "total": 9, "next": 4}})));
        for broken in [
            json!({"ok": true, "data": {"items": [{"id": "1"}], "total": 1}}),
            json!({"ok": true, "data": {"items": ["x"], "total": 1, "next": null}}),
            json!({"ok": true, "data": {"items": [], "total": -1, "next": null}}),
            json!({"ok": true, "data": {"items": [], "total": 1, "next": "2"}}),
            json!({"ok": true, "data": {"items": [], "total": 1, "next": null, "extra": 1}}),
            json!({"ok": true, "data": [] }),
        ] {
            assert!(!valid_positions_reply(&request, &broken), "{broken}");
        }
        assert!(POSITIONS_READ_PY.contains("if op=='map':"));
        // it reads the positions' light columns, never the description
        let reader = POSITIONS_READ_PY.split("if op=='map':").nth(1).unwrap().split("filters=req.get").next().unwrap();
        assert!(!reader.contains("jd_text") && !reader.contains("p.*"));
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
    fn the_team_activity_read_takes_only_a_closed_range_of_days_and_answers_the_shape_the_page_expects() {
        let good = json!({"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15"});
        let parsed = parse_positions_request(good.clone()).unwrap();
        assert_eq!(parsed.op(), "team_activity");
        assert_eq!(serde_json::to_value(&parsed).unwrap(), good);
        for bad in [
            json!({"op": "team_activity"}),
            json!({"op": "team_activity", "from": "2026-10-05"}),
            json!({"op": "team_activity", "from": "2026-10-15", "to": "2026-10-05"}),
            json!({"op": "team_activity", "from": "2026-10-5", "to": "2026-10-15"}),
            json!({"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15", "limit": 3}),
            json!({"op": "team_activity", "from": "2026-10-05\n", "to": "2026-10-15"}),
            json!({"op": "team_activity", "from": "x026-10-05", "to": "2026-10-15"}),
        ] {
            assert!(parse_positions_request(bad.clone()).is_err(), "{bad}");
        }
        let request = parsed;
        let ok = json!({"ok": true, "data": {"daily": [], "newest": [{"role": "scout"}], "seen": [], "meta": {}}});
        assert!(valid_positions_reply(&request, &ok));
        for broken in [
            json!({"ok": true, "data": {"daily": [], "newest": [], "seen": []}}),
            json!({"ok": true, "data": {"daily": [], "newest": [], "seen": [], "meta": [], "extra": 1}}),
            json!({"ok": true, "data": {"daily": [1], "newest": [], "seen": [], "meta": {}}}),
            json!({"ok": true, "data": {"daily": {}, "newest": [], "seen": [], "meta": {}}}),
            json!({"ok": false, "error": "positions_unavailable"}),
        ] {
            assert!(!valid_positions_reply(&request, &broken), "{broken}");
        }
        // the reader that runs on the host takes the range as a parameter, reads read-only and never `SELECT *`
        let reader = POSITIONS_READ_PY.split("if op=='team_activity':").nth(1).unwrap().split("if op=='map':").next().unwrap();
        assert!(!reader.contains("SELECT *") && !reader.contains("p.*"));
        assert!(reader.contains("(first,last)"));
    }

    #[test]
    fn the_board_read_takes_no_argument_and_answers_a_list_of_rows() {
        let parsed = parse_positions_request(json!({"op": "directives"})).unwrap();
        assert_eq!(parsed.op(), "directives");
        assert_eq!(serde_json::to_value(&parsed).unwrap(), json!({"op": "directives"}));
        // a key it does not take is never sent on: what goes to the reader is the request alone
        for extra in [
            json!({"op": "directives", "id": "3"}),
            json!({"op": "directives", "filters": {}}),
            json!({"op": "directives", "from": "2026-10-01", "to": "2026-10-02"}),
        ] {
            if let Ok(kept) = parse_positions_request(extra.clone()) {
                assert_eq!(serde_json::to_value(&kept).unwrap(), json!({"op": "directives"}), "{extra}");
            }
        }
        assert!(valid_positions_reply(&parsed, &json!({"ok": true, "data": {"items": [{"id": 1, "body": "x"}]}})));
        for broken in [
            json!({"ok": true, "data": {"items": [1]}}),
            json!({"ok": true, "data": {"rows": []}}),
            json!({"ok": true, "data": []}),
        ] {
            assert!(!valid_positions_reply(&parsed, &broken), "{broken}");
        }
        let reader = POSITIONS_READ_PY.split("if op=='directives':").nth(1).unwrap().split("if op=='team_activity':").next().unwrap();
        assert!(!reader.contains("SELECT *") && reader.contains("LIMIT"));
        // every kind of read has its name in the load-times log
        assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[8], "directives");
    }

    #[test]
    fn the_activity_log_read_takes_no_argument_and_answers_a_list_of_rows() {
        let parsed = parse_positions_request(json!({"op": "team_activity_log"})).unwrap();
        assert_eq!(parsed.op(), "team_activity_log");
        assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[10], "team_activity_log");
        // like piles: whatever else a caller adds is gone before the reader, which refuses it anyway
        for extra in [
            json!({"op": "team_activity_log", "from": "2026-10-01", "to": "2026-10-02"}),
            json!({"op": "team_activity_log", "limit": 3}),
            json!({"op": "team_activity_log", "id": "1"}),
        ] {
            let forwarded = parse_positions_request(extra.clone()).map(|request| serde_json::to_value(request).expect("request serializes"));
            assert_eq!(forwarded, Ok(json!({"op": "team_activity_log"})), "{extra}");
        }
        assert!(POSITIONS_READ_PY.contains("'directives','team_activity_log') and set(req)!={'op'}"));
        assert!(valid_positions_reply(&parsed, &json!({"ok": true, "data": {"items": [{"role": "scout", "ts": "2026-10-01"}]}})));
        for broken in [json!({"ok": true, "data": {"rows": []}}), json!({"ok": true, "data": []}), json!({"ok": true, "data": {"items": [1]}})] {
            assert!(!valid_positions_reply(&parsed, &broken), "{broken}");
        }
        // it reads the five sources' time columns and the position's title, company and number, never a whole row
        let reader = POSITIONS_READ_PY.split("if op=='team_activity_log':").nth(1).unwrap().split("if op=='team_activity':").next().unwrap();
        assert!(!reader.contains("SELECT *") && !reader.contains("jd_text") && reader.contains("LIMIT") && reader.contains("BUDGET"));
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
    fn a_team_that_is_off_answers_from_its_saved_data_and_one_that_is_up_does_not_ask_for_them() {
        let failed = || Err("spawn_failed");
        let saved = json!({"ok": true, "data": {"items": []}, "saved": {"at": 1793879580}});
        let off = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || false, || Some(saved.clone()));
        assert_eq!(off, saved);
        // nothing saved to answer with: the sentence it always was
        let none = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || false, || None);
        assert_eq!(none, positions_failure("local_team_not_running"));
        // the team is up and the reader failed: the saved data are not a stand-in for a failure of a team that is running
        let up = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || true, || panic!("not asked"));
        assert_eq!(up, positions_answer_failure("positions_unavailable"));
    }

    #[test]
    fn a_stopped_machine_is_never_asked_for_anything_and_the_pages_show_what_the_team_saved() {
        let saved = json!({"ok": true, "data": {"items": []}, "saved": {"at": 1793879580}});
        let shown = positions_read_local_with(
            &PositionsRequest::Facets,
            br#"{"op":"facets"}"#,
            "0123456789abcdef",
            || true,
            |_| panic!("the wrapper must not be called for a stopped machine"),
            || panic!("nor the question whether the team is up"),
            || Some(saved.clone()),
        );
        assert_eq!(shown, saved);
        // nothing saved to show: the sentence it always was, and still nothing asked of the machine
        let empty = positions_read_local_with(
            &PositionsRequest::Facets,
            br#"{"op":"facets"}"#,
            "0123456789abcdef",
            || true,
            |_| panic!("the wrapper must not be called for a stopped machine"),
            || panic!("nor the question whether the team is up"),
            || None,
        );
        assert_eq!(empty, positions_failure("local_team_not_running"));
    }

    /// The read of this computer's team, with the fixed reader on stdin and the team's state asked only after a failure.
    fn read_local(run: Result<ProcessResult, &'static str>, team_is_up: bool) -> (Value, usize) {
        let mut asked = 0;
        let reply = positions_read_local_with(
            &PositionsRequest::Facets,
            br#"{"op":"facets"}"#,
            "0123456789abcdef",
            || false,
            |input| {
                // the same reader and request as the VPS gets, on stdin: the reader in hex, then the request
                let text = String::from_utf8(input.to_vec()).unwrap();
                let (script, request) = text.split_once('\n').unwrap();
                assert_eq!(script, hex_encode(POSITIONS_READ_PY.as_bytes()));
                assert_eq!(request, "{\"op\":\"facets\"}\n");
                run
            },
            || {
                asked += 1;
                team_is_up
            },
            || None,
        );
        (reply, asked)
    }

    #[test]
    fn the_read_of_this_computers_team_returns_the_readers_answer_without_asking_whether_the_team_is_up() {
        let answer = r#"{"ok":true,"data":{"items":[]}}"#;
        assert_eq!(read_local(exited(0, answer), true), (json!({"ok": true, "data": {"items": []}}), 0));
        // the same checks as the VPS: a reply that is not the shape asked for is not an answer
        let failure = |code: &str| json!({"ok": false, "error": code, "kind": "application"});
        assert_eq!(read_local(exited(0, "not json"), true), (failure("positions_unavailable"), 0));
        assert_eq!(read_local(exited(0, r#"{"ok":true,"data":{"rows":[]}}"#), true), (failure("positions_unavailable"), 0));
        assert_eq!(
            read_local(exited(0, r#"{"ok":false,"error":"positions_request_invalid"}"#), true),
            (failure("positions_request_invalid"), 0)
        );
    }

    #[test]
    fn a_failed_read_of_this_computers_team_says_the_team_is_not_running_only_when_it_is_not() {
        let failure = |code: &str| json!({"ok": false, "error": code, "kind": "application"});
        // the container is off (the wrapper found none): the chat's own code, which the pages turn into «Start the team»
        assert_eq!(read_local(exited(1, ""), false), (failure("local_team_not_running"), 1));
        assert_eq!(read_local(Err("process_timeout"), false), (failure("local_team_not_running"), 1));
        assert_eq!(read_local(Err("runtime_missing"), false), (failure("local_team_not_running"), 1));
        // the team is up and the reader failed: not «start the team», and no host-key or network kind
        assert_eq!(read_local(exited(1, ""), true), (failure("positions_unavailable"), 1));
        assert_eq!(read_local(exited(255, ""), true), (failure("positions_unavailable"), 1));
        assert_eq!(read_local(Err("process_timeout"), true), (failure("positions_unavailable"), 1));
    }

    #[test]
    fn this_computers_team_is_read_before_any_pinned_target_or_ssh_and_the_vps_path_is_the_one_it_was() {
        let source = include_str!("existing_team_runtime.rs");
        let body = source.split("pub(crate) fn positions_read_for_scope(").nth(1).unwrap().split("\n}\n").next().unwrap();
        let local = body.find("positions_read_local(app, scope, &request, &request_bytes)").unwrap();
        // the branch is taken on the validated host, ahead of everything that belongs to a VPS
        for vps_only in ["selected_or_own(", "read_command_for(", "shared_master(", "run_ssh_command(", "read_unless_blocked("] {
            assert!(local < body.find(vps_only).unwrap(), "{vps_only}");
        }
        assert!(body[..local].contains("ValidatedHost::Local"));
        // the VPS still reads through positions_read_with, and the local read never reaches an ssh function
        assert!(body.contains("positions_read_with("));
        let local_fn = source.split("fn positions_read_local(").nth(1).unwrap().split("\n}\n").next().unwrap();
        for forbidden in ["run_ssh_command", "ssh", "selected_or_own", "claim"] {
            assert!(!local_fn.replace("ssh: Duration::ZERO", "").contains(forbidden), "{forbidden}");
        }
        // it checks the owner without claiming the folder, and the wrapper's chat protocol, before anything runs
        let wrapper_fn = source.split("fn local_reader_wrapper(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(wrapper_fn.contains("verify_local_runtime_owner") && !wrapper_fn.contains("validate_local_runtime"));
        assert!(wrapper_fn.contains("wrapper_has_desktop_chat"));
        // every way out with an error leaves a line in the runtime log, with the wrapper it looked at
        assert!(wrapper_fn.contains("record_local_reader_refusal") && wrapper_fn.contains("if let Err(code) = checked"));
        assert!(wrapper_fn.find("wrapper_has_desktop_chat").unwrap() < wrapper_fn.find("record_local_reader_refusal").unwrap());
        // read only: the reader opens the database that way and the wrapper's channel starts nothing
        assert!(POSITIONS_READ_PY.contains("mode=ro") && POSITIONS_READ_PY.contains("PRAGMA query_only=ON"));
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
    fn a_detail_read_of_this_computers_team_carries_the_token_to_write_with_and_no_other_read_or_team_does() {
        let detail = PositionsRequest::Detail { id: "42".into() };
        let body = json!({"position":{},"score":null,"highlights":[],"company":null,"application":null,"tickets":[],"userNote":null,"exclusionEventAt":null});
        let said = json!({"ok": true, "data": body, "ident": [77, 5]}).to_string();
        let with_token = positions_reply_from_output(&detail, exited(0, &said).unwrap(), Some("0123456789abcdef"));
        assert_eq!(with_token["data"]["token"], "0123456789abcdef.77.5");
        assert!(with_token.get("ident").is_none(), "the identity is not passed on as it is");
        // a team on a VPS: the same reader, the same reply, no token
        let vps = positions_reply_from_output(&detail, exited(0, &said).unwrap(), None);
        assert_eq!(vps, json!({"ok": true, "data": body}));
        // a position that is not there has nothing to write to; a database that is not there (0) gives no token
        let none = json!({"ok": true, "data": null, "ident": [77, 5]}).to_string();
        assert_eq!(positions_reply_from_output(&detail, exited(0, &none).unwrap(), Some("0123456789abcdef")), json!({"ok": true, "data": null}));
        let absent = json!({"ok": true, "data": body, "ident": [0, 0]}).to_string();
        assert!(positions_reply_from_output(&detail, exited(0, &absent).unwrap(), Some("0123456789abcdef"))["data"].get("token").is_none());
        // a garbled identity gives no token and does not break the read
        for ident in [json!([1]), json!("1.2"), json!([-1, 5]), json!([1.5, 5]), json!(null)] {
            let garbled = json!({"ok": true, "data": body, "ident": ident}).to_string();
            let reply = positions_reply_from_output(&detail, exited(0, &garbled).unwrap(), Some("0123456789abcdef"));
            assert_eq!(reply, json!({"ok": true, "data": body}), "{ident}");
        }
        // only a detail read is given one: a list that carries an identity is the list, closed as before
        let list = PositionsRequest::List { filters: None };
        let listed = json!({"ok": true, "data": {"items": []}, "ident": [77, 5]}).to_string();
        assert_eq!(positions_reply_from_output(&list, exited(0, &listed).unwrap(), Some("0123456789abcdef")), json!({"ok": true, "data": {"items": []}}));
        // and the reader answers the identity of the file only for a detail
        assert!(POSITIONS_READ_PY.contains("if op=='detail': emit({'ok':True,'data':position_detail(int(req['id']))} if absent else {'ok':True,'data':position_detail(int(req['id'])),'ident':ident})"));
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
