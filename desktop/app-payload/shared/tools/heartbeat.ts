/**
 * Heartbeat — Ping periodico agenti
 *
 * Timer-based heartbeat con eventi, coalescing delle richieste,
 * retry con backoff, e listener per stato agenti.
 */

import type {
  HeartbeatEvent,
  HeartbeatHandler,
  HeartbeatIndicatorType,
  HeartbeatRunResult,
  HeartbeatStatus,
} from "./types.js";

// --- Stato globale ---

let handler: HeartbeatHandler | null = null;
let enabled = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastEvent: HeartbeatEvent | null = null;
const listeners = new Set<(evt: HeartbeatEvent) => void>();

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

// --- Indicator ---

export function resolveIndicatorType(status: HeartbeatStatus): HeartbeatIndicatorType | undefined {
  switch (status) {
    case "ok-empty":
    case "ok-token":
      return "ok";
    case "sent":
      return "alert";
    case "failed":
      return "error";
    case "skipped":
      return undefined;
  }
}

// --- Eventi ---

export function emitHeartbeatEvent(evt: Omit<HeartbeatEvent, "ts">): void {
  const enriched: HeartbeatEvent = { ts: Date.now(), ...evt };
  enriched.indicatorType = resolveIndicatorType(enriched.status);
  lastEvent = enriched;
  for (const listener of listeners) {
    try { listener(enriched); } catch { /* ignora errori listener */ }
  }
}

export function onHeartbeatEvent(listener: (evt: HeartbeatEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLastHeartbeatEvent(): HeartbeatEvent | null {
  return lastEvent;
}

// --- Controllo ---

export function setHeartbeatHandler(h: HeartbeatHandler): void {
  handler = h;
}

export function setHeartbeatsEnabled(value: boolean): void {
  enabled = value;
  if (!value) stopHeartbeat();
}

export function areHeartbeatsEnabled(): boolean {
  return enabled;
}

// --- Timer e esecuzione ---

async function executeHeartbeat(reason?: string, agentId?: string): Promise<void> {
  if (!handler || running) return;
  running = true;
  emitHeartbeatEvent({ status: "sent", agentId, reason });

  try {
    const result = await handler({ reason, agentId });
    if (result.status === "ran") {
      emitHeartbeatEvent({ status: "ok-token", agentId, durationMs: result.durationMs, reason });
    } else if (result.status === "skipped") {
      emitHeartbeatEvent({ status: "skipped", agentId, reason: result.reason });
    } else {
      emitHeartbeatEvent({ status: "failed", agentId, reason: result.reason });
    }
  } catch (err) {
    emitHeartbeatEvent({ status: "failed", agentId, reason: (err as Error).message });
  } finally {
    running = false;
  }
}

function scheduleNext(delayMs: number, reason?: string, agentId?: string): void {
  if (timer) clearTimeout(timer);
  const delay = Math.max(0, Math.min(delayMs, MAX_RETRY_MS));
  timer = setTimeout(() => {
    timer = null;
    executeHeartbeat(reason ?? "interval", agentId);
  }, delay);
}

/**
 * Richiede un heartbeat immediato (con coalescing).
 */
export function requestHeartbeatNow(opts?: { reason?: string; agentId?: string }): void {
  if (!enabled) return;
  scheduleNext(DEFAULT_COALESCE_MS, opts?.reason ?? "requested", opts?.agentId);
}

/**
 * Avvia heartbeat periodico con intervallo in ms.
 */
export function startHeartbeat(intervalMs: number, agentId?: string): void {
  if (!enabled) return;
  const tick = () => {
    executeHeartbeat("interval", agentId).finally(() => {
      if (enabled) scheduleNext(intervalMs, "interval", agentId);
    });
  };
  scheduleNext(intervalMs, "interval", agentId);
  // Prima esecuzione immediata
  executeHeartbeat("startup", agentId);
}

/**
 * Ferma il timer heartbeat.
 */
export function stopHeartbeat(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Reset per test.
 */
export function resetHeartbeatForTest(): void {
  stopHeartbeat();
  handler = null;
  enabled = true;
  running = false;
  lastEvent = null;
  listeners.clear();
}
