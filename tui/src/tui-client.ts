/**
 * JHT TUI Client — implementazione JhtChatClient che chiama Anthropic API direttamente.
 * Legge API key da ANTHROPIC_API_KEY env o ~/.jht/jht.config.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { JhtChatClient } from "./tui-command-handlers.js";
import type { JhtAgent, ChatEvent } from "./tui-types.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const SYSTEM_PROMPT = `Sei l'assistente AI del Job Hunter Team. Aiuti l'utente nella ricerca lavoro: scrivi cover letter, prepari colloqui, analizzi offerte, ottimizzi CV. Rispondi in italiano, sii conciso e pratico.`;

export function loadApiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".jht", "jht.config.json"), "utf-8"));
    const key = cfg?.providers?.claude?.api_key ?? cfg?.providers?.anthropic?.api_key;
    if (key) return key;
  } catch { /* ignore */ }
  return null;
}

type ConversationMessage = { role: "user" | "assistant"; content: string };

export type ChatEventCallback = (event: ChatEvent) => void;

export function createTuiClient(onChatEvent: ChatEventCallback, apiKeyOverride?: string): JhtChatClient & { history: ConversationMessage[] } {
  const apiKey = apiKeyOverride ?? loadApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configurata");
  const abortControllers = new Map<string, AbortController>();
  const history: ConversationMessage[] = [];

  const sendChat: JhtChatClient["sendChat"] = async (params) => {
    const { message, runId, sessionKey } = params;
    history.push({ role: "user", content: message });

    const controller = new AbortController();
    abortControllers.set(runId, controller);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          stream: true,
          messages: history.slice(-20),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onChatEvent({
                runId, sessionKey,
                state: "delta",
                message: { text: fullText, content: fullText },
              });
            }
            if (parsed.type === "message_stop") {
              break;
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      history.push({ role: "assistant", content: fullText });
      onChatEvent({
        runId, sessionKey,
        state: "final",
        message: { text: fullText, content: fullText, stopReason: "end_turn" },
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        onChatEvent({ runId, sessionKey, state: "aborted" });
      } else {
        history.pop(); // rimuovi il messaggio user fallito
        onChatEvent({
          runId, sessionKey,
          state: "error",
          errorMessage: String((err as Error).message ?? err),
        });
      }
    } finally {
      abortControllers.delete(runId);
    }
  };

  const getStatus: JhtChatClient["getStatus"] = async () => ({
    runtimeVersion: "jht-tui-client 1.0",
    isConnected: true,
    activeRuns: abortControllers.size,
    model: MODEL,
    historyLength: history.length,
  });

  const abortRun: JhtChatClient["abortRun"] = async (_sessionKey) => {
    for (const [, ctrl] of abortControllers) ctrl.abort();
  };

  const listAgents: JhtChatClient["listAgents"] = async () => {
    const roles = ["scout", "analista", "assistente", "critico", "scorer", "scrittore", "sentinella", "alfa"];
    return roles.map<JhtAgent>(r => ({ id: r, name: r, role: r, status: "idle" }));
  };

  return { sendChat, getStatus, abortRun, listAgents, history };
}
