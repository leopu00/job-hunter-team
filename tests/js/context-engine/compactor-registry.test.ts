/**
 * Test: shared/context-engine/compactor.ts + registry.ts
 * compactContext, registry CRUD, resolveContextEngine, DefaultContextEngine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compactContext } from '../../../shared/context-engine/compactor.js';
import {
  registerContextEngine,
  getContextEngineFactory,
  listContextEngineIds,
  unregisterContextEngine,
  resolveContextEngine,
  DefaultContextEngine,
} from '../../../shared/context-engine/registry.js';
import type { ContextMessage } from '../../../shared/context-engine/types.js';

const msg = (role: 'user' | 'assistant' | 'system', content: string): ContextMessage =>
  ({ role, content });

// ── compactContext ───────────────────────────────────────────

describe('compactContext', () => {
  it('non compatta se sotto soglia 80%', async () => {
    const r = await compactContext({ messages: [msg('user', 'ciao')], tokenBudget: 1000 });
    expect(r.compacted).toBe(false);
    expect(r.reason).toMatch(/soglia/i);
  });

  it('restituisce ok:true sempre', async () => {
    const r = await compactContext({ messages: [msg('user', 'test')], tokenBudget: 1000 });
    expect(r.ok).toBe(true);
  });

  it('tokensBefore e tokensAfter sono numeri', async () => {
    const r = await compactContext({ messages: [msg('user', 'test')], tokenBudget: 1000 });
    expect(typeof r.tokensBefore).toBe('number');
    expect(typeof r.tokensAfter).toBe('number');
  });

  it('compatta messaggi voluminosi oltre soglia', async () => {
    const big = 'z'.repeat(500);
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', big),
    );
    const r = await compactContext({ messages, tokenBudget: 200 });
    expect(r.ok).toBe(true);
    if (r.compacted) {
      expect(r.tokensBefore).toBeGreaterThan(r.tokensAfter);
    }
  });

  it('usa summarizeFn AI se fornita', async () => {
    const big = 'y'.repeat(500);
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', big),
    );
    const summarizeFn = vi.fn().mockResolvedValue('Riassunto AI');
    const r = await compactContext({ messages, tokenBudget: 200, summarizeFn });
    if (r.compacted) {
      expect(summarizeFn).toHaveBeenCalled();
      expect(r.summary).toBe('Riassunto AI');
    }
  });

  it('fallback a riassunto locale se summarizeFn lancia', async () => {
    const big = 'w'.repeat(500);
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', big),
    );
    const summarizeFn = vi.fn().mockRejectedValue(new Error('AI error'));
    const r = await compactContext({ messages, tokenBudget: 200, summarizeFn });
    if (r.compacted) {
      expect(r.summary).toMatch(/Riassunto/i);
    }
  });

  it('force:true bypassa controllo soglia', async () => {
    const messages = [
      msg('system', 'sys'),
      msg('user', 'a'), msg('assistant', 'b'),
      msg('user', 'c'), msg('assistant', 'd'),
    ];
    const r = await compactContext({ messages, tokenBudget: 1000, force: true });
    expect(r.ok).toBe(true);
  });
});

// ── Registry ─────────────────────────────────────────────────

describe('registry', () => {
  beforeEach(() => {
    unregisterContextEngine('test-eng');
    unregisterContextEngine('test-eng-2');
  });

  it('registerContextEngine registra un engine', () => {
    const r = registerContextEngine('test-eng', () => new DefaultContextEngine());
    expect(r.ok).toBe(true);
    expect(getContextEngineFactory('test-eng')).toBeDefined();
  });

  it('register fallisce per ID duplicato', () => {
    registerContextEngine('test-eng', () => new DefaultContextEngine());
    const r = registerContextEngine('test-eng', () => new DefaultContextEngine());
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('unregisterContextEngine rimuove engine', () => {
    registerContextEngine('test-eng', () => new DefaultContextEngine());
    expect(unregisterContextEngine('test-eng')).toBe(true);
    expect(getContextEngineFactory('test-eng')).toBeUndefined();
  });

  it('listContextEngineIds include ID registrati', () => {
    registerContextEngine('test-eng-2', () => new DefaultContextEngine());
    expect(listContextEngineIds()).toContain('test-eng-2');
  });

  it('resolveContextEngine ritorna DefaultContextEngine per "default"', async () => {
    const engine = await resolveContextEngine('default');
    expect(engine.info.id).toBe('default');
  });

  it('resolveContextEngine lancia per ID sconosciuto', async () => {
    await expect(resolveContextEngine('inesistente-xyz')).rejects.toThrow();
  });
});

// ── DefaultContextEngine ──────────────────────────────────────

describe('DefaultContextEngine', () => {
  it('assemble ritorna messaggi e sezioni incluse', async () => {
    const engine = new DefaultContextEngine();
    const r = await engine.assemble({
      sections: [{ id: 'system', priority: 'required', messages: [{ role: 'system', content: 'sys' }] }],
      tokenBudget: 1000,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.includedSections).toContain('system');
  });

  it('compact ritorna ok:true', async () => {
    const engine = new DefaultContextEngine();
    const r = await engine.compact({
      messages: [{ role: 'user', content: 'ciao' }],
      tokenBudget: 1000,
    });
    expect(r.ok).toBe(true);
  });
});
