/**
 * Test: shared/sessions/ — tipi, store helpers, store I/O
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadSessionStore,
  saveSessionStore,
  findSessionById,
  findActiveSessions,
  addSessionToStore,
  removeSessionFromStore,
  pruneEndedSessions,
} from '../../../shared/sessions/store.js';
import { looksLikeSessionId, parseSessionLabel } from '../../../shared/sessions/types.js';
import { createSession } from '../../../shared/sessions/session.js';

// ── Tipi e utility ───────────────────────────────────────────

describe('looksLikeSessionId', () => {
  it('riconosce UUID v4 valido', () => {
    expect(looksLikeSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('rifiuta stringa non-UUID', () => {
    expect(looksLikeSessionId('not-a-uuid')).toBe(false);
  });
});

describe('parseSessionLabel', () => {
  it('accetta label valida', () => {
    const r = parseSessionLabel('Ricerca frontend Milano');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe('Ricerca frontend Milano');
  });
  it('rifiuta label vuota', () => {
    expect(parseSessionLabel('').ok).toBe(false);
  });
  it('rifiuta label troppo lunga', () => {
    expect(parseSessionLabel('x'.repeat(600)).ok).toBe(false);
  });
  it('rifiuta valore non stringa', () => {
    expect(parseSessionLabel(42).ok).toBe(false);
  });
});

// ── Store helpers (in-memory) ─────────────────────────────────

describe('store helpers', () => {
  it('addSessionToStore e findSessionById', () => {
    const store = { version: 1, sessions: [] };
    const s = createSession({ channelId: 'web' });
    addSessionToStore(store, s);
    expect(findSessionById(store, s.id)).toBe(s);
  });

  it('findActiveSessions filtra per stato active', () => {
    const store = { version: 1, sessions: [] };
    const s1 = createSession({ channelId: 'web' });
    const s2 = createSession({ channelId: 'web' });
    s2.state = 'ended';
    addSessionToStore(store, s1);
    addSessionToStore(store, s2);
    const active = findActiveSessions(store);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(s1.id);
  });

  it('removeSessionFromStore rimuove e ritorna true', () => {
    const store = { version: 1, sessions: [] };
    const s = createSession({ channelId: 'cli' });
    addSessionToStore(store, s);
    expect(removeSessionFromStore(store, s.id)).toBe(true);
    expect(findSessionById(store, s.id)).toBeUndefined();
  });

  it('pruneEndedSessions rimuove sessioni vecchie', () => {
    const store = { version: 1, sessions: [] };
    const s = createSession({ channelId: 'web' });
    s.state = 'ended';
    s.updatedAtMs = Date.now() - 10_000;
    addSessionToStore(store, s);
    expect(pruneEndedSessions(store, 5_000)).toBe(1);
    expect(store.sessions).toHaveLength(0);
  });
});

// ── Store I/O ────────────────────────────────────────────────

describe('loadSessionStore / saveSessionStore', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `jht-io-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath + '.bak'); } catch { /* ignore */ }
  });

  it('loadSessionStore ritorna store vuoto se file non esiste', async () => {
    const store = await loadSessionStore(tmpPath);
    expect(store.version).toBe(1);
    expect(store.sessions).toHaveLength(0);
  });

  it('saveSessionStore e loadSessionStore round-trip', async () => {
    const s = createSession({ channelId: 'web', label: 'test' });
    const store = { version: 1 as const, sessions: [s] };
    await saveSessionStore(store, tmpPath);
    const loaded = await loadSessionStore(tmpPath);
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].id).toBe(s.id);
    expect(loaded.sessions[0].label).toBe('test');
  });
});
