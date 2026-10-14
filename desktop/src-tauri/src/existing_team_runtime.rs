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
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
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
 for key in ('unscored','criticUnscored','writeRequested'):
  if key in filters and type(filters[key]) is not bool: return None
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
 def value(item):
  if key=='id': return item.get('legacy_id')
  if key in ('salary','monthly'): return item.get('salary_min')
  if key=='remote': return item.get('remote_type')
  if key=='critic': return item.get('critic_score')
  if key=='last_action_by': return item.get('last_action_actor')
  return item.get(key or 'found_at')
 if key:
  present=[item for item in items if value(item) is not None]; missing=[item for item in items if value(item) is None]
  present.sort(key=value,reverse=direction=='desc'); items[:]=present+missing
 return items
try: req=json.loads(sys.stdin.readline())
except Exception: fail('positions_request_invalid')
if not isinstance(req,dict) or set(req)-{'op','filters','id'}: fail('positions_request_invalid')
op=req.get('op')
if op not in ('list','detail','facets'): fail('positions_request_invalid')
if op=='detail' and (set(req)!={'op','id'} or not isinstance(req['id'],str) or not req['id'].isdigit() or len(req['id'])>20): fail('positions_request_invalid')
if op=='facets' and set(req)!={'op'}: fail('positions_request_invalid')
if op=='list' and (set(req)-{'op','filters'} or (req.get('filters') is not None and not isinstance(req.get('filters'),dict))): fail('positions_request_invalid')
try:
 db=sqlite3.connect('file:/jht_home/jobs.db?mode=ro',uri=True); db.row_factory=sqlite3.Row; db.execute('PRAGMA query_only=ON'); db.execute('SELECT 1 FROM positions LIMIT 1')
except Exception: fail('positions_unavailable')
if op=='detail': emit({'ok':True,'data':position_detail(int(req['id']))})
if op=='facets':
 rows=[]
 try:
  for row in db.execute('SELECT p.id,p.status,p.title,p.company,p.role_family,p.loc_country,p.loc_city,s.total_score,a.critic_score FROM positions p LEFT JOIN scores s ON s.position_id=p.id LEFT JOIN applications a ON a.position_id=p.id ORDER BY p.id'):
   rows.append({'id':sid(row[0]),'status':row[1],'title':row[2],'company':row[3],'role_family':row[4],'loc_country':row[5],'loc_city':row[6],'score':row[7],'critic_score':row[8]})
 except sqlite3.Error: fail('positions_unavailable')
 emit({'ok':True,'data':{'items':rows}})
filters=req.get('filters') or {}; allowed={'statuses','remoteTypes','sources','verdicts','families','countries','cities','scoreBands','unscored','criticBands','criticUnscored','writeRequested','q','limit','offset','sort','dir'}
if set(filters)-allowed: fail('positions_request_invalid')
if not isinstance(filters,dict) or any(value is None for value in filters.values()): fail('positions_request_invalid')
if matching({},filters) is None: fail('positions_request_invalid')
try:
 rows=[]
 for raw in db.execute('SELECT p.* FROM positions p ORDER BY p.found_at DESC,p.id ASC'):
  position=as_dict(raw); pid=position.get('id'); score=one('SELECT * FROM scores WHERE position_id=?',(pid,)); application=one('SELECT * FROM applications WHERE position_id=?',(pid,)); item=map_position(position,score,application)
  declared=salary(position); pending=ticket_count(pid)>0; item.update({'salary_min':declared[0],'salary_max':declared[1],'salary_currency':declared[2] or 'EUR','applied_at':nullable(application,'applied_at') if application else None,'written_at':nullable(application,'written_at') if application else None,'has_open_ticket':pending,'ticket_indicator':'pending' if pending else 'none','public_state':state(position.get('status'))})
  matched=matching(item,filters)
  if matched is None: fail('positions_request_invalid')
  if matched: rows.append(item)
except sqlite3.Error: fail('positions_unavailable')
rows=sort_items(rows,filters)
limit=filters.get('limit'); offset=filters.get('offset',0)
if limit is not None and (type(limit) is not int or not 1<=limit<=600): fail('positions_request_invalid')
if type(offset) is not int or not 0<=offset<=100000: fail('positions_request_invalid')
emit({'ok':True,'data':{'items':rows[offset:offset+limit] if limit is not None else rows[offset:]}})
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
            Self::Facets => true,
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
struct Candidate {
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

#[derive(Clone)]
pub(crate) struct ActivatedTarget {
    pub(crate) team_id: String,
    pub(crate) runtime: RuntimeTarget,
    candidate_sha256: String,
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn team_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

fn valid_target(target: &RuntimeTarget) -> bool {
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

fn root(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "existing_team_runtime_unavailable")
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
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "existing_team_runtime_candidate_invalid")?;
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
    let (candidate, candidate_sha256) = read_candidate_at(&root(app)?, scope)?;
    if candidate.host != *host || candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    Ok(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256,
    })
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

/// Called only after the exact host/team identity and both required sessions
/// have passed the read-only remote probe.
pub(crate) fn activate(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    let root = root(app)?;
    let (candidate, hash) = read_candidate_at(&root, scope)?;
    if !candidate_matches_probed(&candidate, &hash, host, probed) {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    write_selection_at(&root, scope, &candidate, &hash)
}

/// A local connection without a selection preserves the existing local path.
/// Every VPS operation requires a selection; once present, it must see the
/// same candidate bytes, host and team or fail closed.
pub(crate) fn selected(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    let root = root(app)?;
    let selection_path = path(&root, scope, SELECTION_FILE);
    if let Err(error) = fs::symlink_metadata(&selection_path) {
        return if error.kind() == std::io::ErrorKind::NotFound {
            let candidate_exists = match fs::symlink_metadata(path(&root, scope, CANDIDATE_FILE)) {
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
    let bytes = read_bytes(
        &selection_path,
        "existing_team_runtime_selection_invalid",
        "existing_team_runtime_selection_invalid",
    )?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "existing_team_runtime_selection_invalid")?;
    let selection: Selection = serde_json::from_value(value.clone())
        .map_err(|_| "existing_team_runtime_selection_invalid")?;
    if value
        != serde_json::to_value(&selection)
            .map_err(|_| "existing_team_runtime_selection_invalid")?
        || selection.schema != 1
        || !team_id(&selection.team_id)
        || !hex(&selection.candidate_sha256, 64)
    {
        return Err("existing_team_runtime_selection_invalid");
    }
    let (candidate, hash) = read_candidate_at(&root, scope)?;
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

pub(crate) fn team_probe_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        r#"IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
docker exec -i "$JHT_CID" node -e '
const fs=require("fs"), expected=process.argv[1];
let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1"); console.log("providerConfigured="+(configured?"1":"0")); console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0")); console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0")); console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' "$JHT_EXPECTED_TEAM" || exit $?
docker exec "$JHT_CID" tmux has-session -t CAPITANO 2>/dev/null || exit 73
docker exec "$JHT_CID" tmux has-session -t ASSISTENTE 2>/dev/null || exit 73
printf 'captainRunning=1\nassistantRunning=1\n'"#,
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

pub(crate) fn snapshot_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "docker exec \"$JHT_CID\" node -e 'const fs=require(\"fs\"); let c={}; try{c=JSON.parse(fs.readFileSync(\"/jht_home/jht.config.json\",\"utf8\"))}catch{}; const p=String(c.active_provider||\"\").toLowerCase(); const marker={claude:\"/jht_home/.claude/.credentials.json\",anthropic:\"/jht_home/.claude/.credentials.json\",codex:\"/jht_home/.codex/auth.json\",openai:\"/jht_home/.codex/auth.json\",kimi:\"/jht_home/.kimi/credentials/kimi-code.json\",moonshot:\"/jht_home/.kimi/credentials/kimi-code.json\"}[p]; const ok=[\"claude\",\"anthropic\",\"codex\",\"openai\",\"kimi\",\"moonshot\"].includes(p); console.log(\"runtimeInstalled=1\\ncontainerRunning=1\\nproviderConfigured=\"+(ok?\"1\":\"0\")+\"\\nproviderAuthenticated=\"+(marker&&fs.existsSync(marker)?\"1\":\"0\")+\"\\nprofileReady=\"+(fs.existsSync(\"/jht_home/profile/ready.flag\")?\"1\":\"0\")+\"\\nassistantWelcomed=\"+(fs.existsSync(\"/jht_home/profile/welcomed.flag\")?\"1\":\"0\"));'")
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

fn positions_failure(code: &'static str) -> Value {
    json!({"ok":false,"error":code})
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

/// Fixed read-only jobs-db bridge for the desktop adapter. The renderer sends
/// typed operation data only; it never supplies a host, container or SQL.
#[tauri::command]
pub(crate) async fn existing_team_positions_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let request = match parse_positions_request(request) {
        Ok(request) => request,
        Err(()) => return Ok(positions_failure("positions_request_invalid")),
    };
    let request_bytes = match serde_json::to_vec(&request) {
        Ok(bytes) if bytes.len() <= 8192 => bytes,
        _ => return Ok(positions_failure("positions_request_invalid")),
    };
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
        let host = direct_chat::load_persisted_host(&app, &worker_expected)?;
        let validated =
            crate::runtime_host::validate_host_for_scope(&app, &host, &worker_expected)?;
        let target =
            selected(&app, &worker_expected, &host)?.ok_or("existing_team_runtime_required")?;
        let command = python_command(&target.runtime)?;
        let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
        input.push(b'\n');
        input.extend_from_slice(&request_bytes);
        input.push(b'\n');
        let output = run_ssh_command(&validated, &command, Some(&input), READ_TIMEOUT, None)
            .map_err(|_| "positions_unavailable")?;
        if !output.success() || output.stdout.len() > 2 * 1024 * 1024 {
            return Err("positions_unavailable");
        }
        let reply: Value =
            serde_json::from_slice(&output.stdout).map_err(|_| "positions_unavailable")?;
        if valid_positions_reply(&request, &reply) {
            return Ok(reply);
        }
        let error = match reply.get("error").and_then(Value::as_str) {
            Some("positions_request_invalid") => "positions_request_invalid",
            Some("positions_unavailable") => "positions_unavailable",
            _ => return Err("positions_unavailable"),
        };
        Ok(positions_failure(error))
    })
    .await
    .unwrap_or_else(|_| Err("positions_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(positions_failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(positions_failure))
}

#[cfg(test)]
mod tests {
    use super::*;

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
