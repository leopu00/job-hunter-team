/**
 * Test integrazione: Gateway + Context Engine + Events + Tools
 * Flow end-to-end: messaggio → context assembly → provider → risposta + eventi
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Gateway } from '../../../shared/gateway/gateway.js';
import type { ChannelHandler, ProviderHandler } from '../../../shared/gateway/router.js';
import type { GatewayMessage, GatewayResponse, GatewayEvent } from '../../../shared/gateway/types.js';
import { assembleContext, systemSection, historySection, toolsSection } from '../../../shared/context-engine/assembler.js';
import { agentEvents } from '../../../shared/events/channels.js';
import { registerTool, getTool, isKnownToolId } from '../../../shared/tools/tool-registry.js';
import type { Tool } from '../../../shared/tools/types.js';

// ── Mock helpers ─────────────────────────────────────────────

function makeMsg(content: string): GatewayMessage {
  return { id: randomUUID(), channel: 'web', role: 'user', content, timestamp: new Date(), sessionId: 'sess-test' };
}

function makeResp(msg: GatewayMessage, content: string): GatewayResponse {
  return { id: randomUUID(), messageId: msg.id, content, role: 'assistant', timestamp: new Date(), streaming: false, usage: { inputTokens: 10, outputTokens: 5 } };
}

function makeChannel(): ChannelHandler & { sent: GatewayResponse[] } {
  const sent: GatewayResponse[] = [];
  return {
    id: 'web',
    sent,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockImplementation((r) => { sent.push(r); return Promise.resolve(); }),
    status: () => ({ id: 'web', connected: true }),
  };
}

function makeProvider(reply: string): ProviderHandler {
  return { name: 'mock', chat: async (m) => makeResp(m, reply) };
}

// ── Test ─────────────────────────────────────────────────────

describe('integrazione: Gateway + Context Engine + Events + Tools', () => {
  let gateway: Gateway;
  let channel: ReturnType<typeof makeChannel>;

  beforeEach(() => {
    agentEvents.resetForTest();
    gateway = new Gateway({ maxQueueSize: 10 });
    channel = makeChannel();
    gateway.router.registerChannel(channel);
  });

  afterEach(async () => {
    if (gateway.isRunning()) await gateway.stop();
  });

  // ── Gateway base ──────────────────────────────────────────

  it('flow completo: messaggio → provider → risposta al canale', async () => {
    gateway.router.setProvider(makeProvider('risposta test'));
    await gateway.start();
    const resp = await gateway.handleMessage(makeMsg('ciao'));
    expect(resp.content).toBe('risposta test');
    expect(channel.sent).toHaveLength(1);
  });

  it('gateway emette message.received e response.completed', async () => {
    const events: string[] = [];
    gateway.onEvent((e: GatewayEvent) => events.push(e.type));
    gateway.router.setProvider(makeProvider('ok'));
    await gateway.start();
    await gateway.handleMessage(makeMsg('test'));
    expect(events).toContain('message.received');
    expect(events).toContain('response.completed');
  });

  it('gateway non avviato lancia errore su handleMessage', async () => {
    gateway.router.setProvider(makeProvider('ok'));
    await expect(gateway.handleMessage(makeMsg('test'))).rejects.toThrow('Gateway non attivo');
  });

  it('gateway senza provider lancia errore', async () => {
    await gateway.start();
    await expect(gateway.handleMessage(makeMsg('test'))).rejects.toThrow();
  });

  // ── Context Engine nel flow ───────────────────────────────

  it('context engine assembla system + history per il provider', () => {
    const ctx = assembleContext({
      sections: [
        systemSection('Sei un assistente JHT.'),
        historySection([{ role: 'user', content: 'cercami lavoro' }]),
      ],
      tokenBudget: 1000,
    });
    expect(ctx.includedSections).toContain('system');
    expect(ctx.includedSections).toContain('history');
    expect(ctx.messages[0].content).toBe('Sei un assistente JHT.');
  });

  it('provider usa context engine e restituisce risposta arricchita', async () => {
    let ctxTokens = 0;
    gateway.router.setProvider({
      name: 'context-aware',
      chat: async (m) => {
        const ctx = assembleContext({
          sections: [
            systemSection('System'),
            historySection([{ role: 'user', content: m.content }]),
          ],
          tokenBudget: 500,
        });
        ctxTokens = ctx.estimatedTokens;
        return makeResp(m, `ctx:${ctx.messages.length}`);
      },
    });

    await gateway.start();
    const resp = await gateway.handleMessage(makeMsg('ciao'));
    expect(ctxTokens).toBeGreaterThan(0);
    expect(resp.content).toMatch(/ctx:\d+/);
  });

  it('context engine scarta sezione tools se budget esaurito', () => {
    // systemSection('sys') = 5 token; tools ~14 token; budget 10 → solo system
    const ctx = assembleContext({
      sections: [
        systemSection('sys'),
        toolsSection([{ name: 'search', description: 'cerca sul web' }]),
      ],
      tokenBudget: 10,
    });
    expect(ctx.includedSections).toContain('system');
    expect(ctx.droppedSections).toContain('tools');
  });

  // ── Events pub/sub nel flow ───────────────────────────────

  it('agentEvents emessi durante elaborazione provider', async () => {
    const kinds: string[] = [];
    agentEvents.on((e) => kinds.push(e.data.kind as string));

    gateway.router.setProvider({
      name: 'mock-emitter',
      chat: async (m) => {
        agentEvents.emit({ stream: 'assistant', data: { kind: 'turn_start', message: m.content } });
        agentEvents.emit({ stream: 'assistant', data: { kind: 'turn_end', stopReason: 'done', durationMs: 5 } });
        return makeResp(m, 'ok');
      },
    });

    await gateway.start();
    await gateway.handleMessage(makeMsg('ciao'));
    expect(kinds).toContain('turn_start');
    expect(kinds).toContain('turn_end');
  });

  // ── Tools nel flow ────────────────────────────────────────

  it('tool registry: tool disponibile durante il flow', async () => {
    const mockTool: Tool = {
      name: 'integ-search',
      label: 'search',
      description: 'ricerca integrata',
      execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'risultato' }], details: {} }),
    };
    registerTool(mockTool);

    gateway.router.setProvider({
      name: 'tool-aware',
      chat: async (m) => {
        const tool = getTool('integ-search');
        const result = tool ? await tool.execute('call-1', {}, new AbortController().signal) : null;
        return makeResp(m, result?.content[0].text ?? 'nessun tool');
      },
    });

    await gateway.start();
    const resp = await gateway.handleMessage(makeMsg('cerca'));
    expect(resp.content).toBe('risultato');
  });

  it('isKnownToolId riconosce tool core nel catalogo', () => {
    expect(isKnownToolId('read')).toBe(true);
    expect(isKnownToolId('web_search')).toBe(true);
    expect(isKnownToolId('inesistente')).toBe(false);
  });
});
