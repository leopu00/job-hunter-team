/**
 * Sistema hook per i plugin JHT.
 *
 * Gestisce registrazione ed esecuzione degli hook lifecycle
 * con ordinamento per priorità, error handling e supporto async.
 */

import type {
  PluginHookName,
  PluginHookHandlerMap,
  PluginHookRegistration,
  PluginHookEvent,
  PluginLogger,
} from "./types.js";
import type { PluginRegistry } from "./registry.js";

// ── HOOK RUNNER ────────────────────────────────────────────

export class HookRunner {
  private hooks = new Map<PluginHookName, PluginHookRegistration[]>();
  private logger?: PluginLogger;

  constructor(logger?: PluginLogger) {
    this.logger = logger;
  }

  /** Registra un hook per un plugin */
  register<K extends PluginHookName>(registration: PluginHookRegistration<K>): void {
    const list = this.hooks.get(registration.hook) ?? [];
    list.push(registration as PluginHookRegistration);
    list.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    this.hooks.set(registration.hook, list);
  }

  /** Rimuovi tutti gli hook di un plugin */
  unregisterPlugin(pluginId: string): void {
    for (const [hook, registrations] of this.hooks) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(hook);
      } else {
        this.hooks.set(hook, filtered);
      }
    }
  }

  /** Esegui tutti gli handler per un hook in ordine di priorità */
  async run<K extends PluginHookName>(
    hook: K,
    event: Parameters<PluginHookHandlerMap[K]>[0],
  ): Promise<void> {
    const registrations = this.hooks.get(hook);
    if (!registrations || registrations.length === 0) return;

    for (const reg of registrations) {
      try {
        await (reg.handler as (e: typeof event) => void | Promise<void>)(event);
      } catch (err) {
        this.logger?.error(
          `Hook ${hook} errore (plugin: ${reg.pluginId}): ${String(err)}`,
        );
      }
    }
  }

  /** Esegui hook in modo sincrono (best-effort, ignora errori) */
  runSync<K extends PluginHookName>(
    hook: K,
    event: Parameters<PluginHookHandlerMap[K]>[0],
  ): void {
    const registrations = this.hooks.get(hook);
    if (!registrations) return;

    for (const reg of registrations) {
      try {
        (reg.handler as (e: typeof event) => void)(event);
      } catch (err) {
        this.logger?.error(
          `Hook sync ${hook} errore (plugin: ${reg.pluginId}): ${String(err)}`,
        );
      }
    }
  }

  /** Verifica se ci sono handler per un hook */
  has(hook: PluginHookName): boolean {
    const list = this.hooks.get(hook);
    return list !== undefined && list.length > 0;
  }

  /** Conta handler per un hook */
  count(hook: PluginHookName): number {
    return this.hooks.get(hook)?.length ?? 0;
  }

  /** Lista tutti gli hook registrati */
  listHooks(): PluginHookName[] {
    return Array.from(this.hooks.keys());
  }

  /** Reset completo (utile per test) */
  clear(): void {
    this.hooks.clear();
  }
}

// ── FACTORY ────────────────────────────────────────────────

/** Crea un HookRunner e registra gli hook da un registry di plugin */
export function createHookRunner(registry: PluginRegistry, logger?: PluginLogger): HookRunner {
  const runner = new HookRunner(logger);

  for (const record of registry.getActive()) {
    const hooks = record.definition?.hooks;
    if (!hooks) continue;

    for (const [hookName, handler] of Object.entries(hooks)) {
      if (!handler) continue;
      runner.register({
        pluginId: record.id,
        hook: hookName as PluginHookName,
        handler: handler as PluginHookHandlerMap[PluginHookName],
      });
    }
  }

  return runner;
}

// ── SINGLETON ──────────────────────────────────────────────

let activeRunner: HookRunner | null = null;

export function setActiveHookRunner(runner: HookRunner): void {
  activeRunner = runner;
}

export function getActiveHookRunner(): HookRunner | null {
  return activeRunner;
}

/** Emetti un hook globale (usa il runner attivo) */
export async function emitHook<K extends PluginHookName>(
  hook: K,
  event: Parameters<PluginHookHandlerMap[K]>[0],
): Promise<void> {
  if (!activeRunner) return;
  await activeRunner.run(hook, event);
}

/** Crea un evento base con timestamp corrente */
export function createHookEvent(pluginId: string): PluginHookEvent {
  return { pluginId, timestamp: Date.now() };
}

export function resetActiveHookRunner(): void {
  activeRunner = null;
}
