/**
 * Agent System — Tipi e interfacce
 *
 * Definisce configurazione agente, sessione, comandi,
 * risultati di esecuzione e payload.
 */

import type { Tool } from "../tools/types.js";

// --- Agent Config ---

export type AgentConfig = {
  id: string;
  name: string;
  default?: boolean;
  model?: string;
  provider?: string;
  workspace?: string;
  skills?: string[];
  thinking?: ThinkLevel;
  contextTokens?: number;
  sandbox?: boolean;
};

export type AgentsConfig = {
  defaults: AgentDefaults;
  list: AgentConfig[];
};

export type AgentDefaults = {
  model?: string;
  provider?: string;
  workspace?: string;
  contextTokens?: number;
  thinking?: ThinkLevel;
};

export type ThinkLevel = "off" | "low" | "medium" | "high";

// --- Resolved Agent ---

export type ResolvedAgent = {
  id: string;
  name: string;
  model: string;
  provider: string;
  workspaceDir: string;
  agentDir: string;
  skills?: string[];
  thinking: ThinkLevel;
  contextTokens: number;
};

// --- Session ---

export type AgentSession = {
  sessionId: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  modelOverride?: string;
  providerOverride?: string;
  thinkingLevel?: ThinkLevel;
  transcriptPath?: string;
};

// --- Command ---

export type AgentCommandOpts = {
  message: string;
  agentId?: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  thinking?: ThinkLevel;
  timeoutMs?: number;
  workspaceDir?: string;
  tools?: Tool[];
  abortSignal?: AbortSignal;
};

// --- Result ---

export type AgentPayload =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolName: string; toolCallId: string; args: unknown }
  | { kind: "tool_result"; toolCallId: string; content: string }
  | { kind: "error"; message: string };

export type AgentRunResult = {
  payloads: AgentPayload[];
  usage: AgentUsage;
  model: string;
  provider: string;
  stopReason: "end_turn" | "max_tokens" | "timeout" | "error";
  durationMs: number;
  error?: string;
};

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

// --- Event ---

export type AgentEventType = "turn_start" | "turn_end" | "tool_call" | "tool_result" | "error";

export type AgentEvent = {
  type: AgentEventType;
  agentId: string;
  sessionId?: string;
  ts: number;
  payload?: AgentPayload;
  result?: AgentRunResult;
};

export type AgentEventListener = (event: AgentEvent) => void;
