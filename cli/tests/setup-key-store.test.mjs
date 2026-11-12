// `jht setup --provider glm|kimi --harness pi --api-key-file|--api-key-stdin`: the key is kept in the container's key store
// (a 0700 folder with a 0600 file per provider), the config holds only the path, a key the provider refuses leaves nothing.
// Keys are invented and built from parts; the store is a folder of a temporary home.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { offeredInRelease } from '../../shared/runtime/release-providers.js';
const kimiSkip = offeredInRelease('kimi') ? false : 'kimi is not offered in this release (shared/runtime/release-providers.js)';

const HOME = mkdtempSync(join(tmpdir(), 'jht-key-store-'));
const DEPS = join(HOME, 'deps');
process.env.JHT_HOME = join(HOME, 'home');
process.env.JHT_DEPS_PREFIX = DEPS;
mkdirSync(process.env.JHT_HOME);
const { runNonInteractiveSetup } = await import('../wizard/setup-noninteractive.js');
const { firstLine, isLauncherSafePath, keyShapeProblem, keyStoreDir, readKeyFromStream, storeApiKey } = await import('../wizard/key-store.js');

const KEY = ['synthetic', 'glm', 'key', 'ab'.repeat(8)].join('-');
const STORE = join(DEPS, 'keys');
const CONFIG = join(process.env.JHT_HOME, 'jht.config.json');
const posix = process.platform !== 'win32';

async function setup(opts, status = 200) {
  const out = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300 });
  process.exitCode = 0;
  try { await runNonInteractiveSetup({ language: 'en', authMethod: 'api_key', harness: 'pi', provider: 'glm', ...opts }); }
  finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}
const config = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : null);
const keyFile = (name) => { const path = join(HOME, name); writeFileSync(path, `${KEY}\n`); return path; };
const piped = (text) => Readable.from([Buffer.from(text)]);
const clean = () => { rmSync(STORE, { recursive: true, force: true }); rmSync(CONFIG, { force: true }); };

test('the key file of the person goes to the key store: config has the path, never the key; folder 0700, file 0600', async () => {
  clean();
  const { code, text } = await setup({ apiKeyFile: keyFile('given.txt'), skipHealth: true });
  assert.equal(code, 0, text);
  assert.deepEqual(config().providers.glm.api_key_ref, { type: 'ref', source: 'file', path: join(STORE, 'glm.key') });
  assert.equal(config().providers.glm.api_key, undefined);
  assert.equal(readFileSync(join(STORE, 'glm.key'), 'utf8'), `${KEY}\n`);
  assert.ok(!readFileSync(CONFIG, 'utf8').includes(KEY));
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes(STORE), 'the summary does not name the folder of the store');
  assert.match(text, /API key kept by the setup/);
  if (posix) {
    assert.equal(statSync(STORE).mode & 0o777, 0o700);
    assert.equal(statSync(join(STORE, 'glm.key')).mode & 0o777, 0o600);
  }
});

test('the key from the standard input is kept the same way (kimi, with its own file)', { skip: kimiSkip }, async () => {
  clean();
  const { code, text } = await setup({ provider: 'moonshot', apiKeyStdin: true, stdin: piped(`${KEY}\r\n`), skipHealth: true });
  assert.equal(code, 0, text);
  assert.equal(config().active_provider, 'kimi');
  assert.equal(config().providers.kimi.api_key_ref.path, join(STORE, 'kimi.key'));
  assert.equal(readFileSync(join(STORE, 'kimi.key'), 'utf8'), `${KEY}\n`);
  assert.ok(!text.includes(KEY));
});

test('a key the provider refuses is not stored and nothing is saved; one it accepts is stored after the check', async () => {
  clean();
  const refused = await setup({ apiKeyFile: keyFile('given.txt') }, 401);
  assert.equal(refused.code, 3, refused.text);
  assert.match(refused.text, /Nothing was saved/);
  assert.equal(existsSync(STORE), false, 'the store is not even made');
  assert.equal(config(), null);
  assert.ok(!refused.text.includes(KEY));

  const accepted = await setup({ apiKeyFile: keyFile('given.txt') }, 200);
  assert.equal(accepted.code, 0, accepted.text);
  assert.match(accepted.text, /the API key is accepted/);
  assert.equal(readFileSync(join(STORE, 'glm.key'), 'utf8'), `${KEY}\n`);
});

test('a new key replaces the old one whole and leaves no temporary file', async () => {
  clean();
  await setup({ apiKeyFile: keyFile('given.txt'), skipHealth: true });
  const next = `${KEY}-second`;
  const second = await setup({ apiKeyStdin: true, stdin: piped(`${next}\n`), skipHealth: true });
  assert.equal(second.code, 0, second.text);
  assert.equal(readFileSync(join(STORE, 'glm.key'), 'utf8'), `${next}\n`);
  assert.deepEqual(readdirSync(STORE), ['glm.key']);
});

test('a temporary file left by a setup that was killed is removed by the next setup of that provider, and only that one', async () => {
  clean();
  mkdirSync(STORE, { recursive: true, mode: 0o700 });
  writeFileSync(join(STORE, '.glm.key.4242.tmp'), `${KEY}\n`);
  writeFileSync(join(STORE, '.kimi.key.4242.tmp'), `${KEY}\n`);
  const { code, text } = await setup({ apiKeyFile: keyFile('given.txt'), skipHealth: true });
  assert.equal(code, 0, text);
  assert.deepEqual(readdirSync(STORE).sort(), ['.kimi.key.4242.tmp', 'glm.key']);
});

test('what cannot be a key is said and nothing is stored: a terminal, an empty pipe, a big one, spaces, two sources', async () => {
  clean();
  const cases = [
    [{ apiKeyStdin: true, stdin: { isTTY: true } }, /reads the key from a pipe/],
    [{ apiKeyStdin: true, stdin: piped('') }, /empty or too big/],
    [{ apiKeyStdin: true, stdin: piped('a'.repeat(5000)) }, /empty or too big/],
    [{ apiKeyStdin: true, stdin: piped(`one two ${KEY}\n`) }, /one line of 16 to 512 printable characters, without spaces/],
    [{ apiKeyStdin: true, stdin: piped('short-key-1\n') }, /one line of 16 to 512/],
    [{ apiKeyStdin: true, apiKeyFile: keyFile('given.txt') }, /not both/],
  ];
  for (const [extra, said] of cases) {
    const { code, text } = await setup({ skipHealth: true, ...extra });
    assert.equal(code, 1, text);
    assert.match(text, said);
    assert.ok(!text.includes(KEY));
  }
  assert.equal(existsSync(STORE), false);
  assert.equal(config(), null);
});

test('their key is still never plaintext: --api-key and no source at all are refused, and the message names the new way', async () => {
  for (const extra of [{}, { secretMode: 'plaintext', apiKey: KEY }]) {
    const { code, text } = await setup({ skipHealth: true, ...extra });
    assert.equal(code, 1, text);
    assert.match(text, /by reference: use --api-key-file or --api-key-stdin/);
    assert.ok(!text.includes(KEY));
  }
  assert.equal(config(), null);
});

test('--secret-file must be a path the launcher can use: a path of the host is refused at the setup, not at the first start', { skip: !posix }, async () => {
  for (const path of ['C:\\Users\\me\\key.txt', 'key.txt', '/dev/shm/with space', '/dev/shm/../etc/key']) {
    const { code, text } = await setup({ secretMode: 'file', secretFile: path, skipHealth: true });
    assert.equal(code, 1, path);
    assert.match(text, /absolute path inside the container/);
    assert.match(text, /--api-key-file/);
  }
  assert.equal(config(), null);
  assert.equal((await setup({ secretMode: 'file', secretFile: '/dev/shm/jht-key', skipHealth: true })).code, 0);
});

test('the pieces: the store folder, the safe path, the shape of a key, the first line, the stream', async () => {
  assert.equal(keyStoreDir({}), '/opt/jht-deps/keys');
  assert.equal(keyStoreDir({ JHT_DEPS_PREFIX: '/x/deps' }), '/x/deps/keys');
  assert.equal(isLauncherSafePath('/opt/jht-deps/keys/glm.key'), true);
  for (const bad of ['C:\\k', 'k', '/a b', '/a/../b', '/a$b', '']) assert.equal(isLauncherSafePath(bad), false, bad);
  assert.equal(keyShapeProblem(KEY), null);
  assert.ok(keyShapeProblem('short'));
  assert.ok(keyShapeProblem(`${KEY} x`));
  assert.equal(firstLine(Buffer.from(`${KEY}\r\nsecond`)), KEY);
  assert.equal(firstLine(Buffer.alloc(5000)), null);
  assert.equal(await readKeyFromStream(piped('\n')), null);
  assert.equal(await readKeyFromStream(piped(`${KEY}\n`)), KEY);
  assert.throws(() => storeApiKey('../x', KEY, { dir: STORE }), /file name/);
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
