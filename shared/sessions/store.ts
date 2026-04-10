/**
 * JHT Sessions — Store persistente su file
 *
 * Salva e carica sessioni da ~/.jht/sessions/sessions.json.
 * Scrittura atomica con backup, stessa strategia di shared/cron/store.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JHT_HOME } from '../paths.js';
import type { SessionStoreFile, SessionEntry } from './types.js';

const JHT_SESSIONS_DIR = path.join(JHT_HOME, 'sessions');
const JHT_SESSIONS_PATH = path.join(JHT_SESSIONS_DIR, 'sessions.json');

export function resolveSessionStorePath(custom?: string): string {
  return custom ?? JHT_SESSIONS_PATH;
}

const EMPTY_STORE: SessionStoreFile = { version: 1, sessions: [] };

let lastSerializedCache: string | null = null;

export async function loadSessionStore(storePath?: string): Promise<SessionStoreFile> {
  const p = resolveSessionStorePath(storePath);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as SessionStoreFile;
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.sessions)) {
      return { ...EMPTY_STORE };
    }
    lastSerializedCache = raw;
    return parsed;
  } catch (err: any) {
    if (err.code === 'ENOENT') return { ...EMPTY_STORE };
    throw err;
  }
}

export async function saveSessionStore(
  store: SessionStoreFile,
  storePath?: string,
): Promise<void> {
  const p = resolveSessionStorePath(storePath);
  const serialized = JSON.stringify(store, null, 2) + '\n';

  // Skip no-op writes
  if (serialized === lastSerializedCache) return;

  fs.mkdirSync(path.dirname(p), { recursive: true });

  // Backup
  if (fs.existsSync(p)) {
    try {
      fs.copyFileSync(p, p + '.bak');
    } catch { /* ignore backup errors */ }
  }

  // Atomic write: temp + rename
  const tmp = p + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, serialized, 'utf-8');
    fs.renameSync(tmp, p);
    lastSerializedCache = serialized;
  } catch (err: any) {
    // Windows fallback: copy + unlink
    try {
      fs.copyFileSync(tmp, p);
      fs.unlinkSync(tmp);
      lastSerializedCache = serialized;
    } catch {
      throw err;
    }
  }
}

// --- Query helpers ---

export function findSessionById(
  store: SessionStoreFile,
  id: string,
): SessionEntry | undefined {
  return store.sessions.find((s) => s.id === id);
}

export function findSessionsByChannel(
  store: SessionStoreFile,
  channelId: string,
): SessionEntry[] {
  return store.sessions.filter((s) => s.channelId === channelId);
}

export function findActiveSessions(store: SessionStoreFile): SessionEntry[] {
  return store.sessions.filter((s) => s.state === 'active');
}

export function findSessionsByUser(
  store: SessionStoreFile,
  userId: string,
): SessionEntry[] {
  return store.sessions.filter((s) => s.userId === userId);
}

export function removeSessionFromStore(
  store: SessionStoreFile,
  id: string,
): boolean {
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.id !== id);
  return store.sessions.length !== before;
}

export function addSessionToStore(
  store: SessionStoreFile,
  session: SessionEntry,
): void {
  store.sessions.push(session);
}

/** Rimuove sessioni terminate piu' vecchie di maxAgeMs */
export function pruneEndedSessions(
  store: SessionStoreFile,
  maxAgeMs: number,
): number {
  const cutoff = Date.now() - maxAgeMs;
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(
    (s) => s.state !== 'ended' || s.updatedAtMs > cutoff,
  );
  return before - store.sessions.length;
}
