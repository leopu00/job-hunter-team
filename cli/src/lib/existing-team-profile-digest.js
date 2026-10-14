import { createHash } from 'node:crypto';

// `jht existing-team profile --digest`: what can be compared without reading it.
// The reply of the profile op is the candidate's own data; this keeps a closed
// list of facts about it (envelope, states, counts, byte lengths, sha256, the
// names of the fields present with the length of each) and nothing else. It is
// a projection, not a filter: a value can only reach the output by being one of
// the primitives checked below, so a key the companion adds later is dropped.

// The top-level keys of candidate_profile.yml the core keeps (PROFILE_FIELDS in
// desktop/src-tauri/src/existing_team_runtime.rs; a test keeps the two equal).
export const PROFILE_FIELD_NAMES = [
  'aspirations', 'birth_year', 'candidate', 'certifications', 'domain_expertise', 'education',
  'email', 'experience', 'experience_months', 'experience_years', 'goals', 'has_degree',
  'industry', 'interests', 'languages', 'location', 'location_preferences', 'name',
  'nationality', 'notes', 'personal', 'positioning', 'preferences', 'projects',
  'sector_details', 'seniority_target', 'skills', 'strengths', 'target_role',
  'target_role_category_id', 'target_roles', 'target_roles_priority', 'target_specialty',
  'timezone', 'work_authorization',
];
// The summaries the assistant writes by convention; any other name may carry
// personal text, so it is replaced by a hash of itself.
const KNOWN_SUMMARY_NAMES = ['about', 'goals', 'preferences', 'strengths'];

const FILE_STATES = ['absent', 'too_large', 'unreadable', 'not_utf8', 'ok'];
const SUMMARY_STATES = ['ok', 'too_large', 'unreadable', 'not_utf8', 'over_budget'];
const FOLDER_STATES = ['ok', 'absent', 'unreadable'];
const PARSES = ['ok', 'invalid_yaml', 'not_a_mapping', 'aliases_unsupported', 'none'];
const CODE = /^[a-z][a-z0-9_]{0,79}$/;

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : 'unknown');
const code = (value) => (typeof value === 'string' && CODE.test(value) ? value : null);
const sha = (value) => (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null);
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

function kind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function fieldFacts(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  return Object.keys(fields).sort().map((name) => {
    const value = fields[name];
    const encoded = JSON.stringify(value);
    return {
      name: PROFILE_FIELD_NAMES.includes(name) ? name : `h:${hash(name)}`,
      kind: kind(value),
      length: typeof encoded === 'string' ? encoded.length : 0,
    };
  });
}

function summaryFacts(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const name = typeof raw.name === 'string' ? raw.name : '';
  return {
    name: KNOWN_SUMMARY_NAMES.includes(name) ? name : `h:${hash(name)}`,
    state: oneOf(raw.state, SUMMARY_STATES),
    bytes: count(raw.bytes),
    sha256: sha(raw.sha256),
    length: typeof raw.text === 'string' ? raw.text.length : null,
  };
}

/** The envelope of a failed or foreign reply: codes only. */
function envelope(value) {
  const out = { ok: value.ok === true, phase: code(value.phase), code: Number.isInteger(value.code) ? value.code : null };
  if (value.ok !== true) out.error = code(value.error);
  return out;
}

/**
 * {code, value} as runExistingTeamAdapter returns it for the profile op →
 * the same shape, with `value` reduced to the digest. A reply that is ok but is
 * not the profile shape is an invalid reply, never passed through.
 */
export function digestProfileResult(result) {
  const value = result?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: 69, value: { ok: false, phase: 'adapter', code: 69, error: 'existing_team_adapter_invalid_reply' } };
  }
  if (value.ok !== true) return { code: result.code, value: { ...envelope(value), digest: true } };
  const data = value.data;
  const profile = data?.profile;
  const summaries = data?.summaries;
  if (!profile || typeof profile !== 'object' || !summaries || typeof summaries !== 'object' || !Array.isArray(summaries.items)) {
    return { code: 69, value: { ok: false, phase: 'adapter', code: 69, error: 'existing_team_adapter_invalid_reply' } };
  }
  return {
    code: result.code,
    value: {
      ...envelope(value),
      digest: true,
      data: {
        profile: {
          state: oneOf(profile.state, FILE_STATES),
          parse: oneOf(profile.parse, PARSES),
          bytes: count(profile.bytes),
          sha256: sha(profile.sha256),
          kept: count(profile.kept),
          dropped: count(profile.dropped),
          fields: fieldFacts(profile.fields),
        },
        summaries: {
          state: oneOf(summaries.state, FOLDER_STATES),
          included: count(summaries.included),
          of: count(summaries.of),
          items: summaries.items.map(summaryFacts),
        },
      },
    },
  };
}
