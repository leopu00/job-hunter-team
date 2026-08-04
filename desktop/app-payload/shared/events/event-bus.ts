/**
 * Event Bus — Pub/sub generico tipizzato
 *
 * Bus eventi singleton con listener Set, notifica con error isolation,
 * sequencing automatico per-run, contesto run e reset per test.
 */

import type {
  EventListener,
  EventPayload,
  EventStream,
  RunContext,
  Unsubscribe,
} from "./types.js";

// --- Core listener utilities (da shared/listeners pattern) ---

function notifyListeners<T>(
  listeners: Iterable<EventListener<T>>,
  event: T,
  onError?: (error: unknown) => void,
): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      onError?.(error);
    }
  }
}

function addListener<T>(
  listeners: Set<EventListener<T>>,
  listener: EventListener<T>,
): Unsubscribe {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// --- Global singleton (da shared/global-singleton pattern) ---

function resolveGlobalSingleton<T>(key: symbol, create: () => T): T {
  const store = globalThis as Record<PropertyKey, unknown>;
  if (Object.prototype.hasOwnProperty.call(store, key)) return store[key] as T;
  const created = create();
  store[key] = created;
  return created;
}

// --- Event Bus State ---

type EventBusState<TData> = {
  listeners: Set<EventListener<EventPayload<TData>>>;
  seqByRun: Map<string, number>;
  runContexts: Map<string, RunContext>;
};

const DEFAULT_RUN_ID = "__default__";

// --- Typed Event Bus ---

export class EventBus<TData = Record<string, unknown>> {
  private state: EventBusState<TData>;
  private name: string;

  constructor(name: string) {
    this.name = name;
    const key = Symbol.for(`jht.events.${name}`);
    this.state = resolveGlobalSingleton<EventBusState<TData>>(key, () => ({
      listeners: new Set(),
      seqByRun: new Map(),
      runContexts: new Map(),
    }));
  }

  /** Sottoscrive a tutti gli eventi di questo bus */
  on(listener: EventListener<EventPayload<TData>>): Unsubscribe {
    return addListener(this.state.listeners, listener);
  }

  /** Emette un evento, arricchito con seq e ts automatici */
  emit(event: {
    stream: EventStream;
    data: TData;
    runId?: string;
    sessionId?: string;
    agentId?: string;
  }): void {
    const runId = event.runId ?? DEFAULT_RUN_ID;
    const nextSeq = (this.state.seqByRun.get(runId) ?? 0) + 1;
    this.state.seqByRun.set(runId, nextSeq);

    const ctx = this.state.runContexts.get(runId);
    const enriched: EventPayload<TData> = {
      ...event,
      seq: nextSeq,
      ts: Date.now(),
      sessionId: event.sessionId ?? ctx?.sessionId,
      agentId: event.agentId ?? ctx?.agentId,
    };

    notifyListeners(this.state.listeners, enriched, (err) => {
      console.error(`[events:${this.name}] errore listener:`, err);
    });
  }

  /** Registra contesto per un run (sessionId, agentId) */
  registerRunContext(runId: string, context: RunContext): void {
    const existing = this.state.runContexts.get(runId);
    if (!existing) {
      this.state.runContexts.set(runId, { ...context });
    } else {
      Object.assign(existing, context);
    }
  }

  /** Ottieni contesto di un run */
  getRunContext(runId: string): RunContext | undefined {
    return this.state.runContexts.get(runId);
  }

  /** Rimuovi contesto di un run */
  clearRunContext(runId: string): void {
    this.state.runContexts.delete(runId);
    this.state.seqByRun.delete(runId);
  }

  /** Numero di listener attivi */
  get listenerCount(): number {
    return this.state.listeners.size;
  }

  /** Reset completo per test */
  resetForTest(): void {
    this.state.listeners.clear();
    this.state.seqByRun.clear();
    this.state.runContexts.clear();
  }
}
