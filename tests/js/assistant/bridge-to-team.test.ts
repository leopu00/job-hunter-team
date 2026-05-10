/**
 * Test: shared/assistant/bridge-to-team.ts
 * TeamBridge — dispatch, receiveResponse, onEvent, getStatus, getPendingRequests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234-5678'),
}));

import { execSync } from 'child_process';
import { TeamBridge } from '../../../shared/assistant/bridge-to-team.js';

const baseConfig = {
  botToken: 'tok',
  ownerChatId: '42',
  captainSession: 'CAPITANO',
  teamResponseTimeoutMs: 60000,
};

describe('TeamBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execSync as any).mockImplementation(() => '');
  });

  // ── dispatch ────────────────────────────────────────────────

  it('dispatch crea richiesta con status dispatched', async () => {
    const bridge = new TeamBridge(baseConfig);
    const req = await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    expect(req.status).toBe('dispatched');
    expect(req.userId).toBe('user-1');
  });

  it('dispatch imposta id dalla richiesta', async () => {
    const bridge = new TeamBridge(baseConfig);
    const req = await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    expect(req.id).toBe('test-uuid-1234-5678');
  });

  it('dispatch incrementa totalRequests e pendingRequests', async () => {
    const bridge = new TeamBridge(baseConfig);
    await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    const s = bridge.getStatus();
    expect(s.pendingRequests).toBe(1);
    expect(s.totalRequests).toBe(1);
  });

  it('dispatch emette evento request_received', async () => {
    const bridge = new TeamBridge(baseConfig);
    const events: string[] = [];
    bridge.onEvent((e) => events.push(e.type));
    await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    expect(events).toContain('request_received');
  });

  it('dispatch emette evento request_dispatched', async () => {
    const bridge = new TeamBridge(baseConfig);
    const events: string[] = [];
    bridge.onEvent((e) => events.push(e.type));
    await bridge.dispatch({ kind: 'stop_search' }, 'user-1');
    expect(events).toContain('request_dispatched');
  });

  it('dispatch emette error se tmux non risponde', async () => {
    (execSync as any).mockImplementationOnce(() => { throw new Error('no session'); });
    const bridge = new TeamBridge(baseConfig);
    const events: string[] = [];
    bridge.onEvent((e) => events.push(e.type));
    await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    expect(events).toContain('error');
  });

  // ── receiveResponse ─────────────────────────────────────────

  it('receiveResponse ritorna false per requestId sconosciuto', () => {
    const bridge = new TeamBridge(baseConfig);
    const r = bridge.receiveResponse({ requestId: 'unknown', message: 'ok', timestamp: Date.now() });
    expect(r).toBe(false);
  });

  it('receiveResponse completa richiesta pendente', async () => {
    const bridge = new TeamBridge(baseConfig);
    const req = await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    const r = bridge.receiveResponse({ requestId: req.id, message: 'ok', timestamp: Date.now() });
    expect(r).toBe(true);
    expect(bridge.getStatus().pendingRequests).toBe(0);
  });

  it('receiveResponse emette evento response_received', async () => {
    const bridge = new TeamBridge(baseConfig);
    const req = await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    const events: string[] = [];
    bridge.onEvent((e) => events.push(e.type));
    bridge.receiveResponse({ requestId: req.id, message: 'ok', timestamp: Date.now() });
    expect(events).toContain('response_received');
  });

  // ── onEvent ─────────────────────────────────────────────────

  it('onEvent ritorna funzione di unsubscribe', async () => {
    const bridge = new TeamBridge(baseConfig);
    const events: string[] = [];
    const unsub = bridge.onEvent((e) => events.push(e.type));
    unsub();
    await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    expect(events).toHaveLength(0);
  });

  // ── getStatus e getPendingRequests ──────────────────────────

  it('getStatus iniziale: 0 richieste, ownerChatId corretto', () => {
    const bridge = new TeamBridge(baseConfig);
    const s = bridge.getStatus();
    expect(s.pendingRequests).toBe(0);
    expect(s.totalRequests).toBe(0);
    expect(s.ownerChatId).toBe('42');
    expect(s.running).toBe(true);
  });

  it('getPendingRequests ritorna richieste pendenti', async () => {
    const bridge = new TeamBridge(baseConfig);
    await bridge.dispatch({ kind: 'status_check' }, 'user-1');
    const pending = bridge.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe('user-1');
  });
});
