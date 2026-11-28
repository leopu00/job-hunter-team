import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginUrl, loginChatGpt, readLoginRequest, acceptRedirect, startRelay } from '../src/auth/chatgpt-login.js';

test('only the official HTTPS login domain can reach a host browser', () => {
  assert.equal(loginUrl('https://auth.openai.com/oauth/authorize?state=example'), 'https://auth.openai.com/oauth/authorize?state=example');
  for (const url of ['http://auth.openai.com/', 'https://auth.openai.com.evil.invalid/', 'https://auth.openai.com@evil.invalid/', 'file:///tmp/page', 'https://auth.openai.com:444/', 'https://auth.openai.com/\nfoo', 'https://auth.openai.com\\@evil.invalid/']) assert.throws(() => loginUrl(url));
});

test('browser login receives a real relay callback and saves only through the provider store', async () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'jht-signin-'));
  const old = process.env.JHT_HOME; process.env.JHT_HOME = home;
  const session = 'a'.repeat(32), state = 'synthetic-state';
  const callbackFile = join(home, 'relay.json');
  const relay = await startRelay({ host: '127.0.0.1', port: 0, path: callbackFile });
  const output = []; let saved;
  try {
    const result = await loginChatGpt({ session, method: 'browser', input: { isTTY: false }, output: (s) => output.push(s), load: async () => ({
      oauth: { async login(interaction) {
        assert.equal(await interaction.prompt({ type: 'select' }), 'browser');
        interaction.notify({ type: 'auth_url', url: `https://auth.openai.com/oauth/authorize?state=${state}` });
        assert.equal(fs.statSync(join(home, 'state/login-request.json')).mode & 0o777, 0o600);
        assert.equal(readLoginRequest(session).session, session);
        assert.throws(() => readLoginRequest('b'.repeat(32)));
        assert.throws(() => acceptRedirect(session, 'http://localhost:1455/auth/callback?code=x&state=wrong'));
        assert.throws(() => acceptRedirect(session, `https://evil.invalid/auth/callback?code=x&state=${state}`));
        const port = relay.address().port;
        assert.equal((await fetch(`http://127.0.0.1:${port}/wrong?code=x&state=${state}`)).status, 400);
        assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=synthetic&state=${state}`)).status, 200);
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
        interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=test' });
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
      oauth: { async login(i) { methods.push(await i.prompt({ type: 'select' })); if (methods.length === 1) throw new Error('device code login is not enabled'); return { type: 'oauth' }; } },
      store: { async modify() {} },
    }) });
    assert.equal(result.status, 0); assert.deepEqual(methods, ['device_code', 'browser']);
  } finally { if (old === undefined) delete process.env.JHT_HOME; else process.env.JHT_HOME = old; fs.rmSync(home, { recursive: true }); }
});
