/**
 * Test: shared/context-engine/types.ts + assembler.ts
 * Token estimators, section builders, assembleContext
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateSectionTokens,
} from '../../../shared/context-engine/types.js';
import {
  assembleContext,
  systemSection,
  memorySection,
  toolsSection,
  historySection,
} from '../../../shared/context-engine/assembler.js';

// ── Token estimators ─────────────────────────────────────────

describe('estimateTokens', () => {
  it('calcola ceil(length/4)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('estimateMessageTokens', () => {
  it('aggiunge overhead di 4 token al contenuto', () => {
    const msg = { role: 'user' as const, content: 'abcd' };
    expect(estimateMessageTokens(msg)).toBe(5);
  });
});

describe('estimateSectionTokens', () => {
  it('usa estimatedTokens preimpostato', () => {
    const s = { id: 's', priority: 'high' as const, messages: [], estimatedTokens: 42 };
    expect(estimateSectionTokens(s)).toBe(42);
  });

  it('calcola dai messaggi se estimatedTokens assente', () => {
    const s = {
      id: 's',
      priority: 'high' as const,
      messages: [{ role: 'user' as const, content: 'abcd' }],
    };
    expect(estimateSectionTokens(s)).toBe(5);
  });
});

// ── Section builders ─────────────────────────────────────────

describe('systemSection', () => {
  it('crea sezione required con role system', () => {
    const s = systemSection('prompt sistema');
    expect(s.id).toBe('system');
    expect(s.priority).toBe('required');
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toBe('prompt sistema');
  });
});

describe('memorySection', () => {
  it('lista vuota → sezione senza messaggi', () => {
    expect(memorySection([]).messages).toHaveLength(0);
  });

  it('include le memorie nel contenuto', () => {
    const s = memorySection(['ricorda A', 'ricorda B']);
    expect(s.messages[0].content).toContain('ricorda A');
    expect(s.messages[0].content).toContain('ricorda B');
  });

  it('priorita high', () => {
    expect(memorySection(['x']).priority).toBe('high');
  });
});

describe('toolsSection', () => {
  it('lista vuota → sezione senza messaggi', () => {
    expect(toolsSection([]).messages).toHaveLength(0);
  });

  it('include nome e descrizione tool', () => {
    const s = toolsSection([{ name: 'search', description: 'cerca lavoro' }]);
    expect(s.messages[0].content).toContain('search');
    expect(s.messages[0].content).toContain('cerca lavoro');
  });
});

describe('historySection', () => {
  it('crea sezione history con priorita high', () => {
    const msgs = [{ role: 'user' as const, content: 'msg' }];
    const s = historySection(msgs);
    expect(s.id).toBe('history');
    expect(s.priority).toBe('high');
    expect(s.messages).toBe(msgs);
  });
});

// ── assembleContext ──────────────────────────────────────────

describe('assembleContext', () => {
  it('include sezione nel budget', () => {
    const r = assembleContext({ sections: [systemSection('sys')], tokenBudget: 1000 });
    expect(r.includedSections).toContain('system');
    expect(r.messages).toHaveLength(1);
  });

  it('scarta sezione fuori budget', () => {
    const big = 'x'.repeat(2000);
    const r = assembleContext({
      sections: [
        systemSection('sys'),
        { id: 'low', priority: 'low', messages: [{ role: 'user', content: big }] },
      ],
      tokenBudget: 50,
    });
    expect(r.droppedSections).toContain('low');
  });

  it('ordina per priorita: required prima di high', () => {
    const r = assembleContext({
      sections: [
        { id: 'h', priority: 'high', messages: [{ role: 'user' as const, content: 'high' }] },
        systemSection('sys'),
      ],
      tokenBudget: 1000,
    });
    expect(r.messages[0].content).toBe('sys');
  });

  it('sezione required inclusa con budget sufficiente al contenuto', () => {
    // 'sys' = 3 char → 1 token + 4 overhead = 5 token, budget 10 basta
    const r = assembleContext({
      sections: [
        { id: 'system', priority: 'required', messages: [{ role: 'system', content: 'sys' }] },
        { id: 'low', priority: 'low', messages: [{ role: 'user', content: 'x'.repeat(400) }] },
      ],
      tokenBudget: 10,
    });
    expect(r.includedSections).toContain('system');
    expect(r.droppedSections).toContain('low');
  });

  it('estimatedTokens > 0 con contenuto', () => {
    const r = assembleContext({ sections: [systemSection('testo')], tokenBudget: 1000 });
    expect(r.estimatedTokens).toBeGreaterThan(0);
  });

  it('droppedSections vuoto quando tutto entra', () => {
    const r = assembleContext({ sections: [systemSection('sys')], tokenBudget: 1000 });
    expect(r.droppedSections).toHaveLength(0);
  });
});
