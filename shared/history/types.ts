/**
 * History — Tipi per persistenza conversazioni
 *
 * Definisce formato messaggi, header transcript JSONL,
 * configurazione e entry per buffer in-memory.
 */

// --- Message ---

export type HistoryRole = 'system' | 'user' | 'assistant' | 'tool';

export interface HistoryMessage {
  id?: string;
  role: HistoryRole;
  content: string;
  timestamp: number;
  /** Nome tool se role=tool */
  name?: string;
  /** Metadata aggiuntivi (provider, model, token count, ecc.) */
  meta?: Record<string, unknown>;
}

// --- Transcript JSONL ---

/** Prima riga del file JSONL — header con metadati sessione */
export interface TranscriptHeader {
  type: 'session';
  version: string;
  sessionId: string;
  timestamp: number;
  /** Working directory al momento della creazione */
  cwd?: string;
}

/** Riga messaggio nel file JSONL */
export interface TranscriptLine {
  id: string;
  message: HistoryMessage;
}

/** Risultato lettura transcript */
export interface TranscriptData {
  header: TranscriptHeader | null;
  messages: HistoryMessage[];
  lineCount: number;
}

// --- Config ---

export interface HistoryConfig {
  /** Directory base per i transcript (default: ~/.jht/history) */
  baseDir?: string;
  /** Numero massimo di messaggi per transcript (0 = illimitato) */
  maxMessages?: number;
  /** Dimensione massima in byte per transcript (0 = illimitato) */
  maxBytes?: number;
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxMessages: 0,
  maxBytes: 0,
};

// --- Buffer entry (in-memory) ---

export interface HistoryEntry {
  sender: string;
  body: string;
  timestamp: number;
  messageId?: string;
}

// --- Helpers ---

const TRANSCRIPT_VERSION = '1.0.0';

export function createTranscriptHeader(sessionId: string, cwd?: string): TranscriptHeader {
  return {
    type: 'session',
    version: TRANSCRIPT_VERSION,
    sessionId,
    timestamp: Date.now(),
    cwd,
  };
}

export function createHistoryMessage(
  role: HistoryRole,
  content: string,
  meta?: Record<string, unknown>,
): HistoryMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
    meta,
  };
}
