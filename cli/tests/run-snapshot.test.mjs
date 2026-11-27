// JHT-T355: jht run snapshot / restore [--fresh] / diff on made-up homes. Synthetic profile, positions and calls; fake keys that
// must never reach a snapshot. The team's stop and start are counted, never run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

process.env.JHT_LANG = 'en';
const lib = await import('../src/lib/run-snapshot.js');
const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

const FAKE_KEY = 'sk-ant-FAKEFAKEFAKEFAKEFAKE0123456789';
const FAKE_GH = 'ghp_FAKEFAKEFAKEFAKEFAKEFAKE0123';
const FAKE_TOKEN = 'fake-cloud-token-0123456789-abcdef';

function stamp(ms) { return new Date(ms).toISOString(); }

/** A made-up home: a team that found, scored and wrote, with keys planted everywhere a key could hide. */
function world({ positions = [['https://jobs.example.org/a/1', 'Acme', 82], ['https://jobs.example.org/a/2', 'Beta', 55]], t0 = Date.parse('2026-11-20T10:00:00Z'), cost = 0.25 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-run-'));
  const home = join(root, 'home');
  const user = join(root, 'user');
  const archive = join(root, 'archive');
  mkdirSync(join(home, 'profile'), { recursive: true });
  mkdirSync(join(home, 'state'), { recursive: true });
  mkdirSync(join(home, 'logs'), { recursive: true });
  mkdirSync(join(home, 'credentials'), { recursive: true });
  mkdirSync(join(home, 'agents', 'scout-1', '.claude'), { recursive: true });
  mkdirSync(join(user, 'allegati'), { recursive: true });
  mkdirSync(join(user, 'cv'), { recursive: true });
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({
    active_provider: 'anthropic', harness: 'pi',
    providers: { anthropic: { auth_method: 'api_key', api_key: FAKE_KEY } },
    cloud: { sync_token: FAKE_TOKEN },
    team: { budget: { usd: 3, timezone: 'Europe/Rome' }, role_models: { scout: { model: 'sonnet', effort: 'medium' } } },
  }));
  writeFileSync(join(home, 'profile', 'candidate_profile.yml'), 'name: Synthetic Candidate\nskills: [python]\n');
  writeFileSync(join(home, 'state', 'budget-start.json'), JSON.stringify({ starts_at: stamp(t0) }));
  writeFileSync(join(home, 'logs', 'bridge.log'), `started; Authorization: Bearer ${FAKE_TOKEN}\nkey ${FAKE_KEY}\n`);
  writeFileSync(join(home, 'credentials', 'github.json'), JSON.stringify({ token: FAKE_GH }));
  writeFileSync(join(home, 'agents', 'scout-1', '.claude', '.credentials.json'), JSON.stringify({ accessToken: FAKE_TOKEN }));
  mkdirSync(join(home, 'agents', 'scout-1', 'credentials'), { recursive: true });
  writeFileSync(join(home, 'agents', 'scout-1', 'credentials', 'gh'), FAKE_GH);
  writeFileSync(join(home, '.env'), `ANTHROPIC_API_KEY=${FAKE_KEY}\n`);
  writeFileSync(join(user, 'allegati', 'cv-synthetic.pdf'), Buffer.from('%PDF-1.4 synthetic\n'));
  writeFileSync(join(user, 'cv', 'cv-acme.md'), '# CV for a synthetic candidate\n');
  // the pi sessions: three calls of a Scout
  const sessions = join(home, '.pi', 'agent', 'sessions', '--jht_home-agents-scout-1--');
  mkdirSync(sessions, { recursive: true });
  const rows = [{ type: 'session', id: 's1' }];
  for (let i = 0; i < 3; i++) {
    rows.push({ type: 'message', timestamp: stamp(t0 + i * 10 * 60000), message: { role: 'assistant', usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: cost } } } });
  }
  writeFileSync(join(sessions, 's1.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(home, '.pi', 'agent', 'auth.json'), JSON.stringify({ anthropic: { key: FAKE_KEY } }));
  // jobs.db in WAL mode, with a secret-named column
  const db = new DatabaseSync(join(home, 'jobs.db'));
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, url TEXT, company TEXT);
    CREATE TABLE scores (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, total_score INTEGER, scored_at TIMESTAMP);
    CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, critic_verdict TEXT);
    CREATE TABLE settings (name TEXT, api_token TEXT);`);
  positions.forEach(([url, company, score], i) => {
    db.prepare('INSERT INTO positions (id, title, url, company) VALUES (?, ?, ?, ?)').run(i + 1, `Role ${i}`, url, company);
    db.prepare('INSERT INTO scores (position_id, total_score, scored_at) VALUES (?, ?, ?)').run(i + 1, score, new Date(t0 + 15 * 60000).toISOString().replace('T', ' ').slice(0, 19));
  });
  db.prepare("INSERT INTO applications (position_id, critic_verdict) VALUES (2, 'PASS')").run();
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('cloud', FAKE_TOKEN);
  db.close();
  const counts = { stop: 0, start: 0 };
  const deps = { home, userDir: user, root: archive, stopTeam: () => { counts.stop += 1; return true; }, startTeam: () => { counts.start += 1; return true; } };
  return { root, home, user, archive, deps, counts };
}

function everyByte(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push([p, readFileSync(p)]); } };
  walk(dir);
  return out;
}

const snap = (w, name) => lib.takeSnapshot({ name, ...w.deps, where: () => ({ host_type: 'vps', host_os: 'linux' }), version: '0.4.0-test' });

test('a snapshot stops the team first, is private, and has its manifest', async () => {
  const w = world();
  const { dir, manifest } = await snap(w, 'run-a');
  assert.equal(w.counts.stop, 1);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'manifest.json')).mode & 0o777, 0o600);
  assert.equal(manifest.schema, 'jht.run.snapshot/1');
  assert.equal(manifest.provider, 'anthropic');
  assert.deepEqual(manifest.role_models, { scout: { model: 'sonnet', effort: 'medium' } });
  assert.equal(manifest.budget.usd, 3);
  assert.equal(manifest.timezone, 'Europe/Rome');
  assert.equal(manifest.host_type, 'vps');
  assert.equal(manifest.run.started_at, '2026-11-20T10:00:00.000Z');
  assert.equal(manifest.run.ended_at, '2026-11-20T10:20:00.000Z');
  assert.ok(manifest.files.some((f) => f.path === 'home/jobs.db' && /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.ok(manifest.files.some((f) => f.path === 'user/allegati/cv-synthetic.pdf'));
  assert.deepEqual(lib.verifySnapshot(dir, manifest), []);
  const db = new DatabaseSync(join(dir, 'home', 'jobs.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM positions').get().n, 2, 'the backup holds what was in the WAL');
  db.close();
});

test('no key and no token reaches the snapshot, in any file', async () => {
  const w = world();
  const { dir, manifest } = await snap(w, 'run-secret');
  for (const [path, bytes] of everyByte(dir)) {
    for (const secret of [FAKE_KEY, FAKE_GH, FAKE_TOKEN]) assert.ok(!bytes.includes(secret), `${secret.slice(0, 8)}… in ${path}`);
  }
  assert.ok(!existsSync(join(dir, 'home', 'credentials')));
  assert.ok(!existsSync(join(dir, 'home', '.pi', 'agent', 'auth.json')));
  const left = manifest.secrets_left_out;
  assert.ok(left.folders >= 1 && left.files >= 1 && left.values >= 2 && left.db_columns >= 1, JSON.stringify(left));
});

test('restore puts the run back, keeps what was there and the keys in use, and starts the team', async () => {
  const w = world();
  await snap(w, 'run-a');
  // the team went on after the snapshot: one more position
  const db = new DatabaseSync(join(w.home, 'jobs.db'));
  db.prepare("INSERT INTO positions (id, url, company) VALUES (9, 'https://jobs.example.org/later', 'Later')").run();
  db.close();
  const { kept, started } = await lib.restoreSnapshot({ name: 'run-a', ...w.deps });
  assert.ok(started && w.counts.start === 1 && w.counts.stop === 2);
  assert.ok(kept && existsSync(join(kept, 'manifest.json')), 'what was there is a snapshot of its own');
  const back = new DatabaseSync(join(w.home, 'jobs.db'), { readOnly: true });
  assert.equal(back.prepare('SELECT COUNT(*) AS n FROM positions').get().n, 2);
  back.close();
  const config = JSON.parse(readFileSync(join(w.home, 'jht.config.json'), 'utf8'));
  assert.equal(config.providers.anthropic.api_key, FAKE_KEY, 'the key in use stays');
  assert.ok(existsSync(join(w.home, 'state', 'budget-start.json')));
  assert.ok(existsSync(join(w.user, 'cv', 'cv-acme.md')));
});

test('restore --fresh: the same inputs, zero results, zero spending', async () => {
  const w = world();
  const { dir } = await snap(w, 'run-a');
  await lib.restoreSnapshot({ name: 'run-a', fresh: true, ...w.deps });
  assert.ok(!existsSync(join(w.home, 'jobs.db')), 'no positions, scores, reviews, applications or messages');
  for (const gone of ['state', 'logs', 'agents', join('.pi', 'agent', 'sessions')]) assert.ok(!existsSync(join(w.home, gone)), gone);
  assert.ok(!existsSync(join(w.user, 'cv')), 'no written CV');
  assert.deepEqual(lib.piUsage(w.home), [], 'the spending counters start at zero');
  // the inputs are the snapshot's, byte for byte
  assert.deepEqual(readFileSync(join(w.home, 'profile', 'candidate_profile.yml')), readFileSync(join(dir, 'home', 'profile', 'candidate_profile.yml')));
  assert.deepEqual(readFileSync(join(w.user, 'allegati', 'cv-synthetic.pdf')), readFileSync(join(dir, 'user', 'allegati', 'cv-synthetic.pdf')));
  const config = JSON.parse(readFileSync(join(w.home, 'jht.config.json'), 'utf8'));
  assert.equal(config.team.budget.usd, 3);
  assert.equal(config.providers.anthropic.api_key, FAKE_KEY);
  assert.equal(w.counts.start, 1);
});

test('a damaged snapshot or one made by hand is refused, and nothing in the home changes', async () => {
  const w = world();
  const { dir } = await snap(w, 'run-a');
  writeFileSync(join(dir, 'home', 'profile', 'candidate_profile.yml'), 'tampered\n');
  await assert.rejects(lib.restoreSnapshot({ name: 'run-a', ...w.deps }), /run_corrupt/);
  assert.equal(w.counts.start, 0);
  assert.match(readFileSync(join(w.home, 'profile', 'candidate_profile.yml'), 'utf8'), /Synthetic Candidate/);
  // a folder made by hand before the tool: VERIFIED.json and the archive it names (synthetic)
  const manual = join(w.archive, '2026-11-01-manual');
  mkdirSync(manual, { recursive: true });
  writeFileSync(join(manual, 'VERIFIED.json'), JSON.stringify({ archive: 'run.tar.gz', archive_readback_verified: true, bytes: 10, files: 3, sha256: 'ab', sqlite_integrity_checked: true, verified_utc: '2026-11-01T10:00:00Z' }));
  const listed = lib.listSnapshots(w.archive).find((s) => s.name === '2026-11-01-manual');
  assert.equal(listed.manifest.schema, 'jht.run.snapshot/manual');
  assert.equal(listed.manifest.created_at, '2026-11-01T10:00:00Z');
  await assert.rejects(lib.restoreSnapshot({ name: '2026-11-01-manual', ...w.deps }), /run_manual_snapshot/);
});

test('names that leave the folder and names already taken are refused', async () => {
  const w = world();
  for (const bad of ['../x', '..', 'a/b', '', '.hidden', 'x'.repeat(101)]) await assert.rejects(snap(w, bad), /run_name_invalid/, bad);
  await snap(w, 'run-a');
  await assert.rejects(snap(w, 'run-a'), /run_exists/);
});

test('diff: stable names, aggregate numbers only, and the overlap of a replica', async () => {
  const a = world({ cost: 0.25 });
  await snap(a, 'run-a');
  const b = world({ cost: 0.5, positions: [['https://www.jobs.example.org/a/1/', 'ACME', 70], ['https://jobs.example.org/b/9', 'Gamma', 90]] });
  await lib.takeSnapshot({ name: 'run-b', ...b.deps, root: a.archive });
  const diff = await lib.diffSnapshots('run-a', 'run-b', a.archive);
  assert.deepEqual(Object.keys(diff), ['schema', 'a', 'b', 'replica']);
  assert.equal(diff.schema, 'jht.run.diff/1');
  assert.deepEqual(Object.keys(diff.a), ['name', 'positions_found', 'evaluated_offers', 'useful_positions', 'spend_usd',
    'cost_per_evaluated_offer', 'cost_per_useful_position', 'ai_calls', 'tokens', 'minutes_per_run',
    'minutes_to_first_evaluated_offer', 'quality']);
  assert.deepEqual(Object.keys(diff.a.quality), ['relevance_mean_score', 'score_stddev', 'critic_verdicts', 'distance_from_residence_km_median']);
  assert.deepEqual(Object.keys(diff.replica), ['url_overlap', 'company_overlap', 'shared_scored_positions', 'score_delta_mean_abs',
    'positions_new_in_b', 'positions_repeated_in_b']);
  assert.equal(diff.a.spend_usd, 0.75);
  assert.equal(diff.a.ai_calls, 3);
  assert.deepEqual(diff.a.tokens, { input: 300, output: 150, cache_read: 30, cache_write: 15 });
  assert.equal(diff.a.useful_positions, 2, 'one above the threshold, one passed by the Critico');
  assert.equal(diff.a.cost_per_evaluated_offer, 0.375);
  assert.equal(diff.a.minutes_per_run, 20);
  assert.equal(diff.a.minutes_to_first_evaluated_offer, 15);
  assert.deepEqual(diff.replica.url_overlap, { shared: 1, only_a: 1, only_b: 1, jaccard: 0.3333 });
  assert.equal(diff.replica.company_overlap.shared, 1);
  assert.equal(diff.replica.score_delta_mean_abs, 12);
  assert.equal(diff.replica.positions_new_in_b, 1);
  const text = JSON.stringify(diff);
  for (const personal of ['example.org', 'Acme', 'ACME', 'Gamma', 'Synthetic', 'Role 0']) assert.ok(!text.includes(personal), personal);
});

test('jht run is a command of the CLI, with its help in the person\'s language', () => {
  const w = world();
  const r = spawnSync(process.execPath, [JHT, 'run', 'list'], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, JHT_HOME: w.home, JHT_RUN_ARCHIVE: join(w.root, 'empty'), JHT_LANG: 'it', NO_COLOR: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nessun run salvato/);
  const help = spawnSync(process.execPath, [JHT, 'run', '--help'], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, JHT_HOME: w.home, JHT_LANG: 'it', NO_COLOR: '1' } });
  assert.match(help.stdout, /snapshot/);
  assert.match(help.stdout, /Confronta due run salvati/);
});

test('a fresh restore starts from the profile of the start of the run, not from the one changed afterwards', async () => {
  const w = world();
  // the copy first_run.py begin-burst keeps (shared/skills/launch_profile.py), then the person changes the profile
  mkdirSync(join(w.home, 'profile-at-start'), { recursive: true });
  writeFileSync(join(w.home, 'profile-at-start', 'candidate_profile.yml'), 'name: Synthetic Candidate\nskills: [python]\n');
  writeFileSync(join(w.home, 'profile-at-start', '.saved.json'), JSON.stringify({ saved_at: '2026-11-20T10:00:00+00:00', files: 1 }));
  writeFileSync(join(w.home, 'profile', 'candidate_profile.yml'), 'name: Synthetic Candidate\nskills: [python, rust]\nsalary: changed later\n');
  const { manifest } = await snap(w, 'run-a');
  assert.deepEqual(manifest.profile_at_start, { saved_at: '2026-11-20T10:00:00+00:00', files: 1 });
  await lib.restoreSnapshot({ name: 'run-a', fresh: true, ...w.deps });
  assert.equal(readFileSync(join(w.home, 'profile', 'candidate_profile.yml'), 'utf8'), 'name: Synthetic Candidate\nskills: [python]\n');
  assert.ok(!existsSync(join(w.home, 'profile', '.saved.json')), 'the mark of the copy is not part of the profile');
  assert.ok(existsSync(join(w.home, 'profile-at-start', '.saved.json')), 'the copy stays, for the next replay');
  // a plain restore puts back the profile of the end of the run
  await lib.restoreSnapshot({ name: 'run-a', ...w.deps });
  assert.match(readFileSync(join(w.home, 'profile', 'candidate_profile.yml'), 'utf8'), /changed later/);
});

test('a snapshot without the copy keeps the fresh restore as before', async () => {
  const w = world();
  const { manifest } = await snap(w, 'run-a');
  assert.equal(manifest.profile_at_start, null);
  await lib.restoreSnapshot({ name: 'run-a', fresh: true, ...w.deps });
  assert.match(readFileSync(join(w.home, 'profile', 'candidate_profile.yml'), 'utf8'), /Synthetic Candidate/);
});
