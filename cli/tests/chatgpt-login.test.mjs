import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginUrl, loginChatGpt, readLoginRequest, acceptRedirect, startRelay } from '../src/auth/chatgpt-login.js';

const authorize = (state = 'b'.repeat(32)) => 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=' + state + '&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi';

test('only the official HTTPS login domain can reach a host browser', () => {
  assert.equal(loginUrl(authorize()), authorize());
  assert.equal(loginUrl('https://auth.openai.com/codex/device'), 'https://auth.openai.com/codex/device');
  for (const changed of [authorize().replace('originator=pi', 'originator=jht'), authorize().replace('client_id=app_', 'client_id=other_'), authorize().replace('localhost%3A1455', 'evil.invalid%3A1455'), authorize() + '&extra=value', 'https://auth.openai.com/codex/device?code=other', authorize() + '\n']) assert.throws(() => loginUrl(changed));
  for (const url of ['http://auth.openai.com/', 'https://auth.openai.com.evil.invalid/', 'https://auth.openai.com@evil.invalid/', 'file:///tmp/page', 'https://auth.openai.com:444/', 'https://auth.openai.com/\nfoo', 'https://auth.openai.com\\@evil.invalid/']) assert.throws(() => loginUrl(url));
});

test('browser login receives a real relay callback and saves only through the provider store', async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  const session = 'a'.repeat(32), state = 'b'.repeat(32);
  const callbackFile = join(home, 'relay.json');
  const relay = await startRelay({ host: '127.0.0.1', port: 0, path: callbackFile, expectedState: state });
  const output = []; let saved;
  try {
    const result = await loginChatGpt({ session, method: 'browser', input: { isTTY: false }, output: (s) => output.push(s), load: async () => ({
      oauth: { async login(interaction) {
        assert.equal(await interaction.prompt({ type: 'select' }), 'browser');
        interaction.notify({ type: 'auth_url', url: authorize(state) });
        assert.equal(fs.statSync(join(home, 'state/login-request.json')).mode & 0o777, 0o600);
        assert.equal(readLoginRequest(session).session, session);
        const requestFile = join(home, 'state/login-request.json');
        const request = fs.readFileSync(requestFile, 'utf8');
        for (const expires of [Date.now() - 1000, 'invalid', null, Date.now() + 30 * 60 * 1000]) {
          fs.writeFileSync(requestFile, JSON.stringify({ ...JSON.parse(request), expires }));
          assert.throws(() => readLoginRequest(session));
        }
        fs.writeFileSync(requestFile, request);
        assert.throws(() => readLoginRequest('b'.repeat(32)));
        assert.throws(() => acceptRedirect(session, 'http://localhost:1455/auth/callback?code=x&state=wrong'));
        assert.throws(() => acceptRedirect(session, `https://evil.invalid/auth/callback?code=x&state=${state}`));
        const port = relay.address().port;
        assert.equal((await fetch(`http://127.0.0.1:${port}/wrong?code=x&state=${state}`)).status, 400);
        assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=wrong&state=other`)).status, 400);
        assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=synthetic&state=${state}`)).status, 200);
        assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=overwritten&state=${state}`)).status, 409);
        acceptRedirect(session, JSON.parse(fs.readFileSync(callbackFile)).url);
        const url = await interaction.prompt({ type: 'manual_code' });
        assert.equal(new URL(url).searchParams.get('state'), state);
        return { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh' };
      } }, store: { modify: async (name, fn) => { saved = [name, fn()]; } },
    }) });
    assert.equal(result.status, 0); assert.equal(saved[0], 'openai');
    assert.equal(output.join('\n').includes('synthetic-access'), false);
    assert.equal(fs.existsSync(join(home, 'state/login-request.json')), false);
    assert.equal(fs.existsSync(join(home, 'state/chatgpt-login.lock')), false);
  } finally { relay.closeAllConnections(); await new Promise((r) => relay.close(r)); if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});

for (const fail of ['error', 'cancel']) test(`${fail} leaves no request or pending sign-in and never saves credentials`, async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  try {
    let saved = false;
    const result = await loginChatGpt({ session: 'c'.repeat(32), input: { isTTY: false }, output() {}, load: async () => ({
      oauth: { async login(interaction) {
        interaction.notify({ type: 'auth_url', url: authorize() });
        if (fail === 'error') throw new Error('synthetic provider error');
        process.emit('SIGINT');
        interaction.signal.throwIfAborted();
      } }, store: { modify() { saved = true; } },
    }) });
    assert.equal(result.status, fail === 'cancel' ? 130 : 1);
    assert.equal(saved, false);
    assert.deepEqual(fs.readdirSync(join(home, 'state')), []);
  } finally { if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});

test('a disabled device flow falls back to the browser step without exposing provider errors', async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  try {
    const methods = [];
    const result = await loginChatGpt({ output() {}, load: async () => ({
      oauth: { async login(i, options) { assert.equal(options, undefined, 'same default originator as the installed Pi /login'); methods.push(await i.prompt({ type: 'select' })); if (methods.length === 1) throw new Error('device code login is not enabled'); return { type: 'oauth' }; } },
      store: { async modify() {} },
    }) });
    assert.equal(result.status, 0); assert.deepEqual(methods, ['device_code', 'browser']);
  } finally { if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});

for (const stale of [true, false]) test(`a ${stale ? 'stale' : 'live'} lock is ${stale ? 'recovered' : 'preserved'}`, async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  const lock = join(home, 'state/chatgpt-login.lock');
  fs.mkdirSync(lock, { recursive: true });
  const owner = JSON.stringify({ token: 'previous', pid: process.pid, expires: Date.now() + (stale ? -1000 : 60000) });
  fs.writeFileSync(join(lock, 'owner.json'), owner);
  let loaded = false;
  try {
    const result = await loginChatGpt({ output() {}, load: async () => {
      loaded = true;
      return { oauth: { async login() { return { type: 'oauth' }; } }, store: { async modify() {} } };
    } });
    assert.equal(result.status, stale ? 0 : 1); assert.equal(loaded, stale);
    if (stale) assert.equal(fs.existsSync(lock), false);
    else assert.equal(fs.readFileSync(join(lock, 'owner.json'), 'utf8'), owner);
  } finally { if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});

test('a mistyped redirect can be corrected in the same login without a new authorization URL', async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  let questions = 0, logins = 0;
  try {
    const result = await loginChatGpt({ input: { isTTY: true }, output() {}, method: 'browser',
      question: async () => ++questions === 1 ? 'mistyped' : `http://localhost:1455/auth/callback?code=synthetic&state=${'b'.repeat(32)}`,
      load: async () => ({ oauth: { async login(i, options) {
        logins++; assert.equal(options, undefined);
        i.notify({ type: 'auth_url', url: authorize() });
        await i.prompt({ type: 'manual_code' }); return { type: 'oauth' };
      } }, store: { async modify() {} } }),
    });
    assert.equal(result.status, 0); assert.equal(questions, 2); assert.equal(logins, 1);
  } finally { if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});
