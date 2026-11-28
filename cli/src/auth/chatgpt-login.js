/** ChatGPT sign-in without the provider's terminal UI. No tokens cross the host bridge. */
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PI_IMAGE_BIN } from '../../../shared/runtime/agent-harness.js';

const TTL = 15 * 60 * 1000;
// Canonical URL emitted by pi-ai 1.5.0: no extra endpoints or parameters can reach the host browser.
export const AUTHORIZE_PATTERN = /^https:\/\/auth\.openai\.com\/oauth\/authorize\?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid\+profile\+email\+offline_access&code_challenge=[A-Za-z0-9_-]{43}&code_challenge_method=S256&state=[a-f0-9]{32}&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi$/;
export function loginUrl(input) {
  if (typeof input !== 'string' || /[\s\\]/.test(input) || (!AUTHORIZE_PATTERN.test(input) && input !== 'https://auth.openai.com/codex/device')) throw new Error('Invalid login URL');
  return input;
}
function sessionId(value) {
  if (!/^[a-f0-9]{32}$/.test(value || '')) throw new Error('Invalid login session');
  return value;
}
const stateDir = () => join(process.env.JHT_HOME || '/jht_home', 'state');
const requestPath = () => join(stateDir(), 'login-request.json');
const responsePath = (id) => join(stateDir(), `login-response-${sessionId(id)}.json`);
const modePath = (id) => join(stateDir(), `login-mode-${sessionId(id)}.json`);
const cancelPath = (id) => join(stateDir(), `login-cancel-${sessionId(id)}`);
function privateWrite(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, JSON.stringify(value)); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, path);
  } finally { try { fs.unlinkSync(temp); } catch { } }
}
function readSmall(path) {
  const info = fs.lstatSync(path);
  if (!info.isFile() || info.size > 16384) throw new Error('Invalid login file');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
export function readLoginRequest(id) {
  const request = readSmall(requestPath());
  if (request.session !== sessionId(id) || typeof request.expires !== 'number' || !Number.isFinite(request.expires) || request.expires <= Date.now() || request.expires > Date.now() + TTL) throw new Error('Expired login request');
  if (request.phase !== 'probe') request.url = loginUrl(request.url);
  return request;
}
export function acceptRedirect(id, input) {
  const request = readLoginRequest(id);
  const url = validateRedirect(request.url, input);
  privateWrite(responsePath(id), { url: url.href });
}
function validateRedirect(authorizeUrl, input) {
  const expected = new URL(authorizeUrl).searchParams.get('state');
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '1455' || url.pathname !== '/auth/callback' || !expected || url.searchParams.get('state') !== expected || (!url.searchParams.get('code') && !url.searchParams.get('error'))) throw new Error('Invalid login callback');
  return url;
}

function claimLock(path, session) {
  const token = randomBytes(16).toString('hex');
  try { fs.mkdirSync(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const owner = readSmall(join(path, 'owner.json'));
      stale = typeof owner.expires === 'number' && owner.expires <= Date.now();
      if (Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') stale = true; }
      }
    } catch { stale = fs.lstatSync(path).mtimeMs + TTL < Date.now(); }
    if (!stale) throw new Error('ChatGPT sign-in is already in progress');
    const previous = `${path}.expired-${token}`;
    fs.renameSync(path, previous);
    try { fs.unlinkSync(join(previous, 'owner.json')); } catch { }
    try { fs.rmdirSync(previous); } catch { }
    fs.mkdirSync(path, { mode: 0o700 });
  }
  try { privateWrite(join(path, 'owner.json'), { token, session, pid: process.pid, expires: Date.now() + TTL }); }
  catch (error) { try { fs.rmdirSync(path); } catch { } throw error; }
  return token;
}
function releaseLock(path, token) {
  try {
    if (readSmall(join(path, 'owner.json')).token !== token) return;
    fs.unlinkSync(join(path, 'owner.json')); fs.rmdirSync(path);
  } catch { /* a shutdown or an already reaped lock must not hide the login result */ }
}
async function hostLoginMethod(session, signal) {
  if (!session) return 'device_code';
  privateWrite(requestPath(), { phase: 'probe', session, expires: Date.now() + TTL });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const { method } = readSmall(modePath(session));
      if (['browser', 'device_code'].includes(method)) return method;
    } catch { }
    await sleep(100, undefined, { signal });
  }
  return 'device_code';
}

/** Relay uses only Node's standard library, including in the core image; no Pi, mounts or credentials. */
export async function startRelay({ port = 1455, host = '0.0.0.0', path = '/tmp/jht-login-callback.json', expectedState } = {}) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:1455');
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !url.searchParams.get('state') || (!url.searchParams.get('code') && !url.searchParams.get('error')) || req.url.length > 8192) {
        res.writeHead(400).end('Invalid callback'); return;
      }
      const state = expectedState || readSmall('/tmp/jht-login-state.json');
      if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid state'); return; }
      if (fs.existsSync(path)) { res.writeHead(409).end('Callback already received'); return; }
      privateWrite(path, { url: url.href });
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Return to Job Hunter Team to finish signing in.');
    } catch { res.writeHead(400).end('Invalid callback'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}

async function loadProvider() {
  const bin = fs.realpathSync(PI_IMAGE_BIN);
  const root = dirname(dirname(bin));
  const ai = join(root, '..', 'pi-ai', 'dist', 'auth', 'oauth', 'openai-codex.js');
  const { openaiCodexOAuth } = await import(pathToFileURL(ai).href);
  const { AuthStorage } = await import(pathToFileURL(join(root, 'dist', 'core', 'auth-storage.js')).href);
  return { oauth: openaiCodexOAuth, store: AuthStorage.create(join(process.env.JHT_HOME || '/jht_home', '.pi', 'agent', 'auth.json')) };
}

export async function loginChatGpt({ load = loadProvider, output = console.log, input = process.stdin, question, method = process.env.JHT_CHATGPT_LOGIN_METHOD || 'device_code', session = process.env.JHT_CHATGPT_LOGIN_SESSION } = {}) {
  if (session) sessionId(session);
  const controller = new AbortController();
  const lock = join(stateDir(), 'chatgpt-login.lock');
  let lockToken;
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, TTL);
  const cancelled = setInterval(() => { if (session && fs.existsSync(cancelPath(session))) stop(); }, 250);
  let reader, authorizeUrl, notificationFailed = false;
  const wasRaw = input.isRaw === true;
  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
  try {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    lockToken = claimLock(lock, session);
    if (method === 'bridge') method = await hostLoginMethod(session, controller.signal);
    const { oauth, store } = await load();
    // Give the provider's lazily imported Node crypto a turn to initialize.
    await sleep(0);
    const interaction = {
      signal: controller.signal,
      notify(event) {
        try {
        if (event.type === 'auth_url' || event.type === 'device_code') {
          const url = loginUrl(event.url || event.verificationUri);
          authorizeUrl = url;
          if (session) privateWrite(requestPath(), { session, expires: Date.now() + TTL, url });
          output(url);
          output(`Copy link: ${process.env.JHT_LOGIN_CLIPBOARD === 'pbcopy' ? `printf '%s' '${url.replaceAll("'", "'\\''")}' | pbcopy` : `Set-Clipboard -Value '${url.replaceAll("'", "''")}'`}`);
          if (event.type === 'device_code') output(`ChatGPT code: ${event.userCode}`);
        }
        } catch { notificationFailed = true; controller.abort(); }
      },
      async prompt(prompt) {
        if (prompt.type === 'select') return method;
        output('Complete the ChatGPT sign-in in your browser. If needed, paste the final redirect URL and press Enter.');
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        controller.signal.addEventListener('abort', onAbort, { once: true });
        prompt.signal?.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted || prompt.signal?.aborted) abort.abort();
        try {
          const poll = async () => {
            for (;;) {
              abort.signal.throwIfAborted();
              if (session && fs.existsSync(responsePath(session))) {
                try { return validateRedirect(authorizeUrl, readSmall(responsePath(session)).url).href; } catch { }
              }
              await sleep(250, undefined, { signal: abort.signal });
            }
          };
          const waits = [poll()];
          if (input.isTTY) {
            if (!question) reader = createInterface({ input, output: process.stdout });
            const manual = async () => {
              for (;;) {
                abort.signal.throwIfAborted();
                const url = await (question ? question(abort.signal) : reader.question('Redirect URL: ', { signal: abort.signal }));
                try {
                  validateRedirect(authorizeUrl, url);
                  if (session) acceptRedirect(session, url);
                  return url;
                } catch { output('Invalid redirect URL. Paste the complete address from the ChatGPT sign-in window.'); }
              }
            };
            waits.push(manual());
          }
          return await Promise.race(waits);
        } finally {
          abort.abort(); reader?.close(); reader = undefined;
          controller.signal.removeEventListener('abort', onAbort);
          prompt.signal?.removeEventListener('abort', onAbort);
        }
      },
    };
    let credential;
    // The installed Pi /login passes no agentName; pi-ai 1.5.0 defaults originator to pi.
    try { credential = await oauth.login(interaction); }
    catch (error) {
      if (method !== 'device_code' || !/device code login is not enabled/.test(error.message)) throw error;
      output('Device sign-in is unavailable. Continue with the ChatGPT browser link.');
      method = 'browser';
      credential = await oauth.login(interaction);
    }
    controller.signal.throwIfAborted();
    await store.modify('openai', () => credential, { signal: controller.signal });
    output('ChatGPT sign-in complete.');
    return { status: 0 };
  } catch {
    output(controller.signal.aborted ? 'ChatGPT sign-in cancelled. Run jht login chatgpt to retry.' : 'ChatGPT sign-in failed. Run jht login chatgpt to retry.');
    return { status: controller.signal.aborted && !notificationFailed ? 130 : 1 };
  } finally {
    controller.abort();
    clearTimeout(timer); clearInterval(cancelled); reader?.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
    if (lockToken && session) for (const path of [requestPath(), responsePath(session), cancelPath(session), modePath(session)]) {
      try {
        if (path !== requestPath() || readSmall(path).session === session) fs.unlinkSync(path);
      } catch { /* absent or owned by another session */ }
    }
    if (lockToken) releaseLock(lock, lockToken);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [verb, id, data] = process.argv.slice(2);
  try {
    if (verb === '--relay') {
      const server = await startRelay();
      privateWrite('/tmp/jht-login-ready.json', true);
      const stop = () => { server.closeAllConnections(); server.close(); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      setTimeout(stop, TTL).unref();
    } else if (verb === '--health') {
      if (readSmall('/tmp/jht-login-ready.json') !== true) process.exitCode = 1;
    } else if (verb === '--arm') {
      if (!/^[a-f0-9]{32}$/.test(id) || fs.existsSync('/tmp/jht-login-state.json')) throw new Error('Invalid callback state');
      privateWrite('/tmp/jht-login-state.json', id);
    } else if (verb === '--relay-read') {
      process.stdout.write(Buffer.from(readSmall('/tmp/jht-login-callback.json').url).toString('base64url'));
    } else if (verb === '--request') {
      const request = readLoginRequest(id);
      process.stdout.write(request.phase === 'probe' ? 'probe' : request.url);
    } else if (verb === '--mode') {
      if (!['browser', 'device_code'].includes(data) || readLoginRequest(id).phase !== 'probe') throw new Error('Invalid login method');
      privateWrite(modePath(id), { method: data });
    }
    else if (verb === '--accept') acceptRedirect(id, Buffer.from((data || fs.readFileSync(0, 'utf8')).trim(), 'base64url').toString('utf8'));
    else if (verb === '--cancel') {
      if (readSmall(join(stateDir(), 'chatgpt-login.lock', 'owner.json')).session === sessionId(id)) privateWrite(cancelPath(id), true);
    }
    else process.exitCode = 2;
  } catch { process.exitCode = 1; }
}
