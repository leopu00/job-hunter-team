/**
 * Test: shared/events/event-bus.ts + channels.ts
 * EventBus — on, emit, seq, runContext, listenerCount, reset; canali tipizzati
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../../shared/events/event-bus.js';
import { agentEvents, systemEvents, messageEvents } from '../../../shared/events/channels.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus('test-bus');
    bus.resetForTest();
  });

  it('on() riceve eventi emessi', () => {
    const received: any[] = [];
    bus.on((e) => received.push(e));
    bus.emit({ stream: 'lifecycle', data: { msg: 'hi' } });
    expect(received).toHaveLength(1);
    expect((received[0].data as any).msg).toBe('hi');
  });

  it('on() ritorna funzione unsubscribe', () => {
    const received: any[] = [];
    const unsub = bus.on((e) => received.push(e));
    unsub();
    bus.emit({ stream: 'lifecycle', data: {} });
    expect(received).toHaveLength(0);
  });

  it('emit aggiunge ts come numero positivo', () => {
    let event: any;
    bus.on((e) => (event = e));
    bus.emit({ stream: 'lifecycle', data: {} });
    expect(typeof event.ts).toBe('number');
    expect(event.ts).toBeGreaterThan(0);
  });

  it('emit incrementa seq per stesso runId', () => {
    const seqs: number[] = [];
    bus.on((e) => seqs.push(e.seq));
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'run-1' });
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'run-1' });
    expect(seqs).toEqual([1, 2]);
  });

  it('seq indipendente per runId diversi', () => {
    const byRun: Record<string, number[]> = {};
    bus.on((e) => {
      const id = e.runId ?? 'default';
      byRun[id] = byRun[id] ?? [];
      byRun[id].push(e.seq);
    });
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'A' });
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'B' });
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'A' });
    expect(byRun['A']).toEqual([1, 2]);
    expect(byRun['B']).toEqual([1]);
  });

  it('listenerCount riflette i listener attivi', () => {
    expect(bus.listenerCount).toBe(0);
    const unsub = bus.on(() => {});
    expect(bus.listenerCount).toBe(1);
    unsub();
    expect(bus.listenerCount).toBe(0);
  });

  it('registerRunContext e getRunContext', () => {
    bus.registerRunContext('run-1', { sessionId: 'sess-1', agentId: 'agent-1' });
    const ctx = bus.getRunContext('run-1');
    expect(ctx?.sessionId).toBe('sess-1');
    expect(ctx?.agentId).toBe('agent-1');
  });

  it('clearRunContext rimuove contesto e seq', () => {
    bus.registerRunContext('run-1', { sessionId: 's' });
    bus.emit({ stream: 'lifecycle', data: {}, runId: 'run-1' });
    bus.clearRunContext('run-1');
    expect(bus.getRunContext('run-1')).toBeUndefined();
  });

  it('resetForTest svuota tutto', () => {
    bus.on(() => {});
    bus.registerRunContext('r', { sessionId: 's' });
    bus.resetForTest();
    expect(bus.listenerCount).toBe(0);
    expect(bus.getRunContext('r')).toBeUndefined();
  });

  it('errore in listener non blocca gli altri', () => {
    const results: string[] = [];
    bus.on(() => { throw new Error('fail'); });
    bus.on(() => results.push('ok'));
    bus.emit({ stream: 'lifecycle', data: {} });
    expect(results).toContain('ok');
  });
});

// ── Canali tipizzati ─────────────────────────────────────────

describe('channels', () => {
  beforeEach(() => {
    agentEvents.resetForTest();
    systemEvents.resetForTest();
    messageEvents.resetForTest();
  });

  it('agentEvents riceve eventi agente', () => {
    const events: any[] = [];
    agentEvents.on((e) => events.push(e));
    agentEvents.emit({ stream: 'assistant', data: { kind: 'text', text: 'ciao' } });
    expect(events).toHaveLength(1);
    expect(events[0].data.kind).toBe('text');
  });

  it('systemEvents riceve eventi sistema', () => {
    const events: any[] = [];
    systemEvents.on((e) => events.push(e));
    systemEvents.emit({ stream: 'lifecycle', data: { kind: 'startup', version: '1.0' } });
    expect(events[0].data.kind).toBe('startup');
  });

  it('messageEvents riceve eventi messaggi', () => {
    const events: any[] = [];
    messageEvents.on((e) => events.push(e));
    messageEvents.emit({ stream: 'assistant', data: { kind: 'sent', to: 'u', channelId: 'c', success: true } });
    expect(events[0].data.kind).toBe('sent');
  });
});
