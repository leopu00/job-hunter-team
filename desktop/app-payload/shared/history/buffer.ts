/**
 * History — Buffer in-memory con limiti e context builder
 *
 * Buffer per history conversazionale in-memory, con eviction LRU,
 * limiti per chiave, e costruzione contesto per prompt AI.
 */

import type { HistoryEntry, HistoryMessage, HistoryRole } from './types.js';

// --- In-memory buffer ---

const buffers = new Map<string, HistoryEntry[]>();
const DEFAULT_MAX_ENTRIES = 100;
const MAX_KEYS = 1000;

/**
 * Appende una entry al buffer di una chiave (es. sessionId, chatId).
 * Evita duplicati per messageId. FIFO se supera maxEntries.
 */
export function appendHistoryEntry(
  key: string,
  entry: HistoryEntry,
  maxEntries = DEFAULT_MAX_ENTRIES,
): void {
  let list = buffers.get(key);
  if (!list) {
    list = [];
    buffers.set(key, list);
  }

  // Dedup per messageId
  if (entry.messageId && list.some((e) => e.messageId === entry.messageId)) {
    return;
  }

  list.push(entry);

  // FIFO eviction
  if (list.length > maxEntries) {
    list.splice(0, list.length - maxEntries);
  }
}

/**
 * Recupera le entry del buffer per una chiave.
 */
export function getHistoryBuffer(key: string): readonly HistoryEntry[] {
  return buffers.get(key) ?? [];
}

/**
 * Svuota il buffer per una chiave.
 */
export function clearHistoryBuffer(key: string): void {
  buffers.delete(key);
}

/**
 * Svuota tutti i buffer.
 */
export function clearAllHistoryBuffers(): void {
  buffers.clear();
}

/**
 * Evita accumulo chiavi: rimuove le piu' vecchie se > MAX_KEYS.
 */
export function evictOldHistoryKeys(maxKeys = MAX_KEYS): number {
  if (buffers.size <= maxKeys) return 0;

  const keys = Array.from(buffers.keys());
  const toRemove = keys.slice(0, buffers.size - maxKeys);

  for (const key of toRemove) {
    buffers.delete(key);
  }

  return toRemove.length;
}

/**
 * Numero di chiavi attive nel buffer.
 */
export function getBufferKeyCount(): number {
  return buffers.size;
}

// --- Context builder ---

/**
 * Costruisce contesto formattato per prompt AI da entry buffer.
 * Utile per iniettare storia recente nel system prompt.
 */
export function buildHistoryContext(entries: readonly HistoryEntry[]): string {
  if (entries.length === 0) return '';

  const lines = entries.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${e.sender}: ${e.body}`;
  });

  return [
    '[Messaggi recenti della conversazione — per contesto]',
    ...lines,
    '[Fine contesto conversazione]',
  ].join('\n');
}

// --- History turn limiter ---

/**
 * Limita la history a N turni utente (user→assistant).
 * Mantiene il system prompt iniziale se presente.
 */
export function limitHistoryTurns(
  messages: HistoryMessage[],
  maxTurns: number,
): HistoryMessage[] {
  if (messages.length === 0 || maxTurns <= 0) return [];

  // Preserva system prompt
  const hasSystem = messages[0]?.role === 'system';
  const systemMsgs = hasSystem ? [messages[0]] : [];
  const rest = hasSystem ? messages.slice(1) : messages;

  // Conta turni dal fondo (un turno = un messaggio user)
  let turnCount = 0;
  let cutIndex = rest.length;

  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].role === 'user') {
      turnCount++;
      if (turnCount >= maxTurns) {
        cutIndex = i;
        break;
      }
    }
  }

  return [...systemMsgs, ...rest.slice(cutIndex)];
}

/**
 * Converte HistoryEntry in HistoryMessage per uso in context engine.
 */
export function entriesToMessages(entries: readonly HistoryEntry[]): HistoryMessage[] {
  return entries.map((e) => ({
    role: 'user' as HistoryRole,
    content: `${e.sender}: ${e.body}`,
    timestamp: e.timestamp,
    id: e.messageId,
  }));
}
