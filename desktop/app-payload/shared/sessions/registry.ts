/**
 * JHT Sessions — Registry sessioni attive
 *
 * Gestione in-memoria delle sessioni con persistenza automatica.
 * Integra store e session logic per CRUD completo.
 */
import type { SessionEntry, SessionStoreFile } from './types.js';
import type { ChannelId } from '../channels/channel.js';
import {
  createSession,
  pauseSession,
  resumeSession,
  endSession,
  updateSession,
  recordMessage,
  type CreateSessionParams,
  type SessionPatch,
} from './session.js';
import {
  loadSessionStore,
  saveSessionStore,
  findSessionById,
  findActiveSessions,
  findSessionsByChannel,
  removeSessionFromStore,
  addSessionToStore,
  pruneEndedSessions,
} from './store.js';

export class SessionRegistry {
  #storePath?: string;
  #store: SessionStoreFile | null = null;

  constructor(opts?: { storePath?: string }) {
    this.#storePath = opts?.storePath;
  }

  async #ensureLoaded(): Promise<SessionStoreFile> {
    if (!this.#store) {
      this.#store = await loadSessionStore(this.#storePath);
    }
    return this.#store;
  }

  async #persist(): Promise<void> {
    if (this.#store) await saveSessionStore(this.#store, this.#storePath);
  }

  async create(params: CreateSessionParams): Promise<SessionEntry> {
    const store = await this.#ensureLoaded();
    const session = createSession(params);
    addSessionToStore(store, session);
    await this.#persist();
    return session;
  }

  async get(id: string): Promise<SessionEntry | undefined> {
    const store = await this.#ensureLoaded();
    return findSessionById(store, id);
  }

  async list(opts?: { channelId?: ChannelId; activeOnly?: boolean }): Promise<SessionEntry[]> {
    const store = await this.#ensureLoaded();
    let sessions = store.sessions;
    if (opts?.channelId) {
      sessions = findSessionsByChannel(store, opts.channelId);
    }
    if (opts?.activeOnly) {
      sessions = sessions.filter((s) => s.state === 'active');
    }
    return sessions.toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async update(id: string, patch: SessionPatch): Promise<SessionEntry | null> {
    const store = await this.#ensureLoaded();
    const session = findSessionById(store, id);
    if (!session) return null;
    updateSession(session, patch);
    await this.#persist();
    return session;
  }

  async pause(id: string, reason?: string): Promise<boolean> {
    const store = await this.#ensureLoaded();
    const session = findSessionById(store, id);
    if (!session || session.state !== 'active') return false;
    pauseSession(session, reason);
    await this.#persist();
    return true;
  }

  async resume(id: string, reason?: string): Promise<boolean> {
    const store = await this.#ensureLoaded();
    const session = findSessionById(store, id);
    if (!session || session.state !== 'paused') return false;
    resumeSession(session, reason);
    await this.#persist();
    return true;
  }

  async end(id: string, reason?: string): Promise<boolean> {
    const store = await this.#ensureLoaded();
    const session = findSessionById(store, id);
    if (!session || session.state === 'ended') return false;
    endSession(session, reason);
    await this.#persist();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const store = await this.#ensureLoaded();
    const removed = removeSessionFromStore(store, id);
    if (removed) await this.#persist();
    return removed;
  }

  async addMessage(
    id: string,
    params: { role: 'user' | 'assistant' | 'system'; text: string; meta?: Record<string, unknown> },
  ): Promise<boolean> {
    const store = await this.#ensureLoaded();
    const session = findSessionById(store, id);
    if (!session) return false;
    recordMessage(session, params);
    await this.#persist();
    return true;
  }

  async prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const store = await this.#ensureLoaded();
    const pruned = pruneEndedSessions(store, maxAgeMs);
    if (pruned > 0) await this.#persist();
    return pruned;
  }

  async status(): Promise<{ total: number; active: number; paused: number; ended: number }> {
    const store = await this.#ensureLoaded();
    const sessions = store.sessions;
    return {
      total: sessions.length,
      active: sessions.filter((s) => s.state === 'active').length,
      paused: sessions.filter((s) => s.state === 'paused').length,
      ended: sessions.filter((s) => s.state === 'ended').length,
    };
  }
}
