/**
 * History — Persistenza conversazioni per sessione
 */

// Tipi
export type {
  HistoryRole,
  HistoryMessage,
  TranscriptHeader,
  TranscriptLine,
  TranscriptData,
  HistoryConfig,
  HistoryEntry,
} from './types.js';
export { DEFAULT_HISTORY_CONFIG, createTranscriptHeader, createHistoryMessage } from './types.js';

// Transcript JSONL
export {
  resolveBaseDir,
  resolveTranscriptPath,
  ensureTranscriptFile,
  appendMessage,
  appendMessages,
  loadTranscript,
  archiveTranscript,
  deleteTranscript,
  listTranscriptSessionIds,
} from './transcript.js';

// Buffer in-memory
export {
  appendHistoryEntry,
  getHistoryBuffer,
  clearHistoryBuffer,
  clearAllHistoryBuffers,
  evictOldHistoryKeys,
  getBufferKeyCount,
  buildHistoryContext,
  limitHistoryTurns,
  entriesToMessages,
} from './buffer.js';
