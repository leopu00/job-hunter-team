/**
 * Hook System — Tipi e interfacce
 *
 * Definisce hook, eventi, handler, sorgenti e policy.
 * I hook intercettano azioni pre/post nel lifecycle agenti.
 */

// --- Hook Event ---

export type HookEventType = "command" | "session" | "agent" | "message" | "gateway";

export type HookEvent = {
  type: HookEventType;
  action: string;
  agentId?: string;
  sessionId?: string;
  timestamp: number;
  context: Record<string, unknown>;
  /** I handler possono pushare messaggi da inviare all'utente */
  messages: string[];
};

// --- Hook Handler ---

export type HookHandler = (event: HookEvent) => Promise<void> | void;

// --- Hook Source & Precedence ---

export type HookSource = "bundled" | "plugin" | "managed" | "workspace";

/** Precedenza: bundled(10) < plugin(20) < managed(30) < workspace(40) */
export const HOOK_SOURCE_PRECEDENCE: Record<HookSource, number> = {
  bundled: 10,
  plugin: 20,
  managed: 30,
  workspace: 40,
};

// --- Hook Definition ---

export type Hook = {
  name: string;
  description: string;
  source: HookSource;
  pluginId?: string;
  baseDir: string;
  handlerPath: string;
};

export type HookMetadata = {
  emoji?: string;
  events: string[];
  always?: boolean;
  requires?: HookRequirements;
};

export type HookRequirements = {
  env?: string[];
  bins?: string[];
  config?: string[];
};

export type HookEntry = {
  hook: Hook;
  metadata: HookMetadata;
  enabled: boolean;
};

// --- Hook Config ---

export type HookConfig = {
  enabled?: boolean;
  env?: Record<string, string>;
  [key: string]: unknown;
};

export type HooksConfig = {
  enabled?: boolean;
  entries?: Record<string, HookConfig>;
};

// --- Message Hook Contexts ---

export type MessageReceivedContext = {
  from: string;
  content: string;
  channelId: string;
  timestamp?: number;
  accountId?: string;
  messageId?: string;
};

export type MessageSentContext = {
  to: string;
  content: string;
  channelId: string;
  success: boolean;
  error?: string;
  messageId?: string;
};
