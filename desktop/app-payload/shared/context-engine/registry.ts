/**
 * JHT Context Engine — Registry implementazioni
 *
 * Registro per context engine. Permette di registrare implementazioni
 * custom (es. con vector DB) e risolvere quella attiva.
 */
import type { ContextEngine, ContextEngineInfo } from './types.js';
import { assembleContext, systemSection, historySection } from './assembler.js';
import { compactContext, type SummarizeFn } from './compactor.js';

// --- Factory type ---

export type ContextEngineFactory = () => ContextEngine | Promise<ContextEngine>;

// --- Default Engine ---

/**
 * DefaultContextEngine: implementazione base che usa assembler + compactor.
 * Sufficiente per la maggior parte dei casi d'uso JHT.
 */
export class DefaultContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'default',
    name: 'JHT Default Context Engine',
    version: '1.0.0',
  };

  #summarizeFn?: SummarizeFn;

  constructor(opts?: { summarizeFn?: SummarizeFn }) {
    this.#summarizeFn = opts?.summarizeFn;
  }

  async assemble(params: Parameters<ContextEngine['assemble']>[0]) {
    return assembleContext({
      sections: params.sections,
      tokenBudget: params.tokenBudget,
    });
  }

  async compact(params: Parameters<ContextEngine['compact']>[0]) {
    return compactContext({
      messages: params.messages,
      tokenBudget: params.tokenBudget,
      force: params.force,
      instructions: params.instructions,
      summarizeFn: this.#summarizeFn,
    });
  }

  async dispose() {}
}

// --- Registry ---

const engines = new Map<string, { factory: ContextEngineFactory }>();

export function registerContextEngine(
  id: string,
  factory: ContextEngineFactory,
): { ok: boolean; error?: string } {
  if (engines.has(id)) {
    return { ok: false, error: `Engine "${id}" gia' registrato` };
  }
  engines.set(id, { factory });
  return { ok: true };
}

export function getContextEngineFactory(id: string): ContextEngineFactory | undefined {
  return engines.get(id)?.factory;
}

export function listContextEngineIds(): string[] {
  return [...engines.keys()];
}

export function unregisterContextEngine(id: string): boolean {
  return engines.delete(id);
}

/**
 * Risolve il context engine da usare.
 * Se specificato un ID, usa quello. Altrimenti usa "default".
 * Registra automaticamente il default se non presente.
 */
export async function resolveContextEngine(
  engineId?: string,
): Promise<ContextEngine> {
  // Assicura che il default sia sempre disponibile
  if (!engines.has('default')) {
    registerContextEngine('default', () => new DefaultContextEngine());
  }

  const id = engineId?.trim() || 'default';
  const entry = engines.get(id);
  if (!entry) {
    throw new Error(
      `Context engine "${id}" non registrato. Disponibili: ${listContextEngineIds().join(', ') || '(nessuno)'}`,
    );
  }

  return entry.factory();
}
