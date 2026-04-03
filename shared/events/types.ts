/**
 * Event System — Tipi e interfacce
 *
 * Pub/sub tipizzato tra moduli con sequencing, stream,
 * contesto run e gestione stato globale singleton.
 */

// --- Listener utilities ---

export type EventListener<T> = (event: T) => void;
export type Unsubscribe = () => void;

// --- Event Bus ---

export type EventBusOptions = {
  /** Nome del bus (per debug) */
  name?: string;
  /** Callback errori nei listener */
  onError?: (error: unknown, listenerIndex: number) => void;
};

// --- Event Streams ---

export type EventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

// --- Event Payload ---

export type EventPayload<TData = Record<string, unknown>> = {
  stream: EventStream;
  ts: number;
  seq: number;
  data: TData;
  runId?: string;
  sessionId?: string;
  agentId?: string;
};

// --- Typed Event Channels ---

export type AgentEventData =
  | { kind: "turn_start"; message: string }
  | { kind: "turn_end"; stopReason: string; durationMs: number }
  | { kind: "tool_call"; toolName: string; args: unknown }
  | { kind: "tool_result"; toolName: string; content: string }
  | { kind: "text"; text: string }
  | { kind: "error"; message: string };

export type SystemEventData =
  | { kind: "startup"; version?: string }
  | { kind: "shutdown"; reason?: string }
  | { kind: "config_changed"; path: string }
  | { kind: "hook_fired"; hookName: string; event: string };

export type MessageEventData =
  | { kind: "received"; from: string; channelId: string; content: string }
  | { kind: "sent"; to: string; channelId: string; success: boolean }
  | { kind: "failed"; to: string; channelId: string; error: string };

// --- Run Context ---

export type RunContext = {
  sessionId?: string;
  agentId?: string;
  isHeartbeat?: boolean;
};
