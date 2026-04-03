/**
 * Hook Registry — Registrazione, risoluzione e triggering
 *
 * Registry singleton per hook con supporto multi-handler per evento,
 * risoluzione collisioni per precedenza sorgente, e triggering asincrono.
 */

import type {
  HookHandler,
  HookEntry,
  HookEvent,
  HookEventType,
  HookSource,
  HooksConfig,
  HOOK_SOURCE_PRECEDENCE,
} from "./types.js";

// --- Handler storage ---

type RegisteredHandler = {
  hookName: string;
  handler: HookHandler;
};

const handlers = new Map<string, RegisteredHandler[]>();

// --- Event key ---

function eventKey(type: string, action?: string): string {
  return action ? `${type}:${action}` : type;
}

// --- Registration ---

export function registerHook(
  event: string,
  hookName: string,
  handler: HookHandler,
): void {
  const list = handlers.get(event) ?? [];
  list.push({ hookName, handler });
  handlers.set(event, list);
}

export function unregisterHook(event: string, hookName: string): void {
  const list = handlers.get(event);
  if (!list) return;
  const filtered = list.filter((h) => h.hookName !== hookName);
  if (filtered.length > 0) {
    handlers.set(event, filtered);
  } else {
    handlers.delete(event);
  }
}

export function clearAllHooks(): void {
  handlers.clear();
}

// --- Query ---

export function hasListeners(type: string, action?: string): boolean {
  if (handlers.has(type)) return true;
  if (action && handlers.has(eventKey(type, action))) return true;
  return false;
}

export function getRegisteredEvents(): string[] {
  return Array.from(handlers.keys());
}

export function getHandlerCount(event?: string): number {
  if (event) return handlers.get(event)?.length ?? 0;
  let total = 0;
  for (const list of handlers.values()) total += list.length;
  return total;
}

// --- Triggering ---

/**
 * Triggera tutti gli handler registrati per un evento.
 * Esegue prima i handler generici (tipo), poi quelli specifici (tipo:azione).
 * Gli errori vengono catturati e loggati, non bloccano gli altri handler.
 */
export async function triggerHook(event: HookEvent): Promise<void> {
  const typeHandlers = handlers.get(event.type) ?? [];
  const specificHandlers = handlers.get(eventKey(event.type, event.action)) ?? [];

  const allHandlers = [...typeHandlers, ...specificHandlers];
  if (allHandlers.length === 0) return;

  for (const { hookName, handler } of allHandlers) {
    try {
      await handler(event);
    } catch (err) {
      console.error(`[hooks] errore in hook "${hookName}" per ${event.type}:${event.action}:`, err);
    }
  }
}

// --- Event factory ---

export function createHookEvent(
  type: HookEventType,
  action: string,
  context?: Record<string, unknown>,
): HookEvent {
  return {
    type,
    action,
    timestamp: Date.now(),
    context: context ?? {},
    messages: [],
  };
}

// --- Entry resolution ---

/**
 * Risolve collisioni tra hook con lo stesso nome.
 * Hook con precedenza sorgente piu' alta vincono.
 */
export function resolveHookEntries(
  entries: HookEntry[],
  precedence: Record<HookSource, number>,
): HookEntry[] {
  const byName = new Map<string, HookEntry>();

  const sorted = [...entries].sort(
    (a, b) => precedence[a.hook.source] - precedence[b.hook.source],
  );

  for (const entry of sorted) {
    byName.set(entry.hook.name, entry);
  }

  return Array.from(byName.values());
}

/**
 * Filtra hook in base alla config e ai requirements.
 */
export function filterEligibleHooks(
  entries: HookEntry[],
  config?: HooksConfig,
): HookEntry[] {
  if (config?.enabled === false) return [];

  return entries.filter((entry) => {
    if (!entry.enabled) return false;

    const hookConfig = config?.entries?.[entry.hook.name];
    if (hookConfig?.enabled === false) return false;

    const reqs = entry.metadata.requires;
    if (reqs?.env) {
      for (const envVar of reqs.env) {
        if (!process.env[envVar]) return false;
      }
    }

    return true;
  });
}
