/**
 * JHT Sessions — Modulo gestione sessioni conversazione
 */

// Tipi
export type {
  SessionState,
  SessionChatType,
  SessionEntry,
  SessionLifecycleAction,
  SessionLifecycleEvent,
  SessionTranscriptUpdate,
  InputProvenance,
  InputProvenanceKind,
  SessionStoreFile,
  ParsedSessionLabel,
} from './types.js';
export { SESSION_ID_RE, looksLikeSessionId, parseSessionLabel, SESSION_LABEL_MAX_LENGTH } from './types.js';

// Logica sessione
export {
  createSession,
  pauseSession,
  resumeSession,
  endSession,
  updateSession,
  recordMessage,
  normalizeInputProvenance,
  onSessionLifecycle,
  emitSessionLifecycle,
  onSessionTranscript,
  emitSessionTranscript,
} from './session.js';
export type { CreateSessionParams, SessionPatch } from './session.js';

// Store
export {
  loadSessionStore,
  saveSessionStore,
  resolveSessionStorePath,
  findSessionById,
  findSessionsByChannel,
  findActiveSessions,
  findSessionsByUser,
  removeSessionFromStore,
  addSessionToStore,
  pruneEndedSessions,
} from './store.js';

// Registry
export { SessionRegistry } from './registry.js';
