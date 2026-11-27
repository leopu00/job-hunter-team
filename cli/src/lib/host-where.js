/**
 * Where the team runs, for whoever talks to the person (the Assistente reads it from `jht team status --json`): the kind of
 * host (`vps` or `local`) and the system of the host (`linux`, `macos`, `windows`), so the paths and the commands it gives are
 * the ones of that machine. A Windows path on a Linux server, or «drag the file into the app» to someone in a terminal, is a
 * way that does not exist there.
 *
 * - The kind: JHT_HOST_TYPE (compose), else the line in $JHT_HOME/host.env the host setup writes, else `local` (as pid1 does).
 * - The system: a VPS is a Linux server. Inside the container the system of the host is read from the folder of the person,
 *   mounted at /jht_user: shared by the virtual machine of macOS (virtiofs, or the file sharing of Docker Desktop), by
 *   WSL on Windows (9p, drvfs), a disk of its own on Linux. Outside the container it is the system Node runs on.
 *   Null when it cannot be told: whoever reads it asks instead of guessing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

const MAC_SHARES = new Set(['virtiofs', 'fakeowner', 'fuse.grpcfuse', 'osxfs']);
const WINDOWS_SHARES = new Set(['9p', 'drvfs', 'v9fs']);
const PLATFORMS = { linux: 'linux', darwin: 'macos', win32: 'windows' };

export function hostType({ env = process.env, home = JHT_HOME, read = readFileSync } = {}) {
  const fromEnv = String(env.JHT_HOST_TYPE ?? '').trim().toLowerCase();
  if (fromEnv) return fromEnv === 'vps' ? 'vps' : 'local';
  try {
    const m = /^\s*(?:export\s+)?JHT_HOST_TYPE=["']?([A-Za-z]+)/m.exec(read(join(home, 'host.env'), 'utf8'));
    return m?.[1]?.toLowerCase() === 'vps' ? 'vps' : 'local';
  } catch {
    return 'local';
  }
}

/** The file system the mount at `point` comes from, read from a /proc/self/mountinfo text; null when it is not mounted. */
export function mountFsType(mountinfo, point = '/jht_user') {
  for (const line of String(mountinfo ?? '').split('\n')) {
    const [left, right] = line.split(' - ');
    const fields = (left ?? '').split(' ');
    if (fields[4] === point && right) return right.split(' ')[0] || null;
  }
  return null;
}

export function hostOs({ type, platform = process.platform, read = readFileSync } = {}) {
  if (type === 'vps') return 'linux';
  let mountinfo = null;
  try { mountinfo = read('/proc/self/mountinfo', 'utf8'); } catch { mountinfo = null; }
  const fs = mountFsType(mountinfo);
  if (fs === null) return mountinfo === null || !/ \/jht_home /.test(mountinfo) ? (PLATFORMS[platform] ?? null) : null;
  if (MAC_SHARES.has(fs)) return 'macos';
  if (WINDOWS_SHARES.has(fs)) return 'windows';
  return platform === 'linux' ? 'linux' : null;
}

/** @returns {{ host_type: 'vps'|'local', host_os: 'linux'|'macos'|'windows'|null }} */
export function hostWhere(options = {}) {
  const type = hostType(options);
  return { host_type: type, host_os: hostOs({ ...options, type }) };
}
