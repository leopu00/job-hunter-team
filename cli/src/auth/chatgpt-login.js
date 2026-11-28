/** ChatGPT sign-in without the provider's terminal UI. No tokens cross the host bridge. */
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PI_IMAGE_BIN } from '../../../shared/runtime/agent-harness.js';

const TTL = 15 * 60 * 1000;
export function loginUrl(input) {
  if (typeof input !== 'string' || /[\s\\]/.test(input)) throw new Error('Invalid login URL');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password) throw new Error('Invalid login URL');
  return url.href;
}
function sessionId(value) {
  if (!/^[a-f0-9]{32}$/.test(value || '')) throw new Error('Invalid login session');
  return value;
}
const stateDir = () => join(process.env.JHT_HOME || '/jht_home', 'state');
const requestPath = () => join(stateDir(), 'login-request.json');
const responsePath = (id) => join(stateDir(), `login-response-${sessionId(id)}.json`);
const cancelPath = (id) => join(stateDir(), `login-cancel-${sessionId(id)}`);
function privateWrite(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, path);
}
function readSmall(path) {
  const info = fs.lstatSync(path);
  if (!info.isFile() || info.size > 16384) throw new Error('Invalid login file');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
export function readLoginRequest(id) {
  const request = readSmall(requestPath());
  if (request.session !== sessionId(id) || typeof request.expires !== 'number' || !Number.isFinite(request.expires) || request.expires <= Date.now() || request.expires > Date.now() + TTL) throw new Error('Expired login request');
  request.url = loginUrl(request.url);
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

/** Relay uses only Node's standard library, including in the core image; no Pi, mounts or credentials. */
export async function startRelay({ port = 1455, host = '0.0.0.0', path = '/tmp/jht-login-callback.json' } = {}) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:1455');
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !url.searchParams.get('state') || (!url.searchParams.get('code') && !url.searchParams.get('error')) || req.url.length > 8192) {
        res.writeHead(400).end('Invalid callback'); return;
      }
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

export async function loginChatGpt({ load = loadProvider, output = console.log, input = process.stdin, method = process.env.JHT_CHATGPT_LOGIN_METHOD || 'device_code', session = process.env.JHT_CHATGPT_LOGIN_SESSION } = {}) {
  if (session) sessionId(session);
  const controller = new AbortController();
  const lock = join(stateDir(), 'chatgpt-login.lock');
  let locked = false;
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, TTL);
  const cancelled = setInterval(() => { if (session && fs.existsSync(cancelPath(session))) stop(); }, 250);
  let reader, authorizeUrl;
  const wasRaw = input.isRaw === true;
  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
  try {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(lock, { mode: 0o700 });
    locked = true;
    privateWrite(join(lock, 'owner.json'), session || null);
    const { oauth, store } = await load();
    // Give the provider's lazily imported Node crypto a turn to initialize.
    await sleep(0);
    const interaction = {
      signal: controller.signal,
      notify(event) {
        if (event.type === 'auth_url' || event.type === 'device_code') {
          const url = loginUrl(event.url || event.verificationUri);
          authorizeUrl = url;
          if (session) privateWrite(requestPath(), { session, expires: Date.now() + TTL, url });
          output(url);
          output(`Copy link: ${process.env.JHT_LOGIN_CLIPBOARD === 'pbcopy' ? `printf '%s' '${url.replaceAll("'", "'\\''")}' | pbcopy` : `Set-Clipboard -Value '${url.replaceAll("'", "''")}'`}`);
          if (event.type === 'device_code') output(`ChatGPT code: ${event.userCode}`);
        }
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
                return validateRedirect(authorizeUrl, readSmall(responsePath(session)).url).href;
              }
              await sleep(250, undefined, { signal: abort.signal });
            }
          };
          const waits = [poll()];
          if (input.isTTY) {
            reader = createInterface({ input, output: process.stdout });
            waits.push(reader.question('Redirect URL: ', { signal: abort.signal }).then((url) => {
              validateRedirect(authorizeUrl, url);
              if (session) acceptRedirect(session, url);
              return url;
            }));
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
    try { credential = await oauth.login(interaction, { agentName: 'jht' }); }
    catch (error) {
      if (method !== 'device_code' || !/device code login is not enabled/.test(error.message)) throw error;
      output('Device sign-in is unavailable. Continue with the ChatGPT browser link.');
      method = 'browser';
      credential = await oauth.login(interaction, { agentName: 'jht' });
    }
    controller.signal.throwIfAborted();
    await store.modify('openai', () => credential, { signal: controller.signal });
    output('ChatGPT sign-in complete.');
    return { status: 0 };
  } catch {
    output(controller.signal.aborted ? 'ChatGPT sign-in cancelled. Run jht login chatgpt to retry.' : 'ChatGPT sign-in failed. Run jht login chatgpt to retry.');
    return { status: controller.signal.aborted ? 130 : 1 };
  } finally {
    clearTimeout(timer); clearInterval(cancelled); reader?.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
    if (locked && session) for (const path of [requestPath(), responsePath(session), cancelPath(session)]) {
      try {
        if (path !== requestPath() || readSmall(path).session === session) fs.unlinkSync(path);
      } catch { /* absent or owned by another session */ }
    }
    if (locked) { fs.unlinkSync(join(lock, 'owner.json')); fs.rmdirSync(lock); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [verb, id, data] = process.argv.slice(2);
  try {
    if (verb === '--relay') {
      const server = await startRelay();
      const stop = () => { server.closeAllConnections(); server.close(); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      setTimeout(stop, TTL).unref();
    } else if (verb === '--relay-read') {
      process.stdout.write(Buffer.from(readSmall('/tmp/jht-login-callback.json').url).toString('base64url'));
    } else if (verb === '--request') process.stdout.write(readLoginRequest(id).url);
    else if (verb === '--accept') acceptRedirect(id, Buffer.from(data, 'base64url').toString('utf8'));
    else if (verb === '--cancel') {
      if (readSmall(join(stateDir(), 'chatgpt-login.lock', 'owner.json')) === sessionId(id)) privateWrite(cancelPath(id), true);
    }
    else process.exitCode = 2;
  } catch { process.exitCode = 1; }
}
