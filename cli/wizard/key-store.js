/**
 * The key store of the setup: where `jht setup --api-key-file|--api-key-stdin` puts the API key of glm and kimi.
 *
 * Why not a file in ~/.jht: on Windows the bind mount of ~/.jht shows every file as 0777, and the launcher
 * (shared/skills/api_key_file.py) refuses a key file that group or others can read. Why not tmpfs: it is gone at the
 * next restart of the container. The key store is a folder of the container's own volume (/opt/jht-deps, a Linux file
 * system with real modes, kept across the container's recreation), mode 0700, one file per provider, mode 0600.
 * The config holds only the path (`api_key_ref`), never the key, and api_key_file.py accepts exactly that folder
 * (KEY_STORE there: keep the two paths together).
 */
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** The most a file holding one API key can weigh (the launcher's limit). */
export const API_KEY_MAX_BYTES = 4096;
/** One line of 16 to 512 printable ASCII characters without spaces: what the launcher accepts, said at the setup. */
const KEY_SHAPE = /^[!-~]{16,512}$/;
/** The path characters the launcher can type into a pane (spawn-keyfile.sh). */
const LAUNCHER_SAFE_PATH = /^\/[A-Za-z0-9_./-]*$/;

/** The folder of the keys: <JHT_DEPS_PREFIX or /opt/jht-deps>/keys. */
export function keyStoreDir(env = process.env) {
  return join(env.JHT_DEPS_PREFIX || '/opt/jht-deps', 'keys');
}

/** True for an absolute path the launcher can use for a key file: letters, digits and _ . / - only, no «..». */
export function isLauncherSafePath(path) {
  return typeof path === 'string' && LAUNCHER_SAFE_PATH.test(path) && !path.split('/').includes('..');
}

/** Null when `key` is one line a provider key can be; otherwise the reason, which never holds the key. */
export function keyShapeProblem(key) {
  return KEY_SHAPE.test(key) ? null : 'The API key must be one line of 16 to 512 printable characters, without spaces';
}

/**
 * The first line of what a file or the standard input gave (a trailing CR/LF dropped), or null when it is too big for a key.
 * @param {Buffer} data
 */
export function firstLine(data) {
  if (data.length > API_KEY_MAX_BYTES) return null;
  return data.toString('utf8').split(/\r?\n/)[0];
}

/**
 * Writes the key in the store and returns the path of its file. The folder is made 0700 (and refused when it is a link,
 * or another user's), the file is written 0600 beside the final name and renamed over it, so a restart that finds the
 * file finds all of it. Throws an Error whose message never holds the key.
 * @param {string} provider glm | kimi
 * @param {string} key
 * @param {{ dir?: string }} [options]
 */
export function storeApiKey(provider, key, { dir = keyStoreDir() } = {}) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(provider)) throw new Error('the provider name cannot be a file name');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`the key store ${dir} is not a folder`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(`the key store ${dir} belongs to another user`);
  chmodSync(dir, 0o700);

  // A setup killed between the write and the rename (kill -9, power cut) leaves `.<provider>.key.<pid>.tmp` with a key in it:
  // the next setup of the provider takes it away first.
  const stale = new RegExp(`^\\.${provider}\\.key\\.\\d+\\.tmp$`);
  for (const name of readdirSync(dir)) {
    if (stale.test(name)) { try { rmSync(join(dir, name), { force: true }); } catch { /* the write below says if the folder is not usable */ } }
  }

  const target = join(dir, `${provider}.key`);
  const temp = join(dir, `.${provider}.key.${process.pid}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeSync(fd, `${key}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(temp, 0o600);
    renameSync(temp, target);
  } catch (err) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    try { rmSync(temp, { force: true }); } catch { /* nothing to remove */ }
    throw new Error(`the key could not be stored in ${dir}: ${err.code || 'write failed'}`);
  }
  return target;
}

/**
 * The key from the standard input: one line, at most API_KEY_MAX_BYTES bytes. Null when nothing came or it is too big.
 * @param {NodeJS.ReadableStream} stream
 */
export async function readKeyFromStream(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > API_KEY_MAX_BYTES) return null;
    chunks.push(chunk);
  }
  const line = firstLine(Buffer.concat(chunks));
  return line === null || line.trim() === '' ? null : line;
}
