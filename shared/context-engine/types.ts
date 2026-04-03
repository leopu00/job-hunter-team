/**
 * JHT Context Engine — Tipi per assemblaggio contesto AI
 *
 * Il context engine assembla il contesto (system prompt, memory,
 * tools, cronologia sessione) per le chiamate ai provider AI,
 * rispettando un budget di token.
 */

// --- Message ---

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContextMessage {
  role: MessageRole;
  content: string;
  /** Nome tool per role=tool */
  name?: string;
  /** Metadata aggiuntivi */
  meta?: Record<string, unknown>;
}

// --- Context Section ---

export type SectionPriority = 'required' | 'high' | 'medium' | 'low';

export interface ContextSection {
  /** Identificativo sezione (es. "system", "memory", "tools", "history") */
  id: string;
  /** Priorita' per il budget allocation */
  priority: SectionPriority;
  /** Messaggi della sezione */
  messages: ContextMessage[];
  /** Token stimati (se gia' calcolati) */
  estimatedTokens?: number;
  /** Max token allocabili a questa sezione */
  maxTokens?: number;
}

// --- Assemble Result ---

export interface AssembleResult {
  /** Messaggi ordinati pronti per il modello */
  messages: ContextMessage[];
  /** Token totali stimati */
  estimatedTokens: number;
  /** Sezioni incluse */
  includedSections: string[];
  /** Sezioni scartate per budget */
  droppedSections: string[];
}

// --- Compact Result ---

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  summary?: string;
  tokensBefore: number;
  tokensAfter: number;
}

// --- Context Engine Info ---

export interface ContextEngineInfo {
  id: string;
  name: string;
  version?: string;
}

// --- Context Engine Interface ---

export interface ContextEngine {
  readonly info: ContextEngineInfo;

  /**
   * Assembla contesto sotto un budget di token.
   * Ordina le sezioni per priorita', taglia se necessario.
   */
  assemble(params: {
    sections: ContextSection[];
    tokenBudget: number;
    model?: string;
  }): Promise<AssembleResult>;

  /**
   * Compatta il contesto riducendo i token.
   * Puo' creare riassunti, rimuovere turni vecchi, ecc.
   */
  compact(params: {
    messages: ContextMessage[];
    tokenBudget: number;
    /** Forza compaction anche sotto soglia */
    force?: boolean;
    /** Istruzioni custom per il riassunto */
    instructions?: string;
  }): Promise<CompactResult>;

  /** Libera risorse */
  dispose?(): Promise<void>;
}

// --- Token Estimator ---

export type TokenEstimator = (text: string) => number;

/**
 * Stima token con approssimazione 1 token ~ 4 caratteri.
 * Sufficiente per budget allocation, non per conteggio esatto.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(msg: ContextMessage): number {
  // Overhead per role/formatting (~4 token)
  return estimateTokens(msg.content) + 4;
}

export function estimateSectionTokens(section: ContextSection): number {
  if (section.estimatedTokens !== undefined) return section.estimatedTokens;
  return section.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
