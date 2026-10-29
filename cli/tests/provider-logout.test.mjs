import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_FILES, providerLogout, providerStatus, runProvider } from '../src/lib/provider-logout.js';
import { runAgentControl } from '../src/commands/agent-control.js';

// jht agent-control provider status|logout: the sign-in of the team's active provider, taken off the home.
// Synthetic homes only (a scratch folder per test).
const fresh = (config = { active_provider: 'codex' }) => {
  const home = mkdtempSync(join(tmpdir(), 'jht-provider-logout-'));
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify(config));
  return home;
};
const put = (home, relative, text = '{"token":"synthetic"}') => {
  mkdirSync(dirname(join(home, relative)), { recursive: true });
  writeFileSync(join(home, relative), text);
};
const here = (home, relative) => existsSync(join(home, relative));
const lines = (home, args) => {
  const seen = [];
  const exit = runProvider(args, { write: (text) => seen.push(text), home });
  return { exit, out: JSON.parse(seen.join('').trim()) };
};

test('status: signed in = the marker of the active provider is there; a name of the vendor counts as its CLI', () => {
  const home = fresh({ active_provider: 'openai' });
  assert.deepEqual(providerStatus(home), { ok: true, provider: 'codex', authenticated: false });
  put(home, '.codex/auth.json');
  assert.deepEqual(providerStatus(home), { ok: true, provider: 'codex', authenticated: true });
});

test('logout: removes the files of the active provider and no others, and says the truth', () => {
  const home = fresh({ active_provider: 'codex' });
  put(home, '.codex/auth.json');
  put(home, '.config/codex/credentials.json');
  put(home, '.codex/config.toml', 'model = "synthetic"');
  put(home, '.claude/.credentials.json');
  put(home, 'profile/candidate_profile.yml', 'name: Synthetic');
  assert.deepEqual(providerLogout(home), { ok: true, provider: 'codex', authenticated: false, removed: 2 });
  assert.equal(here(home, '.codex/auth.json'), false);
  assert.equal(here(home, '.config/codex/credentials.json'), false);
  // the other provider, the provider's own settings, the config and the profile stay
  for (const kept of ['.codex/config.toml', '.claude/.credentials.json', 'profile/candidate_profile.yml', 'jht.config.json']) {
    assert.equal(here(home, kept), true, kept);
  }
  assert.deepEqual(providerStatus(home), { ok: true, provider: 'codex', authenticated: false });
});

test('logout: each of the three providers has its own closed list, six files at most', () => {
  for (const [provider, files] of Object.entries(CREDENTIAL_FILES)) {
    assert.ok(files.length >= 3 && files.length <= 6, provider);
    const home = fresh({ active_provider: provider });
    for (const relative of files) put(home, relative);
    assert.deepEqual(providerLogout(home), { ok: true, provider, authenticated: false, removed: files.length });
  }
});

test('logout: nothing to remove is a sign-out already, not an error', () => {
  const home = fresh({ active_provider: 'kimi' });
  assert.deepEqual(providerLogout(home), { ok: true, provider: 'kimi', authenticated: false, removed: 0 });
});

test('a folder on the way that is a link is not followed: the file it leads to stays, and the answer is not «disconnected»', () => {
  const home = fresh({ active_provider: 'codex' });
  const elsewhere = mkdtempSync(join(tmpdir(), 'jht-provider-elsewhere-'));
  writeFileSync(join(elsewhere, 'auth.json'), 'not the home');
  symlinkSync(elsewhere, join(home, '.codex'));
  assert.equal(readFileSync(join(home, '.codex/auth.json'), 'utf-8'), 'not the home');
  assert.deepEqual(providerLogout(home), { ok: false, error: 'provider_logout_incomplete' });
  assert.equal(readFileSync(join(elsewhere, 'auth.json'), 'utf-8'), 'not the home');
  // the status still says the sign-in is there (the marker is, through that link)
  assert.equal(providerStatus(home).authenticated, true);
});

test('a link in place of the file is left alone and the answer is not «disconnected»', () => {
  const home = fresh({ active_provider: 'codex' });
  const outside = join(mkdtempSync(join(tmpdir(), 'jht-provider-outside-')), 'token.json');
  writeFileSync(outside, 'outside');
  mkdirSync(join(home, '.codex'));
  symlinkSync(outside, join(home, '.codex/auth.json'));
  put(home, '.config/codex/credentials.json');
  assert.deepEqual(providerLogout(home), { ok: false, error: 'provider_logout_incomplete' });
  assert.equal(readFileSync(outside, 'utf-8'), 'outside');
  // the plain file of the list was still removed
  assert.equal(here(home, '.config/codex/credentials.json'), false);
});

test('a directory in place of the file is left alone and the answer is not «disconnected»', () => {
  const home = fresh({ active_provider: 'codex' });
  mkdirSync(join(home, '.codex/auth.json'), { recursive: true });
  writeFileSync(join(home, '.codex/auth.json/inside'), 'x');
  assert.deepEqual(providerLogout(home), { ok: false, error: 'provider_logout_incomplete' });
  assert.equal(here(home, '.codex/auth.json/inside'), true);
});

test('a file written back by an agent that was still running, right after the unlink, is not told as disconnected', () => {
  const home = fresh({ active_provider: 'codex' });
  put(home, '.codex/auth.json');
  // the agent renews its token the instant the file is gone: the second look, after the unlinks, finds it again
  const writesBack = (path) => {
    unlinkSync(path);
    writeFileSync(path, '{"token":"renewed"}');
  };
  assert.deepEqual(providerLogout(home, { unlink: writesBack }), { ok: false, error: 'provider_logout_incomplete' });
  assert.equal(providerStatus(home).authenticated, true);
});

test('an unlink that fails for any reason but «not there» is a failure, not a disconnection', () => {
  const home = fresh({ active_provider: 'codex' });
  put(home, '.codex/auth.json');
  const denied = () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  };
  assert.deepEqual(providerLogout(home, { unlink: denied }), { ok: false, error: 'provider_logout_failed' });
  assert.equal(here(home, '.codex/auth.json'), true);
});

test('the provider comes from the config alone, and a config an agent wrote cannot name a path', () => {
  for (const bad of [{ active_provider: '../../etc' }, { active_provider: '' }, { active_provider: 'codex/../claude' }, {}, { active_provider: 7 }]) {
    const home = fresh(bad);
    put(home, '.codex/auth.json');
    assert.deepEqual(providerLogout(home), { ok: false, error: 'provider_unknown' });
    assert.equal(here(home, '.codex/auth.json'), true);
  }
  const broken = mkdtempSync(join(tmpdir(), 'jht-provider-broken-'));
  writeFileSync(join(broken, 'jht.config.json'), '{not json');
  assert.deepEqual(providerLogout(broken), { ok: false, error: 'provider_unknown' });
  // a config that holds paths of its own is read for the name only
  const home = fresh({ active_provider: 'codex', providers: { codex: { auth_method: 'subscription', path: '/etc/passwd', files: ['../x'] } } });
  put(home, '.codex/auth.json');
  assert.equal(providerLogout(home).ok, true);
});

test('only a subscription sign-in is taken off: an API key is not a login to remove', () => {
  const home = fresh({ active_provider: 'codex', providers: { codex: { auth_method: 'api_key' } } });
  put(home, '.codex/auth.json');
  assert.deepEqual(providerLogout(home), { ok: false, error: 'provider_not_subscription' });
  assert.equal(here(home, '.codex/auth.json'), true);
});

test('the door takes `status` or `logout` and no more: any other word, or a second one, is refused', () => {
  const home = fresh();
  for (const args of [[], ['reset'], ['logout', 'claude'], ['status', '--all'], ['logout', '../x'], [''], ['LOGOUT']]) {
    const { exit, out } = lines(home, args);
    assert.equal(exit, 100);
    assert.deepEqual(out, { ok: false, error: 'agent_control_invalid' });
  }
  put(home, '.codex/auth.json');
  assert.deepEqual(lines(home, ['status']), { exit: 0, out: { ok: true, provider: 'codex', authenticated: true } });
  assert.equal(lines(home, ['logout']).exit, 0);
  assert.equal(lines(home, ['logout']).out.removed, 0);
});

test('agent-control routes `provider` to this door and to nothing else', () => {
  const seen = [];
  const exit = runAgentControl(['provider', 'bogus'], { write: (text) => seen.push(text), exec: () => assert.fail('no container script') });
  assert.equal(exit, 100);
  assert.deepEqual(JSON.parse(seen.join('')), { ok: false, error: 'agent_control_invalid' });
});

test('the boot check and the onboarding snapshot only READ the credential files: nothing copies a sign-in back', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pid1 = readFileSync(join(root, 'cli/src/commands/pid1.js'), 'utf-8');
  const check = pid1.split('async function hasProviderCredentials()')[1].split('\n}\n')[0];
  assert.match(check, /access\(/);
  for (const write of ['writeFile', 'copyFile', 'rename', 'symlink', 'link(', 'cp(', 'appendFile', 'open(']) {
    assert.ok(!check.includes(write), write);
  }
  const wrapper = readFileSync(join(root, 'scripts/jht-wrapper.sh'), 'utf-8');
  const snapshot = wrapper.split('const markers={claude:')[1].slice(0, 600);
  assert.match(snapshot, /existsSync/);
  for (const write of ['writeFile', 'copyFile', 'renameSync', 'symlinkSync', 'appendFile']) {
    assert.ok(!snapshot.includes(write), write);
  }
});
