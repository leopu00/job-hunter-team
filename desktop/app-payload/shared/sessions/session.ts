/**
 * JHT Sessions — Logica core sessione e event emitter
 *
 * Crea, aggiorna sessioni e emette eventi lifecycle/transcript.
 */
import { randomUUID } from 'node:crypto';
import type {
  SessionEntry,
  SessionState,
  SessionChatType,
  SessionLifecycleEvent,
  SessionLifecycleAction,
  SessionTranscriptUpdate,
  InputProvenance,
  InputProvenanceKind,
} from './types.js';
import type { ChannelId } from '../channels/channel.js';

// --- Lifecycle Event Emitter ---

type LifecycleListener = (event: SessionLifecycleEvent) => void;
const lifecycleListeners = new Set<LifecycleListener>();

export function onSessionLifecycle(listener: LifecycleListener): () => void {
  lifecycleListeners.add(listener);
  return () => { lifecycleListeners.delete(listener); };
}

export function emitSessionLifecycle(event: SessionLifecycleEvent): void {
  for (const listener of lifecycleListeners) {
    try { listener(event); } catch { /* best-effort */ }
  }
}

// --- Transcript Event Emitter ---

type TranscriptListener = (update: SessionTranscriptUpdate) => void;
const transcriptListeners = new Set<TranscriptListener>();

export function onSessionTranscript(listener: TranscriptListener): () => void {
  transcriptListeners.add(listener);
  return () => { transcriptListeners.delete(listener); };
}

export function emitSessionTranscript(update: SessionTranscriptUpdate): void {
  for (const listener of transcriptListeners) {
    try { listener(update); } catch { /* best-effort */ }
  }
}

// --- Session Factory ---

export interface CreateSessionParams {
  channelId: ChannelId;
  chatType?: SessionChatType;
  label?: string;
  provider?: string;
  model?: string;
  userId?: string;
  context?: Record<string, unknown>;
}

export function createSession(params: CreateSessionParams): SessionEntry {
  const now = Date.now();
  const session: SessionEntry = {
    id: randomUUID(),
    label: params.label,
    channelId: params.channelId,
    chatType: params.chatType ?? 'direct',
    state: 'active',
    provider: params.provider,
    model: params.model,
    userId: params.userId,
    context: params.context,
    createdAtMs: now,
    updatedAtMs: now,
    messageCount: 0,
  };

  emitSessionLifecycle({
    sessionId: session.id,
    action: 'created',
    label: session.label,
    timestamp: now,
  });

  return session;
}

// --- Session State Transitions ---

function transitionState(
  session: SessionEntry,
  newState: SessionState,
  action: SessionLifecycleAction,
  reason?: string,
): void {
  session.state = newState;
  session.updatedAtMs = Date.now();
  emitSessionLifecycle({
    sessionId: session.id,
    action,
    reason,
    label: session.label,
    timestamp: session.updatedAtMs,
  });
}

export function pauseSession(session: SessionEntry, reason?: string): void {
  if (session.state !== 'active') return;
  transitionState(session, 'paused', 'paused', reason);
}

export function resumeSession(session: SessionEntry, reason?: string): void {
  if (session.state !== 'paused') return;
  transitionState(session, 'active', 'resumed', reason);
}

export function endSession(session: SessionEntry, reason?: string): void {
  if (session.state === 'ended') return;
  transitionState(session, 'ended', 'ended', reason);
}

// --- Session Update ---

export interface SessionPatch {
  label?: string;
  provider?: string;
  model?: string;
  context?: Record<string, unknown>;
}

export function updateSession(session: SessionEntry, patch: SessionPatch): void {
  if (patch.label !== undefined) session.label = patch.label;
  if (patch.provider !== undefined) session.provider = patch.provider;
  if (patch.model !== undefined) session.model = patch.model;
  if (patch.context !== undefined) session.context = { ...session.context, ...patch.context };
  session.updatedAtMs = Date.now();
  emitSessionLifecycle({
    sessionId: session.id,
    action: 'updated',
    label: session.label,
    timestamp: session.updatedAtMs,
  });
}

// --- Record Message ---

export function recordMessage(
  session: SessionEntry,
  params: { role: 'user' | 'assistant' | 'system'; text: string; meta?: Record<string, unknown> },
): SessionTranscriptUpdate {
  const now = Date.now();
  session.messageCount += 1;
  session.lastMessageAtMs = now;
  session.updatedAtMs = now;

  const update: SessionTranscriptUpdate = {
    sessionId: session.id,
    messageId: `${session.id}_${session.messageCount}`,
    role: params.role,
    text: params.text,
    timestamp: now,
    meta: params.meta,
  };

  emitSessionTranscript(update);
  return update;
}

// --- Input Provenance ---

const INPUT_PROVENANCE_KINDS: readonly InputProvenanceKind[] = [
  'external_user', 'inter_session', 'internal_system',
];

export function normalizeInputProvenance(value: unknown): InputProvenance | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !INPUT_PROVENANCE_KINDS.includes(kind as InputProvenanceKind)) {
    return undefined;
  }
  return {
    kind: kind as InputProvenanceKind,
    sourceSessionId: typeof record.sourceSessionId === 'string' ? record.sourceSessionId.trim() || undefined : undefined,
    sourceChannel: typeof record.sourceChannel === 'string' ? record.sourceChannel.trim() || undefined : undefined,
  };
}
