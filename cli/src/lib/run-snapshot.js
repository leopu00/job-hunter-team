/**
 * Snapshots of a run of the team (JHT-T355): archive it, take it up again days later as a person who comes back would, replay it from
 * the same inputs, and compare two runs in aggregate numbers.
 *
 * A snapshot is a private folder (0700, files 0600) under the archive root:
 *
 *   <root>/<name>/manifest.json      schema, times, version, provider and models per role, budget, zone, host, every file with sha256
 *   <root>/<name>/home/...           the parts of JHT_HOME: jobs.db (a backup consistent with the WAL), the config without secrets,
 *                                    profile/, state/, logs/, agents/, the pi sessions (spending and calls)
 *   <root>/<name>/user/...           the parts of the visible folder: allegati/ (inputs), cv/ and output/ (what the team wrote)
 *
 * No secret goes in: credentials/ and files named like keys or tokens are left out, JSON values under a secret-named key are saved as
 * null (the rule of `jht backup`), values that look like a key in text files are replaced, columns with a secret name in the copy of the
 * database are emptied. The one exception is the copy a restore keeps of what it replaces (`before-restore-<time>`, `raw` in its
 * manifest): that one is whole, keys and links included, because the restore deletes exactly those parts of the home and the copy is
 * the only way back. The pieces that need the team or the host (stop, start, where it runs) are passed in, so the whole module is
 * tried on made-up homes.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { SECRET_KEY, mergeLiveSecrets, redactSecrets } from './backup-secrets.js';

export const SNAPSHOT_SCHEMA = 'jht.run.snapshot/1';
export const LEGACY_SCHEMA = 'jht.run.snapshot/manual';
export const DIFF_SCHEMA = 'jht.run.diff/1';
export const USEFUL_SCORE = 70;

/** What a snapshot keeps, and what a `--fresh` restore keeps of it: the inputs only. */
export const HOME_ENTRIES = [
  { path: 'jobs.db', role: 'result', db: true },
  { path: 'jht.config.json', role: 'input', config: true },
  { path: 'profile', role: 'input' },
  // the profile as it was when the run began (shared/skills/launch_profile.py, first_run.py begin-burst): a fresh restore starts
  // from it, not from the profile the person changed afterwards
  { path: 'profile-at-start', role: 'input' },
  { path: 'state', role: 'result' },
  { path: 'logs', role: 'result' },
  { path: 'agents', role: 'result' },
  { path: join('.pi', 'agent', 'sessions'), role: 'result' },
];
export const USER_ENTRIES = [
  { path: 'allegati', role: 'input' },
  { path: 'cv', role: 'result' },
  { path: 'output', role: 'result' },
];

const SKIP_DIRS = new Set(['credentials', '.ssh', '.gnupg', 'node_modules', '.cache', 'backups']);
const SECRET_FILE = /(^|[._-])(auth|credentials?|secrets?|tokens?|api[_-]?keys?)([._-]|$)|\.(env|pem|key|p12|pfx)$|^\.env|^id_(rsa|ed25519|ecdsa|dsa)/i;
const TEXT_FILE = /\.(jsonl|log|md|txt|ya?ml|csv|tsv|sh|py|js|mjs|html?|xml|toml|ini|conf)$/i;
// values that look like a key whatever the file says around them
const SECRET_VALUE = /(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?<=Bearer\s)[A-Za-z0-9._~+/-]{16,})/g;
const REDACTED = '[REDACTED]';

export function archiveRoot(env = process.env) {
  return env.JHT_RUN_ARCHIVE || join(env.HOME || homedir(), '.local', 'state', 'jht-run-archivio');
}

/** A name that stays one folder: letters, digits, dot, dash, underscore; not «.» or «..». */
export function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !name.includes('..');
}

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function writePrivate(path, data) {
  privateDir(dirname(path));
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function redactText(text) {
  let n = 0;
  const out = text.replace(SECRET_VALUE, () => { n += 1; return REDACTED; });
  return { text: out, redacted: n };
}

function looksBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

/** One file into the snapshot, cleaned of secrets. Returns what was done: copied | skipped. */
function copyFile(src, dst, counts) {
  const name = src.split(sep).pop();
  if (SECRET_FILE.test(name)) { counts.secretFiles += 1; return; }
  const raw = readFileSync(src);
  if (/\.json$/i.test(name)) {
    try {
      const value = JSON.parse(raw.toString('utf8'));
      const clean = redactSecrets(value);
      const text = JSON.stringify(clean, null, 2);
      const { text: scrubbed, redacted } = redactText(text);
      counts.secretValues += redacted;
      writePrivate(dst, scrubbed + '\n');
      return;
    } catch { /* not JSON after all: treated as text below */ }
  }
  if (TEXT_FILE.test(name) || /\.json$/i.test(name) || !looksBinary(raw)) {
    const { text, redacted } = redactText(raw.toString('utf8'));
    counts.secretValues += redacted;
    writePrivate(dst, text);
    return;
  }
  writePrivate(dst, raw);
}

/** A folder into the snapshot: plain files and folders only (a link is never followed), secret folders left out. */
function copyTree(src, dst, counts) {
  let info;
  try { info = lstatSync(src); } catch { return false; }
  if (info.isSymbolicLink()) return false;
  if (info.isFile()) { copyFile(src, dst, counts); return true; }
  if (!info.isDirectory()) return false;
  privateDir(dst);
  for (const entry of readdirSync(src)) {
    if (SKIP_DIRS.has(entry)) { counts.secretDirs += 1; continue; }
    copyTree(join(src, entry), join(dst, entry), counts);
  }
  return true;
}

/**
 * A folder copied whole, for the copy a restore keeps of what it replaces: every file byte for byte (keys included), every link as a
 * link (never followed), no folder left out. Private like the rest of the archive.
 */
function copyTreeRaw(src, dst) {
  let info;
  try { info = lstatSync(src); } catch { return false; }
  if (info.isSymbolicLink()) {
    privateDir(dirname(dst));
    symlinkSync(readlinkSync(src), dst);
    return true;
  }
  if (info.isFile()) { writePrivate(dst, readFileSync(src)); return true; }
  if (!info.isDirectory()) return false;
  privateDir(dst);
  for (const entry of readdirSync(src)) copyTreeRaw(join(src, entry), join(dst, entry));
  return true;
}

const LAUNCH_PROFILE = 'profile-at-start';
const LAUNCH_MARK = '.saved.json';

/** {saved_at, files} of the profile kept when the run began, or null when the home has none. */
export function launchProfileOf(home) {
  const mark = readJson(join(home, LAUNCH_PROFILE, LAUNCH_MARK));
  return mark && typeof mark === 'object' ? { saved_at: typeof mark.saved_at === 'string' ? mark.saved_at : null,
    files: Number.isFinite(Number(mark.files)) ? Number(mark.files) : null } : null;
}

/**
 * Copy back, for the restore: only what the manifest lists (`listed`: path in the snapshot → its line of the manifest), each file
 * checked again against its sha256 as it is written, each link only as the manifest recorded it. The restore refuses a snapshot with
 * anything else in it before touching the home (`unlistedFiles`); this is the same rule where the bytes are written.
 * An integrity check, not an authentication: whoever can add a file to the archive can rewrite the manifest too, and then it passes.
 */
function copyBack(src, dst, { snapshotDir, listed, skip = new Set() }) {
  const info = lstatSync(src);
  const rel = relative(snapshotDir, src).split(sep).join('/');
  if (info.isDirectory()) {
    mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(src)) if (!skip.has(entry)) copyBack(join(src, entry), join(dst, entry), { snapshotDir, listed });
    return;
  }
  const line = listed.get(rel);
  if (!line) throw Object.assign(new Error('run_unlisted'), { files: [rel] });
  mkdirSync(dirname(dst), { recursive: true, mode: 0o700 });
  if (info.isSymbolicLink()) {
    if (typeof line.link !== 'string' || readlinkSync(src) !== line.link) throw Object.assign(new Error('run_corrupt'), { files: [rel] });
    if (!linkAllowed(listed.manifest, rel, line.link)) throw Object.assign(new Error('run_link_refused'), { files: [rel] });
    symlinkSync(line.link, dst);
    return;
  }
  if (!info.isFile()) return;
  const bytes = readFileSync(src);
  if (createHash('sha256').update(bytes).digest('hex') !== line.sha256) throw Object.assign(new Error('run_corrupt'), { files: [rel] });
  writeFileSync(dst, bytes, { mode: 0o600 });
}

async function sqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  return DatabaseSync;
}

/** jobs.db copied with VACUUM INTO (consistent with the WAL, one file), then every secret-named column emptied in the copy. */
export async function snapshotDb(src, dst, counts = { secretColumns: 0 }, { raw = false } = {}) {
  const DatabaseSync = await sqlite();
  privateDir(dirname(dst));
  const db = new DatabaseSync(src, { readOnly: true });
  try { db.exec(`VACUUM INTO '${dst.replaceAll("'", "''")}'`); } finally { db.close(); }
  chmodSync(dst, 0o600);
  if (raw) return;   // the copy a restore keeps: whole
  const copy = new DatabaseSync(dst);
  try {
    const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name } of tables) {
      const quoted = `"${String(name).replaceAll('"', '""')}"`;
      for (const column of copy.prepare(`PRAGMA table_info(${quoted})`).all()) {
        if (!SECRET_KEY.test(column.name)) continue;
        const col = `"${String(column.name).replaceAll('"', '""')}"`;
        const done = copy.prepare(`UPDATE ${quoted} SET ${col} = NULL WHERE ${col} IS NOT NULL`).run();
        counts.secretColumns += Number(done.changes || 0) > 0 ? 1 : 0;
      }
    }
    const check = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(check ?? {})[0] !== 'ok') throw new Error('snapshot_db_integrity');
  } finally {
    copy.close();
  }
}

function sha256(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

function listFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    const info = lstatSync(path);
    if (info.isDirectory()) listFiles(path, base, out);
    else if (info.isFile() || info.isSymbolicLink()) out.push(relative(base, path).split(sep).join('/'));
  }
  return out;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}

/** One event per call to the model in the pi sessions of a home: {ts, agent, cost, input, output, cacheRead, cacheWrite}. */
export function piUsage(home) {
  const root = join(home, '.pi', 'agent', 'sessions');
  const events = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry);
      let info;
      try { info = lstatSync(path); } catch { continue; }
      if (info.isDirectory()) { walk(path); continue; }
      if (!info.isFile() || !entry.endsWith('.jsonl')) continue;
      const agent = (/--jht_home-agents-([^/]+?)--$/.exec(dir.split(sep).pop() ?? '') ?? [])[1] ?? null;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.includes('"usage"')) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const message = row?.message;
        if (row?.type !== 'message' || message?.role !== 'assistant' || !message.usage) continue;
        const ts = Date.parse(row.timestamp);
        if (!Number.isFinite(ts)) continue;
        const u = message.usage;
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        events.push({ ts, agent, cost: num(u.cost?.total), input: num(u.input), output: num(u.output),
          cacheRead: num(u.cacheRead), cacheWrite: num(u.cacheWrite) });
      }
    }
  };
  walk(root);
  return events.sort((a, b) => a.ts - b.ts);
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** What the manifest says of the run, from the config (never a secret: the config is redacted first). */
export function runFacts(config, { where = null, version = null, pin = null } = {}) {
  const clean = redactSecrets(config ?? {});
  const team = clean.team ?? {};
  const zone = team.budget?.timezone || team.working_hours?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  return {
    jht_version: version,
    pin,
    provider: typeof clean.active_provider === 'string' ? clean.active_provider : null,
    harness: typeof clean.harness === 'string' ? clean.harness : (typeof clean.agent_harness === 'string' ? clean.agent_harness : null),
    role_models: team.role_models ?? null,
    budget: team.budget ?? null,
    timezone: zone,
    host_type: where?.host_type ?? null,
    host_os: where?.host_os ?? null,
  };
}

/**
 * Take a snapshot. `stopTeam()` runs first (the database is then still); `where()` says where the team runs.
 * @returns {{ dir, manifest }}
 */
export async function takeSnapshot({
  name, home, userDir, root = archiveRoot(), stopTeam = () => true, where = () => null, version = null, pin = null,
  now = () => new Date(), raw = false,
}) {
  if (!validName(name)) throw new Error('run_name_invalid');
  privateDir(root);
  const dir = join(root, name);
  if (existsSync(dir)) throw new Error('run_exists');
  if ((await stopTeam()) === false) throw new Error('run_stop_failed');
  privateDir(dir);
  const counts = { secretFiles: 0, secretDirs: 0, secretValues: 0, secretColumns: 0 };
  try {
    for (const entry of HOME_ENTRIES) {
      const src = join(home, entry.path);
      if (!existsSync(src)) continue;
      const dst = join(dir, 'home', entry.path);
      if (entry.db) await snapshotDb(src, dst, counts, { raw });
      else if (raw) copyTreeRaw(src, dst);
      else copyTree(src, dst, counts);
    }
    for (const entry of USER_ENTRIES) {
      const src = join(userDir, entry.path);
      if (!existsSync(src)) continue;
      if (raw) copyTreeRaw(src, join(dir, 'user', entry.path));
      else copyTree(src, join(dir, 'user', entry.path), counts);
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const usage = piUsage(join(dir, 'home'));
  const files = listFiles(dir).map((path) => {
    const full = join(dir, path);
    if (lstatSync(full).isSymbolicLink()) return { path, link: readlinkSync(full) };
    return { path, bytes: lstatSync(full).size, sha256: sha256(full) };
  });
  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    name,
    // whole, keys included: the copy a restore keeps of what it replaced
    raw,
    created_at: now().toISOString(),
    run: { started_at: iso(usage[0]?.ts), ended_at: iso(usage.at(-1)?.ts) },
    ...runFacts(readJson(join(home, 'jht.config.json')), { where: where(), version, pin }),
    inputs: [...HOME_ENTRIES, ...USER_ENTRIES].filter((e) => e.role === 'input').map((e) => e.path.split(sep).join('/')),
    profile_at_start: launchProfileOf(join(dir, 'home')),
    secrets_left_out: { files: counts.secretFiles, folders: counts.secretDirs, values: counts.secretValues, db_columns: counts.secretColumns },
    files,
  };
  writePrivate(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { dir, manifest };
}

/**
 * The manifest of a snapshot, or of one made by hand before the tool (a folder with VERIFIED.json and the archives it names): those
 * are read as `jht.run.snapshot/manual`, listed, never restored nor compared (their content is inside an archive).
 */
export function readManifest(dir) {
  const manifest = readJson(join(dir, 'manifest.json'));
  if (manifest && manifest.schema === SNAPSHOT_SCHEMA) return manifest;
  const verified = readJson(join(dir, 'VERIFIED.json'));
  if (verified && typeof verified === 'object') {
    return {
      schema: LEGACY_SCHEMA,
      name: dir.split(sep).pop(),
      created_at: typeof verified.verified_utc === 'string' ? verified.verified_utc : null,
      archive: typeof verified.archive === 'string' ? verified.archive : null,
      files: Number.isFinite(Number(verified.files)) ? Number(verified.files) : null,
    };
  }
  return null;
}

export function listSnapshots(root = archiveRoot()) {
  let names;
  try { names = readdirSync(root).sort(); } catch { return []; }
  return names.map((name) => ({ name, manifest: readManifest(join(root, name)) })).filter((s) => s.manifest);
}

/** Every file the manifest lists is there with its sha256. Returns the paths that are not. */
export function verifySnapshot(dir, manifest) {
  const bad = [];
  for (const file of manifest.files ?? []) {
    const path = join(dir, ...String(file.path).split('/'));
    if (String(file.path).split('/').includes('..')) { bad.push(file.path); continue; }
    let info;
    try { info = lstatSync(path); } catch { bad.push(file.path); continue; }
    if (typeof file.link === 'string') {
      if (!info.isSymbolicLink() || readlinkSync(path) !== file.link) bad.push(file.path);
    } else if (!info.isFile() || sha256(path) !== file.sha256) bad.push(file.path);
  }
  return bad;
}

/**
 * A link a restore may put back: only in the copy a restore keeps (`raw`: a normal snapshot never holds one), with a relative target
 * that, read from the link's own folder, stays inside the part of the home it belongs to (state/, logs/…). A link the team never
 * makes, pointing out of the home, is a trap a later write would follow: refused.
 */
export function linkAllowed(manifest, path, target) {
  if (manifest?.raw !== true || typeof target !== 'string' || !target || isAbsolute(target) || target.includes('\\')) return false;
  const [part, ...rest] = String(path).split('/');
  const entries = part === 'home' ? HOME_ENTRIES : part === 'user' ? USER_ENTRIES : [];
  const inside = rest.join('/');
  const entry = entries.find((e) => inside.startsWith(`${e.path.split(sep).join('/')}/`));
  if (!entry) return false;
  const root = entry.path.split(sep).join('/');
  const resolved = posix.normalize(posix.join(posix.dirname(inside), target));
  return resolved.startsWith(`${root}/`);
}

/** The links of a snapshot's manifest a restore refuses to put back (see `linkAllowed`). */
export function refusedLinks(manifest) {
  return (manifest.files ?? []).filter((f) => typeof f.link === 'string' && !linkAllowed(manifest, f.path, f.link)).map((f) => f.path);
}

/** The files and links of the parts of a snapshot (home/, user/) that its manifest does not list. */
export function unlistedFiles(dir, manifest) {
  const listed = new Set((manifest.files ?? []).map((f) => String(f.path)));
  const out = [];
  for (const part of ['home', 'user']) {
    if (!existsSync(join(dir, part))) continue;
    for (const path of listFiles(join(dir, part))) if (!listed.has(`${part}/${path}`)) out.push(`${part}/${path}`);
  }
  return out;
}

function removeEntry(base, entry) {
  rmSync(join(base, entry.path), { recursive: true, force: true });
  if (entry.db) for (const tail of ['-wal', '-shm', '-journal']) rmSync(join(base, entry.path + tail), { force: true });
}

/**
 * Restore a snapshot into the home. The team is stopped first (`stopTeam`), what is there now is kept as a snapshot of its own
 * (`before-restore-<time>`), then the parts of the snapshot replace the same parts of the home; `fresh` keeps only the inputs and
 * leaves the results empty (positions, scores, reviews, applications, messages, state, sessions, logs, written CVs, spending counters).
 * The keys in use now stay in the config. `startTeam()` runs last.
 */
export async function restoreSnapshot({
  name, home, userDir, root = archiveRoot(), fresh = false, stopTeam = () => true, startTeam = () => true, now = () => new Date(),
  version = null,
}) {
  if (!validName(name)) throw new Error('run_name_invalid');
  const dir = join(root, name);
  const manifest = readManifest(dir);
  if (!manifest) throw new Error('run_not_found');
  if (manifest.schema !== SNAPSHOT_SCHEMA) throw new Error('run_manual_snapshot');
  const bad = verifySnapshot(dir, manifest);
  if (bad.length) throw Object.assign(new Error('run_corrupt'), { files: bad });
  // a restore writes only what the manifest lists: a file added to the archive afterwards (a hook in an agent's folder) is refused,
  // unless the manifest is rewritten too (an integrity check, not an authentication)
  const unlisted = unlistedFiles(dir, manifest);
  if (unlisted.length) throw Object.assign(new Error('run_unlisted'), { files: unlisted });
  const outside = refusedLinks(manifest);
  if (outside.length) throw Object.assign(new Error('run_link_refused'), { files: outside });
  const listed = new Map((manifest.files ?? []).map((f) => [String(f.path), f]));
  listed.manifest = manifest;
  if ((await stopTeam()) === false) throw new Error('run_stop_failed');
  let kept = null;
  const hasData = [...HOME_ENTRIES.map((e) => join(home, e.path)), ...USER_ENTRIES.map((e) => join(userDir, e.path))].some(existsSync);
  if (hasData) {
    const stamp = now().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // two restores in the same second would name the same safety snapshot: the second gets -2, -3…
    let safety = `before-restore-${stamp}`;
    for (let n = 2; existsSync(join(root, safety)); n += 1) safety = `before-restore-${stamp}-${n}`;
    // whole, keys and links included: every part the restore is about to delete is in it
    kept = (await takeSnapshot({ name: safety, home, userDir, root, version, now, raw: true })).dir;
  }
  const liveConfig = readJson(join(home, 'jht.config.json'));
  for (const [entries, base, part] of [[HOME_ENTRIES, home, 'home'], [USER_ENTRIES, userDir, 'user']]) {
    for (const entry of entries) {
      removeEntry(base, entry);
      if (fresh && entry.role !== 'input') continue;
      let src = join(dir, part, entry.path);
      let skip;
      // a replay starts from the profile of the start of the run, when the snapshot has it
      if (fresh && part === 'home' && entry.path === 'profile' && launchProfileOf(join(dir, 'home'))) {
        src = join(dir, 'home', LAUNCH_PROFILE);
        skip = new Set([LAUNCH_MARK]);
      }
      if (!existsSync(src)) continue;
      if (entry.config) {
        const saved = readJson(src);
        writePrivate(join(base, entry.path), JSON.stringify(mergeLiveSecrets(saved, liveConfig), null, 2) + '\n');
      } else copyBack(src, join(base, entry.path), { snapshotDir: dir, listed, skip });
    }
  }
  const started = (await startTeam()) !== false;
  return { manifest, kept, started };
}

// --- diff ------------------------------------------------------------------------------------------------------------

function normUrl(url) {
  try {
    const u = new URL(String(url).trim());
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

function normCompany(name) {
  const text = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return text || null;
}

function sqlTime(text) {
  if (typeof text !== 'string' || !text) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
}

const round = (value, digits = 4) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function stddev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

async function readRun(dir) {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error('run_not_found');
  if (manifest.schema !== SNAPSHOT_SCHEMA) throw new Error('run_manual_snapshot');
  const home = join(dir, 'home');
  const rows = { positions: [], scores: [], applications: [] };
  if (existsSync(join(home, 'jobs.db'))) {
    const DatabaseSync = await sqlite();
    const db = new DatabaseSync(join(home, 'jobs.db'), { readOnly: true });
    const all = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };
    try {
      rows.positions = all('SELECT id, url, company FROM positions');
      rows.scores = all('SELECT position_id, total_score, scored_at FROM scores');
      rows.applications = all('SELECT position_id, critic_verdict FROM applications');
    } finally { db.close(); }
  }
  return { manifest, usage: piUsage(home), ...rows };
}

/** The numbers of one run. Names are stable: the dashboards read them. No title, company or URL leaves this function. */
export function runMetrics({ usage, positions, scores, applications }) {
  const cost = usage.reduce((a, e) => a + e.cost, 0);
  const evaluated = scores.length;
  const passed = new Set(applications.filter((a) => String(a.critic_verdict ?? '').toUpperCase() === 'PASS').map((a) => a.position_id));
  const useful = new Set([...scores.filter((s) => Number(s.total_score) >= USEFUL_SCORE).map((s) => s.position_id), ...passed]).size;
  const first = usage[0]?.ts;
  const last = usage.at(-1)?.ts;
  const firstScored = Math.min(...scores.map((s) => sqlTime(s.scored_at)).filter(Number.isFinite));
  const totals = scores.map((s) => Number(s.total_score)).filter(Number.isFinite);
  const verdicts = { pass: 0, needs_work: 0, reject: 0 };
  for (const a of applications) {
    const v = String(a.critic_verdict ?? '').toUpperCase();
    if (v === 'PASS') verdicts.pass += 1;
    else if (v === 'NEEDS_WORK') verdicts.needs_work += 1;
    else if (v === 'REJECT') verdicts.reject += 1;
  }
  return {
    positions_found: positions.length,
    evaluated_offers: evaluated,
    useful_positions: useful,
    spend_usd: round(cost),
    cost_per_evaluated_offer: evaluated ? round(cost / evaluated) : null,
    cost_per_useful_position: useful ? round(cost / useful) : null,
    ai_calls: usage.length,
    tokens: {
      input: usage.reduce((a, e) => a + e.input, 0),
      output: usage.reduce((a, e) => a + e.output, 0),
      cache_read: usage.reduce((a, e) => a + e.cacheRead, 0),
      cache_write: usage.reduce((a, e) => a + e.cacheWrite, 0),
    },
    minutes_per_run: Number.isFinite(first) && Number.isFinite(last) ? round((last - first) / 60000, 1) : null,
    minutes_to_first_evaluated_offer: Number.isFinite(first) && Number.isFinite(firstScored) ? round((firstScored - first) / 60000, 1) : null,
    quality: {
      relevance_mean_score: round(mean(totals), 2),
      score_stddev: round(stddev(totals), 2),
      critic_verdicts: verdicts,
      distance_from_residence_km_median: null,
    },
  };
}

function overlap(a, b) {
  const shared = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { shared, only_a: a.size - shared, only_b: b.size - shared, jaccard: union ? round(shared / union) : null };
}

/** The comparison of two runs: each one's numbers, and what the second shares with the first. */
export function compareRuns(a, b) {
  const urls = (run) => new Set(run.positions.map((p) => normUrl(p.url)).filter(Boolean));
  const companies = (run) => new Set(run.positions.map((p) => normCompany(p.company)).filter(Boolean));
  const scoreByUrl = (run) => {
    const url = new Map(run.positions.map((p) => [p.id, normUrl(p.url)]));
    return new Map(run.scores.map((s) => [url.get(s.position_id), Number(s.total_score)]).filter(([u, v]) => u && Number.isFinite(v)));
  };
  const sa = scoreByUrl(a);
  const sb = scoreByUrl(b);
  const deltas = [...sa.keys()].filter((u) => sb.has(u)).map((u) => Math.abs(sa.get(u) - sb.get(u)));
  const byUrl = overlap(urls(a), urls(b));
  return {
    schema: DIFF_SCHEMA,
    a: { name: a.manifest.name, ...runMetrics(a) },
    b: { name: b.manifest.name, ...runMetrics(b) },
    replica: {
      url_overlap: byUrl,
      company_overlap: overlap(companies(a), companies(b)),
      shared_scored_positions: deltas.length,
      score_delta_mean_abs: round(mean(deltas), 2),
      positions_new_in_b: byUrl.only_b,
      positions_repeated_in_b: byUrl.shared,
    },
  };
}

export async function diffSnapshots(nameA, nameB, root = archiveRoot()) {
  for (const name of [nameA, nameB]) if (!validName(name)) throw new Error('run_name_invalid');
  return compareRuns(await readRun(join(root, nameA)), await readRun(join(root, nameB)));
}
