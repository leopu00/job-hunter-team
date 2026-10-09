import {
  closeSync, chmodSync, constants, fchmodSync, fstatSync, ftruncateSync, fsyncSync, lstatSync,
  mkdirSync, openSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

// All private configuration state goes through this writer.  chmod is applied
// on every run so files created by an overly-permissive umask are repaired.
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

// How a folder refuses the atomic replace. On Windows through DrvFS/9p (Podman
// in WSL) a rename over a file that another Windows process holds open
// (antivirus, indexer, Explorer) fails with one of these, usually for a moment;
// a folder the container user cannot write fails the same way for good.
const REFUSED_CODES = new Set(['EACCES', 'EPERM', 'EBUSY']);
// Backoff of the rename retries: 25 ms doubling, about 1.6 s in total.
const RENAME_RETRIES = 6;

export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try { chmodSync(dir, PRIVATE_DIR_MODE); } catch { /* ACLs may be managed by the OS */ }
}

/**
 * Atomic write (temp + rename), with one fallback.
 *
 * In v0.3.9 the working hours never saved on Windows: a `.bak-*` appeared at
 * every attempt and `jht.config.json` never changed, with a truncated
 * traceback as the only trace. When the folder refuses the temp file or the
 * rename, the save must neither vanish nor fail when it can still succeed:
 *  - a refused rename is retried (a Windows sharing violation passes);
 *  - if the folder keeps refusing and the file already exists, the file is
 *    rewritten in place, and the fact goes to stderr;
 *  - otherwise the error is thrown with the path and both causes, and no
 *    temp file with the configuration in it is left behind.
 */
export function writePrivateJson(path, value) {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  let pending = false;
  try {
    try {
      fd = openSync(tmp, 'wx', PRIVATE_FILE_MODE);
    } catch (err) {
      if (!REFUSED_CODES.has(err?.code)) throw err;
      writeInPlace(path, body, err);
      return;
    }
    pending = true;
    writeFileSync(fd, body, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // v9fs/DrvFS bind mounts (rootless Podman on Windows) enforce the host
    // ACL but reject POSIX chmod with EPERM. The file was already created
    // with the private mode above; do not abort the atomic rename when the
    // backing filesystem owns permission enforcement.
    try { chmodSync(tmp, PRIVATE_FILE_MODE); } catch { /* host ACL is authoritative */ }
    try {
      renameWithRetry(tmp, path);
      pending = false;
    } catch (err) {
      if (!REFUSED_CODES.has(err?.code)) throw err;
      writeInPlace(path, body, err);
      return;
    }
    try { chmodSync(path, PRIVATE_FILE_MODE); } catch { /* best effort on Windows */ }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (pending) {
      try { unlinkSync(tmp); } catch { /* the folder may refuse this too */ }
    }
  }
}

function renameWithRetry(tmp, path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      if (!REFUSED_CODES.has(err?.code) || attempt >= RENAME_RETRIES) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * 2 ** attempt);
    }
  }
}

// Only an EXISTING regular file, opened without O_CREAT: this path never
// creates a file the atomic path could not create, and never follows a link.
// A symlink planted where the config should be would otherwise send the
// configuration wherever it points (lstat refuses it; O_NOFOLLOW, where the
// platform has it, closes the window between lstat and open, and the inode
// check catches a swap). One write of the whole body, then truncate, the
// private mode and fsync. On Windows the file keeps the ACL it already has:
// writing content does not touch the security descriptor, only a rename would.
function writeInPlace(path, body, cause) {
  let fd;
  try {
    const before = lstatSync(path);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw Object.assign(new Error('not a regular file'),
        { code: before.isSymbolicLink() ? 'ELOOP' : 'EINVAL' });
    }
    fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd);
    if (before.ino && opened.ino && (opened.ino !== before.ino || opened.dev !== before.dev)) {
      throw Object.assign(new Error('replaced while opening'), { code: 'ESTALE' });
    }
    const bytes = Buffer.from(body, 'utf8');
    writeSync(fd, bytes, 0, bytes.length, 0);
    ftruncateSync(fd, bytes.length);
    // Same rule as the atomic path: private, unless the host ACL owns it.
    try { fchmodSync(fd, PRIVATE_FILE_MODE); } catch { /* host ACL is authoritative */ }
    fsyncSync(fd);
  } catch (err) {
    const failure = new Error(
      `cannot save ${path}: the folder refused the atomic replace (${cause.code}) `
      + `and writing in place failed too (${err?.code || err?.message})`,
      { cause },
    );
    failure.code = 'config_write_failed';
    throw failure;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  process.stderr.write(
    `jht: ${path}: the folder refused the atomic replace (${cause.code}); `
    + 'the file was rewritten in place\n',
  );
}

export function repairPrivatePath(path, { directory = false } = {}) {
  try { chmodSync(path, directory ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE); } catch { /* missing/unsupported */ }
}
