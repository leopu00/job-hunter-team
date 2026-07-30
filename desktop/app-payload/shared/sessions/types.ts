/**
 * JHT Sessions — Tipi per gestione sessioni conversazione
 *
 * Una sessione rappresenta una conversazione tra utente e agenti
 * attraverso un canale specifico (web, CLI, Telegram).
 */
import type { ChannelId } from '../channels/channel.js';

// --- Session ID ---

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value.trim());
}

// --- Session State ---

export type SessionState = 'active' | 'paused' | 'ended';

export type SessionChatType = 'direct' | 'group' | 'channel';

// --- Session Entry ---

export interface SessionEntry {
  id: string;
  /** Etichetta leggibile (es. "Ricerca frontend Milano") */
  label?: string;
  /** Canale di comunicazione */
  channelId: ChannelId;
  /** Tipo chat */
  chatType: SessionChatType;
  /** Stato corrente */
  state: SessionState;
  /** Provider AI attivo in questa sessione */
  provider?: string;
  /** Modello AI attivo */
  model?: string;
  /** ID utente associato */
  userId?: string;
  /** Contesto aggiuntivo */
  context?: Record<string, unknown>;
  /** Timestamp creazione (epoch ms) */
  createdAtMs: number;
  /** Timestamp ultimo aggiornamento (epoch ms) */
  updatedAtMs: number;
  /** Timestamp ultimo messaggio (epoch ms) */
  lastMessageAtMs?: number;
  /** Contatore messaggi */
  messageCount: number;
}

// --- Session Label ---

export const SESSION_LABEL_MAX_LENGTH = 512;

export type ParsedSessionLabel =
  | { ok: true; label: string }
  | { ok: false; error: string };

export function parseSessionLabel(raw: unknown): ParsedSessionLabel {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'label deve essere una stringa' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'label vuota' };
  }
  if (trimmed.length > SESSION_LABEL_MAX_LENGTH) {
    return { ok: false, error: `label troppo lunga (max ${SESSION_LABEL_MAX_LENGTH})` };
  }
  return { ok: true, label: trimmed };
}

// --- Lifecycle Events ---

export type SessionLifecycleAction = 'created' | 'resumed' | 'paused' | 'ended' | 'updated';

export interface SessionLifecycleEvent {
  sessionId: string;
  action: SessionLifecycleAction;
  reason?: string;
  parentSessionId?: string;
  label?: string;
  timestamp: number;
}

// --- Transcript Events ---

export interface SessionTranscriptUpdate {
  sessionId: string;
  messageId?: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

// --- Input Provenance ---

export type InputProvenanceKind = 'external_user' | 'inter_session' | 'internal_system';

export interface InputProvenance {
  kind: InputProvenanceKind;
  sourceSessionId?: string;
  sourceChannel?: string;
}

// --- Session Store ---

export interface SessionStoreFile {
  version: number;
  sessions: SessionEntry[];
}
