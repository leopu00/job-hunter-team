import { closeSync, chmodSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// All private configuration state goes through this writer.  chmod is applied
// on every run so files created by an overly-permissive umask are repaired.
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try { chmodSync(dir, PRIVATE_DIR_MODE); } catch { /* ACLs may be managed by the OS */ }
}

export function writePrivateJson(path, value) {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', PRIVATE_FILE_MODE);
    writeFileSync(fd, body, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // v9fs/DrvFS bind mounts (rootless Podman on Windows) enforce the host
    // ACL but reject POSIX chmod with EPERM. The file was already created
    // with the private mode above; do not abort the atomic rename when the
    // backing filesystem owns permission enforcement.
    try { chmodSync(tmp, PRIVATE_FILE_MODE); } catch { /* host ACL is authoritative */ }
    renameSync(tmp, path);
    try { chmodSync(path, PRIVATE_FILE_MODE); } catch { /* best effort on Windows */ }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function repairPrivatePath(path, { directory = false } = {}) {
  try { chmodSync(path, directory ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE); } catch { /* missing/unsupported */ }
}
