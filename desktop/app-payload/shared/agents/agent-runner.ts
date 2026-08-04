/**
 * Agent Runner — Esecuzione turno agente con tool loop
 */

import type {
  AgentCommandOpts,
  AgentRunResult,
  AgentPayload,
  AgentUsage,
  AgentEvent,
  AgentEventListener,
  ResolvedAgent,
} from "./types.js";
import type { Tool, ToolResult } from "../tools/types.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minuti
const MAX_TOOL_ITERATIONS = 50;

// --- Event bus ---

const listeners = new Set<AgentEventListener>();

export function onAgentEvent(listener: AgentEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(event: Omit<AgentEvent, "ts">): void {
  const enriched = { ...event, ts: Date.now() } as AgentEvent;
  for (const listener of listeners) {
    try { listener(enriched); } catch { /* ignora */ }
  }
}

// --- Tool execution ---

async function executeTool(
  tools: Tool[],
  toolName: string,
  toolCallId: string,
  args: unknown,
  signal: AbortSignal,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Tool non trovato: ${toolName}` }],
      details: { error: "tool_not_found" },
    };
  }
  return tool.execute(toolCallId, args, signal);
}

// --- Provider callback type ---

export type LLMProviderFn = (params: {
  model: string;
  provider: string;
  messages: LLMMessage[];
  tools: LLMToolDef[];
  signal: AbortSignal;
}) => Promise<LLMResponse>;

export type LLMMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: LLMToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMToolDef = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
};

export type LLMResponse = {
  content: string;
  tool_calls?: LLMToolCall[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
};

// --- Main runner ---

export async function runAgentTurn(
  agent: ResolvedAgent,
  opts: AgentCommandOpts,
  llmCall: LLMProviderFn,
): Promise<AgentRunResult> {
  const startMs = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tools = opts.tools ?? [];
  const abortController = new AbortController();
  const signal = opts.abortSignal ?? abortController.signal;

  const payloads: AgentPayload[] = [];
  const totalUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  const toolDefs: LLMToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const messages: LLMMessage[] = [{ role: "user", content: opts.message }];

  emit({ type: "turn_start", agentId: agent.id, sessionId: opts.sessionId });

  let stopReason: AgentRunResult["stopReason"] = "end_turn";
  let iterations = 0;

  try {
    while (iterations < MAX_TOOL_ITERATIONS) {
      if (signal.aborted) { stopReason = "timeout"; break; }
      iterations++;

      const response = await llmCall({
        model: opts.model ?? agent.model,
        provider: opts.provider ?? agent.provider,
        messages,
        tools: toolDefs,
        signal,
      });

      totalUsage.inputTokens += response.usage.input_tokens;
      totalUsage.outputTokens += response.usage.output_tokens;
      totalUsage.totalTokens = totalUsage.inputTokens + totalUsage.outputTokens;

      if (response.content) {
        payloads.push({ kind: "text", text: response.content });
      }

      if (!response.tool_calls?.length || response.stop_reason === "end_turn") {
        stopReason = "end_turn";
        break;
      }

      if (response.stop_reason === "max_tokens") {
        stopReason = "max_tokens";
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        let args: unknown;
        try { args = JSON.parse(tc.arguments); } catch { args = {}; }

        payloads.push({ kind: "tool_use", toolName: tc.name, toolCallId: tc.id, args });
        emit({ type: "tool_call", agentId: agent.id, sessionId: opts.sessionId,
          payload: { kind: "tool_use", toolName: tc.name, toolCallId: tc.id, args } });

        const result = await executeTool(tools, tc.name, tc.id, args, signal);
        const resultText = result.content.map((c) => c.text).join("\n");

        payloads.push({ kind: "tool_result", toolCallId: tc.id, content: resultText });
        messages.push({ role: "tool", tool_call_id: tc.id, content: resultText });

        emit({ type: "tool_result", agentId: agent.id, sessionId: opts.sessionId,
          payload: { kind: "tool_result", toolCallId: tc.id, content: resultText } });
      }
    }
  } catch (err) {
    stopReason = "error";
    const errorMsg = (err as Error).message;
    payloads.push({ kind: "error", message: errorMsg });
    emit({ type: "error", agentId: agent.id, sessionId: opts.sessionId,
      payload: { kind: "error", message: errorMsg } });
  } finally {
    clearTimeout(timer);
  }

  const runResult: AgentRunResult = {
    payloads,
    usage: totalUsage,
    model: opts.model ?? agent.model,
    provider: opts.provider ?? agent.provider,
    stopReason,
    durationMs: Date.now() - startMs,
    error: stopReason === "error" ? payloads.find((p) => p.kind === "error")?.message : undefined,
  };

  emit({ type: "turn_end", agentId: agent.id, sessionId: opts.sessionId, result: runResult });

  return runResult;
}
