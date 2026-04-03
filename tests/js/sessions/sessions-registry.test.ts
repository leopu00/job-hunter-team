/**
 * Test: shared/sessions/registry.ts — SessionRegistry CRUD completo
 * Workaround: inizializza file store per evitare shallow copy di EMPTY_STORE
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRegistry } from '../../../shared/sessions/registry.js';

describe('SessionRegistry', () => {
  let reg: SessionRegistry;
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `jht-reg-${Math.random().toString(36).slice(2)}.json`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, sessions: [] }, null, 2) + '\n', 'utf-8');
    reg = new SessionRegistry({ storePath: tmpPath });
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath + '.bak'); } catch { /* ignore */ }
  });

  it('create e get', async () => {
    const s = await reg.create({ channelId: 'web', label: 'Test sessione' });
    expect(s.channelId).toBe('web');
    expect(s.state).toBe('active');
    expect((await reg.get(s.id))?.id).toBe(s.id);
  });

  it('list ritorna sessioni ordinate per updatedAtMs', async () => {
    await reg.create({ channelId: 'web' });
    await reg.create({ channelId: 'cli' });
    const all = await reg.list();
    expect(all).toHaveLength(2);
    expect(all[0].updatedAtMs).toBeGreaterThanOrEqual(all[1].updatedAtMs);
  });

  it('list filtrata per channelId', async () => {
    await reg.create({ channelId: 'web' });
    await reg.create({ channelId: 'cli' });
    const web = await reg.list({ channelId: 'web' });
    expect(web).toHaveLength(1);
    expect(web[0].channelId).toBe('web');
  });

  it('update modifica campi', async () => {
    const s = await reg.create({ channelId: 'web' });
    await reg.update(s.id, { label: 'Nuova label', model: 'claude-3' });
    const updated = await reg.get(s.id);
    expect(updated?.label).toBe('Nuova label');
    expect(updated?.model).toBe('claude-3');
  });

  it('pause → resume ciclo di vita', async () => {
    const s = await reg.create({ channelId: 'web' });
    expect(await reg.pause(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe('paused');
    expect(await reg.resume(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe('active');
  });

  it('end termina sessione', async () => {
    const s = await reg.create({ channelId: 'cli' });
    expect(await reg.end(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe('ended');
  });

  it('remove elimina sessione', async () => {
    const s = await reg.create({ channelId: 'web' });
    expect(await reg.remove(s.id)).toBe(true);
    expect(await reg.get(s.id)).toBeUndefined();
  });

  it('addMessage incrementa messageCount', async () => {
    const s = await reg.create({ channelId: 'web' });
    await reg.addMessage(s.id, { role: 'user', text: 'ciao' });
    expect((await reg.get(s.id))?.messageCount).toBe(1);
  });

  it('prune rimuove sessioni terminate scadute', async () => {
    const s = await reg.create({ channelId: 'web' });
    await reg.end(s.id);
    // Imposta updatedAtMs nel passato per simulare sessione scaduta
    const store = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    store.sessions[0].updatedAtMs = Date.now() - 20_000;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
    const reg2 = new SessionRegistry({ storePath: tmpPath });
    const pruned = await reg2.prune(10_000);
    expect(pruned).toBe(1);
  });

  it('status ritorna conteggi corretti', async () => {
    await reg.create({ channelId: 'web' });
    const s2 = await reg.create({ channelId: 'cli' });
    await reg.end(s2.id);
    const st = await reg.status();
    expect(st.total).toBe(2);
    expect(st.active).toBe(1);
    expect(st.ended).toBe(1);
  });
});
